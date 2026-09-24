import { Prisma } from '../../../generated/prisma/client';
import { ERP_STATUS_SALE } from '../../../domain/constants/businessRules';
import {
  KpiWindow,
  SALE_AT,
  inWindow,
  inCurrent,
  inPrevious,
} from '../fragments.sql';

/** Número de pedidos: confirmed sales in the period. */
export const ordersCountSql = (w: KpiWindow): Prisma.Sql => Prisma.sql`
  SELECT COUNT(*) FILTER (WHERE ${inCurrent(SALE_AT, w)})::int  AS value,
         COUNT(*) FILTER (WHERE ${inPrevious(SALE_AT, w)})::int AS previous_value
  FROM   sale s
  WHERE  s.deleted_at IS NULL
    AND  s.erp_status = ${ERP_STATUS_SALE}
    AND  ${inWindow(SALE_AT, w)}
`;
