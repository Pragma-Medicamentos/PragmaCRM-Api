import { Prisma } from '../../generated/prisma/client';
import { Client } from '../../lib/prisma';
import { getWeeklyRoute } from '../weekly-route.service';
import { WeeklyRouteStopRow } from '../../repositories/weekly-route.repository';

const SELLER_ID = '11111111-1111-1111-1111-111111111101';
const ROUTE_ID = '22222222-2222-2222-2222-222222222201';
const ROUTE_USER_ID = '1f41e2d0-d81c-45a4-baea-912674c63dae';

/**
 * Same split as daily-route.service.test.ts: with $queryRaw mocked, this file
 * proves the week arithmetic, the grouping and the row→DTO mapping. The SQL
 * derivations (template vs extras, ordering) are asserted on the SQL text and
 * proven against the seeded database, not here.
 */
const stopRow = (overrides: Partial<WeeklyRouteStopRow> = {}): WeeklyRouteStopRow => ({
  id: '69b10917-fcbb-4450-b909-73963b7534d8',
  day: 3,
  visit_date: '2026-10-14',
  route_user_id: ROUTE_USER_ID,
  route_id: ROUTE_ID,
  route_name: 'Zona Escalon',
  route_municipality: 'San Salvador',
  route_zone: 'Escalon',
  stop_type: 'visit',
  target_kind: 'customer',
  target_id: 'b09d04b7-f931-4162-b028-7b6ed0fc9f88',
  name: 'Farmacia Maria Lopez 1',
  trade_name: 'Farmacia 1',
  address: 'Calle 1, Escalon',
  zone: 'Escalon',
  municipality: 'San Salvador',
  phone: '2200-0001',
  personality: 'rojo',
  potential: 'alto',
  establishment_type: 'Farmacia',
  credit_limit: 1500.5,
  lat: 13.75,
  lng: -89.22,
  sort_order: 1,
  is_extra: false,
  reason: null,
  ...overrides,
});

const buildClient = (rows: WeeklyRouteStopRow[]) => {
  const $queryRaw = jest.fn().mockResolvedValue(rows);
  const $executeRaw = jest.fn().mockResolvedValue(0);
  const client = { $queryRaw, $executeRaw } as unknown as Client;
  return { client, $queryRaw, $executeRaw };
};

const ranQuery = ($queryRaw: jest.Mock): Prisma.Sql => $queryRaw.mock.calls[0][0];

const ranSql = ($queryRaw: jest.Mock): string =>
  ranQuery($queryRaw)
    .sql.replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

describe('getWeeklyRoute — semana', () => {
  it('siempre devuelve 7 dias, de lunes a domingo, aunque no haya paradas', async () => {
    const { client } = buildClient([]);

    // Wednesday 2026-10-14.
    const week = await getWeeklyRoute(client, SELLER_ID, '2026-10-14');

    expect(week.week_start).toBe('2026-10-12');
    expect(week.week_end).toBe('2026-10-18');
    expect(week.today).toBe('2026-10-14');
    expect(week.days.map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(week.days.map((d) => d.date)).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
    ]);
    for (const day of week.days) {
      expect(day.routes).toEqual([]);
      expect(day.stops).toEqual([]);
    }
  });

  it('un domingo pertenece a la semana que empezo el lunes anterior', async () => {
    const { client } = buildClient([]);

    const week = await getWeeklyRoute(client, SELLER_ID, '2026-10-18');

    expect(week.week_start).toBe('2026-10-12');
    expect(week.week_end).toBe('2026-10-18');
  });

  it('un lunes abre su propia semana', async () => {
    const { client } = buildClient([]);

    const week = await getWeeklyRoute(client, SELLER_ID, '2026-10-19');

    expect(week.week_start).toBe('2026-10-19');
    expect(week.week_end).toBe('2026-10-25');
  });

  it('cruza el fin de mes sin perder dias', async () => {
    const { client } = buildClient([]);

    const week = await getWeeklyRoute(client, SELLER_ID, '2026-09-01');

    expect(week.week_start).toBe('2026-08-31');
    expect(week.week_end).toBe('2026-09-06');
  });
});

