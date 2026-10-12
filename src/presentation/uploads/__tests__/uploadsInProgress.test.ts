import request from 'supertest';
import { AppRoutes } from '../../routes';
import { Server } from '../../server';
import { envs } from '../../../config/envs';

// Only the HTTP layer is exercised: the service hits Postgres (pg_locks plus
// the `upload` table) and is verified in the integration tests.
// The route is admin-only, so the auth chain is stubbed the same way
// uploads.test.ts does it.
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

jest.mock('../../../services/uploads.service', () => ({
  getImportInProgress: jest.fn(),
}));

import { getImportInProgress } from '../../../services/uploads.service';

const getImportInProgressMock = getImportInProgress as jest.MockedFunction<
  typeof getImportInProgress
>;

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

const ENDPOINT = '/api/v1/uploads/sales/in-progress';
const API_KEY = envs.API_KEY;

const get = () =>
  request(app)
    .get(ENDPOINT)
    .set('Authorization', 'Bearer token-de-prueba')
    .set('x-api-key', API_KEY);

describe('GET /api/v1/uploads/sales/in-progress (PCRM-169)', () => {
  beforeEach(() => {
    getImportInProgressMock.mockReset();
  });

  it('responds 200 with the running upload', async () => {
    getImportInProgressMock.mockResolvedValue({
      in_progress: true,
      upload_id: '3f1c8e2a-0000-4000-8000-000000000001',
      status: 'processing',
      updated_at: '2026-09-29T15:04:05.000Z',
    });

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        in_progress: true,
        upload_id: '3f1c8e2a-0000-4000-8000-000000000001',
        status: 'processing',
        updated_at: '2026-09-29T15:04:05.000Z',
      },
    });
  });

  it('responds 200 with nulls when nothing is running', async () => {
    getImportInProgressMock.mockResolvedValue({
      in_progress: false,
      upload_id: null,
      status: null,
      updated_at: null,
    });

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      in_progress: false,
      upload_id: null,
      status: null,
      updated_at: null,
    });
  });

  it('reports the lock alone, before the upload row exists', async () => {
    getImportInProgressMock.mockResolvedValue({
      in_progress: true,
      upload_id: null,
      status: null,
      updated_at: null,
    });

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body.data.in_progress).toBe(true);
    expect(res.body.data.upload_id).toBeNull();
  });

  it('does not leak internal details of an unexpected error', async () => {
    getImportInProgressMock.mockRejectedValue(
      new Error('connection string: postgres://user:pass@host')
    );

    const res = await get();

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Internal server error');
    expect(JSON.stringify(res.body)).not.toContain('postgres://');
  });
});
