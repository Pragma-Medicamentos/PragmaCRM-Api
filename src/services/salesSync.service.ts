import {
  EfactsoftSaleDetail,
  EfactsoftSaleHeader,
  efactsoftSaleSchema,
  formatZodIssues,
} from '../domain/schemas/efactsoft-sale.schema';
import { SyncResult } from '../domain/types/sales-import.types';
import { parseErpTimestamp } from '../lib/parseErpDate';
import { Client } from '../lib/prisma';

/**
 * Synchronizer of the ERP sales queue (RF-03, PCRM-34).
 *
 * Drains `sale_staging` rows left `pending` by `stageSalesFile` and upserts
 * them into the live tables: `customer`, `product`, `sale`, `sale_detail` and
 * `balance_snapshot`. Every row that reaches this module is already a
 * confirmed sale (`estado = 2`) — quotations never make it into
 * `sale_staging` (CLAUDE.md 5.5, confirmed 2026-09-11).
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
 * No `SAVEPOINT` is used inside the batch: this runs inside the same
 * transaction as `stageSalesFile` (see `importSalesFile.use-case.ts`), and a
 * database-level failure (e.g. an unexpected FK violation) aborts the whole
 * transaction rather than just the offending row. In practice this should be
 * rare, because every row already passed the intake schema
 * (`efactsoftSaleSchema`) before reaching `sale_staging`.
 */

const toDecimalInput = (value: string | number | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  return typeof value === 'number' ? value.toString() : value.trim();
};

const isZeroBalance = (value: string | number): boolean => Number(value) === 0;

const buildCustomerName = (venta: EfactsoftSaleHeader): string => {
  const fullName = [venta.nombres, venta.apellidos].filter(Boolean).join(' ').trim();
  return fullName || venta.cliente?.trim() || venta.nombre_comercial?.trim() || 'Sin nombre';
};

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
    trade_name: venta.nombre_comercial ?? null,
    address: venta.direccion ?? null,
    phone: venta.telefono ?? null,
    mobile: venta.celular ?? null,
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

/** Finds an existing salesperson by the ERP link. Never creates one — sellers are managed via RF-01. */
const findUserId = async (client: Client, erpUserId: number | null | undefined): Promise<string | null> => {
  if (erpUserId === null || erpUserId === undefined) return null;

  const user = await client.app_user.findFirst({
    where: { erp_user_id: erpUserId, deleted_at: null },
    select: { id: true },
  });
  return user?.id ?? null;
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
    select: { erp_created_at: true, last_payment_at: true },
  });

  // Timestamps come from the payload's `updated_at`, never the import time
  // (CLAUDE.md 5.5 and 5.7). Already validated by efactsoftSaleSchema.
  const updatedAt = parseErpTimestamp(venta.updated_at)!;
  const balanceIsZero = isZeroBalance(venta.saldop);

  // erp_created_at and last_payment_at are stamped once and never overwritten.
  const erpCreatedAt = existing?.erp_created_at ?? updatedAt;
  const lastPaymentAt = existing?.last_payment_at ?? (balanceIsZero ? updatedAt : null);

  const shared = {
    customer_id: customerId,
    user_id: userId,
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

/**
 * Drains every `pending` row of one upload into the live tables.
 *
 * Takes `Client` so it can run inside the same `$transaction` as
 * `stageSalesFile` (CLAUDE.md 8.1).
 */
export const syncStagedSales = async (client: Client, uploadId: string): Promise<SyncResult> => {
  const pendingRows = await client.sale_staging.findMany({
    where: { upload_id: uploadId, status: 'pending' },
    orderBy: { id: 'asc' },
  });

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
    const userId = await findUserId(client, venta.id_usuario);
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

  return { processed: inserted + updated, inserted, updated, sync_failed: failed };
};
