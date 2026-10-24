import { Prisma } from '../../generated/prisma/client';
import { Client } from '../../lib/prisma';
import { getRouteHistory } from '../route-history.service';
import { RouteHistoryStopRow } from '../../repositories/route-history.repository';

const SELLER_ID = '11111111-1111-1111-1111-111111111101';
const ROUTE_ID = '22222222-2222-2222-2222-222222222201';
const ROUTE_USER_ID = '1f41e2d0-d81c-45a4-baea-912674c63dae';
const TODAY = '2026-10-22';

/**
 * Same split as weekly-route.service.test.ts: with $queryRaw mocked, this file
 * proves the paging and the grouping. The visibility rule and the joins are
 * asserted on the SQL text and proven against the seeded database in
 * route-history.integration.test.ts.
 */
const stopRow = (overrides: Partial<RouteHistoryStopRow> = {}): RouteHistoryStopRow => ({
  visit_date: '2026-10-21',
  id: '69b10917-fcbb-4450-b909-73963b7534d8',
  route_user_id: ROUTE_USER_ID,
  route_id: ROUTE_ID,
  route_name: 'Zona Escalon',
  route_municipality: 'San Salvador',
  route_zone: 'Escalon',
  stop_type: 'visit',
  name: 'Farmacia Maria Lopez 1',
  completed: true,
  ...overrides,
});

const buildClient = (rows: RouteHistoryStopRow[]) => {
  const $queryRaw = jest.fn().mockResolvedValue(rows);
  const client = { $queryRaw } as unknown as Client;
  return { client, $queryRaw };
};

const ranQuery = ($queryRaw: jest.Mock): Prisma.Sql => $queryRaw.mock.calls[0][0];

const ranSql = ($queryRaw: jest.Mock): string =>
  ranQuery($queryRaw)
    .sql.replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

describe('getRouteHistory — resumen por día', () => {
  it('cuenta completadas, total y omitidas de cada día', async () => {
    const { client } = buildClient([
      stopRow({ id: 'a' }),
      stopRow({ id: 'b', name: 'Farmacia San Jose', completed: false, stop_type: 'collection' }),
      stopRow({ id: 'c' }),
    ]);

    const history = await getRouteHistory(client, SELLER_ID, {}, TODAY);

    expect(history.days).toEqual([
      {
        date: '2026-10-21',
        routes: [
          {
            id: ROUTE_ID,
            route_user_id: ROUTE_USER_ID,
            name: 'Zona Escalon',
            municipality: 'San Salvador',
            zone: 'Escalon',
          },
        ],
        total: 3,
        completed: 2,
        skipped: 1,
        skipped_stops: [{ id: 'b', name: 'Farmacia San Jose', stop_type: 'collection' }],
      },
    ]);
  });

  it('agrupa por día conservando el orden, del más reciente al más viejo', async () => {
    const { client } = buildClient([
      stopRow({ id: 'a', visit_date: '2026-10-21' }),
      stopRow({ id: 'b', visit_date: '2026-10-20' }),
      stopRow({ id: 'c', visit_date: '2026-10-20' }),
      stopRow({ id: 'd', visit_date: '2026-10-14' }),
    ]);

    const history = await getRouteHistory(client, SELLER_ID, {}, TODAY);

    expect(history.days.map((day) => [day.date, day.total])).toEqual([
      ['2026-10-21', 1],
      ['2026-10-20', 2],
      ['2026-10-14', 1],
    ]);
  });

  it('lista una vez cada asignación del día, aunque tenga varias paradas', async () => {
    const OTHER_ROUTE_USER_ID = '3f41e2d0-d81c-45a4-baea-912674c63dae';
    const { client } = buildClient([
      stopRow({ id: 'a' }),
      stopRow({ id: 'b' }),
      stopRow({
        id: 'c',
        route_user_id: OTHER_ROUTE_USER_ID,
        route_id: 'r2',
        route_name: 'Santa Tecla',
        route_zone: null,
      }),
    ]);

    const history = await getRouteHistory(client, SELLER_ID, {}, TODAY);

    expect(history.days[0].routes.map((route) => route.name)).toEqual([
      'Zona Escalon',
      'Santa Tecla',
    ]);
  });

  it('devuelve una lista vacía sin siguiente página cuando no hay historial', async () => {
    const { client } = buildClient([]);

    const history = await getRouteHistory(client, SELLER_ID, {}, TODAY);

    expect(history).toEqual({ days: [], next_before: null });
  });
});

