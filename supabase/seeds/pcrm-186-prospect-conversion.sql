-- Dev seed for the prospect conversion (PCRM-186). Runs after seed.sql on
-- `supabase db reset` (see [db.seed] in supabase/config.toml) and is safe to
-- re-run on its own:
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -f supabase/seeds/pcrm-186-prospect-conversion.sql
--
-- All prospects belong to seller #1, Rosa Alvarado. Dates are relative to
-- today in America/El_Salvador.
--
-- 1) One prospect per outcome of POST /api/v1/prospects/:id/convert, against
--    customers the seed already has:
--
--   "FARMACIA  elena cortéz 17"  -> converts: same normalised name as customer
--                                   1017 ("Farmacia Elena Cortez 17") despite
--                                   the case, the double space and the accent.
--                                   Has a stop 3 days ago (stays as history)
--                                   and one in 2 days (moves to the customer).
--   "Farmacia Gemela"            -> alert: two customers (ERP 9186001 and
--                                   9186002) carry that name; nothing linked.
--   "Farmacia Sin Cliente"       -> no customer has the name: nothing happens.
--   "Farmacia Ya Convertida"     -> already converted to customer 1003.
--
-- 2) Prospects named after customers of the real Efactsoft export
--    (allventasjson.json). None of these customers exists after a reset; they
--    are created by importing that file (POST /api/v1/uploads/sales), and the
--    same import converts the prospects:
--
--   "FARMACIA EL BOSQUE"   -> converts to ERP 145 "Farmacia El Bosque" (case).
--                             Has a stop tomorrow that moves to the customer.
--   "miriam  orellana"     -> converts to ERP 151 "Miriam Orellana" (case and
--                             double space).
--   "Elena Figueróa"       -> converts to ERP 290 "ELENA FIGUEROA" (accent).
--   "Yanira Rauda"         -> converts to ERP 92 "YANIRA  RAUDA" (the double
--                             space is on the Efactsoft side).
--   "Leticia Molina"       -> alert: the export has two customers with that
--                             name (ERP 73 "Leticia Molina" and ERP 146
--                             "Leticia  Molina"); nothing linked.
--   "Marcelina Molinas"    -> stays a prospect: ERP 135 is "Marcelina Molina",
--                             one letter apart, and the match is exact.

DO $$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_seller uuid;
  v_route_user uuid;
  v_prospect uuid;
  v_names text[] := ARRAY[
    'FARMACIA  elena cortéz 17', 'Farmacia Gemela',
    'Farmacia Sin Cliente', 'Farmacia Ya Convertida',
    'FARMACIA EL BOSQUE', 'miriam  orellana', 'Elena Figueróa',
    'Yanira Rauda', 'Leticia Molina', 'Marcelina Molinas'];
BEGIN
  SELECT id INTO v_seller FROM app_user
  WHERE  email = 'rosa.alvarado@pragma.test' AND deleted_at IS NULL;

  SELECT id INTO v_route_user FROM route_user
  WHERE  user_id = v_seller AND deleted_at IS NULL
  ORDER  BY day, id LIMIT 1;

  -- Reset what a previous run left behind.
  DELETE FROM scheduled_visit
  WHERE  prospect_id IN (SELECT id FROM prospect WHERE name = ANY (v_names))
     OR  reason = 'PCRM-186 seed';
  DELETE FROM prospect WHERE name = ANY (v_names);
  DELETE FROM customer WHERE erp_customer_id IN (9186001, 9186002);

  -- 1) Against seeded customers --------------------------------------------

  -- Converts: one exact match, with a past and a pending stop.
  INSERT INTO prospect (user_id, name, phone, status)
  VALUES (v_seller, 'FARMACIA  elena cortéz 17', '7186-0001', 'new')
  RETURNING id INTO v_prospect;

  INSERT INTO scheduled_visit (route_user_id, visit_date, prospect_id, stop_type, reason, is_extra)
  VALUES (v_route_user, v_today - 3, v_prospect, 'visit', 'PCRM-186 seed', true),
         (v_route_user, v_today + 2, v_prospect, 'visit', 'PCRM-186 seed', true);

  -- Alert: two customers share the name.
  INSERT INTO customer (erp_customer_id, name, origin)
  VALUES (9186001, 'Farmacia Gemela', 'efactsoft'),
         (9186002, 'FARMACIA  GEMELA', 'efactsoft');
  INSERT INTO prospect (user_id, name, phone, status)
  VALUES (v_seller, 'Farmacia Gemela', '7186-0002', 'new');

  -- No customer with the name.
  INSERT INTO prospect (user_id, name, phone, status)
  VALUES (v_seller, 'Farmacia Sin Cliente', '7186-0003', 'new');

  -- Already converted.
  INSERT INTO prospect (user_id, name, phone, status, active, customer_id, converted_at)
  SELECT v_seller, 'Farmacia Ya Convertida', '7186-0004', 'new', false, c.id, now() - interval '5 days'
  FROM   customer c
  WHERE  c.erp_customer_id = 1003 AND c.deleted_at IS NULL;

  -- 2) Against the customers of allventasjson.json -------------------------

  INSERT INTO prospect (user_id, name, phone, status)
  VALUES (v_seller, 'FARMACIA EL BOSQUE', '7186-0005', 'new')
  RETURNING id INTO v_prospect;

  INSERT INTO scheduled_visit (route_user_id, visit_date, prospect_id, stop_type, reason, is_extra)
  VALUES (v_route_user, v_today + 1, v_prospect, 'visit', 'PCRM-186 seed', true);

  INSERT INTO prospect (user_id, name, phone, status)
  VALUES (v_seller, 'miriam  orellana',  '7186-0006', 'new'),
         (v_seller, 'Elena Figueróa',    '7186-0007', 'new'),
         (v_seller, 'Yanira Rauda',      '7186-0008', 'new'),
         (v_seller, 'Leticia Molina',    '7186-0009', 'new'),
         (v_seller, 'Marcelina Molinas', '7186-0010', 'new');
END $$;
