import { Prisma } from '../../../generated/prisma/client';
import {
  CASH_PAYMENT_ID,
  CREDIT_TERM_DAYS,
  ERP_STATUS_SALE,
} from '../../../domain/constants/businessRules';

/**
 * Cartera vencida, as of today (no period, previous_value null): credit
 * balance older than the credit term. Same criterion as the credit tab of the
 * customer profile: confirmed sales, cash excluded. Matches the partial index
 * sale_pending_balance_idx.
 */
export const overduePortfolioSql = (): Prisma.Sql => Prisma.sql`
  SELECT COALESCE(SUM(s.pending_balance) FILTER (
           WHERE s.erp_created_at < now() - make_interval(days => ${CREDIT_TERM_DAYS})
         ), 0)::numeric(14,2)::text AS value,
         NULL::text AS previous_value
  FROM   sale s
  WHERE  s.deleted_at IS NULL
    AND  s.pending_balance > 0
    AND  s.erp_status = ${ERP_STATUS_SALE}
    AND  (s.payment_id IS NULL OR s.payment_id <> ${CASH_PAYMENT_ID})
`;
