import { Client } from '../../lib/prisma';
import { CreateExtraStopInput } from '../../domain/schemas/extra-stop.schema';
import { createExtraStop, deleteExtraStop, getExtraStopsDay } from '../extra-stop.service';

const SELLER_ID = '11111111-1111-1111-1111-111111111101';
const CUSTOMER_ID = '22222222-2222-2222-2222-222222222201';
const ROUTE_USER_ID = '33333333-3333-3333-3333-333333333301';
const ROUTE_ID = 'route-1';
const STOP_ID = '44444444-4444-4444-4444-444444444401';

// Tuesday 2026-09-22 in America/El_Salvador -> ISO weekday 2.
const NOW = new Date('2026-09-22T18:00:00.000Z');
const TODAY = '2026-09-22';

const input = (overrides: Partial<CreateExtraStopInput> = {}): CreateExtraStopInput => ({
  date: TODAY,
  customer_id: CUSTOMER_ID,
  stop_type: 'visit',
  ...overrides,
});

const assignment = (overrides: Record<string, unknown> = {}) => ({
  id: ROUTE_USER_ID,
  route_id: ROUTE_ID,
  route: { name: 'Zona Escalon' },
  ...overrides,
});

const p2002 = (target: string) => ({ code: 'P2002', meta: { target: [target] } });

const buildClient = (
  overrides: {
    seller?: unknown;
    customer?: unknown;
    hasGps?: boolean;
    assignments?: unknown[];
    duplicate?: unknown;
    created?: unknown;
    createError?: unknown;
    checkedInVisit?: unknown;
    extraStop?: unknown;
    dailyRoute?: unknown;
  } = {}
) => {
  const create = overrides.createError
    ? jest.fn().mockRejectedValue(overrides.createError)
    : jest
        .fn()
        .mockResolvedValue(
          overrides.created ?? { id: STOP_ID, created_at: new Date('2026-09-22T12:00:00.000Z') }
        );

  const client = {
    app_user: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          'seller' in overrides ? overrides.seller : { id: SELLER_ID, active: true }
        ),
    },
    customer: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          'customer' in overrides
            ? overrides.customer
            : { id: CUSTOMER_ID, name: 'Farmacia San Jose' }
        ),
    },
    route_user: {
      findMany: jest.fn().mockResolvedValue(overrides.assignments ?? [assignment()]),
    },
    scheduled_visit: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          'duplicate' in overrides ? overrides.duplicate : ('extraStop' in overrides ? overrides.extraStop : null)
        ),
      create,
      update: jest.fn().mockResolvedValue(undefined),
    },
    visit: {
      findFirst: jest.fn().mockResolvedValue(overrides.checkedInVisit ?? null),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ has_gps: overrides.hasGps ?? true }]),
    $executeRaw: jest.fn().mockResolvedValue(1),
  };

  return { client: client as unknown as Client, mocks: client };
};

beforeAll(() => {
  jest.useFakeTimers().setSystemTime(NOW);
});
afterAll(() => {
  jest.useRealTimers();
});

