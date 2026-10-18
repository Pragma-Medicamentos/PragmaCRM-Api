-- PCRM-185: fiscal and contact data on prospects.
--
-- The prospect form (mobile PCRM-175, web PCRM-64) asks for the sanitary
-- registration, NRC, NIT and email. None of them is mandatory: a seller who
-- detects a pharmacy in the field rarely has its tax documents at hand.
--
-- Scope is prospects only, by team decision. `customer` keeps its current
-- columns: the Efactsoft export does not carry the customer's NRC, NIT or email
-- (the `nrc`, `nif` and `email` keys in the payload belong to the issuer,
-- Pragma itself), so there is nothing for the importer to fill or overwrite.
--
-- Formats (NIT, NRC, email) are validated by the API schemas, not by CHECK
-- constraints: the registration number has no known format, and the other
-- three only enter through the API, which normalises them before writing.
-- The existing prospect_insert / prospect_update policies and the table-level
-- GRANT already cover the new columns.

ALTER TABLE "public"."prospect"
  ADD COLUMN "sanitary_registration" text,
  ADD COLUMN "nrc" text,
  ADD COLUMN "nit" text,
  ADD COLUMN "email" text;

COMMENT ON COLUMN "public"."prospect"."sanitary_registration" IS
  'Registro sanitario of the establishment. Free text, format unknown.';
COMMENT ON COLUMN "public"."prospect"."nrc" IS
  'Número de Registro de Contribuyente (El Salvador), e.g. 230204-4.';
COMMENT ON COLUMN "public"."prospect"."nit" IS
  'NIT (0614-250621-108-6) or, for natural persons, the DUI homologated as NIT (01234567-8).';
COMMENT ON COLUMN "public"."prospect"."email" IS
  'Contact email, stored lowercase.';
