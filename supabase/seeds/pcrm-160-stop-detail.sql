-- Dev seed for the stop card / customer detail / "set location" work
-- (PCRM-160, PCRM-165, PCRM-166). Runs after seed.sql on `supabase db reset`
-- (see [db.seed] in supabase/config.toml) and is safe to re-run on its own:
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -f supabase/seeds/pcrm-160-stop-detail.sql
--
-- Every run resets the state it owns, so the mobile flow can be repeated:
-- the two no-GPS customers get their pin cleared again, and any visit
-- confirmed against these stops is removed.
--
-- Signs in as seller #1 of seed.sql, Rosa Alvarado
-- (rosa.alvarado@pragma.test, shared seed password documented in seed.sql).
-- Adds eight stops for TODAY (America/El_Salvador) on her "Zona Escalon"
-- assignment, on top of whatever seed.sql already scheduled:
--
--   A  1001  visit       rojo / alto               GPS    full profile
--   B  1011  dispatch    ' Amarillo ' / Medio      GPS    mixed case + spaces:
--                                                          the app normalises
--   C  1041  collection  verde / bajo              GPS
--   D  1020  visit       azul / alto               NO GPS "Establecer ubicación"
--   E  1040  dispatch    (no profile)              NO GPS "Establecer ubicación",
--                                                          empty profile row
--   F  1021  collection  rojo / medio              GPS    already completed
--   G  1016  visit       morado / medio            GPS    extra stop (not on
--                                                          Zona Escalon), with
--                                                          reason; unknown
--                                                          personality -> hidden
--   H  prospect "Farmacia Nueva Vida"  visit             prospect: no profile,
--                                                          no action button
--
-- Customers are addressed by erp_customer_id (1000 + i in seed.sql), which is
-- stable across resets, unlike their generated uuids.

DO $$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_seller_id uuid;
  v_route_user_id uuid;
  v_prospect_id uuid;
  v_completed_at timestamptz;

  -- Fixed ids so a re-run replaces these stops instead of piling up copies.
  v_stop_ids uuid[] := ARRAY[
    'a1600000-0000-4000-8000-00000000000a',
    'a1600000-0000-4000-8000-00000000000b',
    'a1600000-0000-4000-8000-00000000000c',
    'a1600000-0000-4000-8000-00000000000d',
    'a1600000-0000-4000-8000-00000000000e',
    'a1600000-0000-4000-8000-00000000000f',
    'a1600000-0000-4000-8000-000000000010',
    'a1600000-0000-4000-8000-000000000011'
  ]::uuid[];
BEGIN
  SELECT id INTO v_seller_id
  FROM app_user
  WHERE email = 'rosa.alvarado@pragma.test' AND deleted_at IS NULL;

  SELECT ru.id INTO v_route_user_id
  FROM route_user ru
  JOIN route r ON r.id = ru.route_id
  WHERE ru.user_id = v_seller_id
    AND r.name = 'Zona Escalon'
    AND ru.deleted_at IS NULL
  LIMIT 1;

  IF v_route_user_id IS NULL THEN
    RAISE EXCEPTION 'pcrm-160 seed: run seed.sql first (Rosa Alvarado / Zona Escalon not found)';
  END IF;

  SELECT id INTO v_prospect_id
  FROM prospect
  WHERE user_id = v_seller_id AND name = 'Farmacia Nueva Vida' AND deleted_at IS NULL
  LIMIT 1;

  -- Reset ------------------------------------------------------------------
  DELETE FROM visit WHERE scheduled_visit_id = ANY(v_stop_ids);
  DELETE FROM scheduled_visit WHERE id = ANY(v_stop_ids);

  -- The "set location" flow only writes an EMPTY pin, so clear it again.
  UPDATE customer SET location = NULL, updated_at = now()
  WHERE erp_customer_id IN (1020, 1040);

  -- Commercial profile (RF-12) ---------------------------------------------
  UPDATE customer AS c
  SET personality = p.personality,
      potential = p.potential,
      updated_at = now()
  FROM (VALUES
    (1001, 'rojo',         'alto'),
    (1011, ' Amarillo ',   'Medio'),
    (1041, 'verde',        'bajo'),
    (1020, 'azul',         'alto'),
    (1040, NULL,           NULL),
    (1021, 'rojo',         'medio'),
    (1016, 'morado',       'medio')
  ) AS p(erp_id, personality, potential)
  WHERE c.erp_customer_id = p.erp_id;

  -- Today's stops ------------------------------------------------------------
  INSERT INTO scheduled_visit (id, route_user_id, visit_date, customer_id, stop_type, reason)
  SELECT s.id, v_route_user_id, v_today, c.id, s.stop_type, s.reason
  FROM (VALUES
    (v_stop_ids[1], 1001, 'visit',      NULL),
    (v_stop_ids[2], 1011, 'dispatch',   NULL),
    (v_stop_ids[3], 1041, 'collection', NULL),
    (v_stop_ids[4], 1020, 'visit',      NULL),
    (v_stop_ids[5], 1040, 'dispatch',   NULL),
    (v_stop_ids[6], 1021, 'collection', NULL),
    (v_stop_ids[7], 1016, 'visit',      'Pidió visita para revisar un pedido pendiente')
  ) AS s(id, erp_id, stop_type, reason)
  JOIN customer c ON c.erp_customer_id = s.erp_id;

  IF v_prospect_id IS NOT NULL THEN
    INSERT INTO scheduled_visit (id, route_user_id, visit_date, prospect_id, stop_type)
    VALUES (v_stop_ids[8], v_route_user_id, v_today, v_prospect_id, 'visit');
  END IF;

  -- Stop F was already executed this morning: the linked visit is what makes
  -- the card render as completed.
  v_completed_at := (v_today::text || ' 08:40:00')::timestamp AT TIME ZONE 'America/El_Salvador';

  INSERT INTO visit (
    id, customer_id, user_id, route_user_id, started_at, finished_at,
    visit_type, successful, scheduled_visit_id
  )
  SELECT gen_random_uuid(), sv.customer_id, v_seller_id, v_route_user_id,
         v_completed_at, v_completed_at + interval '10 minutes',
         'collection', true, sv.id
  FROM scheduled_visit sv
  WHERE sv.id = v_stop_ids[6];
END $$;
