import { Prisma } from '../../generated/prisma/client';

/*
 * SQL of the prospect conversion (PCRM-186). A prospect is linked to the
 * customer that carries the same name once both go through
 * public.normalize_name (lowercase, no accents, single spaces, trimmed): the
 * name is the only datum Efactsoft shares with a prospect.
 */

/**
 * Active, unconverted prospects that share their normalised name with at
 * least one live customer, with every candidate. One row per prospect;
 * `customers` holds 1 entry for a clean match and 2+ for an ambiguous one.
 * `prospectId` narrows it to one prospect (the manual retry).
 */
export const prospectNameMatchesSql = (prospectId?: string): Prisma.Sql => Prisma.sql`
  SELECT p.id::text AS prospect_id,
         p.name     AS prospect_name,
         json_agg(
           json_build_object(
             'customer_id',     c.id::text,
             'name',            c.name,
             'erp_customer_id', c.erp_customer_id
           )
           ORDER BY c.erp_customer_id NULLS LAST, c.id
         ) AS customers
  FROM   prospect p
  JOIN   customer c
         ON  public.normalize_name(c.name) = public.normalize_name(p.name)
         AND c.deleted_at IS NULL
  WHERE  p.active
    AND  p.customer_id IS NULL
    AND  p.deleted_at IS NULL
    ${prospectId ? Prisma.sql`AND p.id = ${prospectId}::uuid` : Prisma.empty}
  GROUP  BY p.id, p.name
  ORDER  BY p.created_at, p.id
`;

/**
 * Links the prospect and deactivates it. The `customer_id IS NULL` guard makes
 * a concurrent second conversion a no-op instead of a re-link; the caller
 * reads the row count to know which one won.
 */
export const linkProspectSql = (prospectId: string, customerId: string): Prisma.Sql => Prisma.sql`
  UPDATE prospect
  SET    customer_id  = ${customerId}::uuid,
         converted_at = now(),
         active       = false,
         updated_at   = now()
  WHERE  id = ${prospectId}::uuid
    AND  customer_id IS NULL
    AND  deleted_at IS NULL
`;

/**
 * Moves the prospect's pending stops (today onwards, not executed) to the
 * customer. They stay extra stops: a prospect stop was never part of the
 * route's template, and keeping `is_extra` also keeps them clear of
 * scheduled_visit_planned_uq, which only covers template stops. Past stops are
 * left on the prospect as its history.
 */
export const moveProspectStopsSql = (
  prospectId: string,
  customerId: string,
  today: string
): Prisma.Sql => Prisma.sql`
  UPDATE scheduled_visit sv
  SET    customer_id = ${customerId}::uuid,
         prospect_id = NULL,
         is_extra    = true,
         updated_at  = now()
  WHERE  sv.prospect_id = ${prospectId}::uuid
    AND  sv.deleted_at IS NULL
    AND  sv.visit_date >= ${today}::date
    AND  NOT EXISTS (
           SELECT 1 FROM visit v
           WHERE  v.scheduled_visit_id = sv.id
             AND  v.deleted_at IS NULL
         )
`;
