import { Prisma } from '../../generated/prisma/client';
import { Client } from '../../lib/prisma';
import { StopType } from '../../domain/schemas/daily-route.schema';
import { TargetKind } from '../../domain/types/daily-route.types';
import { getDailyRoute } from '../daily-route.service';

const SELLER_ID = '11111111-1111-1111-1111-111111111101';
const ROUTE_ID = '22222222-2222-2222-2222-222222222201';
const ROUTE_USER_ID = '1f41e2d0-d81c-45a4-baea-912674c63dae';
const DATE = '2026-09-19';

/**
 * What this file can and cannot prove.
 *
 * With $queryRaw mocked, the row→DTO mapping is fully testable: the mapper is
 * ordinary TypeScript. The *derivations* are not — is_extra, target_kind, the
 * null zone of a prospect and the ordering are all computed by Postgres, and a
 * mock row simply hands back whatever it was given. Feeding in
 * `is_extra: true` and asserting `is_extra === true` would be a test that
 * cannot fail.
 *
 * So the derivations are covered from the other side: by asserting the shape
 * of the SQL the service actually builds (see `clausesOf`), and by running the
 * real query against the seeded database — that run, not this file, is what
 * proves the SQL returns the right rows.
 */

/**
 * Mirrors DailyRouteStopRow, which the service keeps private: the test asserts
 * the row→DTO mapping, so it has to be able to build a raw row by hand.
 */
interface StopRow {
  id: string;
  route_user_id: string;
  route_id: string;
  route_name: string;
  route_municipality: string | null;
  route_zone: string | null;
  stop_type: StopType;
  target_kind: TargetKind;
  target_id: string;
  name: string;
  trade_name: string | null;
  address: string | null;
  zone: string | null;
  municipality: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  sort_order: number | null;
  is_extra: boolean;
  reason: string | null;
  completed_at: Date | null;
}

/** A planned customer stop with GPS, still pending. The seed's "stop A". */
const stopRow = (overrides: Partial<StopRow> = {}): StopRow => ({
  id: '69b10917-fcbb-4450-b909-73963b7534d8',
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
  lat: 13.7533400206238,
  lng: -89.2287687322544,
  sort_order: 1,
  is_extra: false,
  reason: null,
  completed_at: null,
  ...overrides,
});

const buildClient = (rows: StopRow[]) => {
  const $queryRaw = jest.fn().mockResolvedValue(rows);
  const client = { $queryRaw } as unknown as Client;
  return { client, $queryRaw };
};

const ranQuery = ($queryRaw: jest.Mock): Prisma.Sql => $queryRaw.mock.calls[0][0];

/**
 * The SQL the service ran, with block comments removed and formatting
 * whitespace collapsed, so the assertions can match on structure.
 */
const ranSql = ($queryRaw: jest.Mock): string =>
  ranQuery($queryRaw)
    .sql.replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

interface SqlClauses {
  /** Body of each JOIN's ON clause, keyed by the joined table's alias. */
  on: Record<string, string>;
  /** 'inner' or 'left', keyed by the same alias. */
  kind: Record<string, 'inner' | 'left'>;
  /** Body of the WHERE clause, without the trailing ORDER BY. */
  where: string;
}

/**
 * Cuts the query into its top-level clauses.
 *
 * Asserting that "<alias>.deleted_at IS NULL" appears *somewhere* in the SQL
 * proves nothing: the substring is identical whether the predicate sits in its
 * own ON clause or has been moved into the WHERE. That move is precisely the
 * regression the service's own comment warns about — it silently turns a LEFT
 * JOIN into an inner one and drops the stops the join exists to keep — so the
 * assertions have to be able to tell the two apart.
 */
