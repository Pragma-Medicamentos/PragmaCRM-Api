import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { verifyAccessToken } from '../../lib/supabaseJwt';
import { prisma } from '../../lib/prisma';
import { AppRoutes } from '../../presentation/routes';
import { Server } from '../../presentation/server';
import { randomUUID } from 'crypto';
import { envs } from '../../config/envs';
import { ROLES } from '../../domain/types/auth.types';
import { createPendingSellerAuthUser } from '../../services/supabaseAdmin.service';

/**
 * ERP sales JSON upload against real Postgres (RF-03, PCRM-32 / PCRM-33 /
 * PCRM-34: intake AND synchronization into the live tables, in one request).
 *
 * Runs against the local Supabase database, never against staging or
 * production: loadEnv.ts forces .env.test before the Prisma client is
 * imported.
 *
 * `/api/v1/uploads` requires an authenticated Administrador (confirmed
 * 2026-09-11). Token verification is mocked — this suite is about the sync
 * flow, not the auth layer, which already has its own tests.
 */

jest.mock('../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn(),
  JwksUnavailableError: class extends Error {},
  warmUpJwks: jest.fn(),
}));

// No real service_role key in .env.test: the auth account of a seller created
// by the import is faked, but it still has to exist in auth.users because
// app_user.auth_user_id is guarded by a trigger against that table.
jest.mock('../../services/supabaseAdmin.service', () => ({
  createPendingSellerAuthUser: jest.fn(),
}));

const createPendingSellerAuthUserMock = createPendingSellerAuthUser as jest.Mock;
const fakeAuthUserIds: string[] = [];
const erpUserIdsSeen = new Set<number>();

const verifyAccessTokenMock = verifyAccessToken as unknown as jest.Mock;

/** The identity requireAuth resolves against app_user.auth_user_id. */
const ADMIN_AUTH_ID = 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1';

const ENDPOINT = '/api/v1/uploads/sales';
const REAL_FILE = join(process.cwd(), 'ventas_json_example.json');

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

/** The one Administrador every request in this suite authenticates as. */
let adminId: string;

beforeAll(async () => {
  // app_user.auth_user_id is guarded by a trigger against auth.users, so the
  // identity has to exist before the profile. GoTrue owns this table; here the
  // row is inserted directly because the suite never signs anybody in.
  await prisma.$executeRaw`
    insert into auth.users (id, instance_id, aud, role, email)
    values (
      ${ADMIN_AUTH_ID}::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated', 'authenticated', 'uploads-admin@pragma.test'
    )
    on conflict (id) do nothing`;

  const admin = await prisma.app_user.create({
    data: {
      auth_user_id: ADMIN_AUTH_ID,
      role: ROLES.ADMIN,
      name: 'Admin de integración',
      email: 'uploads-admin@pragma.test',
    },
    select: { id: true },
  });
  adminId = admin.id;
  verifyAccessTokenMock.mockResolvedValue({ sub: ADMIN_AUTH_ID });

  createPendingSellerAuthUserMock.mockImplementation(async (erpUserId: number) => {
    const authUserId = randomUUID();
    await prisma.$executeRaw`
      insert into auth.users (id, instance_id, aud, role, email)
      values (
        ${authUserId}::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid,
        'authenticated', 'authenticated', ${`erp-${erpUserId}@pending.invalid`}
      )`;
    fakeAuthUserIds.push(authUserId);
    erpUserIdsSeen.add(erpUserId);
    return { authUserId };
  });
});

/** Ids created during the run, cleaned up at the end. */
const createdUploadIds: string[] = [];

const upload = async (content: Buffer, filename = 'sales.json') => {
  const res = await request(app)
    .post(ENDPOINT)
    .set('Authorization', 'Bearer integration-token')
    .set('x-api-key', envs.API_KEY)
    .attach('file', content, filename);
  if (res.body?.data?.upload_id) createdUploadIds.push(res.body.data.upload_id);
  return res;
};

const sale = (id: number, overrides: Record<string, unknown> = {}) => ({
  venta: {
    id_venta: id,
    id_cliente: 25,
    id_usuario: 26,
    estado: 2,
    updated_at: '05/09/2026 17:27:56',
    fecha_emision: '2026-09-05 17:27:17',
    total: '3.75',
    saldop: '0.00',
    num_control: '000000000000000',
    ...overrides,
  },
  detalle: [
    {
      id_venta_det: id * 10,
      id_producto: 2,
      nombre: 'ACETAMINOFEN 500MG TAB',
      cantidad: '1.0000',
      precio: '3.7500',
      total: '3.7500',
    },
  ],
});

