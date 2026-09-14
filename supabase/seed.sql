-- Dev seed for the customers module (PCRM-37). Applied automatically by
-- `supabase db reset` (see [db.seed] in supabase/config.toml). Safe to
-- re-run: truncates the tables it touches before inserting.
--
-- Produces:
--   * 1 admin + 5 sellers (app_user), 10 routes, recurring route_user
--     assignments (one seller/route/weekday combo each).
--   * 60 customers, split into three performance tiers plus one deliberately
--     empty customer, so listCustomers' A/B/C/uncategorized scoring and all
--     of 1n's filters (search, zone, establishment_type, category,
--     without_gps, active) have something real to return:
--       - customer #1:        zero visits/sales -> uncategorized (no
--                              activity in the scoring window)
--       - customers #2-15:    high volume, high conversion, fast payment
--                              -> candidates for category A
--       - customers #16-40:   medium volume/conversion/payment speed
--                              -> candidates for category B
--       - customers #41-60:   low volume, low conversion, slow payment
--                              -> candidates for category C
--   * ~800 visits and ~900 sales spread over the last 18 months, respecting
--     the real ERP payment_id lifecycle (1 = cash, 5 = credit open,
--     6 = credit settled) plus a 5% share of quotes (erp_status = 1) to
--     verify no endpoint ever surfaces them.
--   * A handful of soft-deleted rows in route_customer, visit and sale, to
--     verify every query's `deleted_at IS NULL` predicate.

BEGIN;

TRUNCATE TABLE
  sale,
  visit,
  route_customer,
  route_user,
  route,
  customer,
  app_user
RESTART IDENTITY CASCADE;

DO $$
DECLARE
  v_admin_id uuid := '11111111-1111-1111-1111-111111111100';
  v_sellers  uuid[] := ARRAY[
    '11111111-1111-1111-1111-111111111101',
    '11111111-1111-1111-1111-111111111102',
    '11111111-1111-1111-1111-111111111103',
    '11111111-1111-1111-1111-111111111104',
    '11111111-1111-1111-1111-111111111105'
  ]::uuid[];
  v_seller_names text[] := ARRAY[
    'Rosa Alvarado', 'Carlos Melendez', 'Ana Cordero', 'Luis Portillo', 'Diana Reyes'
  ];

  v_routes uuid[] := ARRAY[
    '22222222-2222-2222-2222-222222222201',
    '22222222-2222-2222-2222-222222222202',
    '22222222-2222-2222-2222-222222222203',
    '22222222-2222-2222-2222-222222222204',
    '22222222-2222-2222-2222-222222222205',
    '22222222-2222-2222-2222-222222222206',
    '22222222-2222-2222-2222-222222222207',
    '22222222-2222-2222-2222-222222222208',
    '22222222-2222-2222-2222-222222222209',
    '22222222-2222-2222-2222-222222222210'
  ]::uuid[];
  v_route_names text[] := ARRAY[
    'Zona Escalon', 'Zona Centro', 'Zona Merliot', 'Zona Soyapango', 'Zona San Marcos',
    'Zona Mejicanos', 'Zona Antiguo Cuscatlan', 'Zona Ilopango', 'Zona Ciudad Delgado', 'Zona Apopa'
  ];
  v_route_zones text[] := ARRAY[
    'Escalon', 'Centro', 'Merliot', 'Soyapango', 'San Marcos',
    'Mejicanos', 'Antiguo Cuscatlan', 'Ilopango', 'Ciudad Delgado', 'Apopa'
  ];
  v_route_municipalities text[] := ARRAY[
    'San Salvador', 'San Salvador', 'Santa Tecla', 'Soyapango', 'San Marcos',
    'Mejicanos', 'Antiguo Cuscatlan', 'Ilopango', 'Ciudad Delgado', 'Apopa'
  ];

  v_est_types text[] := ARRAY['cadena', 'independiente', 'drogueria'];
  v_attends_names text[] := ARRAY[
    'Maria Lopez', 'Jose Hernandez', 'Karla Ramirez', 'Miguel Torres', 'Sofia Guevara',
    'Ricardo Pena', 'Elena Cortez', 'Fernando Zelaya', 'Patricia Nunez', 'Oscar Delgado'
  ];

  i int;
  j int;
  v_customer_id uuid;
  v_route_a int;
  v_route_b int;
  v_lat numeric;
  v_lng numeric;
  v_has_gps boolean;
  v_is_active boolean;
  v_credit boolean;

  v_tier text;
  v_visit_count int;
  v_sale_count int;
  v_conversion_p numeric;
  v_cash_prob numeric;
  v_settled_upper numeric;
  v_settle_min int;
  v_settle_max int;

  v_visit_id uuid;
  v_visit_ids uuid[];
  v_visit_started timestamptz;
  v_visit_type text;

  v_sale_seq int := 500000;
  v_erp_created timestamptz;
  v_pay_roll numeric;
  v_payment_id int;
  v_total numeric;
  v_net_total numeric;
  v_vat numeric;
  v_pending numeric;
  v_last_payment timestamptz;
  v_linked_visit uuid;
  v_sale_deleted timestamptz;
