import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { prisma } from '../../lib/prisma';
import { AppRoutes } from '../../presentation/routes';
import { Server } from '../../presentation/server';

/**
 * Carga del JSON de Efactsoft contra Postgres real (RF-03, PCRM-32 / PCRM-33).
 *
 * Corre contra la base local de Supabase, nunca contra staging ni produccion:
 * loadEnv.ts fuerza .env.test antes de que se importe el cliente de Prisma.
 */

const ENDPOINT = '/api/v1/uploads/sales';
const REAL_FILE = join(process.cwd(), 'ventas_json_example.json');

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

/** Ids creados durante la corrida, para limpiar al final. */
const createdUploadIds: string[] = [];

const upload = async (content: Buffer, filename = 'ventas.json') => {
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
  // sale_staging cuelga de upload con ON DELETE CASCADE.
  if (createdUploadIds.length > 0) {
    await prisma.upload.deleteMany({ where: { id: { in: createdUploadIds } } });
  }
  await prisma.$disconnect();
  server.close();
});

describe('carga del archivo real de Efactsoft', () => {
  // El archivo no esta versionado (5 MB). Si no esta, se omite en vez de fallar.
  const itWithRealFile = existsSync(REAL_FILE) ? it : it.skip;

  itWithRealFile('encola las 346 ventas y calcula el rango del lote', async () => {
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
      inserted: 0, // los llena PCRM-34
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

  itWithRealFile('cuenta la venta de mostrador sin cliente como dato de control', async () => {
    // id_venta 4421 del archivo real viene sin id_cliente.
    const res = await upload(readFileSync(REAL_FILE), 'ventas_json_example.json');

    expect(res.body.data.warnings.sales_without_customer).toBe(1);
  }, 60_000);

  itWithRealFile('conserva el payload crudo con los campos que el CRM ignora', async () => {
    const res = await upload(readFileSync(REAL_FILE), 'ventas_json_example.json');

    const row = await prisma.sale_staging.findFirstOrThrow({
      where: { upload_id: res.body.data.upload_id as string, erp_sale_id: 4778 },
    });

    const payload = row.payload as { venta: Record<string, unknown> };
    // Campos que el esquema Zod no valida pero PCRM-34 necesita.
    expect(payload.venta.num_control).toBe('000000000000000');
    expect(payload.venta.tpv).toBe('TERMINAL 1');
    expect(payload.venta.id_pago).toBe(1);
  }, 60_000);

  itWithRealFile('conserva los acentos del ERP (UTF-8)', async () => {
    const res = await upload(readFileSync(REAL_FILE), 'ventas_json_example.json');

    const row = await prisma.sale_staging.findFirstOrThrow({
      where: { upload_id: res.body.data.upload_id as string, erp_sale_id: 4778 },
    });

    const payload = row.payload as { venta: Record<string, unknown> };
    expect(payload.venta.apellidos).toBe('Galán');
  }, 60_000);
});

describe('lote parcial', () => {
  it('persiste las validas como pending y las invalidas como failed', async () => {
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

  it('marca el id_venta duplicado dentro del mismo archivo', async () => {
    const res = await upload(toBuffer([sale(900_010), sale(900_010)]));

    expect(res.body.data).toMatchObject({ accepted: 1, rejected: 1 });
    expect(res.body.data.rejections[0].reason).toContain('mas de una vez');
  });
});

describe('archivo invalido — no se escribe nada (CA2 de la HU-02)', () => {
  const countUploads = () => prisma.upload.count();

  it('responde 400 ante un JSON roto sin crear el upload', async () => {
    const before = await countUploads();

    const res = await upload(Buffer.from('[{"venta":', 'utf-8'));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no es un JSON valido/i);
    expect(await countUploads()).toBe(before);
  });

  it('responde 422 ante un objeto en la raiz sin crear el upload', async () => {
    const before = await countUploads();

    const res = await upload(toBuffer({ ventas: [] }));

    expect(res.status).toBe(422);
    expect(await countUploads()).toBe(before);
  });

  it('responde 422 si ninguna venta es valida, sin crear el upload', async () => {
    const before = await countUploads();

    const res = await upload(toBuffer([{ nada: 1 }, { tampoco: 2 }]));

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/ninguna venta del archivo/i);
    expect(await countUploads()).toBe(before);
  });

  it('responde 400 si la extension no es .json', async () => {
    const before = await countUploads();

    const res = await upload(toBuffer([sale(900_020)]), 'ventas.txt');

    expect(res.status).toBe(400);
    expect(await countUploads()).toBe(before);
  });
});

describe('aislamiento de las tablas vivas', () => {
  it('no crea filas en customer, product ni sale — eso es PCRM-34', async () => {
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
