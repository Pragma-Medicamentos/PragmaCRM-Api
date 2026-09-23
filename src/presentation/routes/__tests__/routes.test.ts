import request from 'supertest';
import { AppRoutes } from '../../routes';
import { Server } from '../../server';
import { envs } from '../../../config/envs';
import {
  addRouteStop,
  createRoute,
  getRouteById,
  listRouteAssignments,
  listRouteStops,
  listRoutes,
  replaceRouteStops,
  softDeleteRouteStop,
  unassignRouteDay,
  updateRoute,
  updateRouteStop,
} from '../../../services/route.service';
import { assignRoute } from '../../../use-cases/assign-route.use-case';
import { reassignRoute } from '../../../use-cases/reassign-route.use-case';
import { reorderRouteStops } from '../../../use-cases/reorder-route-stops.use-case';

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
  unassignRouteDay: jest.fn(),
  listRouteStops: jest.fn(),
  addRouteStop: jest.fn(),
  updateRouteStop: jest.fn(),
  softDeleteRouteStop: jest.fn(),
  replaceRouteStops: jest.fn(),
}));

jest.mock('../../../use-cases/assign-route.use-case', () => ({
  assignRoute: jest.fn(),
}));

jest.mock('../../../use-cases/reassign-route.use-case', () => ({
  reassignRoute: jest.fn(),
}));

jest.mock('../../../use-cases/reorder-route-stops.use-case', () => ({
  reorderRouteStops: jest.fn(),
}));

const listRoutesMock = listRoutes as jest.Mock;
const getRouteByIdMock = getRouteById as jest.Mock;
const createRouteMock = createRoute as jest.Mock;
const updateRouteMock = updateRoute as jest.Mock;
const listRouteAssignmentsMock = listRouteAssignments as jest.Mock;
const unassignRouteDayMock = unassignRouteDay as jest.Mock;
const assignRouteMock = assignRoute as jest.Mock;
const reassignRouteMock = reassignRoute as jest.Mock;
const listRouteStopsMock = listRouteStops as jest.Mock;
const addRouteStopMock = addRouteStop as jest.Mock;
const updateRouteStopMock = updateRouteStop as jest.Mock;
const softDeleteRouteStopMock = softDeleteRouteStop as jest.Mock;
const reorderRouteStopsMock = reorderRouteStops as jest.Mock;
const replaceRouteStopsMock = replaceRouteStops as jest.Mock;

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

const AUTH = {
  'x-api-key': envs.API_KEY,
  Authorization: 'Bearer test-token',
};

const ROUTE_ID = '9f1c2e4a-7b3d-4e21-9c88-0a5d6f2b1e10';
const USER_ID = '8f1c2e4a-7b3d-4e21-9c88-0a5d6f2b1e11';
const CUSTOMER_ID = '7f1c2e4a-7b3d-4e21-9c88-0a5d6f2b1e12';
const STOP_ID = '6f1c2e4a-7b3d-4e21-9c88-0a5d6f2b1e13';

const route = { id: ROUTE_ID, name: 'Zona Escalón', municipality: null, zone: null, active: true };
const assignment = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  route_id: ROUTE_ID,
  user_id: USER_ID,
  user_name: 'Juan Pérez',
  day: 1,
  status: null,
};

