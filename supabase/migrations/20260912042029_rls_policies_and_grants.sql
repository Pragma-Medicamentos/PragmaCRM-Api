-- Grants and policies live in the same file, and therefore the same
-- transaction: a half-applied migration must not leave the database with
-- privileges granted and no policies guarding them.
--
-- Conventions, in case a new table is added later:
--   * always TO authenticated — without it the policy is also evaluated for
--     anon, and any accidental grant to anon becomes exploitable;
--   * always wrap the helpers in (select ...) so they become an InitPlan and
--     are evaluated once per statement instead of once per row;
--   * never filter `deleted_at IS NULL` in a policy. RLS answers "whose row is
--     this", not "is it still current". Postgres evaluates the SELECT policy
--     against the row an UPDATE produces, so a soft delete would make the row
--     invisible to its own owner and the UPDATE would be rejected. Clients
--     filter with .is('deleted_at', null) instead;
--   * no FOR DELETE policy and no GRANT DELETE anywhere: this model soft-deletes.

-- ---------------------------------------------------------------------------
-- 1. Clean up the baseline's residual grants.
-- ---------------------------------------------------------------------------
-- TRUNCATE is NOT governed by RLS: it is a table privilege, so an authenticated
-- client holding it could empty a table without a single policy seeing it.
-- Unreachable today, reachable the moment the clients connect directly.

REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE
  ON ALL TABLES IN SCHEMA "public"
  FROM "anon", "authenticated", "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"
  REVOKE MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLES
  FROM "anon", "authenticated", "service_role";

GRANT USAGE ON SCHEMA "public" TO "authenticated";

-- anon gets nothing, deliberately. The anon key ships inside the web bundle and
-- the APK, so it is public by design, and every row in this database is
-- business data. With no privileges at all, a missing policy surfaces as
-- "permission denied" instead of as a leak.

-- ---------------------------------------------------------------------------
-- 2. app_user
-- ---------------------------------------------------------------------------
GRANT SELECT ON TABLE "public"."app_user" TO "authenticated";
GRANT UPDATE ("name", "email") ON TABLE "public"."app_user" TO "authenticated";

CREATE POLICY "app_user_select" ON "public"."app_user"
  FOR SELECT TO "authenticated"
  USING (
    (SELECT app_auth.is_admin())
    OR "id" = (SELECT app_auth.current_app_user_id())
  );

-- `role = role_name()` is what stops privilege escalation: without it, "a user
-- may edit their own row" reads as "a user may promote themselves to admin".
-- The column-level grant above is the second lock on the same door.
CREATE POLICY "app_user_update_self" ON "public"."app_user"
  FOR UPDATE TO "authenticated"
  USING ("id" = (SELECT app_auth.current_app_user_id()))
  WITH CHECK (
    "id" = (SELECT app_auth.current_app_user_id())
    AND "role" = (SELECT app_auth.role_name())
    AND "active"
    AND "deleted_at" IS NULL
  );

-- No INSERT policy and no GRANT INSERT: creating a user requires the service
-- role key, so it happens in the API and nowhere else.

-- ---------------------------------------------------------------------------
-- 3. Seller-owned tables
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON TABLE "public"."visit" TO "authenticated";

CREATE POLICY "visit_select" ON "public"."visit"
  FOR SELECT TO "authenticated"
  USING (
    (SELECT app_auth.is_admin())
    OR "user_id" = (SELECT app_auth.current_app_user_id())
  );

CREATE POLICY "visit_insert" ON "public"."visit"
  FOR INSERT TO "authenticated"
  WITH CHECK (
    (SELECT app_auth.is_admin())
    OR "user_id" = (SELECT app_auth.current_app_user_id())
  );

-- The WITH CHECK keeps user_id so a visit cannot be reassigned to another
-- seller.
CREATE POLICY "visit_update" ON "public"."visit"
  FOR UPDATE TO "authenticated"
  USING (
    (SELECT app_auth.is_admin())
    OR "user_id" = (SELECT app_auth.current_app_user_id())
  )
  WITH CHECK (
    (SELECT app_auth.is_admin())
    OR "user_id" = (SELECT app_auth.current_app_user_id())
  );

