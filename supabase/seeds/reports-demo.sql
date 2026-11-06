-- Dev seed for the reports (RF-09 / PCRM-159). Runs after seed.sql and the
-- pcrm-* seeds on `supabase db reset` (the name sorts last on purpose: it
-- leaves alone every route day that already has agenda from them), and is
-- safe to re-run on its own:
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -f supabase/seeds/reports-demo.sql
--
-- No psql meta-commands: the Supabase CLI runs the file as is. Comments below
-- are in Spanish, written for whoever reads the reports this feeds.
--
-- SOLO AGREGA: no modifica ni borra filas que ya existían. Lo único que toca
-- de filas existentes es agregarles hijos (detalle de venta, historial de
-- saldo), nunca cambia sus columnas. Todas las fechas son relativas a hoy
-- (America/El_Salvador): unos 3,5 meses de agenda hacia atrás.
--
-- Re-ejecutable: al inicio borra solo lo que este archivo creó:
--   customer          b9300000-…  (erp_customer_id 9300001–9300012)
--   route_customer    b9300001-…
--   scheduled_visit   b9300002-…
--   visit             b9300003-…
--   goal              b9300005-…
--   product           erp 930001–930016
--   sale              erp 9300000–9309999
--   sale_detail       id >= 93000000 (incluye detalle agregado a ventas existentes)
--   balance_snapshot  upload_id IS NULL (la importación real siempre pone upload_id)
--
-- Qué alimenta cada bloque:
--   1. Productos + detalle de ventas sin detalle -> ventas por producto, ABC de
--      productos, rankings de productos.
--   2. Agenda + visitas + ventas encadenadas a ruta, repartidas entre los 5
--      vendedores -> ventas por ruta/zona/municipio, planificadas vs
--      realizadas, efectividad, comparativo de vendedores.
--   3. 12 clientes nuevos repartidos en 5 vendedores y 10 rutas -> clientes nuevos.
--   4. 4 clientes inactivos que vuelven a comprar hace 1-3 semanas -> recuperados.
--   5. Historial de saldos de las ventas a crédito -> cobranza ("cobrado").
--   6. Metas del mes pasado y el actual con cumplimiento variado (y Diana,
--      que no tenía) -> metas.

BEGIN;

SELECT setseed(0.4217);

-- ── Limpieza de lo propio ───────────────────────────────────────────────────
DELETE FROM balance_snapshot WHERE upload_id IS NULL;
DELETE FROM sale_detail WHERE sale_detail_id >= 93000000;
DELETE FROM sale WHERE erp_sale_id BETWEEN 9300000 AND 9309999;
DELETE FROM visit WHERE id::text LIKE 'b9300003-%';
DELETE FROM scheduled_visit WHERE id::text LIKE 'b9300002-%';
DELETE FROM route_customer WHERE id::text LIKE 'b9300001-%';
DELETE FROM goal WHERE id::text LIKE 'b9300005-%';
DELETE FROM customer WHERE id::text LIKE 'b9300000-%';
DELETE FROM product WHERE erp_product_id BETWEEN 930001 AND 930016;

-- ── 1. Productos ────────────────────────────────────────────────────────────
INSERT INTO product (erp_product_id, code, name, product_group, last_seen_at) VALUES
  (930001, 'LOR-10',  'Loratadina 10 mg',          'Antialergicos',        now()),
  (930002, 'MET-850', 'Metformina 850 mg',         'Cronicos',             now()),
  (930003, 'ATO-20',  'Atorvastatina 20 mg',       'Cronicos',             now()),
  (930004, 'ENA-10',  'Enalapril 10 mg',           'Cronicos',             now()),
  (930005, 'DIC-50',  'Diclofenaco 50 mg',         'Analgesicos',          now()),
  (930006, 'NAP-550', 'Naproxeno 550 mg',          'Analgesicos',          now()),
  (930007, 'AZI-500', 'Azitromicina 500 mg',       'Antibioticos',         now()),
  (930008, 'CIP-500', 'Ciprofloxacina 500 mg',     'Antibioticos',         now()),
  (930009, 'SAL-INH', 'Salbutamol inhalador',      'Respiratorio',         now()),
  (930010, 'LOP-2',   'Loperamida 2 mg',           'Gastro',               now()),
  (930011, 'RAN-150', 'Ranitidina 150 mg',         'Gastro',               now()),
  (930012, 'COM-B',   'Complejo B',                'Vitaminas',            now()),
  (930013, 'ZIN-20',  'Zinc 20 mg',                'Vitaminas',            now()),
  (930014, 'ALC-70',  'Alcohol gel 70%',           'Higiene',              now()),
  (930015, 'GAS-EST', 'Gasas esteriles',           'Material de curacion', now()),
  (930016, 'PRE-30',  'Prenatal multivitaminico',  'Vitaminas',            now());

