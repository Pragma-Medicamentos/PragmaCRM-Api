-- Closes open decision B-8 (CLAUDE.md 7.1 / Anexo A.3): a seller can now
-- confirm a stop planned on a prospect. scheduled_visit already accepted
-- prospect_id; visit did not, so the check-in had nowhere to be stored.
--
-- visit mirrors scheduled_visit: customer_id becomes nullable, prospect_id is
-- added, and exactly one of the two is set (same rule as
-- scheduled_visit_target_chk). Every existing row has customer_id, so the
-- CHECK holds without a backfill.
--
-- Customer metrics are unaffected by construction: they join or correlate on
-- v.customer_id = c.id, or COUNT(DISTINCT v.customer_id), and both ignore a
-- NULL customer_id.

ALTER TABLE "public"."visit"
  ALTER COLUMN "customer_id" DROP NOT NULL;

ALTER TABLE "public"."visit"
  ADD COLUMN "prospect_id" uuid;

ALTER TABLE "public"."visit"
  ADD CONSTRAINT "visit_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospect"("id");

ALTER TABLE "public"."visit"
  ADD CONSTRAINT "visit_target_chk" CHECK (num_nonnulls("customer_id", "prospect_id") = 1);

CREATE INDEX "visit_prospect_id_idx"
  ON "public"."visit" USING btree ("prospect_id")
  WHERE "prospect_id" IS NOT NULL AND "deleted_at" IS NULL;

COMMENT ON COLUMN "public"."visit"."prospect_id" IS
  'Prospect visited, when the confirmed stop targeted a prospect instead of a customer. Exactly one of customer_id / prospect_id is set (visit_target_chk).';

-- RLS: visit_select / visit_insert / visit_update filter on user_id only, so
-- they already cover prospect visits. No policy or GRANT change.
