import request from 'supertest';
import { CustomError } from '../../../domain/errors/CustomError';
import { ImportSalesResult } from '../../../use-cases/importSalesFile.use-case';
import { AppRoutes } from '../../routes';
import { Server } from '../../server';
import { envs } from '../../../config/envs';

// The use case hits the database; only the HTTP layer is exercised here.
// Verification against real Postgres lives in the integration tests.
// The route is admin-only now: the auth chain is stubbed so these tests keep
// exercising the HTTP layer and not the token verification.
jest.mock('../../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn().mockResolvedValue({ sub: 'auth-admin' }),
  JwksUnavailableError: class extends Error {},
  warmUpJwks: jest.fn(),
}));

jest.mock('../../../services/auth.service', () => ({
  findUserByAuthUserId: jest.fn().mockResolvedValue({
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    auth_user_id: 'auth-admin',
    role: 'Administrador',
    name: 'Admin',
    email: 'admin@pragma.test',
    active: true,
    password_set_at: new Date('2026-09-11T12:00:00.000Z'),
  }),
}));

jest.mock('../../../use-cases/importSalesFile.use-case', () => ({
  importSalesFile: jest.fn(),
}));

import { importSalesFile } from '../../../use-cases/importSalesFile.use-case';

const importSalesFileMock = importSalesFile as jest.MockedFunction<typeof importSalesFile>;

// setup() wires middlewares and routes without opening a port.
const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

const ENDPOINT = '/api/v1/uploads/sales';

const API_KEY = envs.API_KEY;

const stagingResult = (overrides: Partial<ImportSalesResult> = {}): ImportSalesResult => ({
  upload_id: '3f1c8e2a-0000-4000-8000-000000000001',
  sales_received: 2,
  accepted: 2,
  rejected: 0,
  range: { from: new Date('2026-08-08T00:00:00.000Z'), to: new Date('2026-09-05T00:00:00.000Z') },
  rejections: [],
  rejections_truncated: 0,
  warnings: { sales_without_customer: 0, sales_without_user: 0, quotations_skipped: 0 },
  processed: 2,
  inserted: 2,
  updated: 0,
  sync_failed: 0,
  ...overrides,
});

const validFile = Buffer.from(JSON.stringify([{ venta: {}, detalle: [] }]), 'utf-8');

describe('POST /api/v1/uploads/sales', () => {
  it('responds 201 with the ApiResponse envelope and the batch summary', async () => {
    importSalesFileMock.mockResolvedValue(stagingResult());

    const res = await request(app).post(ENDPOINT)
      .set('Authorization', 'Bearer token-de-prueba').set('x-api-key', API_KEY).attach('file', validFile, 'sales.json');

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

  it('passes the file contents to the use case', async () => {
    importSalesFileMock.mockResolvedValue(stagingResult());

    await request(app).post(ENDPOINT)
      .set('Authorization', 'Bearer token-de-prueba').set('x-api-key', API_KEY).attach('file', validFile, 'sales.json');

    expect(importSalesFileMock).toHaveBeenCalledWith(
      expect.any(Buffer),
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    );
    expect(importSalesFileMock.mock.calls[0][0].toString('utf-8')).toBe(validFile.toString('utf-8'));
  });

  it('returns the rejections so the UI can render them', async () => {
    importSalesFileMock.mockResolvedValue(
      stagingResult({
        accepted: 1,
        rejected: 1,
        rejections: [{ index: 1, erp_sale_id: 4790, reason: 'venta.id_venta: required' }],
      })
    );

    const res = await request(app).post(ENDPOINT)
      .set('Authorization', 'Bearer token-de-prueba').set('x-api-key', API_KEY).attach('file', validFile, 'sales.json');

    expect(res.status).toBe(201);
    expect(res.body.message).toContain('1 rejected');
    expect(res.body.data.rejections).toEqual([
      { index: 1, erp_sale_id: 4790, reason: 'venta.id_venta: required' },
    ]);
  });

  it('returns a null range when there are no dates', async () => {
    importSalesFileMock.mockResolvedValue(stagingResult({ range: { from: null, to: null } }));

    const res = await request(app).post(ENDPOINT)
      .set('Authorization', 'Bearer token-de-prueba').set('x-api-key', API_KEY).attach('file', validFile, 'sales.json');

    expect(res.body.data.range).toEqual({ from: null, to: null });
  });
});

describe('POST /api/v1/uploads/sales — upload errors (PCRM-33)', () => {
  beforeEach(() => {
    importSalesFileMock.mockResolvedValue(stagingResult());
  });

  it('responds 400 when no file was sent', async () => {
    const res = await request(app).post(ENDPOINT)
      .set('Authorization', 'Bearer token-de-prueba').set('x-api-key', API_KEY);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/no file received/i);
    expect(importSalesFileMock).not.toHaveBeenCalled();
  });

  it('responds 400 when the multipart field has another name', async () => {
    const res = await request(app).post(ENDPOINT)
      .set('Authorization', 'Bearer token-de-prueba').set('x-api-key', API_KEY).attach('archivo', validFile, 'sales.json');

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/unexpected file field/i);
  });

  it('responds 400 when the extension is not .json', async () => {
    const res = await request(app).post(ENDPOINT)
      .set('Authorization', 'Bearer token-de-prueba').set('x-api-key', API_KEY).attach('file', validFile, 'sales.txt');

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/\.json extension/i);
    expect(importSalesFileMock).not.toHaveBeenCalled();
  });

  it('propagates the status and message of a CustomError from the use case', async () => {
    importSalesFileMock.mockRejectedValue(
      CustomError.unprocessable('The file does not contain any sales.')
    );

    const res = await request(app).post(ENDPOINT)
      .set('Authorization', 'Bearer token-de-prueba').set('x-api-key', API_KEY).attach('file', validFile, 'sales.json');

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      success: false,
      message: 'The file does not contain any sales.',
    });
  });

  it('does not leak internal details of an unexpected error', async () => {
    importSalesFileMock.mockRejectedValue(new Error('connection string: postgres://user:pass@host'));

    const res = await request(app).post(ENDPOINT)
      .set('Authorization', 'Bearer token-de-prueba').set('x-api-key', API_KEY).attach('file', validFile, 'sales.json');

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Internal server error');
    expect(JSON.stringify(res.body)).not.toContain('postgres://');
  });
});
