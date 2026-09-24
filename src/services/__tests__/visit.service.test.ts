import { Client } from '../../lib/prisma';
import { ConfirmVisitInput } from '../../domain/schemas/visit.schema';
import { confirmVisit, GPS_RADIUS_METERS } from '../visit.service';

const SELLER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STOP_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CUSTOMER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ROUTE_USER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

// 2026-09-21 23:00 in El Salvador (UTC-6).
const NOW = new Date('2026-09-22T05:00:00.000Z');
const CAPTURED_AT = new Date('2026-09-21T20:05:00.000Z');

const stop = (overrides: Record<string, unknown> = {}) => ({
  id: STOP_ID,
  visit_date: new Date('2026-09-21T00:00:00.000Z'),
  customer_id: CUSTOMER_ID,
  prospect_id: null,
  stop_type: 'visit',
  route_user_id: ROUTE_USER_ID,
  route_user: { user_id: SELLER_ID, route_id: 'route-1' },
  ...overrides,
});

const input = (overrides: Partial<ConfirmVisitInput> = {}): ConfirmVisitInput => ({
  scheduled_visit_id: STOP_ID,
  latitude: 13.7,
  longitude: -89.2,
  captured_at: CAPTURED_AT,
  ...overrides,
});

const visitRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'visit-1',
  scheduled_visit_id: STOP_ID,
  customer_id: CUSTOMER_ID,
  visit_type: 'visit',
  started_at: CAPTURED_AT,
  finished_at: null,
  lat: 13.7,
  lng: -89.2,
  distance_meters: 12.5,
  successful: null,
  no_order_reason: null,
  notes: null,
  ...overrides,
});

/** Prisma.Sql text with whitespace collapsed, so assertions match structure. */
const sqlOf = (query: { sql: string }): string => query.sql.replace(/\s+/g, ' ');

/**
 * $queryRaw is called in a fixed order: existing-visit lookup, distance,
 * insert. The queue makes each test state which of them it reaches.
 */
const buildClient = (opts: {
  stop?: unknown;
  queries?: unknown[];
} = {}) => {
  const queryRaw = jest.fn();
  (opts.queries ?? []).forEach((rows) => queryRaw.mockResolvedValueOnce(rows));

  const client = {
    scheduled_visit: {
      findFirst: jest.fn().mockResolvedValue('stop' in opts ? opts.stop : stop()),
    },
    route_customer: { findFirst: jest.fn().mockResolvedValue({ id: 'rc-1' }) },
    $queryRaw: queryRaw,
    $executeRaw: jest.fn().mockResolvedValue(1),
  };

  return { client: client as unknown as Client, queryRaw, mocks: client };
};

beforeAll(() => {
  jest.useFakeTimers().setSystemTime(NOW);
});
afterAll(() => {
  jest.useRealTimers();
});

