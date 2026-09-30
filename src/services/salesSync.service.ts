import { DateTime } from 'luxon';

import {
  EfactsoftSaleDetail,
  EfactsoftSaleHeader,
  efactsoftSaleSchema,
  formatZodIssues,
} from '../domain/schemas/efactsoft-sale.schema';
import { ROLES } from '../domain/types/auth.types';
import {
  SellerCreated,
  SellerUnmapped,
  SyncResult,
} from '../domain/types/sales-import.types';
import { logger } from '../lib/adapters/logger';
import { ERP_TIMEZONE, parseErpTimestamp } from '../lib/parseErpDate';
import { Client } from '../lib/prisma';
import { createPendingSellerAuthUser } from './supabaseAdmin.service';

/**
 * Synchronizer of the ERP sales queue (RF-03, PCRM-34).
 *
 * Drains `sale_staging` rows left `pending` by `stageSalesFile` and upserts
 * them into the live tables: `customer`, `product`, `sale`, `sale_detail` and
 * `balance_snapshot`. Every row that reaches this module is already a
 * confirmed sale (`estado = 2`) — quotations never make it into
 * `sale_staging` (CLAUDE.md 5.5, confirmed 2026-09-11).
 *
 * Sellers embedded in the payload are resolved by `erp_user_id` and created
 * when unknown (see `resolveUserId`).
 *
 * Also attempts to attribute each sale to the visit that produced it
 * (CLAUDE.md 5.4): same customer, same Salvadoran calendar day. This is the
 * only path onto `sale.visit_id` — there is no `sale.route_id` — and it is
 * optional by design: a sale with no matching visit is imported anyway, with
 * `visit_id = null` (CLAUDE.md Anexo A #2).
 *
 * Idempotent by construction: it upserts on the ERP natural keys
 * (`customer.erp_customer_id`, `product.erp_product_id`, `sale.erp_sale_id`,
 * `sale_detail.sale_detail_id`), so re-processing the same `upload_id` does
 * not duplicate rows (CLAUDE.md 6.4).
 *
 * `customer.erp_customer_id` sits behind a partial unique index
 * (`WHERE deleted_at IS NULL`, CLAUDE.md 7.0/9.2), which Prisma's `upsert`
 * cannot target with a native `ON CONFLICT` clause. It is resolved instead
 * with an explicit lookup-then-write, repeating the same predicate
 * (CLAUDE.md 9.2). `product.erp_product_id` and `sale.erp_sale_id` are plain
 * primary keys, so `upsert` uses Postgres' `ON CONFLICT` directly for those.
 *
 * No `SAVEPOINT` is used inside a chunk: a database-level failure (e.g. an
 * unexpected FK violation) aborts that chunk's transaction. Earlier committed
 * chunks stay applied; upserts on ERP natural keys make a retry safe
 * (see `importSalesFile.use-case.ts`). In practice mid-chunk failures should
 * be rare, because every row already passed the intake schema
 * (`efactsoftSaleSchema`) before reaching `sale_staging`.
 */

/**
 * How many pending staging rows one sync transaction processes.
 * ~50 × ~14 sequential awaits stays well under Prisma's 120 s TX timeout;
 * a full month (~350–400 sales) therefore needs several chunk transactions
 * instead of one monolithic sync (PCRM-168).
 */
export const SYNC_CHUNK_SIZE = 50;

const toDecimalInput = (value: string | number | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  return typeof value === 'number' ? value.toString() : value.trim();
};

const isZeroBalance = (value: string | number): boolean => Number(value) === 0;

/**
 * `venta.nombres` / `venta.apellidos` are NOT the customer: they correlate
 * 1:1 with `id_usuario` / `usuario` in the real export (the salesperson who
 * processed the sale). `venta.nombre_comercial`, `venta.razon_social`,
 * `venta.telefono`, `venta.celular` and `venta.direccion` are all constant
 * across every sale — Droguería Pragma's own issuer identity (DTE receptor
 * block), not the customer's. Confirmed 2026-09-23: every `customer.phone`
 * had converged on the same value, the owner's own number. The only field
 * that actually varies per customer is `venta.cliente`. Verified against a
 * full production export, 2026-09-19.
 */
