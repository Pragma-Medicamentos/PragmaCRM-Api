-- Dev seed for the customers module (PCRM-37). Applied automatically by
-- `supabase db reset` (see [db.seed] in supabase/config.toml). Safe to
-- re-run: truncates the tables it touches before inserting.
--
-- Produces:
--   * 1 admin + 5 sellers (app_user), each backed by a real auth.users /
--     auth.identities row and linked via auth_user_id, so
--     `/auth/v1/token?grant_type=password` (see CLAUDE.md 8.1) issues real
--     JWTs to exercise requireAuth/requireRole locally. All six share the
--     password below.
--       - admin@pragma.test               (Administrador)
--       - rosa.alvarado@pragma.test        (Vendedor)
--       - carlos.melendez@pragma.test      (Vendedor)
--       - ana.cordero@pragma.test          (Vendedor)
--       - luis.portillo@pragma.test        (Vendedor)
--       - diana.reyes@pragma.test          (Vendedor)
--     Password for all of them: Pragma123!
--   * 10 routes, recurring route_user assignments (one seller/route/weekday
--     combo each).
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
--   * Metrics panel (PCRM-13): monthly goals per seller for the last 12
--     months plus the current one, ~25 prospects over the last 90 days, and
--     visits linked to the seller's route assignment, so goal_compliance,
--     new_prospects and route_effectiveness return real figures.
--   * A daily route for today (PCRM-46/47, computed from `now()` in
--     America/El_Salvador so the seed still means "today" on any future
--     reset), covering every state GET /api/v1/me/route and the mobile map
--     render: seller #1 (Rosa Alvarado) gets 6 scheduled_visit rows on
--     route 1 (Zona Escalon) - one of each stop_type ('visit', 'dispatch',
--     'collection'), one on a customer with no GPS (no pin/no distance),
--     one on a prospect (target_kind = 'prospect', is_extra = true), one on
--     a customer who is not a member of route 1 (is_extra = true, with a
--     `reason`), and one already executed this morning and linked back via
--     visit.scheduled_visit_id (renders as the completed/greyed card). A
--     7th scheduled_visit for the same day is soft-deleted, to prove the
--     `deleted_at IS NULL` predicate actually excludes it. Seller #2
--     (Carlos Melendez) deliberately gets zero scheduled_visit rows today,
--     to exercise the empty-route state.

BEGIN;

TRUNCATE TABLE
  goal,
  prospect,
  sale,
  visit,
  scheduled_visit,
  route_customer,
  route_user,
  route,
  prospect,
  customer,
  app_user
RESTART IDENTITY CASCADE;