const clausesOf = (sql: string): SqlClauses => {
  const body = sql.slice(sql.indexOf('FROM route_user'));
  const clauses: SqlClauses = { on: {}, kind: {}, where: '' };

  // ranSql has already collapsed every run of whitespace to one space, so the
  // pattern can use literal spaces. Each ON clause runs up to the next join or
  // to the WHERE; "LEFT JOIN" is matched as a whole so a boundary can never
  // fall between LEFT and JOIN and turn a left join into an apparent inner one.
  const joins = /(LEFT )?JOIN \w+ (\w+) ON (.*?)(?= (?:LEFT )?JOIN | WHERE )/g;

  let join: RegExpExecArray | null;
  while ((join = joins.exec(body)) !== null) {
    const [, left, alias, on] = join;
    clauses.on[alias] = on;
    clauses.kind[alias] = left ? 'left' : 'inner';
  }

  const where = / WHERE (.*?)(?= ORDER BY |$)/.exec(body);
  if (where) clauses.where = where[1];

  return clauses;
};

describe('getDailyRoute — mapeo fila→DTO', () => {
  it('convierte lat/lng en location', async () => {
    const { client } = buildClient([stopRow()]);

    const route = await getDailyRoute(client, SELLER_ID, DATE);

    expect(route.stops[0].location).toEqual({
      lat: 13.7533400206238,
      lng: -89.2287687322544,
    });
  });

  it('deja location en null cuando el destino no tiene GPS', async () => {
    const { client } = buildClient([stopRow({ lat: null, lng: null })]);

    const route = await getDailyRoute(client, SELLER_ID, DATE);

    // An ordinary case, not an error: the customer list even has a
    // `without_gps` filter. The card degrades to the zone with no distance.
    expect(route.stops[0].location).toBeNull();
    expect(route.stops[0]).toHaveProperty('location');
  });

  it('no inventa una coordenada cuando solo viene una de las dos', async () => {
    const { client } = buildClient([stopRow({ lat: 13.7, lng: null })]);

    const route = await getDailyRoute(client, SELLER_ID, DATE);

    expect(route.stops[0].location).toBeNull();
  });

  it('no filtra lat ni lng crudos al DTO', async () => {
    const { client } = buildClient([stopRow()]);

    const route = await getDailyRoute(client, SELLER_ID, DATE);

    expect(route.stops[0]).not.toHaveProperty('lat');
    expect(route.stops[0]).not.toHaveProperty('lng');
  });

  it('pasa is_extra y sort_order al DTO tal como vienen de la fila', async () => {
    // Pass-through only. is_extra is derived by the SQL from the absence of a
    // live route_customer row, and a mocked $queryRaw cannot exercise that —
    // the derivation is covered by the SQL-shape test below and by the run
    // against the seeded database.
    const { client } = buildClient([
      stopRow({ sort_order: null, is_extra: true, reason: 'Reclamo' }),
    ]);

    const route = await getDailyRoute(client, SELLER_ID, DATE);

    expect(route.stops[0].is_extra).toBe(true);
    expect(route.stops[0].sort_order).toBeNull();
    expect(route.stops[0].reason).toBe('Reclamo');
  });

  it('devuelve completed_at como Date cuando la parada ya se ejecutó', async () => {
    const { client } = buildClient([
      stopRow({ completed_at: new Date('2026-09-19T15:10:00.000Z') }),
    ]);

    const route = await getDailyRoute(client, SELLER_ID, DATE);

    expect(route.stops[0].completed_at).toEqual(
      new Date('2026-09-19T15:10:00.000Z')
    );
  });

  it('serializa completed_at al instante ISO que pide el contrato', async () => {
    const { client } = buildClient([
      stopRow({ completed_at: new Date('2026-09-19T15:10:00.000Z') }),
    ]);

    const route = await getDailyRoute(client, SELLER_ID, DATE);

    // The DTO keeps a Date, like every other date field in the domain types;
    // what the contract pins down is the wire shape, which is what Express
    // produces here.
    const wire = JSON.parse(JSON.stringify(route.stops[0]));
    expect(wire.completed_at).toBe('2026-09-19T15:10:00.000Z');
  });

  it('deja completed_at en null mientras la parada está pendiente', async () => {
    const { client } = buildClient([stopRow()]);

    const route = await getDailyRoute(client, SELLER_ID, DATE);

    expect(route.stops[0].completed_at).toBeNull();
  });

  it('pasa al DTO el zone y municipality nulos de un prospecto', async () => {
    // Pass-through only, again: that a prospect *always* has them null is a
    // property of the SQL projection, asserted in 'getDailyRoute — consulta'.
    const { client } = buildClient([
      stopRow({
        target_kind: 'prospect',
        target_id: '139f1343-55af-4731-84eb-aa082fe76cd6',
        name: 'Farmacia Nueva Vida',
        trade_name: 'Nueva Vida',
        zone: null,
        municipality: null,
        sort_order: null,
        is_extra: true,
      }),
    ]);

    const route = await getDailyRoute(client, SELLER_ID, DATE);

    expect(route.stops[0].target_kind).toBe('prospect');
    expect(route.stops[0].zone).toBeNull();
    expect(route.stops[0].municipality).toBeNull();
  });

  it('expone la ruta de la parada como {id, name}, sin metadata de ruta', async () => {
    const { client } = buildClient([stopRow()]);

    const route = await getDailyRoute(client, SELLER_ID, DATE);

    expect(route.stops[0].route).toEqual({ id: ROUTE_ID, name: 'Zona Escalon' });
    expect(route.stops[0]).not.toHaveProperty('route_user_id');
    expect(route.stops[0]).not.toHaveProperty('route_municipality');
    expect(route.stops[0]).not.toHaveProperty('route_zone');
  });
});

