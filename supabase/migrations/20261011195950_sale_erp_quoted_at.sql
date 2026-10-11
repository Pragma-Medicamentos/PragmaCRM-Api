-- Import reconciliation (RF-03): sales present in the CRM but absent from the
-- imported JSON are removed, limited to the date range the file covers.
--
-- Efactsoft filters its export by `venta.created_at` (when the quotation was
-- created), not by `fecha_emision` (when it became a sale, the source of
-- erp_created_at, CLAUDE.md 5.5). Emission lags creation by up to 6 days in
-- the real export, so comparing on erp_created_at would remove sales that
-- were never inside the export window. This column keeps the date the export
-- actually filters on.
--
-- Not in the DER: added for the reconciliation, to be documented there.

ALTER TABLE "public"."sale"
  ADD COLUMN "erp_quoted_at" timestamptz;

COMMENT ON COLUMN "public"."sale"."erp_quoted_at" IS
  'venta.created_at from Efactsoft: when the quotation was created. The date the ERP export filters on; used only to scope the import reconciliation. Never use it for sales metrics: those go by erp_created_at.';

-- The reconciliation UPDATE scans live sales inside the export window.
CREATE INDEX "sale_erp_quoted_at_idx"
  ON "public"."sale" ("erp_quoted_at")
  WHERE "deleted_at" IS NULL;

-- No backfill: the sales tables are truncated before the automated import
-- starts. A row left with NULL is simply never removed as "missing".
-- No GRANT: authenticated already holds a table-level SELECT on sale.