describe('createExtraStop', () => {
  it('creates the stop flagged is_extra against the resolved assignment', async () => {
    const { client } = buildClient();

    const result = await createExtraStop(client, SELLER_ID, input());

    expect(result).toMatchObject({
      id: STOP_ID,
      seller_id: SELLER_ID,
      route_user_id: ROUTE_USER_ID,
      route_id: ROUTE_ID,
      route_name: 'Zona Escalon',
      customer_id: CUSTOMER_ID,
      stop_type: 'visit',
      is_extra: true,
    });
  });

  it('inserts is_extra true', async () => {
    const { client, mocks } = buildClient();

    await createExtraStop(client, SELLER_ID, input());

    expect(mocks.scheduled_visit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ is_extra: true, route_user_id: ROUTE_USER_ID }),
      })
    );
  });

  it('rejects a past date with 400', async () => {
    const { client } = buildClient();

    await expect(
      createExtraStop(client, SELLER_ID, input({ date: '2026-09-21' }))
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'date cannot be in the past',
      code: 'EXTRA_STOP_PAST_DATE',
    });
  });

  it('accepts today in El Salvador', async () => {
    const { client } = buildClient();

    await expect(createExtraStop(client, SELLER_ID, input({ date: TODAY }))).resolves.toBeDefined();
  });

  it('answers 404 for an unknown seller', async () => {
    const { client } = buildClient({ seller: null });

    await expect(createExtraStop(client, SELLER_ID, input())).rejects.toMatchObject({
      statusCode: 404,
      message: 'Seller not found',
      code: 'SELLER_NOT_FOUND',
    });
  });

  it('answers 422 for an inactive seller', async () => {
    const { client } = buildClient({ seller: { id: SELLER_ID, active: false } });

    await expect(createExtraStop(client, SELLER_ID, input())).rejects.toMatchObject({
      statusCode: 422,
      message: 'Seller is inactive',
      code: 'SELLER_INACTIVE',
    });
  });

  it('answers 404 for an unknown customer', async () => {
    const { client } = buildClient({ customer: null });

    await expect(createExtraStop(client, SELLER_ID, input())).rejects.toMatchObject({
      statusCode: 404,
      message: 'Customer not found',
      code: 'CUSTOMER_NOT_FOUND',
    });
  });

  it('answers 422 when the customer has no GPS pin', async () => {
    const { client } = buildClient({ hasGps: false });

    await expect(createExtraStop(client, SELLER_ID, input())).rejects.toMatchObject({
      statusCode: 422,
      message: 'Customer has no GPS location',
      code: 'CUSTOMER_NO_GPS',
    });
  });

  it('answers 422 when the seller has no route assigned that day', async () => {
    const { client } = buildClient({ assignments: [] });

    await expect(createExtraStop(client, SELLER_ID, input())).rejects.toMatchObject({
      statusCode: 422,
      message: 'Seller has no route assigned on that date',
      code: 'SELLER_NO_ROUTE_ON_DATE',
    });
  });

  it('answers 422 when route_id is not an assignment of that seller/day', async () => {
    const { client } = buildClient();

    await expect(
      createExtraStop(client, SELLER_ID, input({ route_id: 'not-mine' }))
    ).rejects.toMatchObject({
      statusCode: 422,
      message: 'route_id is not assigned to this seller on that date',
      code: 'ROUTE_NOT_ASSIGNED',
    });
  });

  it('requires route_id when the seller has more than one route that day', async () => {
    const { client } = buildClient({
      assignments: [assignment(), assignment({ id: 'other-assignment', route_id: 'route-2' })],
    });

    await expect(createExtraStop(client, SELLER_ID, input())).rejects.toMatchObject({
      statusCode: 422,
      message: 'Seller has more than one route on that date; route_id is required',
      code: 'ROUTE_ID_REQUIRED',
    });
  });

  it('resolves the given route_id among several assignments', async () => {
    const { client } = buildClient({
      assignments: [assignment(), assignment({ id: 'other-assignment', route_id: 'route-2' })],
    });

    const result = await createExtraStop(client, SELLER_ID, input({ route_id: 'route-2' }));

    expect(result.route_user_id).toBe('other-assignment');
    expect(result.route_id).toBe('route-2');
  });

  it('answers 409 for a duplicate customer + stop_type + day for that seller', async () => {
    const { client } = buildClient({ duplicate: { id: 'existing' } });

    await expect(createExtraStop(client, SELLER_ID, input())).rejects.toMatchObject({
      statusCode: 409,
      message: 'Customer already has a stop of this type on that date',
      code: 'EXTRA_STOP_DUPLICATE',
    });
  });

  it('maps a P2002 on scheduled_visit_extra_uq to the same 409', async () => {
    const { client } = buildClient({ createError: p2002('scheduled_visit_extra_uq') });

    await expect(createExtraStop(client, SELLER_ID, input())).rejects.toMatchObject({
      statusCode: 409,
      message: 'Customer already has a stop of this type on that date',
      code: 'EXTRA_STOP_DUPLICATE',
    });
  });

  it('rethrows an unrelated create error', async () => {
    const { client } = buildClient({ createError: new Error('boom') });

    await expect(createExtraStop(client, SELLER_ID, input())).rejects.toThrow('boom');
  });

  it('takes the advisory lock before checking for a duplicate', async () => {
    const { client, mocks } = buildClient();

    await createExtraStop(client, SELLER_ID, input());

    // Two $executeRaw calls now: the advisory lock, then ensureDailyStops'
    // generation statement (PCRM-161) -- both still ahead of the duplicate
    // check.
    expect(mocks.$executeRaw).toHaveBeenCalledTimes(2);
    expect(mocks.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.scheduled_visit.findFirst.mock.invocationCallOrder[0]
    );
    expect(mocks.$executeRaw.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.scheduled_visit.findFirst.mock.invocationCallOrder[0]
    );
  });

  it('generates the day\'s planned stops before the duplicate check (PCRM-161)', async () => {
    const { client, mocks } = buildClient();

    await createExtraStop(client, SELLER_ID, input());

    const generationCall = mocks.$executeRaw.mock.calls.find(([statement]) =>
      (statement as { sql?: string }).sql?.includes('INSERT INTO scheduled_visit')
    );
    expect(generationCall).toBeDefined();
  });

  it('accepts a seller with a weekly route that day and zero scheduled_visit rows (no SELLER_NO_ROUTE_ON_DATE)', async () => {
    // route_user resolution (findActiveAssignments) reads the weekly
    // assignment directly, never scheduled_visit -- so a seller with a route
    // that day never gets SELLER_NO_ROUTE_ON_DATE just because nobody has
    // opened the day yet. `duplicate: null` makes explicit that no
    // scheduled_visit row exists ahead of this call.
    const { client } = buildClient({ duplicate: null });

    await expect(createExtraStop(client, SELLER_ID, input())).resolves.toMatchObject({
      is_extra: true,
    });
  });

  it('rejects with EXTRA_STOP_DUPLICATE when the extra collides with a stop the weekly route already generated', async () => {
    // Simulates ensureDailyStops having already materialized a planned
    // customer_id/stop_type match for that day.
    const { client } = buildClient({ duplicate: { id: 'generated-planned-stop' } });

    await expect(createExtraStop(client, SELLER_ID, input())).rejects.toMatchObject({
      statusCode: 409,
      code: 'EXTRA_STOP_DUPLICATE',
    });
  });

  it('ignores inactive routes when resolving assignments', async () => {
    const { client, mocks } = buildClient({
      assignments: [assignment()],
    });

    await createExtraStop(client, SELLER_ID, input());

    expect(mocks.route_user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          route: expect.objectContaining({ active: true }),
        }),
      })
    );
  });


  it('rejects with SELLER_NO_ROUTE_ON_DATE when all assignments are inactive', async () => {
    const { client } = buildClient({ assignments: [] });

    await expect(createExtraStop(client, SELLER_ID, input())).rejects.toMatchObject({
      statusCode: 422,
      code: 'SELLER_NO_ROUTE_ON_DATE',
    });
  });

  it('rejects with ROUTE_NOT_ASSIGNED when route_id points to an inactive route', async () => {
    const { client } = buildClient({
      assignments: [assignment()],
    });

    await expect(
      createExtraStop(client, SELLER_ID, input({ route_id: 'inactive-route' }))
    ).rejects.toMatchObject({
      statusCode: 422,
      message: 'route_id is not assigned to this seller on that date',
      code: 'ROUTE_NOT_ASSIGNED',
    });
  });
});