describe('getDailyRoute — routes[]', () => {
  it('arma routes con la asignación de cada parada, sin duplicarla', async () => {
    const { client } = buildClient([
      stopRow(),
      stopRow({ id: 'otra-parada', sort_order: 2 }),
    ]);

    const route = await getDailyRoute(client, SELLER_ID, DATE);

    expect(route.routes).toEqual([
      {
        id: ROUTE_ID,
        route_user_id: ROUTE_USER_ID,
        name: 'Zona Escalon',
        municipality: 'San Salvador',
        zone: 'Escalon',
      },
    ]);
  });

  it('devuelve las dos rutas cuando el vendedor tiene dos asignaciones ese día', async () => {
    // route_user is UQ(route_id, user_id, day), so two routes on the same day
    // are legal -- which is why `routes` is an array and not a single object.
    const { client } = buildClient([
      stopRow(),
      stopRow({
        id: 'parada-de-la-otra-ruta',
        route_user_id: '20c2178c-4ab4-44b0-a814-dbf6258cb663',
        route_id: '22222222-2222-2222-2222-222222222206',
        route_name: 'Zona Mejicanos',
        route_municipality: 'Mejicanos',
        route_zone: 'Mejicanos',
      }),
    ]);

    const route = await getDailyRoute(client, SELLER_ID, DATE);

    expect(route.routes).toHaveLength(2);
    expect(route.routes.map((item) => item.name)).toEqual([
      'Zona Escalon',
      'Zona Mejicanos',
    ]);
  });

  it('garantiza que toda route.id de una parada aparece en routes', async () => {
    const { client } = buildClient([
      stopRow(),
      stopRow({
        id: 'parada-de-la-otra-ruta',
        route_user_id: '20c2178c-4ab4-44b0-a814-dbf6258cb663',
        route_id: '22222222-2222-2222-2222-222222222206',
        route_name: 'Zona Mejicanos',
      }),
    ]);

    const route = await getDailyRoute(client, SELLER_ID, DATE);

    const known = route.routes.map((item) => item.id);
    for (const stop of route.stops) {
      expect(known).toContain(stop.route.id);
    }
  });

  it('devuelve routes y stops vacíos, nunca 404, si no hay paradas', async () => {
    const { client } = buildClient([]);

    const route = await getDailyRoute(client, SELLER_ID, DATE);

    // "No route today" is a legitimate answer: a 404 would light up the
    // seller's error screen instead.
    expect(route).toEqual({ date: DATE, routes: [], stops: [] });
  });
});

