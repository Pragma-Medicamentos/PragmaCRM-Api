import { Prisma } from '../../generated/prisma/client';
import { LocalDateRange } from '../../lib/localDateRange';
import {
  VISIT_AT,
  inRange,
} from './fragments.sql';

/**
 * Active customers, flagged visited when they had a visit in the range.
 *
 * `visited` excludes a visit that fulfils an extra stop (PCRM-158): extra
 * stops never count as planned/assigned coverage (CLAUDE.md open decisions).
 * A visit with no `scheduled_visit_id` at all — the common case, since linking
 * execution to a planned stop is a recent addition — still counts here;
 * only a link to a stop stamped `is_extra` is excluded. `last_visit_at` is
 * unaffected: it answers "when did we last see this customer", not
 * "coverage", so an extra-stop visit still updates it.
 */
export const coverageSql = (range: LocalDateRange): Prisma.Sql => Prisma.sql`
  SELECT c.id::text AS customer_id,
         c.name,
         c.trade_name,
         extensions.st_y(c.location::extensions.geometry)::float8 AS lat,
         extensions.st_x(c.location::extensions.geometry)::float8 AS lng,
         EXISTS (
           SELECT 1 FROM visit v
           WHERE  v.customer_id = c.id
             AND  v.deleted_at IS NULL
               AND  ${inRange(VISIT_AT, range)}
             AND  NOT EXISTS (
               SELECT 1 FROM scheduled_visit sv
               WHERE  sv.id = v.scheduled_visit_id
                 AND  sv.is_extra
             )
         ) AS visited,
         (SELECT MAX(v.started_at) FROM visit v
          WHERE  v.customer_id = c.id
            AND  v.deleted_at IS NULL
            AND  v.started_at < ${range.end}) AS last_visit_at
  FROM   customer c
  WHERE  c.deleted_at IS NULL
    AND  c.active
  ORDER  BY c.name ASC
`;
