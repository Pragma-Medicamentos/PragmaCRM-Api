-- PCRM-158: extra stops added by an admin for a single day, outside the
-- route's planned composition (route_customer / route_user untouched).
--
-- is_extra used to be entirely derived (absence of a live route_customer row
-- for the stop's customer). That derivation still holds for legacy rows and
-- for prospects, but it cannot represent an extra Cobro added on a customer
-- who IS a route member: the stop is still ad-hoc for that one day. Stamping
-- the flag at insert time is what lets that case be told apart from a planned
-- stop; daily-route.service.ts ORs it with the old derivation.

ALTER TABLE "public"."scheduled_visit"
  ADD COLUMN "is_extra" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "public"."scheduled_visit"."is_extra" IS
  'Stop added by an Administrador for one specific date, outside route_customer / route_user. Never counts as planned/assigned coverage.';

-- Race backstop, not the source of truth: the create-extra-stop service does
-- the real duplicate check across every live scheduled_visit of the seller
-- that day (planned or extra), inside an advisory-locked transaction. This
-- index only stops two concurrent requests from both winning that race for
-- the same (assignment, day, customer, stop_type).
CREATE UNIQUE INDEX "scheduled_visit_extra_uq"
  ON "public"."scheduled_visit" ("route_user_id", "visit_date", "customer_id", "stop_type")
  WHERE "is_extra" AND "deleted_at" IS NULL;

-- No RLS policy or GRANT: API-only table, same reasoning as
-- 20260919215008_daily_route_stop_type_and_visit_link.sql. No backfill:
-- scheduled_visit is empty in every environment.
