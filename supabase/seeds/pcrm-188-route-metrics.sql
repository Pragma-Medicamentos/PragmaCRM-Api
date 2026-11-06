-- Dev seed for per-route metrics (PCRM-178) and the workday comparison
-- (PCRM-188). Runs after seed.sql on `supabase db reset` (see [db.seed] in
-- supabase/config.toml) and is safe to re-run on its own:
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -f supabase/seeds/pcrm-188-route-metrics.sql
--
-- Route sales only count through the agenda chain
--   sale.visit_id -> visit.scheduled_visit_id -> scheduled_visit -> route_user
-- and seed.sql never builds it: its ~900 sales have no scheduled_visit behind
-- them, and the only agenda is today's Zona Escalon. This file adds the last
-- 8 occurrences of each route's weekday (on or before today in
-- America/El_Salvador), with stops, executed visits and confirmed sales, so
-- the Rutas cards and "Comparar jornadas" have something to show on every
-- future reset.
--
-- What each route is for, with the panel on "Este mes":
--   Zona Escalon            growing against the previous period and against
--                           its own previous Mondays
--   Zona Centro             declining, latest Tuesday weaker than the average
--   Zona Merliot            flat week to week. Older Wednesdays are Luis.
--                           The latest Wednesday splits its five stops across
--                           the five sellers, so the Vendedor cell lists all
--                           of them.
--   Zona Soyapango          the strongest growth
--   Zona San Marcos         declining, and the previous Friday has agenda but
--                           nobody went (coverage 0, efectividad "—")
--   Zona Mejicanos          partial coverage, about 2 of 5 stops executed
--   Zona Antiguo Cuscatlan  mild growth, and its weekday is Sunday so the
--                           latest workday is often today
--   Zona Ilopango           sales only in the current month: the card says
--                           "Sin venta" in the previous period
--   Zona Ciudad Delgado     agenda this month but no sale: $0 and -100%
--                           against the previous period
--   Zona Apopa              untouched: $0 and "Sin agenda"
--
-- Customer 1001 stays without visits or sales (seed.sql's empty tier).
-- Today's Zona Escalon stops belong to seed.sql / pcrm-160; if that weekday
-- is today, those rows are left alone.
--
-- Owned rows use ids the rest of the seed never generates:
--   scheduled_visit  a1880000-0000-4000-8000-*
--   visit            a1880001-0000-4000-8000-*
--   route_user       a1880002-0000-4000-8000-000000000001..0004
--                    (Luis, Rosa, Carlos, Diana on Merliot, soft-deleted)
--   sale / sale_detail  erp ids 9188100–9188999
--   product             erp ids 918801–918808

DO $$
DECLARE
  v_today       date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_month_start date := date_trunc('month', v_today)::date;
  v_extra_ru uuid[] := ARRAY[
    'a1880002-0000-4000-8000-000000000001',
    'a1880002-0000-4000-8000-000000000002',
    'a1880002-0000-4000-8000-000000000003',
    'a1880002-0000-4000-8000-000000000004'
  ]::uuid[];
  v_luis        uuid;
  v_spec        record;
  v_route_id    uuid;
  v_live_ru     uuid;
  v_live_seller uuid;
  v_day         int;
  v_latest      date;
  v_customers   uuid[];
  v_customer_id uuid;
  v_week        int;
  v_date        date;
  v_cust_i      int;
  v_n_customers int;
  v_route_n     int := 0;
  v_stop_seq    int := 0;
  v_visit_seq   int := 0;
  v_sale_id     int := 9188100;
  v_detail_id   int := 9188100;
  v_stop_id     uuid;
  v_visit_id    uuid;
  v_ru          uuid;
  v_seller      uuid;
  v_execute     boolean;
  v_with_sale   boolean;
  v_amount      numeric;
  v_net         numeric;
  v_at          timestamptz;
  v_product     int;
  v_qty         numeric;
BEGIN
  SELECT id INTO v_luis
  FROM app_user
  WHERE email = 'luis.portillo@pragma.test' AND deleted_at IS NULL;

  IF v_luis IS NULL THEN
    RAISE EXCEPTION 'pcrm-188 seed: run seed.sql first (Luis Portillo not found)';
  END IF;

  -- Reset only what this file owns, so a re-run does not pile up copies
  -- and does not touch the mobile route of today.
  DELETE FROM sale_detail WHERE erp_sale_id BETWEEN 9188100 AND 9188999;
  DELETE FROM sale
  WHERE erp_sale_id BETWEEN 9188100 AND 9188999
     OR visit_id IN (
          SELECT id FROM visit
          WHERE id::text LIKE 'a1880001-%' OR route_user_id = ANY(v_extra_ru)
        );
  DELETE FROM visit
  WHERE id::text LIKE 'a1880001-%'
     OR scheduled_visit_id::text LIKE 'a1880000-%'
     OR route_user_id = ANY(v_extra_ru);
  DELETE FROM scheduled_visit WHERE id::text LIKE 'a1880000-%';
  DELETE FROM route_user WHERE id = ANY(v_extra_ru);

  INSERT INTO product (erp_product_id, code, name, product_group, last_seen_at)
  VALUES
    (918801, 'ACE-500', 'Acetaminofen 500 mg', 'Analgesicos', now()),
    (918802, 'IBU-400', 'Ibuprofeno 400 mg',   'Analgesicos', now()),
    (918803, 'AMX-500', 'Amoxicilina 500 mg',  'Antibioticos', now()),
    (918804, 'LOS-50',  'Losartan 50 mg',      'Cronicos', now()),
    (918805, 'OME-20',  'Omeprazol 20 mg',     'Gastro', now()),
    (918806, 'SUE-OR',  'Suero oral',          'Hidratacion', now()),
    (918807, 'VIT-C',   'Vitamina C 1 g',      'Vitaminas', now()),
    (918808, 'JAR-TOS', 'Jarabe para la tos',  'Respiratorio', now())
  ON CONFLICT (erp_product_id) DO UPDATE
    SET code = EXCLUDED.code,
        name = EXCLUDED.name,
        product_group = EXCLUDED.product_group,
        last_seen_at = now(),
        deleted_at = NULL;

  -- Soft-deleted so the planner keeps Ana as the only live assignment.
  -- Luis covers the older Wednesdays. On the latest Wednesday each of the
  -- other four takes one stop, next to Ana's, so the day lists five sellers.
  INSERT INTO route_user (id, route_id, user_id, day, status, deleted_at)
  SELECT x.id, r.id, u.id, ru.day, 'inactive', now()
  FROM route r
  JOIN route_user ru
    ON ru.route_id = r.id AND ru.deleted_at IS NULL
  JOIN (VALUES
    (v_extra_ru[1], 'luis.portillo@pragma.test'),
    (v_extra_ru[2], 'rosa.alvarado@pragma.test'),
    (v_extra_ru[3], 'carlos.melendez@pragma.test'),
    (v_extra_ru[4], 'diana.reyes@pragma.test')
  ) AS x(id, email) ON true
  JOIN app_user u
    ON u.email = x.email AND u.deleted_at IS NULL
  WHERE r.name = 'Zona Merliot' AND r.deleted_at IS NULL;

  IF (SELECT count(*) FROM route_user WHERE id = ANY(v_extra_ru)) <> 4 THEN
    RAISE EXCEPTION 'pcrm-188 seed: run seed.sql first (Merliot sellers not found)';
  END IF;

  FOR v_spec IN
    SELECT *
    FROM (VALUES
      ('Zona Escalon',            'growth',       22),
      ('Zona Centro',             'decline',      20),
      ('Zona Merliot',            'flat',          0),
      ('Zona Soyapango',          'growth',       40),
      ('Zona San Marcos',         'decline',      22),
      ('Zona Mejicanos',          'thin',         12),
      ('Zona Antiguo Cuscatlan',  'growth',       16),
      ('Zona Ilopango',           'current_only',  0),
      ('Zona Ciudad Delgado',     'dropped',      16)
    ) AS s(route_name, profile, step)
  LOOP
    v_route_n := v_route_n + 1;

    SELECT r.id, ru.id, ru.user_id, ru.day
      INTO v_route_id, v_live_ru, v_live_seller, v_day
    FROM route r
    JOIN route_user ru
      ON ru.route_id = r.id AND ru.deleted_at IS NULL
    WHERE r.name = v_spec.route_name AND r.deleted_at IS NULL
    ORDER BY ru.created_at
    LIMIT 1;

    IF v_route_id IS NULL THEN
      RAISE EXCEPTION 'pcrm-188 seed: run seed.sql first (% not found)', v_spec.route_name;
    END IF;

    SELECT COALESCE(array_agg(c.id ORDER BY c.sort_order, c.erp_customer_id), '{}')
      INTO v_customers
    FROM (
      SELECT c.id, rc.sort_order, c.erp_customer_id
      FROM route_customer rc
      JOIN customer c
        ON c.id = rc.customer_id AND c.deleted_at IS NULL
      WHERE rc.route_id = v_route_id
        AND rc.deleted_at IS NULL
        AND c.erp_customer_id <> 1001
      ORDER BY rc.sort_order NULLS LAST, c.erp_customer_id
      LIMIT 5
    ) AS c;

    v_n_customers := COALESCE(array_length(v_customers, 1), 0);
    IF v_n_customers = 0 THEN
      RAISE EXCEPTION 'pcrm-188 seed: % has no customers', v_spec.route_name;
    END IF;

    -- Most recent occurrence of the route's weekday on or before today.
    v_latest := v_today - ((EXTRACT(ISODOW FROM v_today)::int - v_day + 7) % 7);

    FOR v_week IN 0..7 LOOP
      v_date := v_latest - (v_week * 7);
      -- Ilopango only sells inside the month the panel opens on by default.
      IF v_spec.profile = 'current_only' AND v_date < v_month_start THEN
        CONTINUE;
      END IF;

      FOR v_cust_i IN 1..v_n_customers LOOP
        v_customer_id := v_customers[v_cust_i];

        -- Leave a stop that seed.sql or pcrm-160 already placed for today.
        IF EXISTS (
          SELECT 1 FROM scheduled_visit sv
          WHERE sv.route_user_id = v_live_ru
            AND sv.visit_date = v_date
            AND sv.customer_id = v_customer_id
            AND sv.deleted_at IS NULL
            AND NOT sv.is_extra
        ) THEN
          CONTINUE;
        END IF;

        v_execute := CASE
          WHEN v_spec.profile = 'thin' THEN v_cust_i <= 2
          WHEN v_spec.route_name = 'Zona San Marcos' AND v_week = 1 THEN false
          WHEN v_spec.profile = 'dropped' AND v_date >= v_month_start THEN v_cust_i <= 2
          ELSE v_cust_i <= 4
        END;

        v_with_sale := v_execute AND CASE
          WHEN v_spec.profile = 'dropped' AND v_date >= v_month_start THEN false
          WHEN v_spec.profile = 'thin' THEN v_cust_i = 1
          WHEN v_spec.route_name = 'Zona Centro' AND v_week = 0 THEN v_cust_i <= 2
          ELSE v_cust_i <= 3
        END;

        -- Older Merliot weeks are Luis. The latest Wednesday gives one stop
        -- to Ana (the live assignment) and one each to Luis, Rosa, Carlos
        -- and Diana, so that day lists five sellers.
        IF v_spec.route_name = 'Zona Merliot' AND v_week = 0 AND v_cust_i > 1 THEN
          v_ru := v_extra_ru[v_cust_i - 1];
          SELECT user_id INTO v_seller FROM route_user WHERE id = v_ru;
        ELSIF v_spec.route_name = 'Zona Merliot' AND v_week > 0 THEN
          v_ru := v_extra_ru[1];
          v_seller := v_luis;
        ELSE
          v_ru := v_live_ru;
          v_seller := v_live_seller;
        END IF;

        v_stop_seq := v_stop_seq + 1;
        v_stop_id := ('a1880000-0000-4000-8000-' || lpad(to_hex(v_stop_seq), 12, '0'))::uuid;

        INSERT INTO scheduled_visit (
          id, route_user_id, visit_date, customer_id, stop_type, sort_order, is_extra
        ) VALUES (
          v_stop_id, v_ru, v_date, v_customer_id, 'visit', v_cust_i::smallint, false
        );

        IF NOT v_execute THEN
          CONTINUE;
        END IF;

        v_visit_seq := v_visit_seq + 1;
        v_visit_id := ('a1880001-0000-4000-8000-' || lpad(to_hex(v_visit_seq), 12, '0'))::uuid;
        v_at := (v_date::text || ' ' || lpad((8 + v_cust_i)::text, 2, '0') || ':20:00')::timestamp
                AT TIME ZONE 'America/El_Salvador';

        INSERT INTO visit (
          id, customer_id, user_id, route_user_id, started_at, finished_at,
          visit_type, successful, scheduled_visit_id
        ) VALUES (
          v_visit_id, v_customer_id, v_seller, v_ru,
          v_at, v_at + interval '18 minutes',
          'visit', v_with_sale, v_stop_id
        );

        IF NOT v_with_sale THEN
          CONTINUE;
        END IF;

        v_amount := round(CASE v_spec.profile
          WHEN 'flat' THEN 240 + v_cust_i * 15
          WHEN 'current_only' THEN 280 + v_cust_i * 30
          WHEN 'decline' THEN 90 + (v_week * v_week) * v_spec.step + v_cust_i * 12
          WHEN 'dropped' THEN 90 + (v_week * v_week) * v_spec.step + v_cust_i * 12
          ELSE 90 + ((7 - v_week) * (7 - v_week)) * v_spec.step + v_cust_i * 12
        END, 2);
        v_net := round(v_amount / 1.13, 2);
        v_sale_id := v_sale_id + 1;
        v_product := 918801 + ((v_route_n + v_week + v_cust_i) % 8);
        v_qty := (1 + (v_cust_i % 4))::numeric;

        INSERT INTO sale (
          erp_sale_id, customer_id, user_id, visit_id, erp_created_at,
          last_payment_at, total, net_total, vat, pending_balance,
          payment, payment_id, erp_status, document, remarks
        ) VALUES (
          v_sale_id, v_customer_id, v_seller, v_visit_id, v_at,
          v_at, v_amount, v_net, v_amount - v_net, 0,
          'Contado', 1, 2, 'FAC-' || v_sale_id, 'pcrm-188'
        );

        v_detail_id := v_detail_id + 1;
        INSERT INTO sale_detail (
          sale_detail_id, erp_sale_id, product_id, quantity, unit_of_measure,
          factor, price, total, tax_total
        ) VALUES (
          v_detail_id, v_sale_id, v_product, v_qty, 'unidad',
          1, round(v_amount / v_qty, 4), v_amount, v_amount - v_net
        );
      END LOOP;
    END LOOP;
  END LOOP;
END $$;
