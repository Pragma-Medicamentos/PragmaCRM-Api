-- Drops the deprecated Clerk identity column and replaces the
-- assert_auth_user_exists trigger workaround with a real foreign key to
-- auth.users. The trigger existed only because `prisma db pull` used to
-- refuse a cross-schema reference unless `auth` was added to the
-- datasource's `schemas` array; that array is now set (see schema.prisma),
-- so the constraint can be enforced natively.

DROP INDEX IF EXISTS "public"."app_user_clerk_user_id_key";

ALTER TABLE "public"."app_user"
  DROP COLUMN "clerk_user_id";

DROP TRIGGER IF EXISTS "app_user_assert_auth_user" ON "public"."app_user";
DROP FUNCTION IF EXISTS "public"."assert_auth_user_exists"();

-- ON DELETE SET NULL preserves the previous "fails safe" behavior described
-- in 20260912042024_auth_link_app_user.sql: if the auth.users row is ever
-- deleted directly (outside the API's normal ban/disable flow), the link is
-- cleared instead of blocking the delete or cascading into app_user.
-- ON UPDATE CASCADE is defensive only — auth.users.id is never reassigned.
ALTER TABLE "public"."app_user"
  ADD CONSTRAINT "app_user_auth_user_id_fkey"
  FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
