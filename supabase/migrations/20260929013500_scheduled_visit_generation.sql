-- PCRM-161: on-the-fly, idempotent generation of scheduled_visit rows from
-- the seller's weekly route composition (route_customer + route_user,
-- CLAUDE.md 5.1). No nightly job and no new jornada table: the generation
-- statement runs the first time either daily-route endpoint reads a given
-- (seller, date) forward, in src/repositories/daily-route/generate-stops.sql.ts.

-- Frozen copy of route_customer.sort_order, stamped at generation time.
-- Supersedes the "not added" note in
-- 20260919215008_daily_route_stop_type_and_visit_link.sql: the day's stops
-- must keep the order the seller was handed, even if route_customer is
-- reordered afterwards. NULL on every extra stop (PCRM-158) and on prospects,
-- same convention daily-route.service.ts already reads.
ALTER TABLE "public"."scheduled_visit"
  ADD COLUMN "sort_order" smallint;

COMMENT ON COLUMN "public"."scheduled_visit"."sort_order" IS
  'Frozen copy of route_customer.sort_order at generation time (PCRM-161). Null on extras and prospects.';

-- The real concurrency guarantee behind generateStopsSql's idempotency
-- (see the comment there). The generation statement's own NOT EXISTS gate
-- only prevents *re*-generating an already-generated day; it cannot stop two
-- concurrent first requests from both passing that gate before either
-- commits. This index is what makes the second INSERT's ON CONFLICT DO
-- NOTHING skip every row the first one already committed, instead of
-- duplicating it or erroring.
--
-- Scoped to planned rows only (NOT is_extra AND customer_id IS NOT NULL):
-- an extra stop already has its own index, scheduled_visit_extra_uq, which
-- additionally keys on stop_type because an admin may add a Visita and a
-- Cobro extra on the same customer/day. A planned stop never has that
-- ambiguity — route_customer has at most one row per (route, customer) — so
-- stop_type is not part of this key.
CREATE UNIQUE INDEX "scheduled_visit_planned_uq"
  ON "public"."scheduled_visit" ("route_user_id", "visit_date", "customer_id")
  WHERE (NOT "is_extra") AND "deleted_at" IS NULL AND "customer_id" IS NOT NULL;

-- No RLS policy or GRANT: API-only table, same reasoning as
-- 20260919215008_daily_route_stop_type_and_visit_link.sql. No backfill:
-- scheduled_visit is empty in every environment.
