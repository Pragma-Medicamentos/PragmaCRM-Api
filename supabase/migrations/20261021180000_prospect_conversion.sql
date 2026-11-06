-- PCRM-186: a prospect becomes a customer.
--
-- Customers are born in Efactsoft and reach the CRM through the JSON import,
-- so "converting" a prospect means linking it to the customer row the import
-- created, not creating a customer here. The only datum Efactsoft shares with
-- the prospect is the name (the payload carries no per-customer NIT, NRC,
-- email or phone), so the link is made by exact name after normalisation.
--
-- Decided by the team on 20/10/2026:
--   * linked automatically when a JSON import brings a customer whose name
--     matches exactly one active prospect;
--   * a name shared by two or more customers is not linked, only reported;
--   * the converted prospect is deactivated, and its pending stops move to
--     the customer while its past stops stay as its history.

-- Name comparison key: case, accents and repeated or edge whitespace do not
-- count. Efactsoft names carry double spaces ("ALBA  MARTINEZ") that the
-- seller would never type. IMMUTABLE so it can back an expression index.
CREATE OR REPLACE FUNCTION public.normalize_name(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT btrim(regexp_replace(
    translate(lower(value), 'áéíóúüñàèìòùâêîôû', 'aeiouunaeiouaeiou'),
    '\s+', ' ', 'g'
  ))
$$;

COMMENT ON FUNCTION public.normalize_name(text) IS
  'Name matching key for prospect conversion (PCRM-186): lowercase, no accents, single inner spaces, trimmed.';

ALTER TABLE "public"."prospect"
  ADD COLUMN "active" boolean NOT NULL DEFAULT true,
  ADD COLUMN "customer_id" uuid REFERENCES "public"."customer" ("id"),
  ADD COLUMN "converted_at" timestamptz;

-- A conversion always sets both columns together, and a converted prospect is
-- never active again: the customer is now the one to visit.
ALTER TABLE "public"."prospect"
  ADD CONSTRAINT "prospect_conversion_pair_chk"
    CHECK (("customer_id" IS NULL) = ("converted_at" IS NULL)),
  ADD CONSTRAINT "prospect_converted_inactive_chk"
    CHECK ("customer_id" IS NULL OR NOT "active");

COMMENT ON COLUMN "public"."prospect"."active" IS
  'False once converted (PCRM-186). Inactive prospects take no new stops.';
COMMENT ON COLUMN "public"."prospect"."customer_id" IS
  'Customer this prospect became, linked by name on import (PCRM-186).';
COMMENT ON COLUMN "public"."prospect"."converted_at" IS
  'When the prospect was linked to its customer.';

-- Lookups from both sides: "is this customer a converted prospect?" and the
-- name match the import runs against every active prospect.
CREATE INDEX "prospect_customer_id_idx"
  ON "public"."prospect" ("customer_id")
  WHERE "customer_id" IS NOT NULL;

CREATE INDEX "prospect_active_name_idx"
  ON "public"."prospect" (public.normalize_name("name"))
  WHERE "active" AND "deleted_at" IS NULL;

CREATE INDEX "customer_name_key_idx"
  ON "public"."customer" (public.normalize_name("name"))
  WHERE "deleted_at" IS NULL;

-- The existing prospect policies and table-level GRANT already cover the new
-- columns; normalize_name is only called by the API (role postgres).