describe('getExtraStopsDay', () => {
  it('answers 404 for an unknown seller', async () => {
    const { client } = buildClient({ seller: null });

    await expect(getExtraStopsDay(client, SELLER_ID)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Seller not found',
      code: 'SELLER_NOT_FOUND',
    });
  });

  it('scopes the seller lookup to non-deleted, Vendedor role', async () => {
    const { client, mocks } = buildClient({
      dailyRoute: { date: TODAY, routes: [], stops: [] },
    });

    await getExtraStopsDay(client, SELLER_ID);

    expect(mocks.app_user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: SELLER_ID,
          deleted_at: null,
          role: 'Vendedor',
        }),
      })
    );
  });
});

describe('deleteExtraStop', () => {
  it('soft deletes an extra stop with no check-in and today/future date', async () => {
    const { client, mocks } = buildClient({ extraStop: { id: STOP_ID, visit_date: new Date('2026-09-22T00:00:00.000Z') } });

    const result = await deleteExtraStop(client, SELLER_ID, STOP_ID);

    expect(result).toEqual({ id: STOP_ID, deleted: true });
    expect(mocks.scheduled_visit.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: STOP_ID },
        data: expect.objectContaining({ deleted_at: expect.any(Date) }),
      })
    );
  });

  it('scopes the lookup to the given seller', async () => {
    const { client, mocks } = buildClient({ extraStop: { id: STOP_ID, visit_date: new Date('2026-09-22T00:00:00.000Z') } });

    await deleteExtraStop(client, SELLER_ID, STOP_ID);

    expect(mocks.scheduled_visit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: STOP_ID,
          is_extra: true,
          route_user: { user_id: SELLER_ID },
        }),
      })
    );
  });

  it('answers 404 for a missing, non-extra, or other seller stop', async () => {
    const { client } = buildClient({ extraStop: null });

    await expect(deleteExtraStop(client, SELLER_ID, STOP_ID)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Extra stop not found',
      code: 'EXTRA_STOP_NOT_FOUND',
    });
  });

  it('answers 409 when the stop already has a check-in', async () => {
    const { client } = buildClient({
      extraStop: { id: STOP_ID, visit_date: new Date('2026-09-22T00:00:00.000Z') },
      checkedInVisit: { id: 'visit-1' },
    });

    await expect(deleteExtraStop(client, SELLER_ID, STOP_ID)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Extra stop already has a check-in and cannot be deleted',
      code: 'EXTRA_STOP_HAS_CHECKIN',
    });
  });

  it('answers 422 when the stop is dated in the past', async () => {
    const { client } = buildClient({
      extraStop: { id: STOP_ID, visit_date: new Date('2026-09-21T00:00:00.000Z') },
    });

    await expect(deleteExtraStop(client, SELLER_ID, STOP_ID)).rejects.toMatchObject({
      statusCode: 422,
      message: 'Extra stops dated in the past cannot be deleted',
      code: 'EXTRA_STOP_DELETE_PAST',
    });
  });
});
