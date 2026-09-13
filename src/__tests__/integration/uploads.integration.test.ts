import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { verifyAccessToken } from '../../lib/supabaseJwt';
import { prisma } from '../../lib/prisma';
import { AppRoutes } from '../../presentation/routes';
import { Server } from '../../presentation/server';
import { ROLES } from '../../domain/types/auth.types';

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
});

/** Ids created during the run, cleaned up at the end. */
const createdUploadIds: string[] = [];

const upload = async (content: Buffer, filename = 'sales.json') => {
  const res = await request(app).post(ENDPOINT).attach('file', content, filename);
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
  await prisma.app_user.delete({ where: { id: adminId } });
  await prisma.$executeRaw`delete from auth.users where id = ${ADMIN_AUTH_ID}::uuid`;
  await prisma.$disconnect();
  server.close();
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
      uploaded_by: null,
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
    // id_usuario 26 does not map to any app_user in this suite: not attributable to a route.
    expect(created.user_id).toBeNull();
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
