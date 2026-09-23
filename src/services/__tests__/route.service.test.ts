import { Client } from '../../lib/prisma';
import { ROLES } from '../../domain/types/auth.types';
import {
  addRouteStop,
  assertActiveSeller,
  assertReorderCoversActiveStops,
  createRoute,
  createRouteAssignment,
  getActiveAssignmentForDay,
  getRouteById,
  listRouteAssignments,
  listRouteStops,
  listRoutes,
  replaceRouteStops,
  softDeleteRouteAssignment,
  softDeleteRouteStop,
  unassignRouteDay,
  updateRoute,
  updateRouteStop,
} from '../route.service';

const ROUTE_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ASSIGNMENT_ID = '33333333-3333-3333-3333-333333333333';
const CUSTOMER_ID = '44444444-4444-4444-4444-444444444444';
const STOP_ID = '55555555-5555-5555-5555-555555555555';

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
    route_customer?: Record<string, jest.Mock>;
    app_user?: Record<string, jest.Mock>;
    customer?: Record<string, jest.Mock>;
    $queryRaw?: jest.Mock;
    $executeRaw?: jest.Mock;
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
    route_customer: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      ...overrides.route_customer,
    },
    app_user: {
      findFirst: jest.fn(),
      ...overrides.app_user,
    },
    customer: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      ...overrides.customer,
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn(),
    ...overrides,
  }) as unknown as Client;

const routeStopRow = (overrides: Record<string, unknown> = {}) => ({
  id: STOP_ID,
  route_id: ROUTE_ID,
  customer_id: CUSTOMER_ID,
  sort_order: 1,
  stop_type: 'visit',
  created_at: new Date(),
  updated_at: new Date(),
  customer: { name: 'Farmacia San José' },
  ...overrides,
});

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

describe('unassignRouteDay', () => {
  it('throws 404 when there is no active assignment for that day', async () => {
    const client = buildClient({ route_user: { findFirst: jest.fn().mockResolvedValue(null) } });

    await expect(unassignRouteDay(client, ROUTE_ID, 3)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('soft-deletes the active assignment', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValue({ id: ASSIGNMENT_ID, user_id: USER_ID });
    const update = jest.fn().mockResolvedValue({});
    const client = buildClient({ route_user: { findFirst, update } });

    await unassignRouteDay(client, ROUTE_ID, 3);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ASSIGNMENT_ID },
        data: expect.objectContaining({ deleted_at: expect.any(Date) }),
      })
    );
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

describe('listRouteStops', () => {
  it('orders by sort_order asc nulls last, then created_at, and flattens customer_name', async () => {
    const findMany = jest.fn().mockResolvedValue([routeStopRow()]);
    const client = buildClient({ route_customer: { findMany } });

    const result = await listRouteStops(client, ROUTE_ID);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { route_id: ROUTE_ID, deleted_at: null },
        orderBy: [{ sort_order: { sort: 'asc', nulls: 'last' } }, { created_at: 'asc' }],
      })
    );
    expect(result).toEqual([
      expect.objectContaining({ id: STOP_ID, customer_name: 'Farmacia San José' }),
    ]);
  });
});

