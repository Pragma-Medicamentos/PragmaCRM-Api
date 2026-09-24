import request from 'supertest';
import { AppRoutes } from '../../routes';
import { Server } from '../../server';
import { envs } from '../../../config/envs';
import { CustomError } from '../../../domain/errors/CustomError';
import {
  createProspect,
  createProspectAsAdmin,
  listProspects,
  updateProspectLocation,
} from '../../../services/prospect.service';
import { findUserByAuthUserId } from '../../../services/auth.service';

jest.mock('../../../lib/supabaseJwt', () => ({
  verifyAccessToken: jest.fn().mockResolvedValue({ sub: 'auth-seller' }),
  JwksUnavailableError: class extends Error {},
  warmUpJwks: jest.fn(),
}));

jest.mock('../../../services/auth.service', () => ({
  findUserByAuthUserId: jest.fn(),
}));

// The controller opens the transaction itself; hand the callback a stub client.
jest.mock('../../../lib/prisma', () => ({
  prisma: { $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb({})) },
}));

jest.mock('../../../services/prospect.service', () => ({
  createProspect: jest.fn(),
  createProspectAsAdmin: jest.fn(),
  listProspects: jest.fn(),
  updateProspectLocation: jest.fn(),
}));

const createProspectMock = createProspect as jest.Mock;
const createProspectAsAdminMock = createProspectAsAdmin as jest.Mock;
const listProspectsMock = listProspects as jest.Mock;
const updateProspectLocationMock = updateProspectLocation as jest.Mock;
const findUserMock = findUserByAuthUserId as jest.Mock;

const server = new Server({ port: 0, routes: AppRoutes.routes });
server.setup();
const app = server.app;

const AUTH = {
  'x-api-key': envs.API_KEY,
  Authorization: 'Bearer token-de-prueba',
};

const SELLER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROSPECT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const user = (role: string, id: string = SELLER_ID) => ({
  id,
  auth_user_id: 'auth-seller',
  role,
  name: 'Seller',
  email: 'seller@pragma.test',
  active: true,
  password_set_at: new Date('2026-09-11T12:00:00.000Z'),
});

const listedProspect = (overrides: Record<string, unknown> = {}) => ({
  id: PROSPECT_ID,
  name: 'Farmacia El Sol',
  phone: '7777-1234',
  user_id: SELLER_ID,
  seller_name: 'Seller',
  location: null,
  created_at: '2026-09-21T20:10:00.000Z',
  status: null,
  ...overrides,
});

const body = (overrides: Record<string, unknown> = {}) => ({
  name: 'Farmacia El Sol',
  phone: '7777-1234',
  latitude: 13.7,
  longitude: -89.2,
  captured_at: '2026-09-21T14:05:00-06:00',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  findUserMock.mockResolvedValue(user('Vendedor'));
  createProspectMock.mockResolvedValue({
    id: 'prospect-1',
    name: 'Farmacia El Sol',
    phone: '7777-1234',
    user_id: SELLER_ID,
    location: { lat: 13.7, lng: -89.2 },
    created_at: '2026-09-21T20:10:00.000Z',
    captured_at: '2026-09-21T20:05:00.000Z',
    status: null,
  });
  listProspectsMock.mockResolvedValue({
    items: [
      {
        id: 'prospect-1',
        name: 'Farmacia El Sol',
        phone: '7777-1234',
        user_id: SELLER_ID,
        seller_name: 'Seller',
        location: { lat: 13.7, lng: -89.2 },
        created_at: '2026-09-21T20:10:00.000Z',
        status: null,
      },
    ],
    page: 1,
    page_size: 20,
    total: 1,
    total_pages: 1,
  });
  createProspectAsAdminMock.mockResolvedValue(listedProspect());
  updateProspectLocationMock.mockResolvedValue(
    listedProspect({ location: { lat: 13.7, lng: -89.2 } })
  );
});

