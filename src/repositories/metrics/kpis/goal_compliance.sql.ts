import { Prisma } from '../../../generated/prisma/client';
import { KpiWindow, goalSlicesCte } from '../fragments.sql';

/**
 * Cumplimiento de meta (%): sales inside the seller-months that have a goal,
 * divided by those goals prorated to the period (PCRM-173, see goalSlicesCte).
 * Null when no seller has a goal in the period.
 */
const complianceOf = (slices: string): Prisma.Sql => Prisma.sql`
  (SELECT ROUND(100.0 * SUM(gs.sales) / NULLIF(SUM(gs.goal_amount), 0), 1)::float8
   FROM   ${Prisma.raw(slices)} gs)
`;

export const goalComplianceSql = (w: KpiWindow): Prisma.Sql => Prisma.sql`
  WITH ${goalSlicesCte(w.range, 'current_slices')},
       ${goalSlicesCte(w.previous, 'previous_slices')}
  SELECT ${complianceOf('current_slices')}  AS value,
         ${complianceOf('previous_slices')} AS previous_value
`;