GRANT SELECT, INSERT, UPDATE ON TABLE "public"."prospect" TO "authenticated";

CREATE POLICY "prospect_select" ON "public"."prospect"
  FOR SELECT TO "authenticated"
  USING (
    (SELECT app_auth.is_admin())
    OR "user_id" = (SELECT app_auth.current_app_user_id())
  );

CREATE POLICY "prospect_insert" ON "public"."prospect"
  FOR INSERT TO "authenticated"
  WITH CHECK (
    (SELECT app_auth.is_admin())
    OR "user_id" = (SELECT app_auth.current_app_user_id())
  );

CREATE POLICY "prospect_update" ON "public"."prospect"
  FOR UPDATE TO "authenticated"
  USING (
    (SELECT app_auth.is_admin())
    OR "user_id" = (SELECT app_auth.current_app_user_id())
  )
  WITH CHECK (
    (SELECT app_auth.is_admin())
    OR "user_id" = (SELECT app_auth.current_app_user_id())
  );

-- ---------------------------------------------------------------------------
-- 4. Read-only for the seller, owned by user_id
-- ---------------------------------------------------------------------------
GRANT SELECT ON TABLE "public"."sale" TO "authenticated";

CREATE POLICY "sale_select" ON "public"."sale"
  FOR SELECT TO "authenticated"
  USING (
    (SELECT app_auth.is_admin())
    OR "user_id" = (SELECT app_auth.current_app_user_id())
  );

GRANT SELECT ON TABLE "public"."goal" TO "authenticated";

CREATE POLICY "goal_select" ON "public"."goal"
  FOR SELECT TO "authenticated"
  USING (
    (SELECT app_auth.is_admin())
    OR "user_id" = (SELECT app_auth.current_app_user_id())
  );

GRANT SELECT ON TABLE "public"."route_user" TO "authenticated";

CREATE POLICY "route_user_select" ON "public"."route_user"
  FOR SELECT TO "authenticated"
  USING (
    (SELECT app_auth.is_admin())
    OR "user_id" = (SELECT app_auth.current_app_user_id())
  );

-- ---------------------------------------------------------------------------
-- 5. Shared catalogue
-- ---------------------------------------------------------------------------
-- A route is a reusable package of customers and belongs to no seller (5.1),
-- so every authenticated user reads them; only the admin writes.

GRANT SELECT, INSERT, UPDATE ON TABLE "public"."customer" TO "authenticated";

CREATE POLICY "customer_select" ON "public"."customer"
  FOR SELECT TO "authenticated"
  USING (true);

CREATE POLICY "customer_insert_admin" ON "public"."customer"
  FOR INSERT TO "authenticated"
  WITH CHECK ((SELECT app_auth.is_admin()));

CREATE POLICY "customer_update_admin" ON "public"."customer"
  FOR UPDATE TO "authenticated"
  USING ((SELECT app_auth.is_admin()))
  WITH CHECK ((SELECT app_auth.is_admin()));

GRANT SELECT ON TABLE "public"."route" TO "authenticated";

CREATE POLICY "route_select" ON "public"."route"
  FOR SELECT TO "authenticated"
  USING (true);

GRANT SELECT ON TABLE "public"."route_customer" TO "authenticated";

CREATE POLICY "route_customer_select" ON "public"."route_customer"
  FOR SELECT TO "authenticated"
  USING (true);

-- ---------------------------------------------------------------------------
-- 6. Everything else stays closed
-- ---------------------------------------------------------------------------
-- upload, sale_staging, product, product_request, quoted_product, sale_detail,
-- balance_snapshot and scheduled_visit keep RLS on with zero policies and zero
-- grants. Nothing queries them directly today, so nothing breaks, and the
-- failure mode is closed. Add policies alongside the feature that needs them.
