-- Dev seed for the prospect fiscal fields (PCRM-185). Runs after seed.sql on
-- `supabase db reset` (see [db.seed] in supabase/config.toml) and is safe to
-- re-run on its own, it only UPDATEs prospects seed.sql already created:
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -f supabase/seeds/pcrm-185-prospect-fiscal.sql
--
-- Gives the admin list (web PCRM-64) and the edit endpoint every shape the
-- form has to render:
--
--   "Farmacia Nueva Vida"      all four fields, 14-digit NIT
--   "Prospecto n", n % 4 = 0   all four fields, DUI homologated as NIT
--   "Prospecto n", n % 4 = 1   NRC and email only
--   "Prospecto n", n % 4 = 2   sanitary registration only
--   "Prospecto n", n % 4 = 3   nothing (the pre-PCRM-185 state)
--
-- Values are fictitious and only follow the formats the API validates.

UPDATE prospect
SET sanitary_registration = 'RS-2024-00123',
    nrc   = '230204-4',
    nit   = '0614-250621-108-6',
    email = 'compras@nuevavida.test',
    updated_at = now()
WHERE name = 'Farmacia Nueva Vida' AND deleted_at IS NULL;

UPDATE prospect AS p
SET sanitary_registration = CASE WHEN s.n % 4 IN (0, 2) THEN 'RS-2024-' || lpad(s.n::text, 5, '0') END,
    nrc   = CASE WHEN s.n % 4 IN (0, 1) THEN (100000 + s.n * 37)::text || '-' || (s.n % 10)::text END,
    nit   = CASE WHEN s.n % 4 = 0 THEN lpad((10000000 + s.n * 9173)::text, 8, '0') || '-' || (s.n % 10)::text END,
    email = CASE WHEN s.n % 4 IN (0, 1) THEN 'prospecto' || s.n || '@farmacia.test' END,
    updated_at = now()
FROM (
  SELECT id, substring(name FROM '^Prospecto (\d+)$')::int AS n
  FROM prospect
  WHERE name ~ '^Prospecto \d+$' AND deleted_at IS NULL
) AS s
WHERE p.id = s.id;