const buildCustomerName = (venta: EfactsoftSaleHeader): string =>
  venta.cliente?.trim() || 'Sin nombre';

/**
 * Upserts the customer embedded in the sale header (CLAUDE.md 6.2/9.2).
 * Returns null when the sale has no `id_cliente` (counter sale, CLAUDE.md
 * Appendix A #2 / warnings.sales_without_customer at intake).
 */
const upsertCustomer = async (client: Client, venta: EfactsoftSaleHeader): Promise<string | null> => {
  if (venta.id_cliente === null || venta.id_cliente === undefined) return null;

  // erp_customer_id is unique only WHERE deleted_at IS NULL: the predicate is
  // repeated here by hand instead of relying on Prisma's `upsert`, which
  // would emit an ON CONFLICT that Postgres cannot match against a partial
  // index (CLAUDE.md 9.2).
  const existing = await client.customer.findFirst({
    where: { erp_customer_id: venta.id_cliente, deleted_at: null },
    select: { id: true },
  });

  const shared = {
    name: buildCustomerName(venta),
    // trade_name/address/phone/mobile are deliberately NOT sourced from
    // venta.nombre_comercial/direccion/telefono/celular: those are the
    // issuer's own constant fields (see buildCustomerName above), not the
    // customer's. The payload carries no per-customer contact fields at all;
    // they stay null on import and are set by hand from the dashboard (RF-02)
    // if backend adds that field.
    credit_limit: toDecimalInput(venta.limite_credito ?? null),
    ...(venta.credito !== null && venta.credito !== undefined
      ? { credit: venta.credito === 1 }
      : {}),
  };

  if (existing) {
    const updated = await client.customer.update({
      where: { id: existing.id },
      data: { ...shared, updated_at: new Date() },
      select: { id: true },
    });
    return updated.id;
  }

  const created = await client.customer.create({
    data: { ...shared, erp_customer_id: venta.id_cliente, origin: 'efactsoft' },
    select: { id: true },
  });
  return created.id;
};

/**
 * Salvadoran calendar-day bounds of a UTC instant, as `[start, end)`.
 *
 * `erp_created_at` is a `timestamptz` instant; comparing it to `visit.started_at`
 * with a range predicate on the raw column — instead of casting either side to
 * `::date` — is what CLAUDE.md 5.7 asks for: a `::date` cast on the column would
 * both apply the wrong calendar day for a sale booked after 6 p.m. and defeat
 * the column's index.
 */
const getSalvadoranDayBounds = (instant: Date): { start: Date; end: Date } => {
  const start = DateTime.fromJSDate(instant).setZone(ERP_TIMEZONE).startOf('day');
  return { start: start.toJSDate(), end: start.plus({ days: 1 }).toJSDate() };
};

/**
 * Attributes a sale to the visit that produced it (CLAUDE.md 5.4): same
 * customer, same Salvadoran calendar day. The ERP payload carries no field
 * that names the visit directly, so this is inference, not a foreign key
 * copied from the source — and it is expected to come up empty: a sale with
 * no matching visit stays with `visit_id = null` (CLAUDE.md Anexo A #2).
 *
 * A customer can legitimately have more than one visit the same day (visit,
 * dispatch and collection are separate `visit_type` rows, CLAUDE.md 5.2), and
 * the payload gives no way to tell which one this sale belongs to. Ties are
 * broken by taking the earliest `started_at` of the day — deterministic, but
 * not guaranteed correct; there is no RF that requires better than this.
 */
const findMatchingVisitId = async (
  client: Client,
  customerId: string | null,
  erpCreatedAt: Date
): Promise<string | null> => {
  if (!customerId) return null;

  const { start, end } = getSalvadoranDayBounds(erpCreatedAt);

  const visit = await client.visit.findFirst({
    where: { customer_id: customerId, deleted_at: null, started_at: { gte: start, lt: end } },
    orderBy: { started_at: 'asc' },
    select: { id: true },
  });

  return visit?.id ?? null;
};

