import { Prisma } from '../../../generated/prisma/client';
import { ERP_STATUS_SALE } from '../../../domain/constants/businessRules';
import { monthsTouched } from '../../../lib/localDateRange';
import {
  KpiWindow,
  SALE_AT,
  inWindow,
  inCurrent,
  inPrevious,
} from '../fragments.sql';

/**
 * Venta prom. mensual (1d): total_sales divided by the calendar months each
 * period touches. Each period uses its own month count.
 */
export const averageMonthlySalesSql = (w: KpiWindow): Prisma.Sql => {
  const months = monthsTouched(w.range).length;
  const previousMonths = monthsTouched(w.previous).length;

  return Prisma.sql`
    SELECT (COALESCE(SUM(s.total) FILTER (WHERE ${inCurrent(SALE_AT, w)}), 0)
              / ${months})::numeric(14,2)::text AS value,
           (COALESCE(SUM(s.total) FILTER (WHERE ${inPrevious(SALE_AT, w)}), 0)
              / ${previousMonths})::numeric(14,2)::text AS previous_value
    FROM   sale s
    WHERE  s.deleted_at IS NULL
      AND  s.erp_status = ${ERP_STATUS_SALE}
      AND  ${inWindow(SALE_AT, w)}
  `;
};
