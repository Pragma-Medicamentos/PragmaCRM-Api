import { Prisma } from '../../../generated/prisma/client';
import { ERP_STATUS_SALE } from '../../../domain/constants/businessRules';
import {
  KpiWindow,
  SALE_AT,
  inWindow,
  inCurrent,
  inPrevious,
} from '../fragments.sql';

/**
 * Venta total (RF-09 "venta mensual"): SUM(sale.total), VAT included
 * (decision D-1). Confirmed sales only; "0.00" when there are none.
 */
export const totalSalesSql = (w: KpiWindow): Prisma.Sql => Prisma.sql`
  SELECT COALESCE(SUM(s.total) FILTER (WHERE ${inCurrent(SALE_AT, w)}), 0)::numeric(14,2)::text
           AS value,
         COALESCE(SUM(s.total) FILTER (WHERE ${inPrevious(SALE_AT, w)}), 0)::numeric(14,2)::text
           AS previous_value
  FROM   sale s
  WHERE  s.deleted_at IS NULL
    AND  s.erp_status = ${ERP_STATUS_SALE}
    AND  ${inWindow(SALE_AT, w)}
`;
