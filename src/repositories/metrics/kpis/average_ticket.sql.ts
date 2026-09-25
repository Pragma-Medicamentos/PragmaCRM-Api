import { Prisma } from '../../../generated/prisma/client';
import { ERP_STATUS_SALE } from '../../../domain/constants/businessRules';
import {
  KpiWindow,
  SALE_AT,
  inWindow,
  inCurrent,
  inPrevious,
} from '../fragments.sql';

/** Ticket promedio: total_sales / orders_count. Null without sales. */
export const averageTicketSql = (w: KpiWindow): Prisma.Sql => Prisma.sql`
  SELECT (AVG(s.total) FILTER (WHERE ${inCurrent(SALE_AT, w)}))::numeric(14,2)::text  AS value,
         (AVG(s.total) FILTER (WHERE ${inPrevious(SALE_AT, w)}))::numeric(14,2)::text AS previous_value
  FROM   sale s
  WHERE  s.deleted_at IS NULL
    AND  s.erp_status = ${ERP_STATUS_SALE}
    AND  ${inWindow(SALE_AT, w)}
`;