/**
 * Per-import bookkeeping for sellers found in the payload. `createdAuthUserIds`
 * is owned by the caller so it can delete those accounts if the surrounding
 * transaction rolls back: Supabase Auth is not part of it.
 */
export interface SellerProvisioning {
  created: SellerCreated[];
  unmapped: SellerUnmapped[];
  createdAuthUserIds: string[];
}

/**
 * Resolves the salesperson of a sale by `erp_user_id` only — the name is never
 * used to match. An unknown id creates the seller on the spot: `Vendedor` role,
 * disabled, no email, and a banned auth account (see
 * `createPendingSellerAuthUser`). An admin sets the email and enables it
 * afterwards, which triggers the standard OTP onboarding. Nothing secret is
 * generated, logged or returned here.
 *
 * Failing to provision an account does not fail the import: the sale is loaded
 * without a seller, the id is reported in `unmapped`, and re-importing the file
 * links it once the problem is gone (`upsertSale` rewrites `user_id`).
 */
const resolveUserId = async (
  client: Client,
  venta: EfactsoftSaleHeader,
  provisioning: SellerProvisioning
): Promise<string | null> => {
  const erpUserId = venta.id_usuario;
  if (erpUserId === null || erpUserId === undefined) return null;

  const existing = await client.app_user.findFirst({
    where: { erp_user_id: erpUserId, deleted_at: null },
    select: { id: true },
  });
  if (existing) return existing.id;

  // Do not retry an id that already failed earlier in this same import.
  if (provisioning.unmapped.some((u) => u.erp_user_id === erpUserId)) return null;

  const name = venta.usuario?.trim() || `Vendedor ERP ${erpUserId}`;

  let authUserId: string;
  try {
    ({ authUserId } = await createPendingSellerAuthUser(erpUserId));
  } catch (error) {
    logger.error('Could not create the auth account for an ERP seller', {
      erp_user_id: erpUserId,
      error,
    });
    provisioning.unmapped.push({
      erp_user_id: erpUserId,
      name,
      reason: 'Could not create the access account',
    });
    return null;
  }
  provisioning.createdAuthUserIds.push(authUserId);

  const created = await client.app_user.create({
    data: {
      erp_user_id: erpUserId,
      name,
      role: ROLES.SELLER,
      active: false,
      auth_user_id: authUserId,
    },
    select: { id: true },
  });
  provisioning.created.push({ erp_user_id: erpUserId, name });

  return created.id;
};

/** Upserts the product embedded in a detail line. `erp_product_id` is a plain PK: a native upsert is safe. */
const upsertProduct = (client: Client, line: EfactsoftSaleDetail): Promise<unknown> =>
  client.product.upsert({
    where: { erp_product_id: line.id_producto },
    create: {
      erp_product_id: line.id_producto,
      code: line.codigo ?? null,
      name: line.nombre,
      product_group: line.grupo_prod ?? null,
      last_seen_at: new Date(),
    },
    update: {
      name: line.nombre,
      code: line.codigo ?? null,
      product_group: line.grupo_prod ?? null,
      last_seen_at: new Date(),
      updated_at: new Date(),
    },
  });

/**
 * Upserts the sale header. Returns whether the row was inserted, for the
 * `upload.inserted` / `upload.updated` counters.
 */
