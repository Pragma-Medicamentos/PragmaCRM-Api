import request from 'supertest';
import { getAuth } from '@clerk/express';
import { AppRoutes } from '../../routes';
import { Server } from '../../server';
import { findUserByClerkId } from '../../../services/auth.service';
import { ROLES } from '../../../domain/types/auth.types';

jest.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  getAuth: jest.fn(),
}));

jest.mock('../../../services/auth.service', () => ({
  findUserByClerkId: jest.fn(),
}));

const getAuthMock = getAuth as unknown as jest.Mock;
const findUserByClerkIdMock = findUserByClerkId as jest.Mock;

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

describe('GET /api/v1/me', () => {
  it('devuelve usuario y rol para una sesión válida', async () => {
    getAuthMock.mockReturnValue({
      isAuthenticated: true,
      userId: 'user_clerk_admin',
    });
    findUserByClerkIdMock.mockResolvedValue({
      id: '22222222-2222-2222-2222-222222222222',
      clerk_user_id: 'user_clerk_admin',
      role: ROLES.ADMIN,
      name: 'Admin de prueba',
      email: 'admin@pragma.test',
      active: true,
    });

    const res = await request(app).get('/api/v1/me');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: 'Sesión válida',
      data: {
        id: '22222222-2222-2222-2222-222222222222',
        clerkUserId: 'user_clerk_admin',
        role: ROLES.ADMIN,
        name: 'Admin de prueba',
        email: 'admin@pragma.test',
      },
    });
  });

  it('responde 401 sin token', async () => {
    getAuthMock.mockReturnValue({ isAuthenticated: false, userId: null });

    const res = await request(app).get('/api/v1/me');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/health', () => {
  it('sigue siendo pública con Clerk montado', async () => {
    getAuthMock.mockReturnValue({ isAuthenticated: false, userId: null });

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
  });
});