describe('getDailyRoute — fecha', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('usa el date recibido tal cual y lo devuelve en la respuesta', async () => {
    const { client, $queryRaw } = buildClient([]);

    const route = await getDailyRoute(client, SELLER_ID, '2026-01-31');

    expect(route.date).toBe('2026-01-31');
    expect(ranQuery($queryRaw).values).toContain('2026-01-31');
  });

  it('sin date, toma hoy en America/El_Salvador y no el del servidor', async () => {
    // 03:30 UTC on the 20th is 21:30 on the 19th in El Salvador. Taking the
    // server's day would hand the seller tomorrow's route -- that is, none.
    jest.useFakeTimers().setSystemTime(new Date('2026-09-20T03:30:00.000Z'));
    const { client, $queryRaw } = buildClient([]);

    const route = await getDailyRoute(client, SELLER_ID);

    expect(route.date).toBe('2026-09-19');
    expect(ranQuery($queryRaw).values).toContain('2026-09-19');
  });

  it('devuelve date como día calendario, no como instante', async () => {
    const { client } = buildClient([]);

    const route = await getDailyRoute(client, SELLER_ID, DATE);

    // A Date here would force a timezone onto a calendar day and reintroduce
    // the off-by-one the default exists to prevent.
    expect(typeof route.date).toBe('string');
  });
});