-- Objetos temporales de este archivo: se borran antes (por si la misma sesión
-- lo corre dos veces) y al final.
DROP TABLE IF EXISTS tmp_products, tmp_pw_raw, tmp_pw, tmp_inactive, tmp_new, tmp_plan;
DROP SEQUENCE IF EXISTS seq_sv, seq_visit, seq_sale, seq_det;

-- Popularidad (rank) y precio por unidad de venta. Incluye los 8 que ya existían.
CREATE TEMP TABLE tmp_products (erp int, rank int, box_price numeric, uom text, factor numeric);
INSERT INTO tmp_products VALUES
  (918801,  1,  6.50, 'CAJA', 100), (918803,  2, 14.00, 'CAJA', 100),
  (918802,  3,  8.00, 'CAJA', 100), (918804,  4, 12.00, 'CAJA',  30),
  (930002,  5,  9.50, 'CAJA', 100), (918805,  6,  9.00, 'CAJA',  30),
  (918806,  7,  1.25, 'UNIDAD',  1), (918807,  8,  7.00, 'CAJA',  30),
  (930003,  9, 15.00, 'CAJA',  30), (930001, 10,  5.50, 'CAJA', 100),
  (918808, 11,  3.50, 'UNIDAD',  1), (930004, 12,  6.00, 'CAJA', 100),
  (930005, 13,  5.00, 'CAJA', 100), (930007, 14, 18.00, 'CAJA',  30),
  (930012, 15,  4.50, 'CAJA',  30), (930014, 16,  2.75, 'UNIDAD',  1),
  (930008, 17, 16.00, 'CAJA', 100), (930006, 18,  7.50, 'CAJA', 100),
  (930009, 19,  6.25, 'UNIDAD',  1), (930011, 20,  5.00, 'CAJA', 100),
  (930010, 21,  4.00, 'CAJA', 100), (930013, 22,  3.75, 'CAJA',  30),
  (930015, 23,  2.20, 'CAJA',  10), (930016, 24, 11.00, 'CAJA',  30);

-- Preferencia por vendedor: misma curva de popularidad con ruido propio, para
-- que el ABC tenga A/B/C pero cada vendedor no venda exactamente lo mismo.
CREATE TEMP TABLE tmp_pw_raw AS
SELECT u.k AS user_key, p.erp, p.box_price, p.uom, p.factor,
       (1.0 / power(p.rank, 0.85)) * (0.5 + random()) AS w
FROM (SELECT id AS k FROM app_user WHERE role = 'Vendedor'
      UNION ALL SELECT '00000000-0000-0000-0000-000000000000'::uuid) u
CROSS JOIN tmp_products p;

CREATE TEMP TABLE tmp_pw AS
SELECT r.*, SUM(w) OVER (PARTITION BY user_key ORDER BY erp) AS cum,
            SUM(w) OVER (PARTITION BY user_key)            AS tot
FROM tmp_pw_raw r;

-- ── Clientes que hoy no deben recibir ventas al azar ────────────────────────
-- Última compra hace más de 30 días o nunca: se quedan así para que
-- "clientes sin compra 30/60/90" siga teniendo filas en cada tramo. Solo los
-- 4 recuperados (bloque 4) vuelven a comprar, a propósito.
CREATE TEMP TABLE tmp_inactive AS
SELECT c.id AS customer_id
FROM customer c
LEFT JOIN LATERAL (
  SELECT max(s.erp_created_at) AS last_at FROM sale s
  WHERE s.customer_id = c.id AND s.erp_status = 2 AND s.deleted_at IS NULL
) ls ON true
WHERE c.deleted_at IS NULL
  AND (ls.last_at IS NULL OR ls.last_at < now() - interval '30 days');

