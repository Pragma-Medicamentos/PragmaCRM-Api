import { Prisma } from '../../generated/prisma/client';
import { Client } from '../../lib/prisma';
import { CustomError } from '../../domain/errors/CustomError';
import { getExecutedRoutes } from '../executed-route.service';

const NOW = new Date('2026-10-14T18:00:00Z');
const SELLER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SELLER_ID = '11111111-1111-4111-8111-111111111112';
const ROUTE_USER_ID = '33333333-3333-4333-8333-333333333301';

const buildClient = (queryRaw: jest.Mock, findFirst: jest.Mock = jest.fn()) =>
  ({ $queryRaw: queryRaw, app_user: { findFirst } }) as unknown as Client;

const sqlOf = (mock: jest.Mock, call: number) => mock.mock.calls[call][0] as Prisma.Sql;

const stopRow = (overrides: Record<string, unknown> = {}) => ({
  visit_id: 'v1',
  scheduled_visit_id: 'sv1',
  seller_id: SELLER_ID,
  seller_name: 'Carlos Martínez',
  local_date: '2026-10-13',
  route_user_id: ROUTE_USER_ID,
  route_id: 'r1',
  route_name: 'Zona Escalón',
  customer_id: 'c1',
  customer_name: 'Farmacia San José',
  customer_trade_name: null,
  stop_type: 'visit',
  is_extra: false,
  started_at: new Date('2026-10-13T15:00:00Z'),
  finished_at: new Date('2026-10-13T15:20:00Z'),
  lat: 13.7,
  lng: -89.2,
  distance_meters: 12.5,
  successful: true,
  no_order_reason: null,
  notes: 'Pidió catálogo nuevo',
  ...overrides,
});

describe('getExecutedRoutes', () => {
  it('groups stops by seller, day and assignment, with GPS, note and planned count', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([
        stopRow(),
        stopRow({ visit_id: 'v2', lat: null, lng: null, distance_meters: 150, notes: null }),
        stopRow({
          visit_id: 'v3',
          seller_id: OTHER_SELLER_ID,
          seller_name: 'Ana López',
          route_user_id: null,
          route_id: null,
          route_name: null,
          scheduled_visit_id: null,
          is_extra: true,
          distance_meters: null,
        }),
      ])
      .mockResolvedValueOnce([{ route_user_id: ROUTE_USER_ID, local_date: '2026-10-13', planned: 5 }]);

    const result = await getExecutedRoutes(buildClient(queryRaw), {}, NOW);

    expect(result.from).toBe('2026-10-01');
    expect(result.to).toBe('2026-10-31');
    expect(result.routes).toHaveLength(2);

    const [first, second] = result.routes;
    expect(first).toMatchObject({
      date: '2026-10-13',
      seller: { id: SELLER_ID, name: 'Carlos Martínez' },
      route: { id: 'r1', name: 'Zona Escalón' },
      stops_planned: 5,
      stops_executed: 2,
    });
    expect(first.stops[0]).toMatchObject({
      checkin_location: { lat: 13.7, lng: -89.2 },
      within_radius: true,
      notes: 'Pidió catálogo nuevo',
    });
    expect(first.stops[1]).toMatchObject({ checkin_location: null, within_radius: false, notes: null });

    expect(second).toMatchObject({ route: null, route_user_id: null, stops_planned: 0, stops_executed: 1 });
    expect(second.stops[0].within_radius).toBeNull();

    // Planned counts are asked only for the assignments that showed up.
    expect(sqlOf(queryRaw, 1).values).toContainEqual([ROUTE_USER_ID]);
  });

  it('filters by seller and checks it exists', async () => {
    const queryRaw = jest.fn().mockResolvedValueOnce([]);
    const findFirst = jest.fn().mockResolvedValue({ id: SELLER_ID });

    const result = await getExecutedRoutes(
      buildClient(queryRaw, findFirst),
      { seller_id: SELLER_ID, from: '2026-10-01', to: '2026-10-07' },
      NOW
    );

    expect(result).toEqual({ from: '2026-10-01', to: '2026-10-07', routes: [] });
    expect(sqlOf(queryRaw, 0).values).toContain(SELLER_ID);
    // No assignments, so no second query.
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('throws 404 for an unknown seller', async () => {
    const queryRaw = jest.fn();
    const findFirst = jest.fn().mockResolvedValue(null);

    await expect(
      getExecutedRoutes(buildClient(queryRaw, findFirst), { seller_id: SELLER_ID }, NOW)
    ).rejects.toMatchObject({ statusCode: 404 } as Partial<CustomError>);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('bounds the range in local midnight instants', async () => {
    const queryRaw = jest.fn().mockResolvedValueOnce([]);

    await getExecutedRoutes(buildClient(queryRaw), { from: '2026-10-13', to: '2026-10-13' }, NOW);

    const instants = sqlOf(queryRaw, 0)
      .values.filter((v): v is Date => v instanceof Date)
      .map((v) => v.toISOString());
    expect(instants).toEqual(['2026-10-13T06:00:00.000Z', '2026-10-14T06:00:00.000Z']);
  });
});