describe('getWeeklyRoute — agrupacion y mapeo', () => {
  it('agrupa las paradas por dia y deriva routes de las mismas filas', async () => {
    const { client } = buildClient([
      stopRow({ id: 'a', day: 1, visit_date: '2026-10-12' }),
      stopRow({ id: 'b', day: 3 }),
      stopRow({ id: 'c', day: 3, sort_order: 2 }),
    ]);

    const week = await getWeeklyRoute(client, SELLER_ID, '2026-10-14');

    expect(week.days[0].stops.map((s) => s.id)).toEqual(['a']);
    expect(week.days[1].stops).toEqual([]);
    expect(week.days[1].routes).toEqual([]);
    expect(week.days[2].stops.map((s) => s.id)).toEqual(['b', 'c']);
    expect(week.days[2].routes).toEqual([
      {
        id: ROUTE_ID,
        route_user_id: ROUTE_USER_ID,
        name: 'Zona Escalon',
        municipality: 'San Salvador',
        zone: 'Escalon',
      },
    ]);
  });

  it('una parada tiene el mismo shape que la de la ruta diaria, sin ejecucion', async () => {
    const { client } = buildClient([stopRow()]);

    const week = await getWeeklyRoute(client, SELLER_ID, '2026-10-14');
    const stop = week.days[2].stops[0];

    expect(stop).toEqual({
      id: '69b10917-fcbb-4450-b909-73963b7534d8',
      route: { id: ROUTE_ID, name: 'Zona Escalon' },
      stop_type: 'visit',
      target_kind: 'customer',
      target_id: 'b09d04b7-f931-4162-b028-7b6ed0fc9f88',
      name: 'Farmacia Maria Lopez 1',
      trade_name: 'Farmacia 1',
      address: 'Calle 1, Escalon',
      zone: 'Escalon',
      municipality: 'San Salvador',
      phone: '2200-0001',
      personality: 'rojo',
      potential: 'alto',
      establishment_type: 'Farmacia',
      credit_limit: 1500.5,
      location: { lat: 13.75, lng: -89.22 },
      sort_order: 1,
      is_extra: false,
      reason: null,
      completed_at: null,
      notes: null,
    });
  });

  it('deja location en null cuando falta una coordenada', async () => {
    const { client } = buildClient([stopRow({ lat: null })]);

    const week = await getWeeklyRoute(client, SELLER_ID, '2026-10-14');

    expect(week.days[2].stops[0].location).toBeNull();
  });
});

describe('getWeeklyRoute — SQL', () => {
  it('nunca genera dias: no ejecuta escrituras, solo una lectura', async () => {
    const { client, $queryRaw, $executeRaw } = buildClient([]);

    await getWeeklyRoute(client, SELLER_ID, '2026-10-14');

    // Generating a future day freezes its plan (PCRM-161); this view must keep
    // showing the live template, so it can never go through ensureDailyStops.
    expect($executeRaw).not.toHaveBeenCalled();
    expect($queryRaw).toHaveBeenCalledTimes(1);
    expect(ranSql($queryRaw)).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });

  it('acota la lectura al vendedor y a la semana calculada', async () => {
    const { client, $queryRaw } = buildClient([]);

    await getWeeklyRoute(client, SELLER_ID, '2026-10-14');

    const values = ranQuery($queryRaw).values;
    expect(values).toContain(SELLER_ID);
    expect(values).toContain('2026-10-12');
    expect(values).toContain('2026-10-18');
  });

  it('lee la plantilla viva y las extras de la semana', async () => {
    const { client, $queryRaw } = buildClient([]);

    await getWeeklyRoute(client, SELLER_ID, '2026-10-14');
    const sql = ranSql($queryRaw);

    expect(sql).toContain('JOIN route_customer rc ON rc.route_id = ru.route_id AND rc.deleted_at IS NULL');
    expect(sql).toContain('AND r.active');
    expect(sql).toContain('AND c.active');
    expect(sql).toContain('(sv.is_extra OR sv.prospect_id IS NOT NULL)');
    expect(sql).toContain('UNION ALL');
    // Planned stops before extras inside each day.
    expect(sql).toMatch(/ORDER BY day ASC, is_extra ASC,/);
  });
});