DO $$
DECLARE
  v_admin_id uuid := '11111111-1111-1111-8111-111111111100';
  v_sellers  uuid[] := ARRAY[
    '11111111-1111-1111-8111-111111111101',
    '11111111-1111-1111-8111-111111111102',
    '11111111-1111-1111-8111-111111111103',
    '11111111-1111-1111-8111-111111111104',
    '11111111-1111-1111-8111-111111111105'
  ]::uuid[];
  v_seller_names text[] := ARRAY[
    'Rosa Alvarado', 'Carlos Melendez', 'Ana Cordero', 'Luis Portillo', 'Diana Reyes'
  ];

  -- Supabase Auth identities backing app_user.auth_user_id. Index 1 is the
  -- admin, 2-6 line up 1:1 with v_sellers / v_seller_names.
  v_auth_ids uuid[] := ARRAY[
    '33333333-3333-3333-3333-333333333100',
    '33333333-3333-3333-3333-333333333101',
    '33333333-3333-3333-3333-333333333102',
    '33333333-3333-3333-3333-333333333103',
    '33333333-3333-3333-3333-333333333104',
    '33333333-3333-3333-3333-333333333105'
  ]::uuid[];
  v_seed_password text := 'Pragma123!';
  v_auth_email    text;
  k int;

  v_routes uuid[] := ARRAY[
    '22222222-2222-2222-8222-222222222201',
    '22222222-2222-2222-8222-222222222202',
    '22222222-2222-2222-8222-222222222203',
    '22222222-2222-2222-8222-222222222204',
    '22222222-2222-2222-8222-222222222205',
    '22222222-2222-2222-8222-222222222206',
    '22222222-2222-2222-8222-222222222207',
    '22222222-2222-2222-8222-222222222208',
    '22222222-2222-2222-8222-222222222209',
    '22222222-2222-2222-8222-222222222210'
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

  -- Daily route (PCRM-46/47) ----------------------------------------------
  v_customer_ids uuid[];        -- customer.id by loop index i, so the daily
                                 -- route section below can reference specific
                                 -- customers (already-planned members, an
                                 -- out-of-route "extra", a no-GPS one) by
                                 -- their known position instead of re-deriving.
  v_route_user_id uuid;         -- scratch for the RETURNING below
  v_route_user_ids uuid[];      -- route_user.id by route index, needed to
                                 -- schedule stops against a specific route
  v_today date;                 -- "today" in America/El_Salvador, not the
                                 -- session's own timezone
  v_prospect_id uuid;
  v_sv_completed_id uuid;
  v_completed_started_at timestamptz;
BEGIN
  -- Supabase Auth identities ---------------------------------------------
  -- Real auth.users / auth.identities rows, not just app_user placeholders:
  -- app_user_auth_user_id_fkey (20260914010000_app_user_auth_fk.sql) requires
  -- auth_user_id to resolve, and requireAuth needs a real JWT to verify.
  -- `supabase db reset` wipes auth.* along with everything else, but delete
  -- by id first so a manual re-run of this file alone stays idempotent.
  DELETE FROM auth.identities WHERE user_id = ANY(v_auth_ids);
  DELETE FROM auth.users WHERE id = ANY(v_auth_ids);

  FOR k IN 1..6 LOOP
    v_auth_email := CASE
      WHEN k = 1 THEN 'admin@pragma.test'
      ELSE lower(replace(v_seller_names[k - 1], ' ', '.')) || '@pragma.test'
    END;

    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change, email_change_token_new, email_change_token_current,
      is_sso_user, is_anonymous
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_auth_ids[k], 'authenticated', 'authenticated',
      v_auth_email, extensions.crypt(v_seed_password, extensions.gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      now(), now(), '', '', '', '', '', false, false
    );

    INSERT INTO auth.identities (
      provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) VALUES (
      v_auth_ids[k]::text, v_auth_ids[k],
      jsonb_build_object('sub', v_auth_ids[k]::text, 'email', v_auth_email),
      'email', now(), now(), now()
    );
  END LOOP;

  -- Identity ------------------------------------------------------------
  INSERT INTO app_user (id, role, name, email, active, auth_user_id, password_set_at)
  VALUES (v_admin_id, 'Administrador', 'Patricia Nunez', 'admin@pragma.test', true, v_auth_ids[1], now());

  FOR i IN 1..5 LOOP
    INSERT INTO app_user (id, role, name, email, active, auth_user_id, password_set_at)
    VALUES (
      v_sellers[i], 'Vendedor', v_seller_names[i],
      lower(replace(v_seller_names[i], ' ', '.')) || '@pragma.test', true,
      v_auth_ids[i + 1], now()
    );
  END LOOP;

  -- Routes + recurring assignment (one seller/route/weekday each) -------
  FOR i IN 1..10 LOOP
    INSERT INTO route (id, name, municipality, zone, active)
    VALUES (v_routes[i], v_route_names[i], v_route_municipalities[i], v_route_zones[i], true);

    INSERT INTO route_user (route_id, user_id, day, status)
    VALUES (v_routes[i], v_sellers[((i - 1) % 5) + 1], ((i - 1) % 7) + 1, 'active')
    RETURNING id INTO v_route_user_id;
    v_route_user_ids[i] := v_route_user_id;
  END LOOP;

  -- Customers -------------------------------------------------------------
  FOR i IN 1..60 LOOP
    v_customer_id := gen_random_uuid();
    v_customer_ids[i] := v_customer_id;  -- kept for the daily-route section below
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

  -- Prospects ---------------------------------------------------------------
  -- One prospect registered by seller #1 (Rosa Alvarado). Prospects have no
  -- row in route_customer at all, so any scheduled_visit against one is
  -- structurally an "extra" stop - useful below to seed that branch without
  -- relying on a heuristic.
  v_prospect_id := gen_random_uuid();

  INSERT INTO prospect (id, user_id, name, trade_name, address, phone, location, status)
  VALUES (
    v_prospect_id, v_sellers[1], 'Farmacia Nueva Vida', 'Nueva Vida',
    'Calle Nueva, Escalon', '7799-1234',
    extensions.ST_SetSRID(extensions.ST_MakePoint(-89.2412, 13.7012), 4326)::extensions.geography,
    'pendiente'
  );

  -- Daily route (PCRM-46/47) -------------------------------------------------
  -- Route 1 (Zona Escalon) is assigned to seller #1 (Rosa Alvarado) via
  -- v_route_user_ids[1]. Every scheduled_visit below is dated "today" in
  -- America/El_Salvador, not the session's own timezone, so the seed keeps
  -- meaning "today" on every future reset.
  v_today := (now() AT TIME ZONE 'America/El_Salvador')::date;

  -- Stop A: plain visit. Customer #1 is already on route 1
  -- (route_customer.sort_order = 1, from the customer loop above) ->
  -- is_extra = false.
  INSERT INTO scheduled_visit (route_user_id, visit_date, customer_id, stop_type)
  VALUES (v_route_user_ids[1], v_today, v_customer_ids[1], 'visit');

  -- Stop B: dispatch. Customer #11 is also a route-1 member.
  INSERT INTO scheduled_visit (route_user_id, visit_date, customer_id, stop_type)
  VALUES (v_route_user_ids[1], v_today, v_customer_ids[11], 'dispatch');

  -- Stop C: collection, already executed this morning. Customer #21 is a
  -- route-1 member; the visit row below links back via scheduled_visit_id
  -- (not a heuristic on customer/date), which is what makes this stop
  -- render as the completed/greyed card with a time.
  INSERT INTO scheduled_visit (route_user_id, visit_date, customer_id, stop_type)
  VALUES (v_route_user_ids[1], v_today, v_customer_ids[21], 'collection')
  RETURNING id INTO v_sv_completed_id;

  v_completed_started_at :=
    (v_today::text || ' 09:10:00')::timestamp AT TIME ZONE 'America/El_Salvador';

  INSERT INTO visit (
    id, customer_id, user_id, route_user_id, started_at, finished_at,
    visit_type, successful, scheduled_visit_id
  ) VALUES (
    gen_random_uuid(), v_customer_ids[21], v_sellers[1], v_route_user_ids[1],
    v_completed_started_at, v_completed_started_at + interval '12 minutes',
    'collection', true, v_sv_completed_id
  );

  -- Stop D: customer #10 was seeded without GPS (v_has_gps = (i % 10) <> 0
  -- is false for i = 10) -> the card must degrade to no pin / no distance.
  -- Still a genuine route-1 member (the "b" route_customer slot), so
  -- is_extra = false here too.
  INSERT INTO scheduled_visit (route_user_id, visit_date, customer_id, stop_type)
  VALUES (v_route_user_ids[1], v_today, v_customer_ids[10], 'visit');

  -- Stop E: the prospect. target_kind = 'prospect'; is_extra = true because
  -- prospects never have a route_customer row to match against.
  INSERT INTO scheduled_visit (route_user_id, visit_date, prospect_id, stop_type)
  VALUES (v_route_user_ids[1], v_today, v_prospect_id, 'visit');

  -- Stop F: customer #2 belongs to routes 2 and 3 only (see the route
  -- membership block above), never route 1 -> no live route_customer row
  -- for (route 1, customer #2) -> is_extra = true. `reason` documents the
  -- ad-hoc addition.
  INSERT INTO scheduled_visit (route_user_id, visit_date, customer_id, stop_type, reason)
  VALUES (
    v_route_user_ids[1], v_today, v_customer_ids[2], 'visit',
    'Cliente solicito visita extra por reclamo de producto'
  );

  -- Soft-deleted stop: proves the deleted_at IS NULL predicate actually
  -- excludes a row, not just that none happen to be seeded today.
  INSERT INTO scheduled_visit (route_user_id, visit_date, customer_id, stop_type, deleted_at)
  VALUES (
    v_route_user_ids[1], v_today, v_customer_ids[31], 'visit',
    now() - interval '1 day'
  );

  -- Seller #2 (Carlos Melendez, v_sellers[2]) intentionally gets zero
  -- scheduled_visit rows today, so GET /api/v1/me/route for him renders the
  -- empty-route state (routes: [], stops: []).
END $$;

-- Metrics panel (PCRM-13) ---------------------------------------------------
DO $$
BEGIN
  -- Link each visit to a route assignment of its seller that contains the
  -- customer. The seed ignores the weekday on purpose: its dates are random,
  -- and only the link matters to route sales and executed route-days.
  UPDATE visit v
  SET    route_user_id = ru.id
  FROM   route_user ru
  JOIN   route_customer rc
         ON rc.route_id = ru.route_id
        AND rc.deleted_at IS NULL
  WHERE  ru.user_id = v.user_id
    AND  ru.deleted_at IS NULL
    AND  rc.customer_id = v.customer_id;

  -- Goals around each seller's real monthly sales (80%-120%), so compliance
  -- spreads above and below 100%. Months with no sales get a flat goal.
  INSERT INTO goal (user_id, year, month, goal_amount)
  SELECT u.id,
         EXTRACT(YEAR  FROM m.month_start)::smallint,
         EXTRACT(MONTH FROM m.month_start)::smallint,
         round(COALESCE(NULLIF(sales.amount, 0), 1500) * (0.8 + random() * 0.4), -1)
  FROM   app_user u
  CROSS  JOIN generate_series(
           date_trunc('month', now() AT TIME ZONE 'America/El_Salvador') - interval '12 months',
           date_trunc('month', now() AT TIME ZONE 'America/El_Salvador'),
           interval '1 month'
         ) AS m(month_start)
  LEFT   JOIN LATERAL (
           SELECT SUM(s.total) AS amount
           FROM   sale s
           WHERE  s.user_id = u.id
             AND  s.deleted_at IS NULL
             AND  s.erp_status = 2
             AND  s.erp_created_at >= m.month_start AT TIME ZONE 'America/El_Salvador'
             AND  s.erp_created_at <  (m.month_start + interval '1 month') AT TIME ZONE 'America/El_Salvador'
         ) sales ON true
  WHERE  u.role = 'Vendedor';

  INSERT INTO prospect (user_id, name, trade_name, phone, status, created_at)
  SELECT (ARRAY(SELECT id FROM app_user WHERE role = 'Vendedor' ORDER BY id))[1 + (n % 5)],
         'Prospecto ' || n,
         'Farmacia Nueva ' || n,
         '7' || lpad((1000000 + n * 7919 % 9000000)::text, 7, '0'),
         'new',
         now() - (random() * 90 || ' days')::interval
  FROM   generate_series(1, 25) AS n;
END $$;

COMMIT;
