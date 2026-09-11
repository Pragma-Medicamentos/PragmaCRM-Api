import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { prisma } from '../../lib/prisma';
import { AppRoutes } from '../../presentation/routes';
import { Server } from '../../presentation/server';

/**
 * ERP sales JSON upload against real Postgres (RF-03, PCRM-32 / PCRM-33).
 *
 * Runs against the local Supabase database, never against staging or
 * production: loadEnv.ts forces .env.test before the Prisma client is
 * imported.
 */

const ENDPOINT = '/api/v1/uploads/sales';
const REAL_FILE = join(process.cwd(), 'ventas_json_example.json');

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

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
  // sale_staging hangs off upload with ON DELETE CASCADE.
  if (createdUploadIds.length > 0) {
    await prisma.upload.deleteMany({ where: { id: { in: createdUploadIds } } });
  }
  await prisma.$disconnect();
  server.close();
});

describe('upload of the real ERP export', () => {
  // The file is not versioned (5 MB). If it is missing, skip instead of fail.
  const itWithRealFile = existsSync(REAL_FILE) ? it : it.skip;

  itWithRealFile('queues all 346 sales and computes the batch range', async () => {
    const res = await upload(readFileSync(REAL_FILE), 'ventas_json_example.json');

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      sales_received: 346,
      accepted: 346,
      rejected: 0,
      range: { from: '2026-08-08', to: '2026-09-05' },
    });

    const uploadId = res.body.data.upload_id as string;

    const stored = await prisma.upload.findUniqueOrThrow({ where: { id: uploadId } });
    expect(stored).toMatchObject({
      sales_received: 346,
      failed: 0,
      inserted: 0, // filled by PCRM-34
      updated: 0,
      status: 'staged',
      uploaded_by: null,
    });
    expect(stored.range_from?.toISOString().slice(0, 10)).toBe('2026-08-08');

    const rows = await prisma.sale_staging.count({ where: { upload_id: uploadId } });
    expect(rows).toBe(346);

    const pending = await prisma.sale_staging.count({
      where: { upload_id: uploadId, status: 'pending' },
    });
    expect(pending).toBe(346);
  }, 60_000);

  itWithRealFile('counts the counter sale with no customer as a control figure', async () => {
    // id_venta 4421 of the real export arrives with no id_cliente.
    const res = await upload(readFileSync(REAL_FILE), 'ventas_json_example.json');

    expect(res.body.data.warnings.sales_without_customer).toBe(1);
  }, 60_000);

  itWithRealFile('keeps the raw payload with the fields the CRM ignores', async () => {
    const res = await upload(readFileSync(REAL_FILE), 'ventas_json_example.json');

    const row = await prisma.sale_staging.findFirstOrThrow({
      where: { upload_id: res.body.data.upload_id as string, erp_sale_id: 4778 },
    });

    const payload = row.payload as { venta: Record<string, unknown> };
    // Fields the Zod schema does not validate but PCRM-34 needs.
    expect(payload.venta.num_control).toBe('000000000000000');
    expect(payload.venta.tpv).toBe('TERMINAL 1');
    expect(payload.venta.id_pago).toBe(1);
  }, 60_000);

  itWithRealFile('preserves the accents coming from the ERP (UTF-8)', async () => {
    const res = await upload(readFileSync(REAL_FILE), 'ventas_json_example.json');

    const row = await prisma.sale_staging.findFirstOrThrow({
      where: { upload_id: res.body.data.upload_id as string, erp_sale_id: 4778 },
    });

    const payload = row.payload as { venta: Record<string, unknown> };
    expect(payload.venta.apellidos).toBe('Galán');
  }, 60_000);
});

describe('partial batch', () => {
  it('persists the valid ones as pending and the invalid ones as failed', async () => {
    const res = await upload(
      toBuffer([sale(900_001), { venta: { id_venta: 900_002 }, detalle: [] }, sale(900_003)])
    );

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ sales_received: 3, accepted: 2, rejected: 1 });

    const uploadId = res.body.data.upload_id as string;

    const rows = await prisma.sale_staging.findMany({
      where: { upload_id: uploadId },
      orderBy: { erp_sale_id: 'asc' },
    });

    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.status === 'pending')).toHaveLength(2);

    const failed = rows.find((r) => r.status === 'failed')!;
    expect(failed.erp_sale_id).toBe(900_002);
    expect(failed.error).toContain('detalle');
    expect(failed.processed_at).toBeNull();

    const stored = await prisma.upload.findUniqueOrThrow({ where: { id: uploadId } });
    expect(stored).toMatchObject({ sales_received: 3, failed: 1 });
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

describe('isolation of the live tables', () => {
  it('creates no rows in customer, product or sale — that is PCRM-34', async () => {
    const before = {
      customers: await prisma.customer.count(),
      products: await prisma.product.count(),
      sales: await prisma.sale.count(),
      details: await prisma.sale_detail.count(),
    };

    await upload(toBuffer([sale(900_030), sale(900_031)]));

    expect({
      customers: await prisma.customer.count(),
      products: await prisma.product.count(),
      sales: await prisma.sale.count(),
      details: await prisma.sale_detail.count(),
    }).toEqual(before);
  });
});
