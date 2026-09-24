import { Prisma } from '../../generated/prisma/client';
import { LocalDateRange } from '../../lib/localDateRange';
import {
  VISIT_AT,
  inRange,
} from './fragments.sql';

/** Active customers, flagged visited when they had a visit in the range. */
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