describe('POST /api/v1/prospects', () => {
  it('registers the prospect and answers 201', async () => {
    const res = await request(app)
      .post('/api/v1/prospects')
      .set(AUTH)
      .send(body());

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe('prospect-1');
    expect(res.body.data.phone).toBe('7777-1234');
  });

  it('passes the authenticated seller, not an id from the body', async () => {
    await request(app)
      .post('/api/v1/prospects')
      .set(AUTH)
      .send(body({ user_id: 'someone-else' }));

    expect(createProspectMock).toHaveBeenCalledWith(
      expect.anything(),
      SELLER_ID,
      expect.not.objectContaining({ user_id: expect.anything() })
    );
  });

  it('parses captured_at into a Date keeping its instant', async () => {
    await request(app).post('/api/v1/prospects').set(AUTH).send(body());

    const input = createProspectMock.mock.calls[0][2];
    expect(input.captured_at).toEqual(new Date('2026-09-21T20:05:00.000Z'));
  });

  it('forbids the Administrador', async () => {
    findUserMock.mockResolvedValue(user('Administrador'));

    const res = await request(app)
      .post('/api/v1/prospects')
      .set(AUTH)
      .send(body());

    expect(res.status).toBe(403);
    expect(createProspectMock).not.toHaveBeenCalled();
  });

  it('answers 401 without a session', async () => {
    const res = await request(app)
      .post('/api/v1/prospects')
      .set({ 'x-api-key': envs.API_KEY })
      .send(body());

    expect(res.status).toBe(401);
  });

  it.each([
    ['missing name', { name: '' }, 'name'],
    ['missing phone', { phone: '   ' }, 'phone'],
    ['latitude out of range', { latitude: 91 }, 'latitude'],
    ['longitude out of range', { longitude: -181 }, 'longitude'],
    [
      'captured_at without offset',
      { captured_at: '2026-09-21T14:05:00' },
      'captured_at',
    ],
    ['captured_at not a date', { captured_at: 'yesterday' }, 'captured_at'],
  ])('rejects %s', async (_label, override, field) => {
    const res = await request(app)
      .post('/api/v1/prospects')
      .set(AUTH)
      .send(body(override));

    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe(field);
    expect(createProspectMock).not.toHaveBeenCalled();
  });

  it('maps service errors to their status', async () => {
    createProspectMock.mockRejectedValue(
      CustomError.unprocessable('Seller cannot register prospects')
    );

    const res = await request(app)
      .post('/api/v1/prospects')
      .set(AUTH)
      .send(body());

    expect(res.status).toBe(422);
    expect(res.body.message).toBe('Seller cannot register prospects');
  });
});