const toBuffer = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf-8');

afterAll(async () => {
  if (createdUploadIds.length > 0) {
    // balance_snapshot and sale reference `upload` with onDelete: NoAction,
    // so they must go first. sale_detail cascades from sale.
    await prisma.balance_snapshot.deleteMany({ where: { upload_id: { in: createdUploadIds } } });
    await prisma.sale.deleteMany({ where: { upload_id: { in: createdUploadIds } } });
    // sale_staging hangs off upload with ON DELETE CASCADE.
    await prisma.upload.deleteMany({ where: { id: { in: createdUploadIds } } });
  }
  // Synced by the sync tests below (erp_customer_id 25, erp_product_id 2).
  await prisma.customer.deleteMany({ where: { erp_customer_id: 25 } });
  await prisma.product.deleteMany({ where: { erp_product_id: 2 } });
  // Sellers auto-created by the import (their sales are already gone).
  await prisma.app_user.deleteMany({ where: { erp_user_id: { in: [...erpUserIdsSeen] } } });
  await prisma.app_user.delete({ where: { id: adminId } });
  await prisma.$executeRaw`delete from auth.users where id = ${ADMIN_AUTH_ID}::uuid`;
  for (const id of fakeAuthUserIds) {
    await prisma.$executeRaw`delete from auth.users where id = ${id}::uuid`;
  }
  // close() disconnects Prisma too.
  await server.close();
});

describe('upload of the real ERP export', () => {
  // The file is not versioned (5 MB). If it is missing, skip instead of fail.
  const itWithRealFile = existsSync(REAL_FILE) ? it : it.skip;

  itWithRealFile('queues and synchronizes all 346 sales, computing the batch range', async () => {
    const res = await upload(readFileSync(REAL_FILE), 'ventas_json_example.json');

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      sales_received: 346,
      // 2 of the 346 are quotations (estado 1, id_venta 4777/4778): skipped,
      // never staged (CLAUDE.md 5.5, confirmed 2026-09-11).
      accepted: 344,
      rejected: 0,
      range: { from: '2026-08-08', to: '2026-09-05' },
    });
    expect(res.body.data.warnings.quotations_skipped).toBe(2);

    const uploadId = res.body.data.upload_id as string;

    const stored = await prisma.upload.findUniqueOrThrow({ where: { id: uploadId } });
    expect(stored).toMatchObject({
      sales_received: 346,
      failed: 0,
      inserted: 344,
      updated: 0,
      status: 'completed',
      uploaded_by: adminId,
    });
    expect(stored.range_from?.toISOString().slice(0, 10)).toBe('2026-08-08');

    const rows = await prisma.sale_staging.count({ where: { upload_id: uploadId } });
    expect(rows).toBe(344);

    const processed = await prisma.sale_staging.count({
      where: { upload_id: uploadId, status: 'processed' },
    });
    expect(processed).toBe(344);

    const syncedSales = await prisma.sale.count({ where: { upload_id: uploadId } });
    expect(syncedSales).toBe(344);
  }, 60_000);

  itWithRealFile('counts the counter sale with no customer as a control figure', async () => {
    // id_venta 4421 of the real export arrives with no id_cliente.
    const res = await upload(readFileSync(REAL_FILE), 'ventas_json_example.json');

    expect(res.body.data.warnings.sales_without_customer).toBe(1);
  }, 60_000);

  itWithRealFile('keeps the raw payload with the fields the CRM ignores', async () => {
    // 4766 is a confirmed sale (estado 2); 4778 is one of the quotations
    // skipped at intake and never reaches sale_staging.
    const res = await upload(readFileSync(REAL_FILE), 'ventas_json_example.json');

    const row = await prisma.sale_staging.findFirstOrThrow({
      where: { upload_id: res.body.data.upload_id as string, erp_sale_id: 4766 },
    });

    const payload = row.payload as { venta: Record<string, unknown> };
    // Fields the Zod schema does not validate but PCRM-34 needs.
    expect(payload.venta.num_control).toBe('000000000000000');
    expect(payload.venta.tpv).toBe('TERMINAL 1');
    expect(payload.venta.id_pago).toBe(5);
  }, 60_000);

  itWithRealFile('preserves the accents coming from the ERP (UTF-8)', async () => {
    const res = await upload(readFileSync(REAL_FILE), 'ventas_json_example.json');

    const row = await prisma.sale_staging.findFirstOrThrow({
      where: { upload_id: res.body.data.upload_id as string, erp_sale_id: 4766 },
    });

    const payload = row.payload as { venta: Record<string, unknown> };
    expect(payload.venta.apellidos).toBe('Galán');
  }, 60_000);
});