-- ── 3. Clientes nuevos ──────────────────────────────────────────────────────
-- Alta escalonada: de hace 15 semanas a hace una (`ago`, en días).
CREATE TEMP TABLE tmp_new AS
SELECT ('b9300000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid AS id,
       ('b9300001-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid AS rc_id,
       9300000 + n AS erp, name, route_name,
       (now() AT TIME ZONE 'America/El_Salvador')::date - ago AS start_date,
       credit, personality, potential, est
FROM (VALUES
  ( 1, 'Farmacia San Rafael Apopa',     'Zona Apopa',              105, true,  'verde',    'alto',  'independiente'),
  ( 2, 'Farmacia Divina Providencia',   'Zona Mejicanos',           91, false, 'azul',     'medio', 'independiente'),
  ( 3, 'Farmacia La Esperanza Merliot', 'Zona Merliot',             77, true,  'amarillo', 'alto',  'cadena'),
  ( 4, 'Farmacia Santa Lucia',          'Zona Ilopango',            63, true,  'rojo',     'medio', 'independiente'),
  ( 5, 'Farmacia El Buen Pastor',       'Zona San Marcos',          49, false, 'verde',    'bajo',  'independiente'),
  ( 6, 'Farmacia Central Plaza',        'Zona Centro',              42, true,  'azul',     'alto',  'cadena'),
  ( 7, 'Farmacia Las Arboledas',        'Zona Escalon',             28, true,  'amarillo', 'medio', 'independiente'),
  ( 8, 'Farmacia Vida Sana',            'Zona Soyapango',           21, false, 'verde',    'medio', 'independiente'),
  ( 9, 'Farmacia Nueva Apopa',          'Zona Apopa',               16, false, 'rojo',     'bajo',  'independiente'),
  (10, 'Farmacia Santa Elena',          'Zona Antiguo Cuscatlan',   14, true,  'azul',     'alto',  'cadena'),
  (11, 'Farmacia Los Angeles',          'Zona Ilopango',             9, false, 'amarillo', 'medio', 'independiente'),
  (12, 'Farmacia Popular Delgado',      'Zona Ciudad Delgado',       7, true,  'verde',    'medio', 'independiente')
) AS x(n, name, route_name, ago, credit, personality, potential, est);

INSERT INTO customer (id, erp_customer_id, name, trade_name, personality, potential, establishment_type,
                      address, municipality, zone, phone, location, credit, credit_limit, active,
                      created_at, updated_at)
SELECT n.id, n.erp, n.name, n.name, n.personality, n.potential, n.est,
       'Calle principal, ' || r.municipality, r.municipality, r.zone,
       '2' || lpad((floor(random() * 9999999))::text, 7, '0'),
       ST_SetSRID(ST_MakePoint(ctr.x + (random() - 0.5) * 0.012, ctr.y + (random() - 0.5) * 0.012), 4326)::geography,
       n.credit, CASE WHEN n.credit THEN 1500 END, true,
       (n.start_date + time '09:00') AT TIME ZONE 'America/El_Salvador', now()
FROM tmp_new n
JOIN route r ON r.name = n.route_name AND r.deleted_at IS NULL
CROSS JOIN LATERAL (
  SELECT avg(ST_X(c.location::geometry)) AS x, avg(ST_Y(c.location::geometry)) AS y
  FROM route_customer rc JOIN customer c ON c.id = rc.customer_id
  WHERE rc.route_id = r.id AND rc.deleted_at IS NULL AND c.location IS NOT NULL
) ctr;

INSERT INTO route_customer (id, route_id, customer_id, sort_order, stop_type, created_at, updated_at)
SELECT n.rc_id, r.id, n.id,
       (SELECT COALESCE(max(sort_order), 0) + 1 FROM route_customer WHERE route_id = r.id),
       'visit', (n.start_date + time '09:00') AT TIME ZONE 'America/El_Salvador', now()
FROM tmp_new n JOIN route r ON r.name = n.route_name AND r.deleted_at IS NULL;

-- ── 2. Plan de agenda por ruta ──────────────────────────────────────────────
-- pcrm-188 ya cubre las últimas 8 semanas de casi todas las rutas, así que
-- esas rutas solo reciben las ~8 semanas anteriores. Ilopango y Apopa casi no
-- tienen agenda previa y reciben las ~16 semanas: por eso van con menos
-- paradas por día. El objetivo es que lo agregado quede repartido entre los 5
-- vendedores, sin cargarlo a uno. Luis, que ya lidera, recibe un poco menos. Mejicanos queda con
-- cobertura baja a propósito (planificadas vs realizadas).
CREATE TEMP TABLE tmp_plan AS
SELECT ru.id AS ru_id, ru.route_id, ru.user_id, ru.day,
       x.stops, x.exec_rate, x.sale_rate, x.mult, x.extra_rate
FROM (VALUES
  ('Zona Ilopango',          2, 0.85, 0.60, 1.00, 0.20),
  ('Zona Apopa',             2, 0.80, 0.60, 1.00, 0.20),
  ('Zona Merliot',           4, 0.85, 0.65, 1.05, 0.30),
  ('Zona San Marcos',        5, 0.80, 0.70, 1.10, 0.30),
  ('Zona Mejicanos',         5, 0.55, 0.65, 1.00, 0.20),
  ('Zona Escalon',           5, 0.85, 0.65, 1.05, 0.25),
  ('Zona Centro',            5, 0.80, 0.65, 1.05, 0.25),
  ('Zona Antiguo Cuscatlan', 5, 0.80, 0.65, 1.05, 0.25),
  ('Zona Ciudad Delgado',    4, 0.75, 0.60, 0.95, 0.15),
  ('Zona Soyapango',         4, 0.75, 0.60, 0.95, 0.15)
) AS x(route, stops, exec_rate, sale_rate, mult, extra_rate)
JOIN route r ON r.name = x.route AND r.deleted_at IS NULL
JOIN route_user ru ON ru.route_id = r.id AND ru.deleted_at IS NULL;

CREATE TEMP SEQUENCE seq_sv;
CREATE TEMP SEQUENCE seq_visit;
CREATE TEMP SEQUENCE seq_sale START 9300000;
CREATE TEMP SEQUENCE seq_det START 93000000;

-- Una parada de la agenda; si se ejecuta, su visita; si hubo pedido, su venta.
-- Devuelve true si creó venta.
CREATE OR REPLACE FUNCTION pg_temp.mk_stop(
  p_ru uuid, p_user uuid, p_date date, p_customer uuid, p_rc uuid, p_stop_type text,
  p_extra boolean, p_sort int, p_exec numeric, p_sale_rate numeric, p_mult numeric,
  p_can_sell boolean, p_force boolean
) RETURNS boolean LANGUAGE plpgsql AS $f$
DECLARE
  tz     constant text := 'America/El_Salvador';
  v_sv    uuid := ('b9300002-0000-4000-8000-' || lpad(nextval('seq_sv')::text, 12, '0'))::uuid;
  v_visit uuid;
  v_start timestamptz;
  v_end   timestamptz;
  v_sale  boolean;
  v_succ  boolean;
  v_id    int;
  v_total numeric;
  v_net   numeric;
  v_at    timestamptz;
  r       numeric;
  v_paid_cut numeric;
  v_pid   smallint;
  v_pay   text;
  v_pend  numeric;
BEGIN
  INSERT INTO scheduled_visit (id, route_user_id, visit_date, customer_id, stop_type, is_extra,
                               sort_order, reason, created_at, updated_at)
  VALUES (v_sv, p_ru, p_date, p_customer, p_stop_type, p_extra, p_sort,
          CASE WHEN p_extra THEN 'Parada extra solicitada por el cliente' END,
          (p_date + time '06:00') AT TIME ZONE tz, (p_date + time '06:00') AT TIME ZONE tz);

  IF NOT p_force AND random() >= p_exec THEN
    RETURN false;  -- parada planificada que nadie ejecutó
  END IF;

  v_start := (p_date + time '08:00'
              + make_interval(mins => p_sort * 35 + floor(random() * 20)::int)) AT TIME ZONE tz;
  v_end   := v_start + make_interval(mins => 10 + floor(random() * 20)::int);
  v_sale  := p_can_sell AND p_stop_type <> 'collection' AND (p_force OR random() < p_sale_rate);
  v_succ  := v_sale OR p_stop_type <> 'visit' OR random() < 0.30;
  v_visit := ('b9300003-0000-4000-8000-' || lpad(nextval('seq_visit')::text, 12, '0'))::uuid;

  INSERT INTO visit (id, customer_id, user_id, route_user_id, route_customer_id, started_at, finished_at,
                     visit_type, successful, no_order_reason, scheduled_visit_id, created_at, updated_at)
  VALUES (v_visit, p_customer, p_user, p_ru, p_rc, v_start, v_end, p_stop_type, v_succ,
          CASE WHEN NOT v_succ THEN (ARRAY['Inventario suficiente', 'Encargado ausente',
                                           'Sin necesidad de producto', 'Precio alto',
                                           'Local cerrado'])[1 + floor(random() * 5)::int] END,
          v_sv, v_end, v_end);

  IF NOT v_sale THEN
    RETURN false;
  END IF;

  v_id    := nextval('seq_sale');
  v_total := round(((120 + power(random(), 1.6) * 700)::numeric) * p_mult, 2);
  v_net   := round(v_total / 1.13, 2);
  v_at    := v_end + interval '5 minutes';
  r       := random();
  v_paid_cut := 0.75;
  IF v_at < now() - interval '60 days' THEN v_paid_cut := 0.90; END IF;
  IF r < 0.45 THEN
    v_pid := 1; v_pay := 'Contado'; v_pend := 0;
  ELSIF r < v_paid_cut AND v_at < now() - interval '14 days' THEN
    v_pid := 6; v_pay := 'Credito Pagado'; v_pend := 0;
  ELSE
    v_pid := 5; v_pay := 'Credito'; v_pend := v_total;
  END IF;

  INSERT INTO sale (erp_sale_id, customer_id, user_id, visit_id, erp_created_at, last_payment_at,
                    total, net_total, vat, pending_balance, payment, payment_id, erp_status, document)
  VALUES (v_id, p_customer, p_user, v_visit, v_at, CASE WHEN v_pid = 1 THEN v_at END,
          v_total, v_net, v_total - v_net, v_pend, v_pay, v_pid, 2, 'CCF-' || v_id);
  RETURN true;
END
$f$;

-- Agenda de las últimas ~15,5 semanas. Un día de ruta que ya tiene agenda se respeta tal cual
-- (los seeds de PCRM-160/188 y lo que generó la app): no se le suman paradas.
DO $$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  p record; d date; c record; x record; v_sort int;
BEGIN
  FOR p IN SELECT * FROM tmp_plan ORDER BY day, ru_id LOOP
    FOR d IN
      SELECT g::date FROM generate_series(v_today - 109, v_today - 1, interval '1 day') g
      WHERE extract(isodow FROM g) = p.day
    LOOP
      CONTINUE WHEN EXISTS (SELECT 1 FROM scheduled_visit sv
                            WHERE sv.route_user_id = p.ru_id AND sv.visit_date = d AND sv.deleted_at IS NULL);
      v_sort := 0;
      FOR c IN
        SELECT rc.id AS rc_id, rc.customer_id, COALESCE(rc.stop_type, 'visit') AS st,
               (n.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sale s WHERE s.customer_id = n.id)) AS first_due,
               NOT EXISTS (SELECT 1 FROM tmp_inactive i WHERE i.customer_id = rc.customer_id) AS can_sell
        FROM route_customer rc
        JOIN customer cu ON cu.id = rc.customer_id AND cu.deleted_at IS NULL AND cu.active
        LEFT JOIN tmp_new n ON n.id = rc.customer_id
        WHERE rc.route_id = p.route_id AND rc.deleted_at IS NULL
          AND (n.id IS NULL OR n.start_date <= d)
        ORDER BY 4 DESC, random()
        LIMIT p.stops
      LOOP
        v_sort := v_sort + 1;
        PERFORM pg_temp.mk_stop(p.ru_id, p.user_id, d, c.customer_id, c.rc_id, c.st, false, v_sort,
                                p.exec_rate, p.sale_rate, p.mult, c.can_sell, c.first_due);
      END LOOP;

      -- De vez en cuando, una parada extra con un cliente de otra ruta del mismo vendedor.
      IF random() < p.extra_rate THEN
        SELECT rc.customer_id,
               NOT EXISTS (SELECT 1 FROM tmp_inactive i WHERE i.customer_id = rc.customer_id) AS can_sell
        INTO x
        FROM route_customer rc
        JOIN route_user ru2 ON ru2.route_id = rc.route_id AND ru2.deleted_at IS NULL AND ru2.user_id = p.user_id
        JOIN customer cu ON cu.id = rc.customer_id AND cu.deleted_at IS NULL AND cu.active
        WHERE rc.deleted_at IS NULL AND rc.route_id <> p.route_id
          AND NOT EXISTS (SELECT 1 FROM tmp_new n WHERE n.id = rc.customer_id)
          AND NOT EXISTS (SELECT 1 FROM scheduled_visit sv
                          WHERE sv.route_user_id = p.ru_id AND sv.visit_date = d
                            AND sv.customer_id = rc.customer_id AND sv.deleted_at IS NULL)
        ORDER BY random() LIMIT 1;
        IF FOUND THEN
          PERFORM pg_temp.mk_stop(p.ru_id, p.user_id, d, x.customer_id, NULL, 'visit', true, v_sort + 1,
                                  0.90, p.sale_rate, p.mult, x.can_sell, false);
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END
$$;

-- Clientes nuevos cuya ruta ya tenía agenda en esas fechas: su primera compra
-- entra como parada extra en el primer día de su ruta desde su alta.
-- Bloque 4, recuperados: 4 inactivos de distintos vendedores que vuelven a
-- comprar hace 1-3 semanas (`ago`, en días).
DO $$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  c record; d date;
BEGIN
  FOR c IN
    SELECT n.id AS customer_id, n.rc_id, n.start_date AS target, ru.id AS ru_id, ru.user_id, ru.day, 1.0 AS mult
    FROM tmp_new n
    JOIN route r ON r.name = n.route_name AND r.deleted_at IS NULL
    JOIN route_user ru ON ru.route_id = r.id AND ru.deleted_at IS NULL
    WHERE NOT EXISTS (SELECT 1 FROM sale s WHERE s.customer_id = n.id)
    UNION ALL
    SELECT cu.id, rc.id, v_today - x.ago, ru.id, ru.user_id, ru.day, 1.2
    FROM (VALUES
      ('Farmacia Maria Lopez 41',     'Zona Escalon',        18),
      ('Farmacia Oscar Delgado 50',   'Zona Apopa',           9),
      ('Farmacia Patricia Nunez 49',  'Zona Ciudad Delgado', 10),
      ('Farmacia Karla Ramirez 23',   'Zona Merliot',         9)
    ) AS x(customer, route, ago)
    JOIN customer cu ON cu.name = x.customer AND cu.deleted_at IS NULL
    JOIN route r ON r.name = x.route AND r.deleted_at IS NULL
    JOIN route_customer rc ON rc.route_id = r.id AND rc.customer_id = cu.id AND rc.deleted_at IS NULL
    JOIN route_user ru ON ru.route_id = r.id AND ru.deleted_at IS NULL
  LOOP
    -- Primer día de su ruta desde la fecha objetivo en que el cliente no
    -- tenga ya una parada (si la tiene, se respeta y se usa el siguiente).
    d := NULL;
    SELECT g::date INTO d
    FROM generate_series(c.target, v_today - 1, interval '1 day') g
    WHERE extract(isodow FROM g) = c.day
      AND NOT EXISTS (SELECT 1 FROM scheduled_visit sv
                      WHERE sv.route_user_id = c.ru_id AND sv.visit_date = g::date
                        AND sv.customer_id = c.customer_id AND sv.deleted_at IS NULL)
    ORDER BY g LIMIT 1;
    CONTINUE WHEN d IS NULL;
    PERFORM pg_temp.mk_stop(c.ru_id, c.user_id, d, c.customer_id, c.rc_id, 'visit', true, 12,
                            1, 1, c.mult, true, true);
  END LOOP;
END
$$;

-- ── 1b. Detalle de todas las ventas confirmadas que no tienen ───────────────
-- Las líneas suman exactamente el total de la venta.
DO $$
DECLARE
  s record; pr record;
  n int; i int; w numeric[]; wsum numeric; acc numeric; amt numeric; t numeric; qty numeric;
BEGIN
  FOR s IN
    SELECT sa.erp_sale_id, sa.total,
           COALESCE(sa.user_id, '00000000-0000-0000-0000-000000000000'::uuid) AS uk
    FROM sale sa
    WHERE sa.deleted_at IS NULL AND sa.erp_status = 2 AND COALESCE(sa.total, 0) > 0
      AND NOT EXISTS (SELECT 1 FROM sale_detail d WHERE d.erp_sale_id = sa.erp_sale_id)
    ORDER BY sa.erp_sale_id
  LOOP
    n := 1 + floor(random() * 3)::int + CASE WHEN s.total > 600 THEN 1 ELSE 0 END;
    w := ARRAY[]::numeric[];
    FOR i IN 1..n LOOP w := w || (0.3 + random())::numeric; END LOOP;
    SELECT sum(v) INTO wsum FROM unnest(w) v;
    acc := 0;
    FOR i IN 1..n LOOP
      amt := CASE WHEN i < n THEN round(s.total * w[i] / wsum, 2) ELSE s.total - acc END;
      acc := acc + amt;
      CONTINUE WHEN amt <= 0;
      t := random();
      SELECT * INTO pr FROM tmp_pw WHERE user_key = s.uk AND cum >= t * tot ORDER BY cum LIMIT 1;
      qty := greatest(1, round(amt / pr.box_price));
      INSERT INTO sale_detail (sale_detail_id, erp_sale_id, product_id, quantity, unit_of_measure,
                               factor, price, total, tax_total)
      VALUES (nextval('seq_det'), s.erp_sale_id, pr.erp, qty, pr.uom, pr.factor,
              round(amt / qty, 4), amt, round(amt - amt / 1.13, 4));
    END LOOP;
  END LOOP;
END
$$;

-- ── 5. Historial de saldos de las ventas a crédito ──────────────────────────
-- Una carga semanal (lunes 14:00). Cada factura a crédito aparece con su total
-- en la primera carga posterior a su emisión; las pagadas bajan a 0 entre 2 y
-- 9 semanas después (a veces con un abono parcial en medio). Las pendientes
-- siguen con su saldo, igual que hoy. "Cobrado" = esas bajas de saldo.
DO $$
DECLARE
  tz constant text := 'America/El_Salvador';
  v_today date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_last_mon date;
  s record; ld date; first_d date; pay_d date; mid_d date; weeks int;
BEGIN
  v_last_mon := v_today - (extract(isodow FROM v_today)::int - 1);
  FOR s IN
    SELECT sa.erp_sale_id, sa.total, sa.pending_balance, sa.erp_created_at
    FROM sale sa
    WHERE sa.deleted_at IS NULL AND sa.erp_status = 2 AND sa.payment_id IN (5, 6)
      AND sa.erp_created_at IS NOT NULL AND COALESCE(sa.total, 0) > 0
      AND NOT EXISTS (SELECT 1 FROM balance_snapshot b WHERE b.erp_sale_id = sa.erp_sale_id)
    ORDER BY sa.erp_sale_id
  LOOP
    ld := (s.erp_created_at AT TIME ZONE tz)::date;
    first_d := ld + (8 - extract(isodow FROM ld)::int);
    CONTINUE WHEN first_d > v_last_mon;

    IF COALESCE(s.pending_balance, 0) > 0 THEN
      INSERT INTO balance_snapshot (upload_id, erp_sale_id, pending_balance, payment, captured_at)
      VALUES (NULL, s.erp_sale_id, s.total, 'Credito', (first_d + time '14:00') AT TIME ZONE tz);
      IF s.pending_balance < s.total THEN
        INSERT INTO balance_snapshot (upload_id, erp_sale_id, pending_balance, payment, captured_at)
        VALUES (NULL, s.erp_sale_id, s.pending_balance, 'Credito', (v_last_mon + time '14:00') AT TIME ZONE tz);
      END IF;
      CONTINUE;
    END IF;

    weeks := 2 + floor(random() * 8)::int;
    pay_d := least(first_d + weeks * 7, v_last_mon);
    IF pay_d <= first_d THEN
      INSERT INTO balance_snapshot (upload_id, erp_sale_id, pending_balance, payment, captured_at)
      VALUES (NULL, s.erp_sale_id, 0, 'Credito Pagado', (first_d + time '14:00') AT TIME ZONE tz);
      CONTINUE;
    END IF;

    INSERT INTO balance_snapshot (upload_id, erp_sale_id, pending_balance, payment, captured_at)
    VALUES (NULL, s.erp_sale_id, s.total, 'Credito', (first_d + time '14:00') AT TIME ZONE tz);
    IF pay_d - first_d >= 21 AND random() < 0.45 THEN
      mid_d := first_d + ((pay_d - first_d) / 14) * 7;
      INSERT INTO balance_snapshot (upload_id, erp_sale_id, pending_balance, payment, captured_at)
      VALUES (NULL, s.erp_sale_id, round(s.total * (0.3 + random() * 0.4)::numeric, 2), 'Credito',
              (mid_d + time '14:00') AT TIME ZONE tz);
    END IF;
    INSERT INTO balance_snapshot (upload_id, erp_sale_id, pending_balance, payment, captured_at)
    VALUES (NULL, s.erp_sale_id, 0, 'Credito Pagado', (pay_d + time '14:00') AT TIME ZONE tz);

    IF s.erp_sale_id BETWEEN 9300000 AND 9309999 THEN
      UPDATE sale SET last_payment_at = (pay_d + time '14:00') AT TIME ZONE tz
      WHERE erp_sale_id = s.erp_sale_id;
    END IF;
  END LOOP;
END
$$;

-- ── 6. Metas ────────────────────────────────────────────────────────────────
-- Mes pasado y mes actual para todos (y los dos anteriores para Diana, que no
-- tenía), calculadas sobre la venta real del mes (el actual, proyectado a fin
-- de mes) con un cumplimiento objetivo distinto por vendedor: unos pasan,
-- otros no. `mo` es el mes relativo al actual. No pisa metas existentes.
DO $$
DECLARE
  tz constant text := 'America/El_Salvador';
  v_today date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  g record; v_start date; v_end date; v_sales numeric; v_proj numeric; v_n int := 0;
BEGIN
  FOR g IN
    SELECT u.id AS user_id, x.ratio,
           (date_trunc('month', v_today) + make_interval(months => x.mo))::date AS month_start
    FROM (VALUES
      ('diana.reyes@pragma.test',     -3, 0.90), ('diana.reyes@pragma.test',     -2, 1.10),
      ('rosa.alvarado@pragma.test',   -1, 0.93), ('carlos.melendez@pragma.test', -1, 1.12),
      ('ana.cordero@pragma.test',     -1, 0.81), ('luis.portillo@pragma.test',   -1, 1.05),
      ('diana.reyes@pragma.test',     -1, 0.97),
      ('rosa.alvarado@pragma.test',    0, 1.08), ('carlos.melendez@pragma.test',  0, 0.88),
      ('ana.cordero@pragma.test',      0, 0.95), ('luis.portillo@pragma.test',    0, 0.79),
      ('diana.reyes@pragma.test',      0, 1.03)
    ) AS x(email, mo, ratio)
    JOIN app_user u ON u.email = x.email AND u.deleted_at IS NULL
  LOOP
    v_n := v_n + 1;
    v_start := g.month_start;
    CONTINUE WHEN EXISTS (SELECT 1 FROM goal WHERE user_id = g.user_id
                            AND year = extract(year FROM v_start)
                            AND month = extract(month FROM v_start) AND deleted_at IS NULL);
    v_end   := (v_start + interval '1 month')::date;
    SELECT COALESCE(sum(total), 0) INTO v_sales FROM sale
    WHERE user_id = g.user_id AND erp_status = 2 AND deleted_at IS NULL
      AND erp_created_at >= v_start::timestamp AT TIME ZONE tz
      AND erp_created_at <  v_end::timestamp AT TIME ZONE tz;
    v_proj := CASE WHEN v_today < v_end
                   THEN v_sales * (v_end - v_start) / greatest(v_today - v_start, 1)
                   ELSE v_sales END;
    INSERT INTO goal (id, user_id, year, month, goal_amount)
    VALUES (('b9300005-0000-4000-8000-' || lpad(v_n::text, 12, '0'))::uuid, g.user_id,
            extract(year FROM v_start), extract(month FROM v_start),
            greatest(round(v_proj / g.ratio / 100) * 100, 500));
  END LOOP;
END
$$;

DROP TABLE IF EXISTS tmp_products, tmp_pw_raw, tmp_pw, tmp_inactive, tmp_new, tmp_plan;
DROP SEQUENCE IF EXISTS seq_sv, seq_visit, seq_sale, seq_det;
DROP FUNCTION IF EXISTS pg_temp.mk_stop;

COMMIT;
