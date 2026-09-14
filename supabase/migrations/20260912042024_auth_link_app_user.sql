-- Links app_user to Supabase Auth, replacing the Clerk identity column.
-- clerk_user_id stays until the production cutover: it is the rollback path.

ALTER TABLE "public"."app_user"
  ADD COLUMN "auth_user_id" uuid;

COMMENT ON COLUMN "public"."app_user"."auth_user_id" IS
  'Identity in Supabase Auth (auth.users.id). NULL until the account is created.';

-- Partial, like the two unique indexes already on this table: the soft-delete
-- filter is part of the key, not an extra.
CREATE UNIQUE INDEX "app_user_auth_user_id_key"
  ON "public"."app_user" USING btree ("auth_user_id")
  WHERE ("deleted_at" IS NULL);

-- A real FK to auth.users is NOT used, and this is deliberate: `prisma db pull`
-- aborts with P4002 on a cross-schema reference unless the auth schema is added
-- to the datasource, which would drag ~20 GoTrue models into schema.prisma.
-- Since introspection is mandatory in this project's workflow, the constraint is
-- enforced by a trigger instead.
--
-- What this trigger does not cover: deleting the auth.users row leaves the link
-- dangling. That fails safe — the user resolves to nothing, requireAuth answers
-- 403 and every policy denies — and the API compensates on its own failures.
CREATE OR REPLACE FUNCTION "public"."assert_auth_user_exists"()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.auth_user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.auth_user_id)
  THEN
    RAISE EXCEPTION 'auth_user_id % does not match any auth.users row', NEW.auth_user_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."assert_auth_user_exists"() OWNER TO "postgres";

CREATE TRIGGER "app_user_assert_auth_user"
  BEFORE INSERT OR UPDATE OF "auth_user_id" ON "public"."app_user"
  FOR EACH ROW EXECUTE FUNCTION "public"."assert_auth_user_exists"();

-- role is free text and the RLS policies compare it against literals: a typo
-- would be a silent loss of permissions instead of a loud error.
ALTER TABLE "public"."app_user"
  ADD CONSTRAINT "app_user_role_check"
  CHECK ("role" IN ('Administrador', 'Vendedor')) NOT VALID;

ALTER TABLE "public"."app_user" VALIDATE CONSTRAINT "app_user_role_check";

-- Columns the policies filter on. Postgres evaluates a policy against every
-- candidate row, so an unindexed filter column forces a sequential scan.
CREATE INDEX "prospect_user_id_idx"
  ON "public"."prospect" USING btree ("user_id") WHERE ("deleted_at" IS NULL);

CREATE INDEX "route_user_user_id_idx"
  ON "public"."route_user" USING btree ("user_id") WHERE ("deleted_at" IS NULL);

CREATE INDEX "product_request_user_id_idx"
  ON "public"."product_request" USING btree ("user_id") WHERE ("deleted_at" IS NULL);

CREATE INDEX "upload_uploaded_by_idx"
  ON "public"."upload" USING btree ("uploaded_by");
