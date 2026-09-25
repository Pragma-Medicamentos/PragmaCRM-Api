-- confirmVisit (RF-06) writes visit.scheduled_visit_id on insert. The comment
-- added in 20260919215008 said the column stayed NULL until that feature
-- existed. Editing that migration would change its checksum on environments
-- that already applied it, so the comment is replaced here.

COMMENT ON COLUMN "public"."visit"."scheduled_visit_id" IS
  'Planned stop this execution fulfils. Written by confirmVisit on insert. The daily route joins visit on this column to derive completed_at. NULL only on rows created before that write existed.';