const upsertSale = async (
  client: Client,
  venta: EfactsoftSaleHeader,
  customerId: string | null,
  userId: string | null,
  uploadId: string
): Promise<{ wasInsert: boolean }> => {
  const existing = await client.sale.findUnique({
    where: { erp_sale_id: venta.id_venta },
    select: { erp_created_at: true, last_payment_at: true, visit_id: true },
  });

  // Timestamps come from the payload, never the import time (CLAUDE.md 5.5
  // and 5.7). Both already validated by efactsoftSaleSchema.
  // `fecha_emision` is when the quotation became a sale, the date Efactsoft
  // reports on; `updated_at` moves with every later payment or edit.
  const issuedAt = parseErpTimestamp(venta.fecha_emision)!;
  const updatedAt = parseErpTimestamp(venta.updated_at)!;
  const balanceIsZero = isZeroBalance(venta.saldop);

  // erp_created_at and last_payment_at are stamped once and never overwritten.
  const erpCreatedAt = existing?.erp_created_at ?? issuedAt;
  const lastPaymentAt = existing?.last_payment_at ?? (balanceIsZero ? updatedAt : null);

  // visit_id follows the same "stamp once" rule: once a sale is linked to a
  // visit it stays linked, even if a later re-import would have matched a
  // different one. A sale still unlinked keeps trying on every re-sync, since
  // the matching visit may only get recorded in the field after the sale was
  // first imported.
  const visitId = existing?.visit_id ?? (await findMatchingVisitId(client, customerId, erpCreatedAt));

  const shared = {
    customer_id: customerId,
    user_id: userId,
    visit_id: visitId,
    erp_created_at: erpCreatedAt,
    last_payment_at: lastPaymentAt,
    total: toDecimalInput(venta.total),
    net_total: toDecimalInput(venta.total_neto ?? null),
    vat: toDecimalInput(venta.iva ?? null),
    // Overwritten on every load: this is the current balance, not a stamp
    // (CLAUDE.md 5.5). `balance_snapshot` keeps the history.
    pending_balance: toDecimalInput(venta.saldop),
    payment: venta.pago ?? null,
    payment_id: venta.id_pago ?? null,
    erp_status: venta.estado,
    document: venta.documento ?? null,
    remarks: venta.observaciones ?? null,
    updated_at: new Date(),
  };

  await client.sale.upsert({
    where: { erp_sale_id: venta.id_venta },
    // upload_id is only set at creation: it records which batch first
    // brought the sale in, and is not moved by later re-imports.
    create: { erp_sale_id: venta.id_venta, upload_id: uploadId, ...shared },
    update: shared,
  });

  return { wasInsert: !existing };
};

const upsertSaleDetail = async (
  client: Client,
  erpSaleId: number,
  line: EfactsoftSaleDetail
): Promise<void> => {
  await upsertProduct(client, line);

  const shared = {
    product_id: line.id_producto,
    quantity: toDecimalInput(line.cantidad),
    unit_of_measure: line.um ?? null,
    factor: toDecimalInput(line.factor ?? null),
    price: toDecimalInput(line.precio),
    total: toDecimalInput(line.total),
    tax_total: toDecimalInput(line.total_imp ?? null),
  };

  await client.sale_detail.upsert({
    where: { sale_detail_id: line.id_venta_det },
    create: { sale_detail_id: line.id_venta_det, erp_sale_id: erpSaleId, ...shared },
    update: { ...shared, updated_at: new Date() },
  });
};

/** Counts produced by one sync chunk (before upload finalization). */
export interface SyncChunkResult {
  inserted: number;
  updated: number;
  sync_failed: number;
  /** True when more `pending` rows remain for this upload_id. */
  has_more: boolean;
}

/**
 * Processes up to `limit` pending staging rows for one upload.
 *
 * Does **not** finalize `upload` status — the orchestrator aggregates chunk
 * counts and calls `finalizeUploadSync` once nothing is left pending.
 * Takes `Client` so each chunk can run inside its own `$transaction`.
 */