describe('getDailyRoute — consulta', () => {
  it('ordena por sort_order, nombre y id, como manda el contrato', async () => {
    const { client, $queryRaw } = buildClient([]);

    await getDailyRoute(client, SELLER_ID, DATE);

    // The sv.id tiebreak is what keeps list keys and map-pin identity stable
    // across refetches.
    expect(ranSql($queryRaw)).toMatch(
      /ORDER BY COALESCE\(rc\.sort_order, \?\) ASC, lower\(COALESCE\(c\.name, p\.name\)\) ASC, sv\.id ASC/
    );
    // 32767 = smallint's maximum: sends extras and prospects to the end.
    expect(ranQuery($queryRaw).values).toContain(32767);
  });

  it('no reordena en memoria lo que la base ya ordenó', async () => {
    const { client } = buildClient([
      stopRow({ id: 'a', sort_order: 1 }),
      stopRow({ id: 'b', sort_order: 10 }),
      stopRow({ id: 'c', sort_order: null, is_extra: true }),
    ]);

    const route = await getDailyRoute(client, SELLER_ID, DATE);

    expect(route.stops.map((stop) => stop.id)).toEqual(['a', 'b', 'c']);
  });

  it('arranca desde route_user, que es por donde pega el índice', async () => {
    const { client, $queryRaw } = buildClient([]);

    await getDailyRoute(client, SELLER_ID, DATE);

    // scheduled_visit_route_user_date_idx leads on route_user_id: the other
    // way round the planner has nothing to seek on and falls back to a seq
    // scan.
    expect(ranSql($queryRaw)).toContain('FROM route_user ru');
    expect(ranQuery($queryRaw).values).toContain(SELLER_ID);
  });

  it('filtra deleted_at en las siete tablas que toca', async () => {
    const { client, $queryRaw } = buildClient([]);

    await getDailyRoute(client, SELLER_ID, DATE);

    const clauses = clausesOf(ranSql($queryRaw));

    // route_user is the driving table, so its predicate belongs in the WHERE.
    expect(clauses.where).toContain('ru.deleted_at IS NULL');

    // Every joined table carries its own, inside its own ON clause.
    for (const alias of ['r', 'sv', 'c', 'p', 'rc', 'v']) {
      expect(clauses.on[alias]).toContain(`${alias}.deleted_at IS NULL`);
    }
  });

  it('mantiene los predicados de las tablas opcionales en el ON y no en el WHERE', async () => {
    const { client, $queryRaw } = buildClient([]);

    await getDailyRoute(client, SELLER_ID, DATE);

    const clauses = clausesOf(ranSql($queryRaw));

    // Moving any of these into the WHERE turns its LEFT JOIN into an inner
    // join and silently drops stops -- a stop at a customer with no live
    // route_customer row would vanish instead of coming back as an extra.
    for (const alias of ['c', 'p', 'rc', 'v']) {
      expect(clauses.kind[alias]).toBe('left');
      expect(clauses.where).not.toContain(`${alias}.deleted_at IS NULL`);
    }
  });

  it('une route con INNER JOIN, porque route.name no puede ser null', async () => {
    const { client, $queryRaw } = buildClient([]);

    await getDailyRoute(client, SELLER_ID, DATE);

    const clauses = clausesOf(ranSql($queryRaw));

    // Deliberate, and the one place this query drops a live scheduled_visit on
    // purpose: a LEFT JOIN would let a soft-deleted route project a null name
    // and make RouteRef.name: string a lie.
    expect(clauses.kind['r']).toBe('inner');
    expect(clauses.kind['sv']).toBe('inner');
  });

  it('descarta la parada cuyo destino fue borrado en blando', async () => {
    const { client, $queryRaw } = buildClient([]);

    await getDailyRoute(client, SELLER_ID, DATE);

    // Same class of silent drop as the route INNER JOIN: the contract says
    // `name` is never null, and a soft-deleted target has no name to give.
    expect(clausesOf(ranSql($queryRaw)).where).toContain(
      'COALESCE(c.id, p.id) IS NOT NULL'
    );
  });

  it('enlaza la ejecución por scheduled_visit_id, no por una heurística', async () => {
    const { client, $queryRaw } = buildClient([]);

    await getDailyRoute(client, SELLER_ID, DATE);

    const clauses = clausesOf(ranSql($queryRaw));

    // visit_scheduled_visit_uq is what proves this LEFT JOIN returns at most
    // one execution row per planned stop. A (customer, route_user, day)
    // heuristic could not tell a dispatch from a collection at the same
    // customer on the same day.
    expect(clauses.on['v']).toContain('v.scheduled_visit_id = sv.id');
    expect(clauses.on['v']).not.toContain('customer_id');
  });

  it('deriva is_extra de la ausencia de un route_customer vivo', async () => {
    const { client, $queryRaw } = buildClient([]);

    await getDailyRoute(client, SELLER_ID, DATE);

    const sql = ranSql($queryRaw);
    const clauses = clausesOf(sql);

    expect(sql).toContain('(rc.id IS NULL) AS is_extra');
    // "Live route_customer row for THIS route and THIS customer" -- drop any
    // of the three and is_extra stops meaning what the contract says.
    expect(clauses.on['rc']).toContain('rc.route_id = ru.route_id');
    expect(clauses.on['rc']).toContain('rc.customer_id = sv.customer_id');
    expect(clauses.on['rc']).toContain('rc.deleted_at IS NULL');
  });

  it('lee zone y municipality solo de customer, nunca del prospecto', async () => {
    const { client, $queryRaw } = buildClient([]);

    await getDailyRoute(client, SELLER_ID, DATE);

    const sql = ranSql($queryRaw);

    // This projection is the whole reason a prospect's zone and municipality
    // are always null. `prospect` has no such columns, so a COALESCE here
    // would have to invent them.
    expect(sql).toContain('c.zone AS zone');
    expect(sql).toContain('c.municipality AS municipality');
    expect(sql).not.toMatch(/COALESCE\(c\.zone/);
    expect(sql).not.toMatch(/COALESCE\(c\.municipality/);
  });
});