describe('addRouteStop', () => {
  it('throws 404 when the route does not exist', async () => {
    const client = buildClient({ route: { findFirst: jest.fn().mockResolvedValue(null) } });

    await expect(
      addRouteStop(client, ROUTE_ID, { customer_id: CUSTOMER_ID })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 404 when the customer does not exist or is deleted', async () => {
    const client = buildClient({
      route: { findFirst: jest.fn().mockResolvedValue(route()) },
      customer: { findFirst: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      addRouteStop(client, ROUTE_ID, { customer_id: CUSTOMER_ID })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 409 when an active stop already exists for that customer', async () => {
    const client = buildClient({
      route: { findFirst: jest.fn().mockResolvedValue(route()) },
      customer: { findFirst: jest.fn().mockResolvedValue({ id: CUSTOMER_ID }) },
      route_customer: {
        findFirst: jest.fn().mockResolvedValue({ id: STOP_ID, deleted_at: null }),
      },
    });

    await expect(
      addRouteStop(client, ROUTE_ID, { customer_id: CUSTOMER_ID })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('does not check GPS/location before adding a stop (RF-04 is planning, not execution)', async () => {
    const customerFindFirst = jest.fn().mockResolvedValue({ id: CUSTOMER_ID });
    const client = buildClient({
      route: { findFirst: jest.fn().mockResolvedValue(route()) },
      customer: { findFirst: customerFindFirst },
      route_customer: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(routeStopRow()),
      },
    });

    await addRouteStop(client, ROUTE_ID, { customer_id: CUSTOMER_ID });

    expect(customerFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ select: { id: true } })
    );
  });

  it('appends at max(sort_order) + 1 when sort_order is omitted', async () => {
    const create = jest.fn().mockResolvedValue(routeStopRow({ sort_order: 4 }));
    const client = buildClient({
      route: { findFirst: jest.fn().mockResolvedValue(route()) },
      customer: { findFirst: jest.fn().mockResolvedValue({ id: CUSTOMER_ID }) },
      route_customer: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null) // existing stop lookup
          .mockResolvedValueOnce({ sort_order: 3 }), // nextSortOrder lookup
        create,
      },
    });

    await addRouteStop(client, ROUTE_ID, { customer_id: CUSTOMER_ID });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sort_order: 4 }) })
    );
  });

  it('revives a soft-deleted stop instead of creating a duplicate', async () => {
    const update = jest.fn().mockResolvedValue(routeStopRow());
    const client = buildClient({
      route: { findFirst: jest.fn().mockResolvedValue(route()) },
      customer: { findFirst: jest.fn().mockResolvedValue({ id: CUSTOMER_ID }) },
      route_customer: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: STOP_ID, deleted_at: new Date('2026-01-01') }),
        update,
      },
    });

    await addRouteStop(client, ROUTE_ID, {
      customer_id: CUSTOMER_ID,
      stop_type: 'dispatch',
      sort_order: 2,
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: STOP_ID },
        data: expect.objectContaining({
          stop_type: 'dispatch',
          sort_order: 2,
          deleted_at: null,
        }),
      })
    );
  });
});

describe('updateRouteStop', () => {
  it('throws 404 when the stop does not belong to the route or is deleted', async () => {
    const client = buildClient({ route_customer: { findFirst: jest.fn().mockResolvedValue(null) } });

    await expect(
      updateRouteStop(client, ROUTE_ID, STOP_ID, { stop_type: 'collection' })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('updates only the provided fields', async () => {
    const update = jest.fn().mockResolvedValue(routeStopRow({ stop_type: 'collection' }));
    const client = buildClient({
      route_customer: {
        findFirst: jest.fn().mockResolvedValue({ id: STOP_ID }),
        update,
      },
    });

    await updateRouteStop(client, ROUTE_ID, STOP_ID, { stop_type: 'collection' });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: STOP_ID },
        data: expect.objectContaining({ stop_type: 'collection' }),
      })
    );
  });
});

describe('softDeleteRouteStop', () => {
  it('throws 404 when the stop does not belong to the route or is already deleted', async () => {
    const client = buildClient({ route_customer: { findFirst: jest.fn().mockResolvedValue(null) } });

    await expect(softDeleteRouteStop(client, ROUTE_ID, STOP_ID)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('sets deleted_at and updated_at', async () => {
    const update = jest.fn().mockResolvedValue({});
    const client = buildClient({
      route_customer: {
        findFirst: jest.fn().mockResolvedValue({ id: STOP_ID }),
        update,
      },
    });

    await softDeleteRouteStop(client, ROUTE_ID, STOP_ID);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: STOP_ID },
        data: expect.objectContaining({ deleted_at: expect.any(Date), updated_at: expect.any(Date) }),
      })
    );
  });
});

describe('assertReorderCoversActiveStops', () => {
  it('throws 400 when the submitted ids do not match the active set exactly', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: STOP_ID }]);
    const client = buildClient({ route_customer: { findMany } });

    await expect(
      assertReorderCoversActiveStops(client, ROUTE_ID, ['other-id'])
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('resolves when the submitted ids match the active set exactly', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: STOP_ID }]);
    const client = buildClient({ route_customer: { findMany } });

    await expect(
      assertReorderCoversActiveStops(client, ROUTE_ID, [STOP_ID])
    ).resolves.toBeUndefined();
  });
});

