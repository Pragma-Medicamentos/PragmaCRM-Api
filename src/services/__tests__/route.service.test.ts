import { Client } from '../../lib/prisma';
import { ROLES } from '../../domain/types/auth.types';
import {
  assertActiveSeller,
  createRoute,
  createRouteAssignment,
  getActiveAssignmentForDay,
  getRouteById,
  listRouteAssignments,
  listRoutes,
  softDeleteRouteAssignment,
  updateRoute,
} from '../route.service';

const ROUTE_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ASSIGNMENT_ID = '33333333-3333-3333-3333-333333333333';

const route = (overrides: Record<string, unknown> = {}) => ({
  id: ROUTE_ID,
  name: 'Zona Escalón',
  municipality: 'San Salvador',
  zone: 'Escalón',
  active: true,
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
});

const buildClient = (
  overrides: {
    route?: Record<string, jest.Mock>;
    route_user?: Record<string, jest.Mock>;
    app_user?: Record<string, jest.Mock>;
  } = {}
) =>
  ({
    route: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      ...overrides.route,
    },
    route_user: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      ...overrides.route_user,
    },
    app_user: {
      findFirst: jest.fn(),
      ...overrides.app_user,
    },
  }) as unknown as Client;

describe('listRoutes', () => {
  it('filters by deleted_at IS NULL', async () => {
    const findMany = jest.fn().mockResolvedValue([route()]);
    const client = buildClient({ route: { findMany } });

    await listRoutes(client, {});

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deleted_at: null } })
    );
  });

  it('adds the active filter when provided', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const client = buildClient({ route: { findMany } });

    await listRoutes(client, { active: false });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deleted_at: null, active: false } })
    );
  });
});

describe('getRouteById', () => {
  it('throws 404 when the route does not exist', async () => {
    const client = buildClient({ route: { findFirst: jest.fn().mockResolvedValue(null) } });

    await expect(getRouteById(client, ROUTE_ID)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns the route when it exists', async () => {
    const client = buildClient({
      route: { findFirst: jest.fn().mockResolvedValue(route()) },
    });

    await expect(getRouteById(client, ROUTE_ID)).resolves.toMatchObject({ id: ROUTE_ID });
  });
});

describe('createRoute', () => {
  it('creates the route with active true', async () => {
    const create = jest.fn().mockResolvedValue(route());
    const client = buildClient({ route: { create } });

    await createRoute(client, { name: 'Zona Escalón', municipality: 'San Salvador' });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Zona Escalón',
          municipality: 'San Salvador',
          active: true,
        }),
      })
    );
  });
});

describe('updateRoute', () => {
  it('throws 404 if the route does not exist', async () => {
    const client = buildClient({ route: { findFirst: jest.fn().mockResolvedValue(null) } });

    await expect(updateRoute(client, ROUTE_ID, { name: 'Otra' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('updates only the provided fields', async () => {
    const findFirst = jest.fn().mockResolvedValue(route());
    const update = jest.fn().mockResolvedValue(route({ active: false }));
    const client = buildClient({ route: { findFirst, update } });

    await updateRoute(client, ROUTE_ID, { active: false });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ROUTE_ID },
        data: expect.objectContaining({ active: false }),
      })
    );
  });
});

describe('listRouteAssignments', () => {
  it('flattens the vendor name and filters deleted rows', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: ASSIGNMENT_ID,
        route_id: ROUTE_ID,
        user_id: USER_ID,
        day: 1,
        status: null,
        created_at: new Date(),
        updated_at: new Date(),
        app_user: { name: 'Juan Pérez' },
      },
    ]);
    const client = buildClient({ route_user: { findMany } });

    const result = await listRouteAssignments(client, ROUTE_ID);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { route_id: ROUTE_ID, deleted_at: null } })
    );
    expect(result).toEqual([
      expect.objectContaining({ id: ASSIGNMENT_ID, user_name: 'Juan Pérez' }),
    ]);
  });
});

describe('getActiveAssignmentForDay', () => {
  it('queries by route, day and deleted_at IS NULL', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const client = buildClient({ route_user: { findFirst } });

    await getActiveAssignmentForDay(client, ROUTE_ID, 3);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { route_id: ROUTE_ID, day: 3, deleted_at: null } })
    );
  });
});

describe('assertActiveSeller', () => {
  it('throws 404 when the user does not exist', async () => {
    const client = buildClient({ app_user: { findFirst: jest.fn().mockResolvedValue(null) } });

    await expect(assertActiveSeller(client, USER_ID)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 400 when the user is not a Vendedor', async () => {
    const client = buildClient({
      app_user: {
        findFirst: jest.fn().mockResolvedValue({ role: ROLES.ADMIN, active: true }),
      },
    });

    await expect(assertActiveSeller(client, USER_ID)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws 400 when the vendor is disabled', async () => {
    const client = buildClient({
      app_user: {
        findFirst: jest.fn().mockResolvedValue({ role: ROLES.SELLER, active: false }),
      },
    });

    await expect(assertActiveSeller(client, USER_ID)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('resolves when the vendor is active', async () => {
    const client = buildClient({
      app_user: {
        findFirst: jest.fn().mockResolvedValue({ role: ROLES.SELLER, active: true }),
      },
    });

    await expect(assertActiveSeller(client, USER_ID)).resolves.toBeUndefined();
  });
});

describe('createRouteAssignment', () => {
  it('creates a route_user row for the given route, vendor and day', async () => {
    const create = jest.fn().mockResolvedValue({
      id: ASSIGNMENT_ID,
      route_id: ROUTE_ID,
      user_id: USER_ID,
      day: 2,
      status: null,
      created_at: new Date(),
      updated_at: new Date(),
      app_user: { name: 'Juan Pérez' },
    });
    const client = buildClient({ route_user: { create } });

    const result = await createRouteAssignment(client, ROUTE_ID, { user_id: USER_ID, day: 2 });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { route_id: ROUTE_ID, user_id: USER_ID, day: 2 },
      })
    );
    expect(result).toMatchObject({ id: ASSIGNMENT_ID, user_name: 'Juan Pérez' });
  });
});

describe('softDeleteRouteAssignment', () => {
  it('sets deleted_at and updated_at', async () => {
    const update = jest.fn().mockResolvedValue({});
    const client = buildClient({ route_user: { update } });

    await softDeleteRouteAssignment(client, ASSIGNMENT_ID);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ASSIGNMENT_ID },
        data: expect.objectContaining({ deleted_at: expect.any(Date), updated_at: expect.any(Date) }),
      })
    );
  });
});
