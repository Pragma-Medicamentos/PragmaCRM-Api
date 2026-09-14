-- Tracks when the seller finished onboarding by setting a password in Supabase Auth.
-- Mobile reads it from GET /api/v1/me to choose between the OTP screen and the app.

ALTER TABLE "public"."app_user"
  ADD COLUMN "password_set_at" timestamptz;

COMMENT ON COLUMN "public"."app_user"."password_set_at" IS
  'Set when encrypted_password is first written in auth.users. NULL until then.';

-- Same pattern as assert_auth_user_exists: no FK to auth.users, a trigger keeps
-- app_user in sync without breaking prisma db pull.
CREATE OR REPLACE FUNCTION "public"."sync_password_set_at"()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (OLD.encrypted_password IS NULL OR OLD.encrypted_password = '')
     AND NEW.encrypted_password IS NOT NULL
     AND NEW.encrypted_password <> ''
  THEN
    UPDATE public.app_user
    SET password_set_at = NOW(),
        updated_at = NOW()
    WHERE auth_user_id = NEW.id
      AND deleted_at IS NULL
      AND password_set_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."sync_password_set_at"() OWNER TO "postgres";

CREATE TRIGGER "auth_users_sync_password_set_at"
  AFTER UPDATE OF "encrypted_password" ON "auth"."users"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."sync_password_set_at"();