describe('replaceRouteStops', () => {
  it('throws 404 when route does not exist', async () => {
    const client = buildClient({ route: { findFirst: jest.fn().mockResolvedValue(null) } });

    await expect(
      replaceRouteStops(client, ROUTE_ID, { stops: [] })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 400 when duplicate customer_id in stops', async () => {
    const client = buildClient({
      route: { findFirst: jest.fn().mockResolvedValue(route()) },
    });

    await expect(
      replaceRouteStops(client, ROUTE_ID, {
        stops: [
          { customer_id: CUSTOMER_ID, stop_type: 'visit' },
          { customer_id: CUSTOMER_ID, stop_type: 'dispatch' },
        ],
      })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('Duplicate') });
  });

  it('throws 404 when a customer in stops does not exist', async () => {
    const client = buildClient({
      route: { findFirst: jest.fn().mockResolvedValue(route()) },
      customer: { findMany: jest.fn().mockResolvedValue([]) },
    });

    await expect(
      replaceRouteStops(client, ROUTE_ID, {
        stops: [{ customer_id: CUSTOMER_ID, stop_type: 'visit' }],
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('soft-deletes stops not in the new set', async () => {
    const OTHER_CUSTOMER = '99999999-9999-9999-9999-999999999999';
    const OTHER_STOP = '88888888-8888-8888-8888-888888888888';
    const routeCustomerUpdate = jest.fn().mockResolvedValue({});
    const route_customer = buildClient().route_customer;
    const client = buildClient({
      route: { findFirst: jest.fn().mockResolvedValue(route()) },
      customer: {
        findMany: jest.fn().mockResolvedValue([{ id: CUSTOMER_ID }]),
      },
      route_customer: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            { id: STOP_ID, customer_id: CUSTOMER_ID },
            { id: OTHER_STOP, customer_id: OTHER_CUSTOMER },
          ])
          .mockResolvedValueOnce([routeStopRow()]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(routeStopRow()),
        update: routeCustomerUpdate,
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    });

    await replaceRouteStops(client, ROUTE_ID, {
      stops: [{ customer_id: CUSTOMER_ID, stop_type: 'visit' }],
    });

    expect(routeCustomerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: OTHER_STOP },
        data: expect.objectContaining({ deleted_at: expect.any(Date) }),
      })
    );
  });

  it('creates new stops and revives soft-deleted ones', async () => {
    const routeCustomerCreate = jest.fn().mockResolvedValue(routeStopRow());
    const routeCustomerUpdate = jest.fn().mockResolvedValue(routeStopRow());
    const client = buildClient({
      route: { findFirst: jest.fn().mockResolvedValue(route()) },
      customer: {
        findMany: jest.fn().mockResolvedValue([{ id: CUSTOMER_ID }]),
      },
      route_customer: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([routeStopRow()]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: routeCustomerCreate,
        update: routeCustomerUpdate,
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    });

    await replaceRouteStops(client, ROUTE_ID, {
      stops: [{ customer_id: CUSTOMER_ID, stop_type: 'visit', sort_order: 1 }],
    });

    expect(routeCustomerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          route_id: ROUTE_ID,
          customer_id: CUSTOMER_ID,
          stop_type: 'visit',
          sort_order: 1,
        }),
      })
    );
  });

  it('assigns default sort_order sequentially when omitted', async () => {
    const routeCustomerCreate = jest.fn().mockResolvedValue(routeStopRow());
    const client = buildClient({
      route: { findFirst: jest.fn().mockResolvedValue(route()) },
      customer: {
        findMany: jest.fn().mockResolvedValue([
          { id: CUSTOMER_ID },
          { id: '11111111-1111-1111-1111-111111111111' },
        ]),
      },
      route_customer: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([routeStopRow(), routeStopRow({ id: '77777777-7777-7777-7777-777777777777' })]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: routeCustomerCreate,
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    });

    await replaceRouteStops(client, ROUTE_ID, {
      stops: [
        { customer_id: CUSTOMER_ID },
        { customer_id: '11111111-1111-1111-1111-111111111111' },
      ],
    });

    const calls = routeCustomerCreate.mock.calls;
    expect(calls[0][0].data.sort_order).toBe(1);
    expect(calls[1][0].data.sort_order).toBe(2);
  });
});
