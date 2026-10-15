-- RF-12: the customer's communication style (personality colour) and buying
-- potential become closed vocabularies.
--
-- Both columns were free text since the baseline. Two paths write them: the
-- API (PATCH /api/v1/customers/:id/commercial-profile) and the dashboard
-- through supabase-js, which the customer_update_admin policy allows. Zod only
-- guards the first one, so the vocabulary lives here too: a typo such as
-- 'Rojo' or 'alta' would otherwise land silently and break any filter or
-- colour mapping that compares against the literals.
--
-- Values stay in Spanish: they are data, not identifiers, and the mobile
-- contract (daily-route.types.ts) already documents alto | medio | bajo.

-- Normalise what is already there before constraining it. Casing and stray
-- whitespace are recoverable; anything else is not a known value and is
-- cleared rather than guessed.
UPDATE "public"."customer"
SET "personality" = lower(btrim("personality"))
WHERE "personality" IS NOT NULL
  AND "personality" <> lower(btrim("personality"));

UPDATE "public"."customer"
SET "potential" = lower(btrim("potential"))
WHERE "potential" IS NOT NULL
  AND "potential" <> lower(btrim("potential"));

UPDATE "public"."customer"
SET "personality" = NULL
WHERE "personality" NOT IN ('rojo', 'azul', 'amarillo', 'verde');

UPDATE "public"."customer"
SET "potential" = NULL
WHERE "potential" NOT IN ('alto', 'medio', 'bajo');

-- NULL stays allowed: an unclassified customer is the default, and RF-12 is
-- nice to have, so most of the portfolio will start without either value.
ALTER TABLE "public"."customer"
  ADD CONSTRAINT "customer_personality_check"
  CHECK ("personality" IN ('rojo', 'azul', 'amarillo', 'verde'));

ALTER TABLE "public"."customer"
  ADD CONSTRAINT "customer_potential_check"
  CHECK ("potential" IN ('alto', 'medio', 'bajo'));

COMMENT ON COLUMN "public"."customer"."personality" IS
  'RF-12 communication style: rojo | azul | amarillo | verde. NULL = not classified.';

COMMENT ON COLUMN "public"."customer"."potential" IS
  'RF-12 buying potential: alto | medio | bajo. NULL = not classified.';

-- No GRANT and no policy change: authenticated already holds UPDATE on
-- customer, and customer_update_admin already restricts it to admins.