describe('getRouteHistory — paginación', () => {
  it('pide un día más que el límite para saber si hay otra página', async () => {
    const { client, $queryRaw } = buildClient([]);

    await getRouteHistory(client, SELLER_ID, { limit: 5 }, TODAY);

    const { values } = ranQuery($queryRaw);
    expect(values[values.length - 1]).toBe(6);
  });

  it('corta en el límite y devuelve como next_before la fecha del último día', async () => {
    const { client } = buildClient([
      stopRow({ id: 'a', visit_date: '2026-10-21' }),
      stopRow({ id: 'b', visit_date: '2026-10-20' }),
      stopRow({ id: 'c', visit_date: '2026-10-19' }),
    ]);

    const history = await getRouteHistory(client, SELLER_ID, { limit: 2 }, TODAY);

    expect(history.days.map((day) => day.date)).toEqual(['2026-10-21', '2026-10-20']);
    expect(history.next_before).toBe('2026-10-20');
  });

  it('no hay siguiente página cuando llegan exactamente los días del límite o menos', async () => {
    const { client } = buildClient([
      stopRow({ id: 'a', visit_date: '2026-10-21' }),
      stopRow({ id: 'b', visit_date: '2026-10-20' }),
    ]);

    const history = await getRouteHistory(client, SELLER_ID, { limit: 2 }, TODAY);

    expect(history.days).toHaveLength(2);
    expect(history.next_before).toBeNull();
  });

  it('usa before como cursor', async () => {
    const { client, $queryRaw } = buildClient([]);

    await getRouteHistory(client, SELLER_ID, { before: '2026-10-01', limit: 20 }, TODAY);

    expect(ranQuery($queryRaw).values[0]).toBe('2026-10-01');
  });

  it('nunca incluye hoy: un before futuro se recorta a hoy', async () => {
    const { client, $queryRaw } = buildClient([]);

    await getRouteHistory(client, SELLER_ID, { before: '2026-12-31' }, TODAY);

    expect(ranQuery($queryRaw).values[0]).toBe(TODAY);
  });
});

describe('getRouteHistory — SQL', () => {
  it('lee solo días anteriores al cursor, del vendedor del token', async () => {
    const { client, $queryRaw } = buildClient([]);

    await getRouteHistory(client, SELLER_ID, {}, TODAY);
    const sql = ranSql($queryRaw);

    expect(sql).toContain('FROM route_user ru');
    expect(sql).toContain('sv.visit_date < ?::date');
    expect(sql).toContain('ru.user_id = ?::uuid');
    expect(sql).toMatch(/ORDER BY visit_date DESC LIMIT \?/);
  });

  it('no filtra la asignación ni la ruta retiradas: aplica la regla del historial', async () => {
    const { client, $queryRaw } = buildClient([]);

    await getRouteHistory(client, SELLER_ID, {}, TODAY);
    const sql = ranSql($queryRaw);

    expect(sql).not.toContain('ru.deleted_at IS NULL');
    expect(sql).not.toContain('r.deleted_at IS NULL');
    expect(sql).toContain('v.id IS NOT NULL OR sv.visit_date < COALESCE');
    expect(sql).toContain('LEAST(ru.deleted_at, r.deleted_at)');
  });

  it('descarta las mismas paradas que la ruta del día: borradas o con destino borrado', async () => {
    const { client, $queryRaw } = buildClient([]);

    await getRouteHistory(client, SELLER_ID, {}, TODAY);
    const sql = ranSql($queryRaw);

    expect(sql).toContain('sv.deleted_at IS NULL');
    expect(sql).toContain('c.deleted_at IS NULL');
    expect(sql).toContain('p.deleted_at IS NULL');
    expect(sql).toContain('v.deleted_at IS NULL');
    expect(sql).toContain('COALESCE(c.id, p.id) IS NOT NULL');
  });
});
