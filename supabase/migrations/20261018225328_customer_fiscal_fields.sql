-- PCRM-185 (second part): the same fiscal and contact data on customers.
--
-- The PO confirmed on 18/10/2026 that customers need the sanitary
-- registration, NRC, NIT and email too, same as prospects
-- (20261016235552_prospect_fiscal_fields.sql). None is mandatory.
--
-- They are captured by hand from the dashboard: the Efactsoft export does
-- not carry them (its `nrc`, `nif` and `email` keys belong to the issuer,
-- Pragma itself), and salesSync.service.ts upsertCustomer only writes the
-- name and credit columns, so an import never overwrites them.
--
-- Formats are validated by the API (PATCH /api/v1/customers/:id/fiscal-data),
-- not by CHECK constraints, for the same reasons as on prospect. The existing
-- customer policies and table-level GRANT already cover the new columns.

ALTER TABLE "public"."customer"
  ADD COLUMN "sanitary_registration" text,
  ADD COLUMN "nrc" text,
  ADD COLUMN "nit" text,
  ADD COLUMN "email" text;

COMMENT ON COLUMN "public"."customer"."sanitary_registration" IS
  'Registro sanitario of the establishment. Free text, format unknown.';
COMMENT ON COLUMN "public"."customer"."nrc" IS
  'Número de Registro de Contribuyente (El Salvador), e.g. 230204-4.';
COMMENT ON COLUMN "public"."customer"."nit" IS
  'NIT (0614-250621-108-6) or, for natural persons, the DUI homologated as NIT (01234567-8).';
COMMENT ON COLUMN "public"."customer"."email" IS
  'Contact email, stored lowercase.';