describe('partial batch', () => {
  it('synchronizes the valid ones and leaves the invalid one failed at intake', async () => {
    const res = await upload(
      toBuffer([sale(900_001), { venta: { id_venta: 900_002 }, detalle: [] }, sale(900_003)])
    );

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      sales_received: 3,
      accepted: 2,
      rejected: 1,
      inserted: 2,
      updated: 0,
    });

    const uploadId = res.body.data.upload_id as string;

    const rows = await prisma.sale_staging.findMany({
      where: { upload_id: uploadId },
      orderBy: { erp_sale_id: 'asc' },
    });

    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.status === 'processed')).toHaveLength(2);
    expect(rows.filter((r) => r.processed_at !== null)).toHaveLength(2);

    const failed = rows.find((r) => r.status === 'failed')!;
    expect(failed.erp_sale_id).toBe(900_002);
    expect(failed.error).toContain('detalle');
    expect(failed.processed_at).toBeNull();

    const stored = await prisma.upload.findUniqueOrThrow({ where: { id: uploadId } });
    expect(stored).toMatchObject({ sales_received: 3, failed: 1, inserted: 2, status: 'completed' });

    expect(await prisma.sale.count({ where: { upload_id: uploadId } })).toBe(2);
  });

  it('flags an id_venta duplicated within the same file', async () => {
    const res = await upload(toBuffer([sale(900_010), sale(900_010)]));

    expect(res.body.data).toMatchObject({ accepted: 1, rejected: 1 });
    expect(res.body.data.rejections[0].reason).toContain('more than once');
  });
});

describe('invalid file — nothing is written (CA2 of HU-02)', () => {
  const countUploads = () => prisma.upload.count();

  it('responds 400 to broken JSON without creating the upload', async () => {
    const before = await countUploads();

    const res = await upload(Buffer.from('[{"venta":', 'utf-8'));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not valid JSON/i);
    expect(await countUploads()).toBe(before);
  });

  it('responds 422 to an object at the root without creating the upload', async () => {
    const before = await countUploads();

    const res = await upload(toBuffer({ ventas: [] }));

    expect(res.status).toBe(422);
    expect(await countUploads()).toBe(before);
  });

  it('responds 422 when no sale is valid, without creating the upload', async () => {
    const before = await countUploads();

    const res = await upload(toBuffer([{ nothing: 1 }, { nope: 2 }]));

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/no sale in the file/i);
    expect(await countUploads()).toBe(before);
  });

  it('responds 400 when the extension is not .json', async () => {
    const before = await countUploads();

    const res = await upload(toBuffer([sale(900_020)]), 'sales.txt');

    expect(res.status).toBe(400);
    expect(await countUploads()).toBe(before);
  });
});

