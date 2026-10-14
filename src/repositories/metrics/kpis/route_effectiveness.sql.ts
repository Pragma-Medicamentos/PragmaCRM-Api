import { Prisma } from '../../../generated/prisma/client';
import { ERP_STATUS_SALE } from '../../../domain/constants/businessRules';
import {
  KpiWindow,
  TZ,
  VISIT_AT,
  SALE_AT,
  inWindow,
  inCurrent,
  inPrevious,
} from '../fragments.sql';

/**
 * Efectividad de ruta (1d, "venta generada / ruta ejecutada"): sales attributed
 * to a route divided by executed route-days.
 *
 * Same rule as the per-route metrics (../routeSales.sql.ts): a sale is route
 * sale when its visit executed a stop of the agenda (`scheduled_visit`), and a
 * route-day is a distinct (assignment that generated the stop, local day)
 * pair with at least one executed stop.
 */
export const routeEffectivenessSql = (w: KpiWindow): Prisma.Sql => Prisma.sql`
  WITH
  route_sales AS (
    SELECT COALESCE(SUM(s.total) FILTER (WHERE ${inCurrent(SALE_AT, w)}), 0)  AS amount,
           COALESCE(SUM(s.total) FILTER (WHERE ${inPrevious(SALE_AT, w)}), 0) AS previous_amount
    FROM   sale s
    JOIN   visit v
           ON v.id = s.visit_id
          AND v.deleted_at IS NULL
          AND v.scheduled_visit_id IS NOT NULL
    WHERE  s.deleted_at IS NULL
      AND  s.erp_status = ${ERP_STATUS_SALE}
      AND  ${inWindow(SALE_AT, w)}
  ),
  route_days AS (
    SELECT COUNT(DISTINCT (sv.route_user_id, (v.started_at AT TIME ZONE ${TZ})::date))
             FILTER (WHERE ${inCurrent(VISIT_AT, w)})  AS days,
           COUNT(DISTINCT (sv.route_user_id, (v.started_at AT TIME ZONE ${TZ})::date))
             FILTER (WHERE ${inPrevious(VISIT_AT, w)}) AS previous_days
    FROM   visit v
    JOIN   scheduled_visit sv
           ON sv.id = v.scheduled_visit_id
    WHERE  v.deleted_at IS NULL
      AND  ${inWindow(VISIT_AT, w)}
  )
  SELECT (rs.amount / NULLIF(rd.days, 0))::numeric(14,2)::text                   AS value,
         (rs.previous_amount / NULLIF(rd.previous_days, 0))::numeric(14,2)::text AS previous_value
  FROM   route_sales rs
  CROSS  JOIN route_days rd
`;
