import { Prisma } from '../../../generated/prisma/client';
import { referenceInstant } from '../../../lib/localDateRange';
import {
  KpiWindow,
} from '../fragments.sql';

/**
 * Clientes sin visita (1a): active customers with no visit in the
 * inactivity_days before the reference instant, which is the end of the
 * period, or now if the period reaches into the future. A state at a point in
 * time, so each period is measured at its own reference.
 */
const withoutVisitAt = (referenceAt: Date, inactivityDays: number): Prisma.Sql => Prisma.sql`
  (SELECT COUNT(*)
   FROM   customer c
   WHERE  c.deleted_at IS NULL
     AND  c.active
     AND  NOT EXISTS (
            SELECT 1 FROM visit v
            WHERE  v.customer_id = c.id
              AND  v.deleted_at IS NULL
              AND  v.started_at >= ${referenceAt}::timestamptz
                                   - make_interval(days => ${inactivityDays})
              AND  v.started_at <  ${referenceAt}
          ))::int
`;

export const customersWithoutVisitSql = (w: KpiWindow): Prisma.Sql => Prisma.sql`
  SELECT ${withoutVisitAt(referenceInstant(w.range, w.now), w.inactivityDays)}    AS value,
         ${withoutVisitAt(referenceInstant(w.previous, w.now), w.inactivityDays)} AS previous_value
`;