describe('confirmVisit', () => {
  it('creates the visit and reports the server-side distance', async () => {
    const { client, queryRaw } = buildClient({
      queries: [[], [{ distance: 12.5 }], [visitRow()]],
    });

    const result = await confirmVisit(client, SELLER_ID, input());

    expect(queryRaw).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      id: 'visit-1',
      scheduled_visit_id: STOP_ID,
      distance_meters: 12.5,
      within_radius: true,
      radius_meters: GPS_RADIUS_METERS,
      started_at: CAPTURED_AT,
      replayed: false,
    });
  });

  it('keeps the client timestamp instead of stamping the arrival time', async () => {
    const { client, queryRaw } = buildClient({
      queries: [[], [{ distance: 5 }], [visitRow()]],
    });

    await confirmVisit(client, SELLER_ID, input());

    const insert = queryRaw.mock.calls[2][0];
    expect(insert.values).toContainEqual(CAPTURED_AT);
  });

  it('persists scheduled_visit_id on the insert so the daily route can join it', async () => {
    const { client, queryRaw } = buildClient({
      queries: [[], [{ distance: 12.5 }], [visitRow()]],
    });

    await confirmVisit(client, SELLER_ID, input());

    const insert = queryRaw.mock.calls[2][0];
    // The column has to be in the INSERT list. Selecting it back is not enough:
    // getDailyRoute joins visit on scheduled_visit_id, and a NULL link leaves
    // completed_at unset (PCRM-147).
    expect(sqlOf(insert)).toMatch(/INSERT INTO visit[\s\S]*scheduled_visit_id/);
    expect(insert.values).toContain(STOP_ID);
  });

  it('returns scheduled_visit_id from the inserted row', async () => {
    const persisted = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const { client } = buildClient({
      queries: [
        [],
        [{ distance: 1 }],
        [visitRow({ scheduled_visit_id: persisted })],
      ],
    });

    const result = await confirmVisit(client, SELLER_ID, input());

    expect(result.scheduled_visit_id).toBe(persisted);
  });

  it('looks up an existing confirmation by scheduled_visit_id', async () => {
    const { client, queryRaw } = buildClient({
      queries: [[], [{ distance: 5 }], [visitRow()]],
    });

    await confirmVisit(client, SELLER_ID, input());

    const lookup = queryRaw.mock.calls[0][0];
    const sql = sqlOf(lookup);

    expect(sql).toMatch(/v\.scheduled_visit_id\s*=/);
    expect(lookup.values).toContain(STOP_ID);
    // A (customer, route_user, visit_type, day) match would treat two stops
    // of the same type at the same customer as one confirmation.
    expect(sql).not.toMatch(/v\.customer_id\s*=/);
    expect(sql).not.toMatch(/v\.visit_type\s*=/);
    expect(sql).not.toMatch(/v\.started_at\s*>=/);
  });

  it('records a check-in outside the radius instead of rejecting it', async () => {
    const { client } = buildClient({
      queries: [
        [],
        [{ distance: 350.4 }],
        [visitRow({ distance_meters: 350.4 })],
      ],
    });

    const result = await confirmVisit(client, SELLER_ID, input());

    expect(result.within_radius).toBe(false);
    expect(result.distance_meters).toBe(350.4);
  });

  it('treats exactly the radius as inside', async () => {
    const { client } = buildClient({
      queries: [
        [],
        [{ distance: GPS_RADIUS_METERS }],
        [visitRow({ distance_meters: GPS_RADIUS_METERS })],
      ],
    });

    const result = await confirmVisit(client, SELLER_ID, input());

    expect(result.within_radius).toBe(true);
  });

  it('returns the existing visit when the same check-in is retried', async () => {
    const { client, queryRaw } = buildClient({ queries: [[visitRow()]] });

    const result = await confirmVisit(client, SELLER_ID, input());

    expect(result.replayed).toBe(true);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('answers 409 when the stop was already confirmed with another timestamp', async () => {
    const { client } = buildClient({
      queries: [[visitRow({ started_at: new Date('2026-09-21T18:00:00.000Z') })]],
    });

    await expect(confirmVisit(client, SELLER_ID, input())).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('answers 404 for an unknown stop', async () => {
    const { client } = buildClient({ stop: null });

    await expect(confirmVisit(client, SELLER_ID, input())).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("answers 403 for another seller's stop", async () => {
    const { client } = buildClient({
      stop: stop({ route_user: { user_id: 'someone-else', route_id: 'route-1' } }),
    });

    await expect(confirmVisit(client, SELLER_ID, input())).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('answers 422 for a stop on a prospect', async () => {
    const { client } = buildClient({
      stop: stop({ customer_id: null, prospect_id: 'prospect-1' }),
    });

    await expect(confirmVisit(client, SELLER_ID, input())).rejects.toMatchObject({
      statusCode: 422,
    });
  });

  it('answers 422 when the customer has no GPS pin', async () => {
    const { client } = buildClient({ queries: [[], [{ distance: null }]] });

    await expect(confirmVisit(client, SELLER_ID, input())).rejects.toMatchObject({
      statusCode: 422,
      message: 'Customer has no GPS location assigned',
    });
  });

  it('answers 404 when the customer no longer exists', async () => {
    const { client } = buildClient({ queries: [[], []] });

    await expect(confirmVisit(client, SELLER_ID, input())).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('rejects a timestamp in the future', async () => {
    const { client } = buildClient();

    await expect(
      confirmVisit(
        client,
        SELLER_ID,
        input({ captured_at: new Date(NOW.getTime() + 10 * 60 * 1000) })
      )
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('tolerates a small clock skew ahead of the server', async () => {
    const { client } = buildClient({
      queries: [[], [{ distance: 5 }], [visitRow()]],
    });

    await expect(
      confirmVisit(
        client,
        SELLER_ID,
        input({ captured_at: new Date(NOW.getTime() + 60 * 1000) })
      )
    ).resolves.toBeDefined();
  });

  it('accepts a late sync as long as it falls on the planned day', async () => {
    // Captured 09:00 local on the 21st, arriving at 23:00 local the same day.
    const { client } = buildClient({
      queries: [[], [{ distance: 5 }], [visitRow()]],
    });

    await expect(
      confirmVisit(
        client,
        SELLER_ID,
        input({ captured_at: new Date('2026-09-21T15:00:00.000Z') })
      )
    ).resolves.toBeDefined();
  });

  it.each([
    ['the day before, local time', '2026-09-21T05:59:00.000Z'],
    ['the day after, local time', '2026-09-22T06:00:00.000Z'],
  ])('rejects a timestamp on %s', async (_label, iso) => {
    const { client } = buildClient();

    await expect(
      confirmVisit(client, SELLER_ID, input({ captured_at: new Date(iso) }))
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('takes the planned day in El Salvador time, not UTC', async () => {
    // 20:00 local on the 21st is already the 22nd in UTC. Must still be valid.
    const { client } = buildClient({
      queries: [[], [{ distance: 5 }], [visitRow()]],
    });

    await expect(
      confirmVisit(
        client,
        SELLER_ID,
        input({ captured_at: new Date('2026-09-22T02:00:00.000Z') })
      )
    ).resolves.toBeDefined();
  });

  it('takes the lock before looking for an existing visit', async () => {
    const { client, mocks } = buildClient({
      queries: [[], [{ distance: 5 }], [visitRow()]],
    });

    await confirmVisit(client, SELLER_ID, input());

    expect(mocks.$executeRaw).toHaveBeenCalledTimes(1);
    expect(mocks.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.$queryRaw.mock.invocationCallOrder[0]
    );
  });
});