const stop = {
  id: STOP_ID,
  route_id: ROUTE_ID,
  customer_id: CUSTOMER_ID,
  customer_name: 'Farmacia San José',
  sort_order: 1,
  stop_type: 'visit',
  location: { lat: 13.6929, lng: -89.2182 },
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

beforeEach(() => {
  jest.clearAllMocks();
  listRoutesMock.mockResolvedValue([route]);
  getRouteByIdMock.mockResolvedValue(route);
  listRouteAssignmentsMock.mockResolvedValue([assignment]);
  listRouteStopsMock.mockResolvedValue([stop]);
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

describe('DELETE /api/v1/routes/:id/assignments/:day', () => {
  it('removes the assignment for that day', async () => {
    unassignRouteDayMock.mockResolvedValue(undefined);

    const res = await request(app).delete(`/api/v1/routes/${ROUTE_ID}/assignments/1`).set(AUTH);

    expect(res.status).toBe(200);
    expect(unassignRouteDayMock).toHaveBeenCalledWith(expect.anything(), ROUTE_ID, 1);
  });

  it('rejects a day outside 1-7', async () => {
    const res = await request(app).delete(`/api/v1/routes/${ROUTE_ID}/assignments/9`).set(AUTH);

    expect(res.status).toBe(400);
    expect(unassignRouteDayMock).not.toHaveBeenCalled();
  });

  it('propagates the 404 when there is no active assignment', async () => {
    const { CustomError } = jest.requireActual('../../../domain/errors/CustomError');
    unassignRouteDayMock.mockRejectedValue(CustomError.notFound('No active assignment for this day'));

    const res = await request(app).delete(`/api/v1/routes/${ROUTE_ID}/assignments/1`).set(AUTH);

    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/routes/:id/stops', () => {
  it('returns the active stops for the route', async () => {
    const res = await request(app).get(`/api/v1/routes/${ROUTE_ID}/stops`).set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([stop]);
  });

  it('propagates a 404 when the route does not exist', async () => {
    const { CustomError } = jest.requireActual('../../../domain/errors/CustomError');
    getRouteByIdMock.mockRejectedValue(CustomError.notFound('Route not found'));

    const res = await request(app).get(`/api/v1/routes/${ROUTE_ID}/stops`).set(AUTH);

    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/routes/:id/stops', () => {
  it('adds a customer to the route', async () => {
    addRouteStopMock.mockResolvedValue(stop);

    const res = await request(app)
      .post(`/api/v1/routes/${ROUTE_ID}/stops`)
      .set(AUTH)
      .send({ customer_id: CUSTOMER_ID });

    expect(res.status).toBe(201);
    expect(addRouteStopMock).toHaveBeenCalledWith(
      expect.anything(),
      ROUTE_ID,
      expect.objectContaining({ customer_id: CUSTOMER_ID })
    );
    expect(res.body.data).toEqual(stop);
  });

  it('rejects a non-uuid customer id', async () => {
    const res = await request(app)
      .post(`/api/v1/routes/${ROUTE_ID}/stops`)
      .set(AUTH)
      .send({ customer_id: 'not-a-uuid' });

    expect(res.status).toBe(400);
    expect(addRouteStopMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid stop_type', async () => {
    const res = await request(app)
      .post(`/api/v1/routes/${ROUTE_ID}/stops`)
      .set(AUTH)
      .send({ customer_id: CUSTOMER_ID, stop_type: 'delivery' });

    expect(res.status).toBe(400);
    expect(addRouteStopMock).not.toHaveBeenCalled();
  });

  it('propagates the 409 when the customer is already an active stop', async () => {
    const { CustomError } = jest.requireActual('../../../domain/errors/CustomError');
    addRouteStopMock.mockRejectedValue(
      CustomError.conflict('Customer is already a stop on this route')
    );

    const res = await request(app)
      .post(`/api/v1/routes/${ROUTE_ID}/stops`)
      .set(AUTH)
      .send({ customer_id: CUSTOMER_ID });

    expect(res.status).toBe(409);
  });
});

describe('PUT /api/v1/routes/:id/stops/order', () => {
  it('reorders the active stops', async () => {
    reorderRouteStopsMock.mockResolvedValue([stop]);

    const res = await request(app)
      .put(`/api/v1/routes/${ROUTE_ID}/stops/order`)
      .set(AUTH)
      .send({ stop_ids: [STOP_ID] });

    expect(res.status).toBe(200);
    expect(reorderRouteStopsMock).toHaveBeenCalledWith(expect.anything(), ROUTE_ID, [STOP_ID]);
    expect(res.body.data).toEqual([stop]);
  });

  it('rejects an empty stop_ids array', async () => {
    const res = await request(app)
      .put(`/api/v1/routes/${ROUTE_ID}/stops/order`)
      .set(AUTH)
      .send({ stop_ids: [] });

    expect(res.status).toBe(400);
    expect(reorderRouteStopsMock).not.toHaveBeenCalled();
  });

  it('propagates the 400 when stop_ids do not match the active set', async () => {
    const { CustomError } = jest.requireActual('../../../domain/errors/CustomError');
    reorderRouteStopsMock.mockRejectedValue(
      CustomError.badRequest("stop_ids must match the route's current active stops exactly")
    );

    const res = await request(app)
      .put(`/api/v1/routes/${ROUTE_ID}/stops/order`)
      .set(AUTH)
      .send({ stop_ids: [STOP_ID] });

    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/v1/routes/:id/stops/:stopId', () => {
  it('rejects an empty body', async () => {
    const res = await request(app)
      .patch(`/api/v1/routes/${ROUTE_ID}/stops/${STOP_ID}`)
      .set(AUTH)
      .send({});

    expect(res.status).toBe(400);
    expect(updateRouteStopMock).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid stop id', async () => {
    const res = await request(app)
      .patch(`/api/v1/routes/${ROUTE_ID}/stops/not-a-uuid`)
      .set(AUTH)
      .send({ stop_type: 'dispatch' });

    expect(res.status).toBe(400);
    expect(updateRouteStopMock).not.toHaveBeenCalled();
  });

  it('updates the stop', async () => {
    updateRouteStopMock.mockResolvedValue({ ...stop, stop_type: 'dispatch' });

    const res = await request(app)
      .patch(`/api/v1/routes/${ROUTE_ID}/stops/${STOP_ID}`)
      .set(AUTH)
      .send({ stop_type: 'dispatch' });

    expect(res.status).toBe(200);
    expect(res.body.data.stop_type).toBe('dispatch');
  });

  it('propagates the 404 when the stop does not exist', async () => {
    const { CustomError } = jest.requireActual('../../../domain/errors/CustomError');
    updateRouteStopMock.mockRejectedValue(CustomError.notFound('Stop not found'));

    const res = await request(app)
      .patch(`/api/v1/routes/${ROUTE_ID}/stops/${STOP_ID}`)
      .set(AUTH)
      .send({ stop_type: 'dispatch' });

    expect(res.status).toBe(404);
  });
});

describe('PUT /api/v1/routes/:id/stops (replace)', () => {
  it('replaces all stops for the route', async () => {
    replaceRouteStopsMock.mockResolvedValue([stop]);

    const res = await request(app)
      .put(`/api/v1/routes/${ROUTE_ID}/stops`)
      .set(AUTH)
      .send({ stops: [{ customer_id: CUSTOMER_ID, stop_type: 'visit', sort_order: 1 }] });

    expect(res.status).toBe(200);
    expect(replaceRouteStopsMock).toHaveBeenCalledWith(
      expect.anything(),
      ROUTE_ID,
      expect.objectContaining({ stops: expect.any(Array) })
    );
    expect(res.body.data).toEqual([stop]);
  });

  it('allows empty stops array', async () => {
    replaceRouteStopsMock.mockResolvedValue([]);

    const res = await request(app)
      .put(`/api/v1/routes/${ROUTE_ID}/stops`)
      .set(AUTH)
      .send({ stops: [] });

    expect(res.status).toBe(200);
    expect(replaceRouteStopsMock).toHaveBeenCalledWith(
      expect.anything(),
      ROUTE_ID,
      { stops: [] }
    );
    expect(res.body.data).toEqual([]);
  });

  it('rejects a non-uuid customer_id', async () => {
    const res = await request(app)
      .put(`/api/v1/routes/${ROUTE_ID}/stops`)
      .set(AUTH)
      .send({ stops: [{ customer_id: 'not-a-uuid', stop_type: 'visit' }] });

    expect(res.status).toBe(400);
    expect(replaceRouteStopsMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid stop_type', async () => {
    const res = await request(app)
      .put(`/api/v1/routes/${ROUTE_ID}/stops`)
      .set(AUTH)
      .send({ stops: [{ customer_id: CUSTOMER_ID, stop_type: 'invalid' }] });

    expect(res.status).toBe(400);
    expect(replaceRouteStopsMock).not.toHaveBeenCalled();
  });

  it('propagates the 400 when there are duplicate customer_ids', async () => {
    const { CustomError } = jest.requireActual('../../../domain/errors/CustomError');
    replaceRouteStopsMock.mockRejectedValue(CustomError.badRequest('Duplicate customer_id in stops'));

    const res = await request(app)
      .put(`/api/v1/routes/${ROUTE_ID}/stops`)
      .set(AUTH)
      .send({
        stops: [
          { customer_id: CUSTOMER_ID, stop_type: 'visit' },
          { customer_id: CUSTOMER_ID, stop_type: 'dispatch' },
        ],
      });

    expect(res.status).toBe(400);
  });

  it('propagates the 404 when a customer in stops does not exist', async () => {
    const { CustomError } = jest.requireActual('../../../domain/errors/CustomError');
    replaceRouteStopsMock.mockRejectedValue(CustomError.notFound('One or more customers not found'));

    const res = await request(app)
      .put(`/api/v1/routes/${ROUTE_ID}/stops`)
      .set(AUTH)
      .send({ stops: [{ customer_id: CUSTOMER_ID }] });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/routes/:id/stops/:stopId', () => {
  it('removes the stop', async () => {
    softDeleteRouteStopMock.mockResolvedValue(undefined);

    const res = await request(app)
      .delete(`/api/v1/routes/${ROUTE_ID}/stops/${STOP_ID}`)
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(softDeleteRouteStopMock).toHaveBeenCalledWith(expect.anything(), ROUTE_ID, STOP_ID);
  });

  it('propagates the 404 when the stop does not exist', async () => {
    const { CustomError } = jest.requireActual('../../../domain/errors/CustomError');
    softDeleteRouteStopMock.mockRejectedValue(CustomError.notFound('Stop not found'));

    const res = await request(app)
      .delete(`/api/v1/routes/${ROUTE_ID}/stops/${STOP_ID}`)
      .set(AUTH);

    expect(res.status).toBe(404);
  });
});
