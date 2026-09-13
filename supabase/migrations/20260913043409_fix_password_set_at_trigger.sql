-- sync_password_set_at (20260913043000_password_set_at.sql) never fired:
-- it required OLD.encrypted_password to be NULL/'' before the first real
-- password, but admin.createUser() without a password already assigns a
-- random, unusable bcrypt hash at INSERT time — encrypted_password is never
-- actually empty. Verified locally: a probe user created the same way had a
-- 60-char hash from the start.
--
-- The trigger is already scoped to `AFTER UPDATE OF encrypted_password`, so
-- any UPDATE that touches the column is already a real password change —
-- there is nothing left to distinguish with the OLD check. Idempotency still
-- comes from the `password_set_at IS NULL` guard in the WHERE clause below.
CREATE OR REPLACE FUNCTION "public"."sync_password_set_at"()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
BEGIN
  IF NEW.encrypted_password IS NOT NULL
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
