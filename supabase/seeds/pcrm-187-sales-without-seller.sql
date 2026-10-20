-- Dev seed for the sales comparison (PCRM-187). Runs after seed.sql on
-- `supabase db reset` (see [db.seed] in supabase/config.toml) and is safe to
-- re-run on its own:
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -f supabase/seeds/pcrm-187-sales-without-seller.sql
--
-- seed.sql gives every sale a seller, so the breakdown by seller never shows
-- the case real imports do produce: an Efactsoft `id_usuario` that maps to no
-- app_user leaves sale.user_id NULL (CLAUDE.md Anexo A, point 2). These three
-- confirmed cash sales of customer 1002 have no seller, two this month and
-- one last month, so `group_by=seller` returns a row with id and name null
-- that keeps the rows adding up to the totals.
--
-- Dated relative to today in America/El_Salvador, so they stay inside the
-- default period (current month) on every future reset.

DELETE FROM sale WHERE erp_sale_id IN (9187001, 9187002, 9187003);

WITH v(id, local_at, total) AS (
  VALUES
    (9187001, date_trunc('month', now() AT TIME ZONE 'America/El_Salvador') + interval '1 day 10 hours',  250.00::numeric),
    (9187002, date_trunc('month', now() AT TIME ZONE 'America/El_Salvador') + interval '2 days 15 hours', 180.50::numeric),
    (9187003, date_trunc('month', now() AT TIME ZONE 'America/El_Salvador') - interval '10 days',         320.75::numeric)
),
dated AS (
  -- local wall-clock time -> instant, the same conversion the importer does
  SELECT id, local_at AT TIME ZONE 'America/El_Salvador' AS at, total FROM v
)
INSERT INTO sale (
  erp_sale_id, customer_id, user_id, erp_created_at, erp_quoted_at,
  last_payment_at, total, net_total, vat, pending_balance,
  payment, payment_id, erp_status, document
)
SELECT d.id, c.id, NULL, d.at, d.at, d.at,
       d.total, round(d.total / 1.13, 2), d.total - round(d.total / 1.13, 2), 0,
       'Contado', 1, 2, 'Factura'
FROM   dated d
CROSS  JOIN customer c
WHERE  c.erp_customer_id = 1002 AND c.deleted_at IS NULL;