BEGIN
  -- Identity ------------------------------------------------------------
  INSERT INTO app_user (id, role, name, email, active)
  VALUES (v_admin_id, 'Administrador', 'Patricia Nunez', 'admin@pragma.test', true);

  FOR i IN 1..5 LOOP
    INSERT INTO app_user (id, role, name, email, active)
    VALUES (
      v_sellers[i], 'Vendedor', v_seller_names[i],
      lower(replace(v_seller_names[i], ' ', '.')) || '@pragma.test', true
    );
  END LOOP;

  -- Routes + recurring assignment (one seller/route/weekday each) -------
  FOR i IN 1..10 LOOP
    INSERT INTO route (id, name, municipality, zone, active)
    VALUES (v_routes[i], v_route_names[i], v_route_municipalities[i], v_route_zones[i], true);

    INSERT INTO route_user (route_id, user_id, day, status)
    VALUES (v_routes[i], v_sellers[((i - 1) % 5) + 1], ((i - 1) % 7) + 1, 'active');
  END LOOP;

  -- Customers -------------------------------------------------------------
  FOR i IN 1..60 LOOP
    v_customer_id := gen_random_uuid();
    v_has_gps := (i % 10) <> 0;    -- 6 of 60 without GPS
    v_is_active := (i % 12) <> 0;  -- 5 of 60 inactive
    v_credit := (i % 3) <> 0;      -- 2/3 have a credit line

    v_lat := NULL;
    v_lng := NULL;
    IF v_has_gps THEN
      v_lat := 13.60 + random() * 0.20;
      v_lng := -89.30 + random() * 0.20;
    END IF;

    INSERT INTO customer (
      id, erp_customer_id, name, trade_name, establishment_type,
      address, municipality, zone, phone, mobile, location,
      attends, credit, credit_limit, active
    ) VALUES (
      v_customer_id,
      1000 + i,
      'Farmacia ' || v_attends_names[((i - 1) % 10) + 1] || ' ' || i,
      'Farmacia ' || i,
      v_est_types[((i - 1) % 3) + 1],
      'Calle ' || i || ', ' || v_route_zones[((i - 1) % 10) + 1],
      v_route_municipalities[((i - 1) % 10) + 1],
      v_route_zones[((i - 1) % 10) + 1],
      '2200-' || lpad(i::text, 4, '0'),
      CASE WHEN i % 4 = 0 THEN NULL
           ELSE '7' || lpad((100 + i)::text, 3, '0') || '-' || lpad(i::text, 4, '0')
      END,
      CASE WHEN v_has_gps
        THEN extensions.ST_SetSRID(extensions.ST_MakePoint(v_lng, v_lat), 4326)::extensions.geography
        ELSE NULL
      END,
      v_attends_names[((i - 1) % 10) + 1],
      v_credit,
      CASE WHEN v_credit THEN (1000 + (i * 137 % 4000))::numeric ELSE NULL END,
      v_is_active
    );

    -- Route membership: 1 or 2 distinct routes, never the same one twice.
    v_route_a := ((i - 1) % 10) + 1;
    v_route_b := (i % 10) + 1;

    INSERT INTO route_customer (route_id, customer_id, sort_order, deleted_at)
    VALUES (
      v_routes[v_route_a], v_customer_id, i,
      CASE WHEN i % 15 = 0 THEN now() - interval '30 days' ELSE NULL END
    );

    IF i % 2 = 0 THEN
      INSERT INTO route_customer (route_id, customer_id, sort_order)
      VALUES (v_routes[v_route_b], v_customer_id, i);
    END IF;

    -- Performance tier: drives visits, sales, conversion and payment speed
    -- so the A/B/C scoring has real separation instead of pure noise.
    IF i = 1 THEN
      v_tier := 'empty';
      v_visit_count := 0;
      v_sale_count := 0;
      v_conversion_p := 0;
      v_cash_prob := 0;
      v_settled_upper := 0;
      v_settle_min := 0;
      v_settle_max := 0;
    ELSIF i <= 15 THEN
      v_tier := 'fast';
      v_visit_count := 15 + floor(random() * 15)::int;   -- 15-29
      v_sale_count := 20 + floor(random() * 15)::int;    -- 20-34
      v_conversion_p := 0.55 + random() * 0.25;          -- 0.55-0.80
      v_cash_prob := 0.45;
      v_settled_upper := 0.90;                           -- + another 0.45 settled
      v_settle_min := 1;
      v_settle_max := 10;
    ELSIF i <= 40 THEN
      v_tier := 'medium';
      v_visit_count := 6 + floor(random() * 10)::int;    -- 6-15
      v_sale_count := 8 + floor(random() * 10)::int;     -- 8-17
      v_conversion_p := 0.25 + random() * 0.25;          -- 0.25-0.50
      v_cash_prob := 0.35;
      v_settled_upper := 0.70;
      v_settle_min := 10;
      v_settle_max := 40;
    ELSE
      v_tier := 'slow';
      v_visit_count := floor(random() * 6)::int;         -- 0-5
      v_sale_count := 8 + floor(random() * 8)::int;      -- 8-15 (kept above the
                                                          -- 3-settled-invoice floor
                                                          -- so this tier lands in C
                                                          -- rather than uncategorized)
      v_conversion_p := random() * 0.20;                 -- 0.0-0.20
      v_cash_prob := 0.20;
      v_settled_upper := 0.60;
      v_settle_min := 20;
      v_settle_max := 90;
    END IF;

    -- Visits ----------------------------------------------------------
    v_visit_ids := '{}';

    FOR j IN 1..v_visit_count LOOP
      v_visit_started := now() - (random() * 540 || ' days')::interval;
      v_visit_type := CASE
        WHEN random() < 0.70 THEN 'visit'
        WHEN random() < 0.85 THEN 'dispatch'
        ELSE 'collection'
      END;
      v_visit_id := gen_random_uuid();

      INSERT INTO visit (
        id, customer_id, user_id, started_at, finished_at,
        checkin_location, visit_type, successful, notes, deleted_at
      ) VALUES (
        v_visit_id,
        v_customer_id,
        v_sellers[((i + j) % 5) + 1],
        v_visit_started,
        v_visit_started + (5 + random() * 25 || ' minutes')::interval,
        CASE WHEN v_has_gps THEN
          extensions.ST_SetSRID(
            extensions.ST_MakePoint(
              v_lng + (random() - 0.5) * 0.002,
              v_lat + (random() - 0.5) * 0.002
            ), 4326
          )::extensions.geography
        ELSE NULL END,
        v_visit_type,
        random() < 0.85,
        CASE WHEN random() < 0.4
          THEN 'Atendido por ' || v_attends_names[((i + j - 1) % 10) + 1]
          ELSE NULL
        END,
        CASE WHEN j = 1 AND i % 20 = 0 THEN now() - interval '10 days' ELSE NULL END
      );

      IF v_visit_type = 'visit' THEN
        v_visit_ids := array_append(v_visit_ids, v_visit_id);
      END IF;
    END LOOP;

    -- Sales -------------------------------------------------------------
    FOR j IN 1..v_sale_count LOOP
      v_sale_seq := v_sale_seq + 1;
      v_erp_created := now() - (random() * 540 || ' days')::interval;
      v_total := round((50 + random() * 450)::numeric, 2);
      v_net_total := round(v_total / 1.13, 2);
      v_vat := v_total - v_net_total;

      -- 5% land as quotes (erp_status = 1): must never surface in any
      -- endpoint, which is filtered on erp_status = 2 everywhere.
      IF random() < 0.05 THEN
        INSERT INTO sale (
          erp_sale_id, customer_id, user_id, erp_created_at, total, net_total,
          vat, pending_balance, payment, payment_id, erp_status, document
        ) VALUES (
          v_sale_seq, v_customer_id, v_sellers[((i + j) % 5) + 1], v_erp_created,
          v_total, v_net_total, v_vat, v_total, 'Credito', 5, 1, 'COT-' || v_sale_seq
        );
        CONTINUE;
      END IF;

      v_pay_roll := random();
      v_payment_id := CASE
        WHEN v_pay_roll < v_cash_prob THEN 1        -- Contado
        WHEN v_pay_roll < v_settled_upper THEN 6    -- Credito Pagado
        ELSE 5                                      -- Credito vigente
      END;

      v_pending := CASE WHEN v_payment_id = 5 THEN v_total ELSE 0 END;
      v_last_payment := CASE
        WHEN v_payment_id = 1 THEN v_erp_created
        WHEN v_payment_id = 6 THEN
          LEAST(
            v_erp_created + ((v_settle_min + random() * (v_settle_max - v_settle_min)) || ' days')::interval,
            now()
          )
        ELSE NULL
      END;

      -- Link to a real visit for a share of the sales, per this tier's
      -- conversion target, so conversion_rate spreads across the portfolio.
      v_linked_visit := NULL;
      IF coalesce(array_length(v_visit_ids, 1), 0) > 0 AND random() < v_conversion_p THEN
        v_linked_visit := v_visit_ids[1 + floor(random() * array_length(v_visit_ids, 1))::int];
      END IF;

      v_sale_deleted := CASE WHEN i % 25 = 0 AND j = 1 THEN now() - interval '5 days' ELSE NULL END;

      INSERT INTO sale (
        erp_sale_id, customer_id, user_id, visit_id, erp_created_at,
        last_payment_at, total, net_total, vat, pending_balance,
        payment, payment_id, erp_status, document, deleted_at
      ) VALUES (
        v_sale_seq, v_customer_id, v_sellers[((i + j) % 5) + 1], v_linked_visit,
        v_erp_created, v_last_payment, v_total, v_net_total, v_vat, v_pending,
        CASE v_payment_id WHEN 1 THEN 'Contado' WHEN 6 THEN 'Credito Pagado' ELSE 'Credito' END,
        v_payment_id, 2, 'FAC-' || v_sale_seq, v_sale_deleted
      );
    END LOOP;
  END LOOP;
END $$;

COMMIT;
