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

/** The Prisma.Sql the service ran, with its formatting whitespace collapsed. */
const ranSql = ($queryRaw: jest.Mock): string => {
  const query: Prisma.Sql = $queryRaw.mock.calls[0][0];
  return query.sql.replace(/\s+/g, ' ').trim();
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

    // Caso corriente, no un error: la lista de clientes tiene filtro
    // without_gps. La tarjeta degrada a "{zona} ›" y no dibuja pin.
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

  it('marca is_extra cuando no hay fila viva en route_customer', async () => {
    const { client } = buildClient([
      stopRow({ sort_order: null, is_extra: true, reason: 'Reclamo' }),
    ]);

    const route = await getDailyRoute(client, SELLER_ID, DATE);

    expect(route.stops[0].is_extra).toBe(true);
    // El extra no tiene puesto en la composición de la ruta.
    expect(route.stops[0].sort_order).toBeNull();
    expect(route.stops[0].reason).toBe('Reclamo');
  });

  it('no marca is_extra en una parada planificada', async () => {
    const { client } = buildClient([stopRow()]);

    const route = await getDailyRoute(client, SELLER_ID, DATE);

    expect(route.stops[0].is_extra).toBe(false);
    expect(route.stops[0].sort_order).toBe(1);
  });

  it('devuelve completed_at como instante ISO cuando la parada ya se ejecutó', async () => {
    const { client } = buildClient([
      stopRow({ completed_at: new Date('2026-09-19T15:10:00.000Z') }),
    ]);

    const route = await getDailyRoute(client, SELLER_ID, DATE);

    expect(route.stops[0].completed_at).toBe('2026-09-19T15:10:00.000Z');
  });

  it('deja completed_at en null mientras la parada está pendiente', async () => {
    const { client } = buildClient([stopRow()]);

    const route = await getDailyRoute(client, SELLER_ID, DATE);

    expect(route.stops[0].completed_at).toBeNull();
  });

  it('da zone y municipality en null a los prospectos', async () => {
    const { client } = buildClient([
      stopRow({
        target_kind: 'prospect',
        target_id: '139f1343-55af-4731-84eb-aa082fe76cd6',
        name: 'Farmacia Nueva Vida',
        trade_name: 'Nueva Vida',
        // prospect no tiene columnas zone ni municipality: la consulta las lee
        // solo de customer, así que el prospecto llega con null.
        zone: null,
        municipality: null,
        sort_order: null,
        is_extra: true,
      })
    ]);

    const route = await getDailyRoute(client, SELLER_ID, DATE);

    expect(route.stops[0].target_kind).toBe('prospect');
    expect(route.stops[0].zone).toBeNull();
    expect(route.stops[0].municipality).toBeNull();
    // Un prospecto nunca tiene fila en route_customer: es extra por definición.
    expect(route.stops[0].is_extra).toBe(true);
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
    // route_user es UQ(route_id, user_id, day): dos rutas el mismo día son
    // legales, por eso routes es arreglo y no objeto.
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

    // "No tengo ruta hoy" es una respuesta legítima: un 404 encendería la UI
    // de error del vendedor.
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
    const query: Prisma.Sql = $queryRaw.mock.calls[0][0];
    expect(query.values).toContain('2026-01-31');
  });

  it('sin date, toma hoy en America/El_Salvador y no el del servidor', async () => {
    // 03:30 UTC del 20 son las 21:30 del 19 en El Salvador. Tomar el día del
    // servidor le daría al vendedor la ruta de mañana, es decir, ninguna.
    jest.useFakeTimers().setSystemTime(new Date('2026-09-20T03:30:00.000Z'));
    const { client, $queryRaw } = buildClient([]);

    const route = await getDailyRoute(client, SELLER_ID);

    expect(route.date).toBe('2026-09-19');
    const query: Prisma.Sql = $queryRaw.mock.calls[0][0];
    expect(query.values).toContain('2026-09-19');
  });
});

describe('getDailyRoute — consulta', () => {
  it('ordena por sort_order, nombre y id, como manda el contrato', async () => {
    const { client, $queryRaw } = buildClient([]);

    await getDailyRoute(client, SELLER_ID, DATE);

    // El desempate por sv.id es lo que mantiene estables las keys de lista y
    // la identidad de los pines entre refetches.
    expect(ranSql($queryRaw)).toMatch(
      /ORDER BY COALESCE\(rc\.sort_order, \?\) ASC, lower\(COALESCE\(c\.name, p\.name\)\) ASC, sv\.id ASC/
    );
    // 32767 = máximo de smallint: manda extras y prospectos al final.
    const query: Prisma.Sql = $queryRaw.mock.calls[0][0];
    expect(query.values).toContain(32767);
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

    // scheduled_visit_route_user_date_idx lidera por route_user_id: al revés,
    // el planner no tiene por dónde buscar y cae en seq scan.
    expect(ranSql($queryRaw)).toContain('FROM route_user ru');
    const query: Prisma.Sql = $queryRaw.mock.calls[0][0];
    expect(query.values).toContain(SELLER_ID);
  });

  it('filtra deleted_at en las seis tablas que toca', async () => {
    const { client, $queryRaw } = buildClient([]);

    await getDailyRoute(client, SELLER_ID, DATE);

    const sql = ranSql($queryRaw);
    for (const alias of ['ru', 'sv', 'c', 'p', 'rc', 'v']) {
      expect(sql).toContain(`${alias}.deleted_at IS NULL`);
    }
  });

  it('enlaza la ejecución por scheduled_visit_id, no por una heurística', async () => {
    const { client, $queryRaw } = buildClient([]);

    await getDailyRoute(client, SELLER_ID, DATE);

    // visit_scheduled_visit_uq es lo que prueba que el LEFT JOIN devuelve como
    // mucho una fila de ejecución por parada planificada.
    expect(ranSql($queryRaw)).toContain(
      'LEFT JOIN visit v ON v.scheduled_visit_id = sv.id'
    );
  });

  it('deriva is_extra de la ausencia de route_customer vivo', async () => {
    const { client, $queryRaw } = buildClient([]);

    await getDailyRoute(client, SELLER_ID, DATE);

    expect(ranSql($queryRaw)).toContain('(rc.id IS NULL) AS is_extra');
  });
});
