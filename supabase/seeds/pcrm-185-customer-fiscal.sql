-- Dev seed for the customer fiscal fields (PCRM-185). Runs after seed.sql on
-- `supabase db reset` (see [db.seed] in supabase/config.toml) and is safe to
-- re-run on its own, it only UPDATEs customers seed.sql already created:
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -f supabase/seeds/pcrm-185-customer-fiscal.sql
--
-- Customers are addressed by erp_customer_id (1000 + i in seed.sql), which is
-- stable across resets. Gives the profile (web 1o) and PATCH /:id/fiscal-data
-- every shape the form has to render:
--
--   1001                 all four fields, 14-digit NIT
--   1002..1060, n % 4 = 0  all four fields, DUI homologated as NIT
--   1002..1060, n % 4 = 1  NRC and email only
--   1002..1060, n % 4 = 2  sanitary registration only
--   1002..1060, n % 4 = 3  nothing (what an import leaves)
--
-- Values are fictitious and only follow the formats the API validates.

UPDATE customer
SET sanitary_registration = 'RS-2023-04510',
    nrc   = '230204-4',
    nit   = '0614-250621-108-6',
    email = 'compras@farmacia1.test',
    updated_at = now()
WHERE erp_customer_id = 1001 AND deleted_at IS NULL;

UPDATE customer AS c
SET sanitary_registration = CASE WHEN s.n % 4 IN (0, 2) THEN 'RS-2023-' || lpad(s.n::text, 5, '0') END,
    nrc   = CASE WHEN s.n % 4 IN (0, 1) THEN (200000 + s.n * 41)::text || '-' || (s.n % 10)::text END,
    nit   = CASE WHEN s.n % 4 = 0 THEN (20000000 + s.n * 7919)::text || '-' || (s.n % 10)::text END,
    email = CASE WHEN s.n % 4 IN (0, 1) THEN 'compras@farmacia' || s.n || '.test' END,
    updated_at = now()
FROM (
  SELECT id, erp_customer_id - 1000 AS n
  FROM   customer
  WHERE  erp_customer_id BETWEEN 1002 AND 1060 AND deleted_at IS NULL
) AS s
WHERE c.id = s.id;