export const syncStagedSalesChunk = async (
  client: Client,
  uploadId: string,
  provisioning: SellerProvisioning,
  limit: number = SYNC_CHUNK_SIZE
): Promise<SyncChunkResult> => {
  // Fetch one extra row so we know whether another chunk is needed without a
  // separate COUNT round-trip.
  const fetched = await client.sale_staging.findMany({
    where: { upload_id: uploadId, status: 'pending' },
    orderBy: { id: 'asc' },
    take: limit + 1,
  });

  const has_more = fetched.length > limit;
  const pendingRows = has_more ? fetched.slice(0, limit) : fetched;

  let inserted = 0;
  let updated = 0;
  let failed = 0;

  for (const row of pendingRows) {
    // Re-validated defensively: the row already passed this schema at
    // intake, so a mismatch here would mean the JSON payload round-tripped
    // through Postgres differently than expected, not a dirty ERP record.
    const parsed = efactsoftSaleSchema.safeParse(row.payload);
    if (!parsed.success) {
      await client.sale_staging.update({
        where: { id: row.id },
        data: { status: 'failed', error: formatZodIssues(parsed.error), processed_at: new Date() },
      });
      failed += 1;
      continue;
    }

    const { venta, detalle } = parsed.data;

    const customerId = await upsertCustomer(client, venta);
    const userId = await resolveUserId(client, venta, provisioning);
    const { wasInsert } = await upsertSale(client, venta, customerId, userId, uploadId);

    for (const line of detalle) {
      await upsertSaleDetail(client, venta.id_venta, line);
    }

    // A ledger append, never an upsert: it is what lets RF-02 show the
    // history of a balance that `sale.pending_balance` overwrites every load
    // (CLAUDE.md 7.7).
    await client.balance_snapshot.create({
      data: {
        upload_id: uploadId,
        erp_sale_id: venta.id_venta,
        pending_balance: toDecimalInput(venta.saldop),
        payment: venta.pago ?? null,
      },
    });

    await client.sale_staging.update({
      where: { id: row.id },
      data: { status: 'processed', processed_at: new Date() },
    });

    if (wasInsert) inserted += 1;
    else updated += 1;
  }

  return { inserted, updated, sync_failed: failed, has_more };
};

/**
 * Moves an upload from `staged` to `processing` before the sync loop begins,
 * so the in-progress endpoint can report it while the request is still running
 * (PCRM-169). The terminal status is still written by `finalizeUploadSync`.
 */
export const markUploadProcessing = async (client: Client, uploadId: string): Promise<void> => {
  await client.upload.update({
    where: { id: uploadId },
    data: { status: 'processing', updated_at: new Date() },
  });
};

/**
 * Writes aggregated sync counters onto `upload` and sets its terminal status.
 * Same rules as the former end of `syncStagedSales` (CLAUDE.md 8.1).
 */
export const finalizeUploadSync = async (
  client: Client,
  uploadId: string,
  totals: { inserted: number; updated: number; sync_failed: number }
): Promise<void> => {
  const { inserted, updated, sync_failed: failed } = totals;

  await client.upload.update({
    where: { id: uploadId },
    data: {
      inserted,
      updated,
      // Adds to the validation-time failures already set by `stageSalesFile`
      // (CLAUDE.md 8.1): `upload.failed` is one running total, not two.
      ...(failed > 0 ? { failed: { increment: failed } } : {}),
      status: failed > 0 && inserted + updated === 0 ? 'failed' : 'completed',
      updated_at: new Date(),
    },
  });
};

/**
 * Drains every `pending` row of one upload into the live tables on a single
 * `Client` (one transaction when the caller wraps it). Large imports should
 * prefer the chunked orchestration in `importSalesFile` instead.
 */
export const syncStagedSales = async (
  client: Client,
  uploadId: string,
  provisioning: SellerProvisioning = { created: [], unmapped: [], createdAuthUserIds: [] }
): Promise<SyncResult> => {
  let inserted = 0;
  let updated = 0;
  let failed = 0;
  let hasMore = true;

  while (hasMore) {
    const chunk = await syncStagedSalesChunk(client, uploadId, provisioning, SYNC_CHUNK_SIZE);
    inserted += chunk.inserted;
    updated += chunk.updated;
    failed += chunk.sync_failed;
    hasMore = chunk.has_more;
  }

  await finalizeUploadSync(client, uploadId, {
    inserted,
    updated,
    sync_failed: failed,
  });

  return {
    processed: inserted + updated,
    inserted,
    updated,
    sync_failed: failed,
    sellers: {
      created_count: provisioning.created.length,
      created: provisioning.created,
      unmapped: provisioning.unmapped,
    },
  };
};
