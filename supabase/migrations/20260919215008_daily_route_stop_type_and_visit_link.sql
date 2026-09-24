-- Links planning (scheduled_visit) to execution (visit) for the daily route.
-- Without scheduled_visit_id, completed_at would have to be inferred from
-- (customer_id, route_user_id, day window): that duplicates rows when the
-- seller visits the same customer twice, and cannot tell a Dispatch apart
-- from a Collection at the same customer on the same day -- which is exactly
-- what the wireframe draws as two separate cards. scheduled_visit is empty
-- in every environment and has no writer in the codebase yet: cheap now,
-- expensive once check-in depends on it.

ALTER TABLE "public"."scheduled_visit"
  ADD CONSTRAINT "scheduled_visit_stop_type_chk"
  CHECK ("stop_type" IN ('visit', 'dispatch', 'collection'));

ALTER TABLE "public"."visit"
  ADD COLUMN "scheduled_visit_id" uuid REFERENCES "public"."scheduled_visit"("id");

COMMENT ON COLUMN "public"."visit"."scheduled_visit_id" IS
  'Planned stop this execution row fulfils. NULL until the GPS check-in feature sets it.';

-- The partial unique index is what guarantees the daily route's LEFT JOIN
-- returns at most one execution row per planned stop.
CREATE UNIQUE INDEX "visit_scheduled_visit_uq" ON "public"."visit" ("scheduled_visit_id")
  WHERE "scheduled_visit_id" IS NOT NULL AND "deleted_at" IS NULL;

-- Deliberate omissions from this migration -- left here so nobody "fixes" them later.
--
-- 1. scheduled_visit.sort_order: not added. Nobody would write it today (it
--    would sit 100% NULL), and its semantics are undecided -- order within the
--    day, or the same order route_customer.sort_order already keeps for the
--    route's composition? Adding the column now would lock in a modeling
--    decision the team has not made yet.
--
-- 2. RLS policies and grants for scheduled_visit: not added. The API connects
--    as postgres and bypasses RLS; the app only reaches this table through
--    apiFetch. A GRANT SELECT ... TO authenticated would open a direct path to
--    Supabase that nobody uses or tests today. The comment in
--    20260912042029_rls_policies_and_grants.sql already states the rule:
--    "Add policies alongside the feature that needs them" -- this migration is
--    not that feature yet.
