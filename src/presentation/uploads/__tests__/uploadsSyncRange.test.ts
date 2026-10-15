import request from 'supertest';
import { AppRoutes } from '../../routes';
import { Server } from '../../server';
import { envs } from '../../../config/envs';

// Only the HTTP layer: the range math is covered in uploads.service.test.ts.
// The auth chain is stubbed the same way uploadsInProgress.test.ts does it.
jest.mock('../../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn().mockResolvedValue({ sub: 'auth-admin' }),
  JwksUnavailableError: class extends Error {},
  warmUpJwks: jest.fn(),
}));

jest.mock('../../../services/auth.service', () => ({
  findUserByAuthUserId: jest.fn(),
}));

jest.mock('../../../services/uploads.service', () => ({
  getImportInProgress: jest.fn(),
  getSalesSyncRange: jest.fn(),
}));

import { findUserByAuthUserId } from '../../../services/auth.service';
import { getSalesSyncRange } from '../../../services/uploads.service';

const findUserMock = findUserByAuthUserId as jest.MockedFunction<typeof findUserByAuthUserId>;
const getSalesSyncRangeMock = getSalesSyncRange as jest.MockedFunction<typeof getSalesSyncRange>;

const user = (role: string) =>
  ({
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    auth_user_id: 'auth-admin',
    role,
    name: 'Admin',
    email: 'admin@pragma.test',
    active: true,
    password_set_at: new Date('2026-09-11T12:00:00.000Z'),
  }) as unknown as Awaited<ReturnType<typeof findUserByAuthUserId>>;

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

const ENDPOINT = '/api/v1/uploads/sales/sync-range';

const get = () =>
  request(app)
    .get(ENDPOINT)
    .set('Authorization', 'Bearer token-de-prueba')
    .set('x-api-key', envs.API_KEY);

const range = {
  from: '2026-07-03',
  to: '2026-10-15',
  oldest_pending_date: '2026-07-03',
  pending_sales: 12,
  pending_outside_range: 0,
  min_lookback_days: 30,
  max_lookback_days: 180,
};

describe('GET /api/v1/uploads/sales/sync-range', () => {
  beforeEach(() => {
    getSalesSyncRangeMock.mockReset();
    findUserMock.mockResolvedValue(user('Administrador'));
  });

  it('responds 200 with the range to export', async () => {
    getSalesSyncRangeMock.mockResolvedValue(range);

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: 'Export sales created from 2026-07-03 to 2026-10-15.',
      data: range,
    });
  });

  it('rejects a seller with 403', async () => {
    findUserMock.mockResolvedValue(user('Vendedor'));

    const res = await get();

    expect(res.status).toBe(403);
    expect(getSalesSyncRangeMock).not.toHaveBeenCalled();
  });

  it('rejects a request without the API key', async () => {
    const res = await request(app).get(ENDPOINT).set('Authorization', 'Bearer token-de-prueba');

    expect(res.status).toBe(401);
    expect(getSalesSyncRangeMock).not.toHaveBeenCalled();
  });

  it('does not leak internal details of an unexpected error', async () => {
    getSalesSyncRangeMock.mockRejectedValue(new Error('connection string: postgres://user:pass@host'));

    const res = await get();

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Internal server error');
  });
});
