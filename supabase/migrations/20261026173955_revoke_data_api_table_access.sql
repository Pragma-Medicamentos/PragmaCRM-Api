-- PCRM-138: close the Data API (PostgREST) path to business tables.
--
-- Neither the web dashboard nor the Android app reads or writes a table
-- through supabase-js: both use Supabase only for Auth and send every data
-- request to PragmaCRM-Api, which connects as `postgres` and bypasses RLS.
-- The grants from 20260912042029_rls_policies_and_grants.sql were therefore
-- unused, and they were exploitable: with their own JWT and the publishable
-- key that ships in the APK, a seller could INSERT or UPDATE `visit` with any
-- `distance_meters` / `checkin_location` (defeating the RF-06 GPS check, which
-- only runs in the API) and SELECT every customer's credit and fiscal data
-- (`customer_select` is USING (true)).
--
-- Two locks, either of which closes the path on its own:
--   1. No grants for anon / authenticated.
--   2. No policies. With RLS enabled and no policy, every table is deny-all
--      for those roles, so a stray GRANT in a future migration still opens
--      nothing. The policies were written for a direct-access model nobody
--      uses, and visit_insert / visit_update never validated the distance.
--
-- The app_auth helpers stay: they hold no privileges and are the base for
-- any policy the team decides to write if direct access is ever reopened.
--
-- RLS stays enabled on every table. FORCE ROW LEVEL SECURITY stays off
-- (CLAUDE.md 5.9): the API relies on `postgres` bypassing it.

DROP POLICY IF EXISTS "app_user_select" ON "public"."app_user";
DROP POLICY IF EXISTS "app_user_update_self" ON "public"."app_user";
DROP POLICY IF EXISTS "visit_select" ON "public"."visit";
DROP POLICY IF EXISTS "visit_insert" ON "public"."visit";
DROP POLICY IF EXISTS "visit_update" ON "public"."visit";
DROP POLICY IF EXISTS "prospect_select" ON "public"."prospect";
DROP POLICY IF EXISTS "prospect_insert" ON "public"."prospect";
DROP POLICY IF EXISTS "prospect_update" ON "public"."prospect";
DROP POLICY IF EXISTS "sale_select" ON "public"."sale";
DROP POLICY IF EXISTS "goal_select" ON "public"."goal";
DROP POLICY IF EXISTS "route_user_select" ON "public"."route_user";
DROP POLICY IF EXISTS "customer_select" ON "public"."customer";
DROP POLICY IF EXISTS "customer_insert_admin" ON "public"."customer";
DROP POLICY IF EXISTS "customer_update_admin" ON "public"."customer";
DROP POLICY IF EXISTS "route_select" ON "public"."route";
DROP POLICY IF EXISTS "route_customer_select" ON "public"."route_customer";

REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM "anon", "authenticated";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "public" FROM "anon", "authenticated";

-- Tables created later by migrations (owned by postgres) start closed too.
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
  REVOKE ALL ON TABLES FROM "anon", "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
  REVOKE ALL ON SEQUENCES FROM "anon", "authenticated";

-- Trigger and event-trigger functions cannot be invoked through /rest/v1/rpc,
-- but as SECURITY DEFINER functions nobody outside the database needs EXECUTE
-- on them. Flagged by the Supabase security advisor (lints 0028 / 0029).
REVOKE EXECUTE ON FUNCTION "public"."rls_auto_enable"() FROM PUBLIC, "anon", "authenticated";
REVOKE EXECUTE ON FUNCTION "public"."sync_password_set_at"() FROM PUBLIC, "anon", "authenticated";