describe('synchronization into the live tables (PCRM-34)', () => {
  it('upserts customer, product, sale, sale_detail and a balance_snapshot', async () => {
    const res = await upload(toBuffer([sale(900_030)]));
    const uploadId = res.body.data.upload_id as string;

    const created = await prisma.sale.findUniqueOrThrow({
      where: { erp_sale_id: 900_030 },
      include: { sale_detail: true },
    });
    expect(created.upload_id).toBe(uploadId);
    expect(created.pending_balance?.toString()).toBe('0');
    expect(created.erp_created_at).not.toBeNull();
    expect(created.last_payment_at).not.toBeNull(); // saldop 0.00 on arrival
    // id_usuario 26 was unknown: the import created its seller and linked the sale.
    const seller = await prisma.app_user.findFirstOrThrow({ where: { erp_user_id: 26, deleted_at: null } });
    expect(created.user_id).toBe(seller.id);
    expect(created.sale_detail).toHaveLength(1);

    const customer = await prisma.customer.findFirstOrThrow({ where: { erp_customer_id: 25 } });
    expect(created.customer_id).toBe(customer.id);

    await prisma.product.findUniqueOrThrow({ where: { erp_product_id: 2 } });

    const snapshot = await prisma.balance_snapshot.findFirstOrThrow({
      where: { erp_sale_id: 900_030, upload_id: uploadId },
    });
    expect(snapshot.pending_balance?.toString()).toBe('0');
  });

  it('re-processing the same sale updates instead of duplicating (idempotent upsert)', async () => {
    await upload(toBuffer([sale(900_031, { saldop: '10.00' })]));
    const before = await prisma.sale.findUniqueOrThrow({ where: { erp_sale_id: 900_031 } });
    expect(before.pending_balance?.toString()).toBe('10');
    expect(before.last_payment_at).toBeNull();

    const second = await upload(toBuffer([sale(900_031, { saldop: '0.00' })]));
    expect(second.body.data).toMatchObject({ inserted: 0, updated: 1 });

    const after = await prisma.sale.findUniqueOrThrow({ where: { erp_sale_id: 900_031 } });
    expect(after.pending_balance?.toString()).toBe('0');
    // erp_created_at is stamped once and never overwritten (CLAUDE.md 5.5).
    expect(after.erp_created_at?.toISOString()).toBe(before.erp_created_at?.toISOString());
    // last_payment_at stamps the first time the balance reaches zero.
    expect(after.last_payment_at).not.toBeNull();

    expect(await prisma.sale.count({ where: { erp_sale_id: 900_031 } })).toBe(1);
  });
});

describe('sellers found in the payload', () => {
  const ERP_USER_ID = 987_001;
  const sellerSale = (id: number, name = 'Vendedor de Prueba') =>
    sale(id, { id_usuario: ERP_USER_ID, usuario: name });

  it('creates an unknown seller disabled, reports it, and links the sale to it', async () => {
    const res = await upload(toBuffer([sellerSale(900_040)]));

    expect(res.status).toBe(201);
    expect(res.body.data.sellers).toEqual({
      created_count: 1,
      created: [{ erp_user_id: ERP_USER_ID, name: 'Vendedor de Prueba' }],
      unmapped: [],
    });

    const seller = await prisma.app_user.findFirstOrThrow({ where: { erp_user_id: ERP_USER_ID } });
    expect(seller).toMatchObject({ role: ROLES.SELLER, active: false, email: null });
    expect(seller.auth_user_id).not.toBeNull();

    const linked = await prisma.sale.findUniqueOrThrow({ where: { erp_sale_id: 900_040 } });
    expect(linked.user_id).toBe(seller.id);
  });

  it('maps by erp_user_id, ignoring a different name, and does not duplicate on re-import', async () => {
    await upload(toBuffer([sellerSale(900_041)]));
    const authCallsBefore = createPendingSellerAuthUserMock.mock.calls.length;

    const res = await upload(toBuffer([sellerSale(900_041, 'Otro Nombre Distinto')]));

    expect(res.body.data.sellers).toEqual({ created_count: 0, created: [], unmapped: [] });
    expect(createPendingSellerAuthUserMock.mock.calls.length).toBe(authCallsBefore);
    expect(await prisma.app_user.count({ where: { erp_user_id: ERP_USER_ID, deleted_at: null } })).toBe(1);
    const seller = await prisma.app_user.findFirstOrThrow({ where: { erp_user_id: ERP_USER_ID } });
    expect(seller.name).toBe('Vendedor de Prueba');
  });

  it('links to a seller the admin already created with that erp_user_id', async () => {
    const existingErpId = 987_002;
    erpUserIdsSeen.add(existingErpId);
    const existing = await prisma.app_user.create({
      data: { role: ROLES.SELLER, name: 'Manual', erp_user_id: existingErpId, active: true },
      select: { id: true },
    });
    const authCallsBefore = createPendingSellerAuthUserMock.mock.calls.length;

    const res = await upload(toBuffer([sale(900_042, { id_usuario: existingErpId, usuario: 'Manual' })]));

    expect(res.body.data.sellers.created_count).toBe(0);
    expect(createPendingSellerAuthUserMock.mock.calls.length).toBe(authCallsBefore);
    const linked = await prisma.sale.findUniqueOrThrow({ where: { erp_sale_id: 900_042 } });
    expect(linked.user_id).toBe(existing.id);
  });
});

