import { Prisma } from '../../../generated/prisma/client';
import {
  CASH_PAYMENT_ID,
  ERP_STATUS_SALE,
} from '../../../domain/constants/businessRules';

/**
 * Cobros pendientes, as of today (no period, previous_value null): every
 * outstanding credit balance, cash excluded.
 */
export const pendingCollectionsSql = (): Prisma.Sql => Prisma.sql`
  SELECT COALESCE(SUM(s.pending_balance), 0)::numeric(14,2)::text AS value,
         NULL::text AS previous_value
  FROM   sale s
  WHERE  s.deleted_at IS NULL
    AND  s.pending_balance > 0
    AND  s.erp_status = ${ERP_STATUS_SALE}
    AND  (s.payment_id IS NULL OR s.payment_id <> ${CASH_PAYMENT_ID})
`;
