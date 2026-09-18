import request from 'supertest';
import { AppRoutes } from '../../routes';
import { Server } from '../../server';
import { envs } from '../../../config/envs';
import {
  createRoute,
  getRouteById,
  listRouteAssignments,
  listRoutes,
  updateRoute,
} from '../../../services/route.service';
import { assignRoute } from '../../../use-cases/assign-route.use-case';
import { reassignRoute } from '../../../use-cases/reassign-route.use-case';

// The routes module is admin-only (RF-04). The auth chain is stubbed so these
// tests keep exercising the HTTP layer, not token verification.
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

jest.mock('../../../services/route.service', () => ({
  listRoutes: jest.fn(),
  getRouteById: jest.fn(),
  createRoute: jest.fn(),
  updateRoute: jest.fn(),
  listRouteAssignments: jest.fn(),
}));

jest.mock('../../../use-cases/assign-route.use-case', () => ({
  assignRoute: jest.fn(),
}));

jest.mock('../../../use-cases/reassign-route.use-case', () => ({
  reassignRoute: jest.fn(),
}));

const listRoutesMock = listRoutes as jest.Mock;
const getRouteByIdMock = getRouteById as jest.Mock;
const createRouteMock = createRoute as jest.Mock;
const updateRouteMock = updateRoute as jest.Mock;
const listRouteAssignmentsMock = listRouteAssignments as jest.Mock;
const assignRouteMock = assignRoute as jest.Mock;
const reassignRouteMock = reassignRoute as jest.Mock;

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

const AUTH = {
  'x-api-key': envs.API_KEY,
  Authorization: 'Bearer test-token',
};

const ROUTE_ID = '9f1c2e4a-7b3d-4e21-9c88-0a5d6f2b1e10';
const USER_ID = '8f1c2e4a-7b3d-4e21-9c88-0a5d6f2b1e11';

const route = { id: ROUTE_ID, name: 'Zona Escalón', municipality: null, zone: null, active: true };
const assignment = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  route_id: ROUTE_ID,
  user_id: USER_ID,
  user_name: 'Juan Pérez',
  day: 1,
  status: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  listRoutesMock.mockResolvedValue([route]);
  getRouteByIdMock.mockResolvedValue(route);
  listRouteAssignmentsMock.mockResolvedValue([assignment]);
});

describe('GET /api/v1/routes', () => {
  it('returns the route list', async () => {
    const res = await request(app).get('/api/v1/routes').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([route]);
  });

  it('rejects an invalid active filter', async () => {
    const res = await request(app).get('/api/v1/routes?active=maybe').set(AUTH);

    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/routes/:id', () => {
  it('rejects a non-uuid id', async () => {
    const res = await request(app).get('/api/v1/routes/not-a-uuid').set(AUTH);

    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe('id');
  });

  it('propagates a 404 from the service', async () => {
    const { CustomError } = jest.requireActual('../../../domain/errors/CustomError');
    getRouteByIdMock.mockRejectedValue(CustomError.notFound('Route not found'));

    const res = await request(app).get(`/api/v1/routes/${ROUTE_ID}`).set(AUTH);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Route not found');
  });
});

describe('POST /api/v1/routes', () => {
  it('creates a route', async () => {
    createRouteMock.mockResolvedValue(route);

    const res = await request(app)
      .post('/api/v1/routes')
      .set(AUTH)
      .send({ name: 'Zona Escalón' });

    expect(res.status).toBe(201);
    expect(createRouteMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'Zona Escalón' })
    );
  });

  it('rejects an empty name', async () => {
    const res = await request(app).post('/api/v1/routes').set(AUTH).send({ name: '' });

    expect(res.status).toBe(400);
    expect(createRouteMock).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/v1/routes/:id', () => {
  it('rejects an empty body', async () => {
    const res = await request(app).patch(`/api/v1/routes/${ROUTE_ID}`).set(AUTH).send({});

    expect(res.status).toBe(400);
    expect(updateRouteMock).not.toHaveBeenCalled();
  });

  it('updates the route', async () => {
    updateRouteMock.mockResolvedValue({ ...route, active: false });

    const res = await request(app)
      .patch(`/api/v1/routes/${ROUTE_ID}`)
      .set(AUTH)
      .send({ active: false });

    expect(res.status).toBe(200);
    expect(res.body.data.active).toBe(false);
  });
});

describe('GET /api/v1/routes/:id/assignments', () => {
  it('returns the active assignments', async () => {
    const res = await request(app).get(`/api/v1/routes/${ROUTE_ID}/assignments`).set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([assignment]);
  });
});

describe('POST /api/v1/routes/:id/assignments', () => {
  it('rejects a day outside 1-7', async () => {
    const res = await request(app)
      .post(`/api/v1/routes/${ROUTE_ID}/assignments`)
      .set(AUTH)
      .send({ user_id: USER_ID, day: 8 });

    expect(res.status).toBe(400);
    expect(assignRouteMock).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid vendor id', async () => {
    const res = await request(app)
      .post(`/api/v1/routes/${ROUTE_ID}/assignments`)
      .set(AUTH)
      .send({ user_id: 'not-a-uuid', day: 1 });

    expect(res.status).toBe(400);
  });

  it('assigns the vendor to the route', async () => {
    assignRouteMock.mockResolvedValue(assignment);

    const res = await request(app)
      .post(`/api/v1/routes/${ROUTE_ID}/assignments`)
      .set(AUTH)
      .send({ user_id: USER_ID, day: 1 });

    expect(res.status).toBe(201);
    expect(assignRouteMock).toHaveBeenCalledWith(expect.anything(), ROUTE_ID, {
      user_id: USER_ID,
      day: 1,
    });
    expect(res.body.data).toEqual(assignment);
  });

  it('propagates the 409 when the day is already assigned', async () => {
    const { CustomError } = jest.requireActual('../../../domain/errors/CustomError');
    assignRouteMock.mockRejectedValue(
      CustomError.conflict('This day already has an active vendor assigned')
    );

    const res = await request(app)
      .post(`/api/v1/routes/${ROUTE_ID}/assignments`)
      .set(AUTH)
      .send({ user_id: USER_ID, day: 1 });

    expect(res.status).toBe(409);
  });
});

describe('POST /api/v1/routes/:id/reassign', () => {
  it('reassigns the day to the new vendor', async () => {
    reassignRouteMock.mockResolvedValue({ ...assignment, user_id: 'new-user' });

    const res = await request(app)
      .post(`/api/v1/routes/${ROUTE_ID}/reassign`)
      .set(AUTH)
      .send({ user_id: USER_ID, day: 1 });

    expect(res.status).toBe(200);
    expect(reassignRouteMock).toHaveBeenCalledWith(expect.anything(), ROUTE_ID, {
      user_id: USER_ID,
      day: 1,
    });
  });

  it('propagates the 400 when the day has no active assignment', async () => {
    const { CustomError } = jest.requireActual('../../../domain/errors/CustomError');
    reassignRouteMock.mockRejectedValue(
      CustomError.badRequest('No active assignment for this day')
    );

    const res = await request(app)
      .post(`/api/v1/routes/${ROUTE_ID}/reassign`)
      .set(AUTH)
      .send({ user_id: USER_ID, day: 1 });

    expect(res.status).toBe(400);
  });
});