describe('reconciliation: the CRM mirrors the file within its range', () => {
  // Each test uses its own day in 2027 so the range of one upload never
  // reaches the sales of another test.
  // `day` is yyyy-MM-dd; created_at travels as dd/MM/yyyy, like the real export.
  const erpDay = (day: string) => day.split('-').reverse().join('/');

  /** Created and emitted the same day unless `emittedOn` says otherwise. */
  const onDay = (
    id: number,
    day: string,
    overrides: Record<string, unknown> = {},
    emittedOn: string = day
  ) =>
    sale(id, {
      created_at: `${erpDay(day)} 09:00:00`,
      fecha_emision: `${emittedOn} 10:00:00`,
      ...overrides,
    });

  const isLive = async (erpSaleId: number) =>
    (await prisma.sale.findUniqueOrThrow({ where: { erp_sale_id: erpSaleId } })).deleted_at === null;

  it('soft-deletes a sale in the range that the new file no longer carries, without duplicating the rest', async () => {
    const day = '2027-01-15';
    await upload(toBuffer([onDay(900_101, day), onDay(900_102, day), onDay(900_103, day)]));

    const res = await upload(toBuffer([onDay(900_101, day), onDay(900_103, day)]));

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ inserted: 0, updated: 2, removed: { annulled: 0, missing: 1 } });
    expect(await isLive(900_101)).toBe(true);
    expect(await isLive(900_102)).toBe(false);
    expect(await isLive(900_103)).toBe(true);
    expect(await prisma.sale.count({ where: { erp_sale_id: { in: [900_101, 900_103] } } })).toBe(2);
  });

  it('does not touch sales outside the range of the file', async () => {
    await upload(toBuffer([onDay(900_111, '2027-01-10')]));

    const res = await upload(toBuffer([onDay(900_112, '2027-01-20')]));

    expect(res.body.data.removed).toEqual({ annulled: 0, missing: 0 });
    expect(await isLive(900_111)).toBe(true);
  });

  it('keeps a sale whose entry was rejected at intake: a dirty record is not an absence', async () => {
    const day = '2027-01-22';
    await upload(toBuffer([onDay(900_121, day), onDay(900_122, day)]));

    const dirty = { venta: { id_venta: 900_122 }, detalle: [] };
    const res = await upload(toBuffer([onDay(900_121, day), dirty]));

    expect(res.body.data).toMatchObject({ rejected: 1, removed: { annulled: 0, missing: 0 } });
    expect(await isLive(900_122)).toBe(true);
  });

  it('soft-deletes an annulled sale (estado 3), even outside the range', async () => {
    await upload(toBuffer([onDay(900_131, '2027-01-05')]));

    // No dates on the annulment: it is removed by id, so it does not need to
    // fall in the export range (and it does not widen it).
    const annulled = { venta: { id_venta: 900_131, estado: 3 }, detalle: [] };
    const res = await upload(toBuffer([onDay(900_132, '2027-01-25'), annulled]));

    expect(res.body.data).toMatchObject({
      accepted: 1,
      warnings: { annulled_sales: 1 },
      removed: { annulled: 1, missing: 0 },
    });
    expect(await isLive(900_131)).toBe(false);

    const staged = await prisma.sale_staging.findFirstOrThrow({
      where: { upload_id: res.body.data.upload_id as string, erp_sale_id: 900_131 },
    });
    expect(staged.status).toBe('annulled');
  });

  it('scopes the range by created_at: a sale created before the export but emitted inside it stays', async () => {
    // Quoted on 27/02, emitted on 02/03: the March export (by created_at)
    // does not carry it, though its fecha_emision falls in March.
    await upload(toBuffer([onDay(900_151, '2027-02-27', {}, '2027-03-02')]));

    const res = await upload(toBuffer([onDay(900_152, '2027-03-01', {}, '2027-03-02')]));

    expect(res.body.data.export_range).toEqual({ from: '2027-03-01', to: '2027-03-01' });
    expect(res.body.data.removed).toEqual({ annulled: 0, missing: 0 });
    expect(await isLive(900_151)).toBe(true);
  });

  it('removes nothing as missing when the file carries no created_at', async () => {
    const day = '2027-02-10';
    await upload(toBuffer([onDay(900_161, day), onDay(900_162, day)]));

    const res = await upload(toBuffer([sale(900_161, { fecha_emision: `${day} 10:00:00` })]));

    expect(res.body.data.removed).toEqual({ annulled: 0, missing: 0 });
    expect(await isLive(900_162)).toBe(true);
  });

  it('restores a removed sale when a later file carries it again', async () => {
    const day = '2027-01-28';
    await upload(toBuffer([onDay(900_141, day), onDay(900_142, day)]));
    await upload(toBuffer([onDay(900_141, day)]));
    expect(await isLive(900_142)).toBe(false);

    const res = await upload(toBuffer([onDay(900_141, day), onDay(900_142, day)]));

    expect(res.body.data).toMatchObject({ inserted: 0, updated: 2 });
    expect(await isLive(900_142)).toBe(true);
  });
});

