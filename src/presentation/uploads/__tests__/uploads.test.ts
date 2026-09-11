import request from 'supertest';
import { CustomError } from '../../../domain/errors/CustomError';
import { StagingResult } from '../../../domain/types/sales-import.types';
import { AppRoutes } from '../../routes';
import { Server } from '../../server';

// El use-case toca la base; aqui solo se prueba la capa HTTP. La verificacion
// contra Postgres real esta en los tests de integracion.
jest.mock('../../../use-cases/importSalesFile.use-case', () => ({
  importSalesFile: jest.fn(),
}));

import { importSalesFile } from '../../../use-cases/importSalesFile.use-case';

const importSalesFileMock = importSalesFile as jest.MockedFunction<typeof importSalesFile>;

// setup() monta middlewares y rutas sin abrir un puerto.
const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

const ENDPOINT = '/api/v1/uploads/sales';

const stagingResult = (overrides: Partial<StagingResult> = {}): StagingResult => ({
  upload_id: '3f1c8e2a-0000-4000-8000-000000000001',
  sales_received: 2,
  accepted: 2,
  rejected: 0,
  range: { from: new Date('2026-08-08T00:00:00.000Z'), to: new Date('2026-09-05T00:00:00.000Z') },
  rejections: [],
  rejections_truncated: 0,
  warnings: { sales_without_customer: 0, sales_without_user: 0 },
  ...overrides,
});

const validFile = Buffer.from(JSON.stringify([{ venta: {}, detalle: [] }]), 'utf-8');

describe('POST /api/v1/uploads/sales', () => {
  it('responde 201 con el envelope ApiResponse y el resumen del lote', async () => {
    importSalesFileMock.mockResolvedValue(stagingResult());

    const res = await request(app).post(ENDPOINT).attach('file', validFile, 'ventas.json');

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        upload_id: '3f1c8e2a-0000-4000-8000-000000000001',
        sales_received: 2,
        accepted: 2,
        rejected: 0,
        range: { from: '2026-08-08', to: '2026-09-05' },
        warnings: { sales_without_customer: 0, sales_without_user: 0 },
      },
    });
  });

  it('pasa el contenido del archivo al use-case', async () => {
    importSalesFileMock.mockResolvedValue(stagingResult());

    await request(app).post(ENDPOINT).attach('file', validFile, 'ventas.json');

    expect(importSalesFileMock).toHaveBeenCalledWith(expect.any(Buffer));
    expect(importSalesFileMock.mock.calls[0][0].toString('utf-8')).toBe(validFile.toString('utf-8'));
  });

  it('devuelve los rechazos para que la UI los pinte', async () => {
    importSalesFileMock.mockResolvedValue(
      stagingResult({
        accepted: 1,
        rejected: 1,
        rejections: [{ index: 1, erp_sale_id: 4790, reason: 'venta.id_venta: requerido' }],
      })
    );

    const res = await request(app).post(ENDPOINT).attach('file', validFile, 'ventas.json');

    expect(res.status).toBe(201);
    expect(res.body.message).toContain('1 rechazada');
    expect(res.body.data.rejections).toEqual([
      { index: 1, erp_sale_id: 4790, reason: 'venta.id_venta: requerido' },
    ]);
  });

  it('devuelve null en el rango cuando no hay fechas', async () => {
    importSalesFileMock.mockResolvedValue(stagingResult({ range: { from: null, to: null } }));

    const res = await request(app).post(ENDPOINT).attach('file', validFile, 'ventas.json');

    expect(res.body.data.range).toEqual({ from: null, to: null });
  });
});

describe('POST /api/v1/uploads/sales — errores de la carga (PCRM-33)', () => {
  beforeEach(() => {
    importSalesFileMock.mockResolvedValue(stagingResult());
  });

  it('responde 400 si no se envio ningun archivo', async () => {
    const res = await request(app).post(ENDPOINT);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/no se recibio ningun archivo/i);
    expect(importSalesFileMock).not.toHaveBeenCalled();
  });

  it('responde 400 si el campo multipart tiene otro nombre', async () => {
    const res = await request(app).post(ENDPOINT).attach('archivo', validFile, 'ventas.json');

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/campo de archivo inesperado/i);
  });

  it('responde 400 si la extension no es .json', async () => {
    const res = await request(app).post(ENDPOINT).attach('file', validFile, 'ventas.txt');

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/extension \.json/i);
    expect(importSalesFileMock).not.toHaveBeenCalled();
  });

  it('propaga el status y el mensaje de un CustomError del use-case', async () => {
    importSalesFileMock.mockRejectedValue(
      CustomError.unprocessable('El archivo no contiene ninguna venta.')
    );

    const res = await request(app).post(ENDPOINT).attach('file', validFile, 'ventas.json');

    expect(res.status).toBe(422);
    expect(res.body).toEqual({ success: false, message: 'El archivo no contiene ninguna venta.' });
  });

  it('no filtra el detalle interno de un error inesperado', async () => {
    importSalesFileMock.mockRejectedValue(new Error('connection string: postgres://user:pass@host'));

    const res = await request(app).post(ENDPOINT).attach('file', validFile, 'ventas.json');

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Internal server error');
    expect(JSON.stringify(res.body)).not.toContain('postgres://');
  });
});
