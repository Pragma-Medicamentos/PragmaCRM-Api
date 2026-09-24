import { Prisma } from '../../../generated/prisma/client';
import { ERP_STATUS_SALE } from '../../../domain/constants/businessRules';
import { LocalDateRange } from '../../../lib/localDateRange';
import {
  KpiWindow,
  SALE_AT,
  inRange,
  goalsOfMonths,
} from '../fragments.sql';

/**
 * Cumplimiento de meta (%): sales of the sellers that have a goal divided by
 * the sum of their goals, for the months each period touches. Null when no
 * goal is loaded. The two periods touch different months, so each gets its
 * own subquery instead of a FILTER.
 */
const complianceOf = (range: LocalDateRange): Prisma.Sql => Prisma.sql`
  ROUND(100.0
        * COALESCE((SELECT SUM(s.total)
                    FROM   sale s
                    WHERE  s.deleted_at IS NULL
                      AND  s.erp_status = ${ERP_STATUS_SALE}
                      AND  ${inRange(SALE_AT, range)}
                      AND  s.user_id IN (SELECT g.user_id FROM goal g
                                         WHERE ${goalsOfMonths(range)})), 0)
        / NULLIF((SELECT SUM(g.goal_amount) FROM goal g
                  WHERE ${goalsOfMonths(range)}), 0), 1)::float8
`;

export const goalComplianceSql = (w: KpiWindow): Prisma.Sql => Prisma.sql`
  SELECT ${complianceOf(w.range)}    AS value,
         ${complianceOf(w.previous)} AS previous_value
`;