describe('prospect conversion on import (PCRM-186)', () => {
  // March 2026: away from the dates the other tests reconcile.
  const march = (day: string) => ({
    fecha_emision: `2026-03-${day} 10:00:00`,
    updated_at: `${day}/03/2026 10:00:00`,
  });
  const SALE_IDS = [900_186, 900_187];
  const CUSTOMER_ERP_IDS = [98_601, 98_602, 98_603];
  const prospectIds: string[] = [];

  beforeAll(async () => {
    // Already in the CRM before the upload, sharing a name with one coming in.
    await prisma.customer.create({
      data: { erp_customer_id: 98_601, name: 'FARMACIA  GEMELA IMPORT', origin: 'efactsoft' },
    });
    for (const name of ['farmacia   conversión  import', 'Farmacia Gemela Import']) {
      const p = await prisma.prospect.create({ data: { user_id: adminId, name } });
      prospectIds.push(p.id);
    }
  });

  afterAll(async () => {
    await prisma.balance_snapshot.deleteMany({ where: { erp_sale_id: { in: SALE_IDS } } });
    await prisma.sale.deleteMany({ where: { erp_sale_id: { in: SALE_IDS } } });
    await prisma.prospect.deleteMany({ where: { id: { in: prospectIds } } });
    await prisma.customer.deleteMany({ where: { erp_customer_id: { in: CUSTOMER_ERP_IDS } } });
  });

  it('converts the prospect with one matching customer and only alerts on a shared name', async () => {
    const res = await upload(
      toBuffer([
        sale(SALE_IDS[0], { id_cliente: 98_602, cliente: 'Farmacia Conversion Import', ...march('10') }),
        sale(SALE_IDS[1], { id_cliente: 98_603, cliente: 'Farmacia Gemela Import', ...march('11') }),
      ])
    );

    expect(res.status).toBe(201);
    const [converted, ambiguous] = prospectIds;
    // The run scans every active prospect, so a seeded database adds its own
    // rows: look only at the two this test created.
    const ownConversions = res.body.data.prospects.converted.filter(
      (c: { prospect_id: string }) => prospectIds.includes(c.prospect_id)
    );
    const ownAlerts = res.body.data.prospects.alerts.filter(
      (a: { prospect_id: string }) => prospectIds.includes(a.prospect_id)
    );
    expect(ownConversions).toEqual([
      expect.objectContaining({
        prospect_id: converted,
        customer_name: 'Farmacia Conversion Import',
        moved_stops: 0,
      }),
    ]);
    expect(ownAlerts).toEqual([expect.objectContaining({ prospect_id: ambiguous })]);
    expect(ownAlerts[0].candidates.map((c: { erp_customer_id: number }) => c.erp_customer_id)).toEqual([
      98_601, 98_603,
    ]);
    expect(res.body.message).toMatch(/converted to customer/);
    expect(res.body.message).toMatch(/more than one customer by name/);

    const rows = await prisma.prospect.findMany({
      where: { id: { in: prospectIds } },
      select: { id: true, active: true, customer_id: true, converted_at: true },
    });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[converted]).toMatchObject({ active: false });
    expect(byId[converted].customer_id).not.toBeNull();
    expect(byId[converted].converted_at).not.toBeNull();
    expect(byId[ambiguous]).toMatchObject({ active: true, customer_id: null, converted_at: null });
  });

  it('does not convert again on a re-upload', async () => {
    const res = await upload(
      toBuffer([sale(SALE_IDS[0], { id_cliente: 98_602, cliente: 'Farmacia Conversion Import', ...march('10') })])
    );

    expect(res.status).toBe(201);
    expect(
      res.body.data.prospects.converted.filter((c: { prospect_id: string }) =>
        prospectIds.includes(c.prospect_id)
      )
    ).toEqual([]);
  });
});