describe('GET /api/v1/prospects', () => {
  beforeEach(() => {
    findUserMock.mockResolvedValue(user('Administrador'));
  });

  it('lists prospects for the admin and answers 200', async () => {
    const res = await request(app).get('/api/v1/prospects').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].seller_name).toBe('Seller');
    expect(listProspectsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ page: 1, limit: 20 })
    );
  });

  it('forwards page, limit and user_id', async () => {
    const res = await request(app)
      .get(`/api/v1/prospects?page=2&limit=10&user_id=${SELLER_ID}`)
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(listProspectsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ page: 2, limit: 10, user_id: SELLER_ID })
    );
  });

  it('forbids the Vendedor', async () => {
    findUserMock.mockResolvedValue(user('Vendedor'));

    const res = await request(app).get('/api/v1/prospects').set(AUTH);

    expect(res.status).toBe(403);
    expect(listProspectsMock).not.toHaveBeenCalled();
  });

  it('answers 401 without a session', async () => {
    const res = await request(app)
      .get('/api/v1/prospects')
      .set({ 'x-api-key': envs.API_KEY });

    expect(res.status).toBe(401);
  });

  it('rejects an invalid user_id', async () => {
    const res = await request(app)
      .get('/api/v1/prospects?user_id=nope')
      .set(AUTH);

    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe('user_id');
    expect(listProspectsMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/prospects/admin', () => {
  const adminBody = (overrides: Record<string, unknown> = {}) => ({
    user_id: SELLER_ID,
    name: 'Farmacia El Sol',
    phone: '7777-1234',
    ...overrides,
  });

  beforeEach(() => {
    findUserMock.mockResolvedValue(user('Administrador', ADMIN_ID));
  });

  it('registers the prospect without GPS and answers 201', async () => {
    const res = await request(app)
      .post('/api/v1/prospects/admin')
      .set(AUTH)
      .send(adminBody());

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(PROSPECT_ID);
    expect(res.body.data.seller_name).toBe('Seller');
    expect(createProspectAsAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ user_id: SELLER_ID, name: 'Farmacia El Sol' })
    );
  });

  it('accepts optional GPS', async () => {
    const res = await request(app)
      .post('/api/v1/prospects/admin')
      .set(AUTH)
      .send(adminBody({ latitude: 13.7, longitude: -89.2 }));

    expect(res.status).toBe(201);
    expect(createProspectAsAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ latitude: 13.7, longitude: -89.2 })
    );
  });

  it('forbids the Vendedor', async () => {
    findUserMock.mockResolvedValue(user('Vendedor'));

    const res = await request(app)
      .post('/api/v1/prospects/admin')
      .set(AUTH)
      .send(adminBody());

    expect(res.status).toBe(403);
    expect(createProspectAsAdminMock).not.toHaveBeenCalled();
  });

  it('answers 401 without a session', async () => {
    const res = await request(app)
      .post('/api/v1/prospects/admin')
      .set({ 'x-api-key': envs.API_KEY })
      .send(adminBody());

    expect(res.status).toBe(401);
  });

  it.each([
    ['missing user_id', { user_id: 'nope' }, 'user_id'],
    ['missing name', { name: '' }, 'name'],
    ['missing phone', { phone: '   ' }, 'phone'],
    [
      'latitude without longitude',
      { latitude: 13.7 },
      'latitude',
    ],
  ])('rejects %s', async (_label, override, field) => {
    const res = await request(app)
      .post('/api/v1/prospects/admin')
      .set(AUTH)
      .send(adminBody(override));

    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe(field);
    expect(createProspectAsAdminMock).not.toHaveBeenCalled();
  });

  it('maps service errors to their status (e.g. user_id is not a Vendedor)', async () => {
    createProspectAsAdminMock.mockRejectedValue(
      CustomError.badRequest('User is not a Vendedor')
    );

    const res = await request(app)
      .post('/api/v1/prospects/admin')
      .set(AUTH)
      .send(adminBody());

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('User is not a Vendedor');
  });
});

describe('PATCH /api/v1/prospects/:id/location', () => {
  const locationBody = { latitude: 13.7, longitude: -89.2 };

  beforeEach(() => {
    findUserMock.mockResolvedValue(user('Administrador', ADMIN_ID));
  });

  it('updates the location and answers 200', async () => {
    const res = await request(app)
      .patch(`/api/v1/prospects/${PROSPECT_ID}/location`)
      .set(AUTH)
      .send(locationBody);

    expect(res.status).toBe(200);
    expect(res.body.data.location).toEqual({ lat: 13.7, lng: -89.2 });
    expect(updateProspectLocationMock).toHaveBeenCalledWith(
      expect.anything(),
      PROSPECT_ID,
      locationBody
    );
  });

  it('forbids the Vendedor', async () => {
    findUserMock.mockResolvedValue(user('Vendedor'));

    const res = await request(app)
      .patch(`/api/v1/prospects/${PROSPECT_ID}/location`)
      .set(AUTH)
      .send(locationBody);

    expect(res.status).toBe(403);
    expect(updateProspectLocationMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid id', async () => {
    const res = await request(app)
      .patch('/api/v1/prospects/not-a-uuid/location')
      .set(AUTH)
      .send(locationBody);

    expect(res.status).toBe(400);
    expect(updateProspectLocationMock).not.toHaveBeenCalled();
  });

  it('maps a missing prospect to 404', async () => {
    updateProspectLocationMock.mockRejectedValue(
      CustomError.notFound('Prospect not found')
    );

    const res = await request(app)
      .patch(`/api/v1/prospects/${PROSPECT_ID}/location`)
      .set(AUTH)
      .send(locationBody);

    expect(res.status).toBe(404);
  });
});
