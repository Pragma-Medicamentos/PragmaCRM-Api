-- Helpers the RLS policies resolve the caller through.
--
-- Why SECURITY DEFINER: a policy on visit that reads app_user would also run
-- app_user's own policies, and Postgres aborts with 42P17 (infinite recursion
-- detected in policy). Running as the table owner skips RLS and breaks the cycle.
--
-- WARNING: `ALTER TABLE app_user FORCE ROW LEVEL SECURITY` brings the recursion
-- back AND blindfolds the API, which connects as postgres. Do not enable it.

CREATE SCHEMA IF NOT EXISTS "app_auth";

REVOKE ALL ON SCHEMA "app_auth" FROM PUBLIC;
GRANT USAGE ON SCHEMA "app_auth" TO "authenticated";

-- All three filter by active/deleted_at, so a disabled seller resolves to NULL
-- and every policy denies: disabling takes effect on the next query.
--
-- `set search_path = ''` is not cosmetic: without it, someone able to create
-- objects in a schema on the search_path could shadow app_user and make these
-- return 'Administrador'. It forces every name to be qualified.
--
-- STABLE, not VOLATILE: only non-volatile functions can be hoisted to an InitPlan.

CREATE OR REPLACE FUNCTION "app_auth"."current_app_user_id"()
  RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT u.id
  FROM public.app_user u
  WHERE u.auth_user_id = (SELECT auth.uid())
    AND u.active
    AND u.deleted_at IS NULL
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION "app_auth"."role_name"()
  RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT u.role
  FROM public.app_user u
  WHERE u.auth_user_id = (SELECT auth.uid())
    AND u.active
    AND u.deleted_at IS NULL
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION "app_auth"."is_admin"()
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE((SELECT app_auth.role_name()) = 'Administrador', false)
$$;

ALTER FUNCTION "app_auth"."current_app_user_id"() OWNER TO "postgres";
ALTER FUNCTION "app_auth"."role_name"() OWNER TO "postgres";
ALTER FUNCTION "app_auth"."is_admin"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "app_auth"."current_app_user_id"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app_auth"."role_name"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "app_auth"."is_admin"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "app_auth"."current_app_user_id"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "app_auth"."role_name"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "app_auth"."is_admin"() TO "authenticated";
