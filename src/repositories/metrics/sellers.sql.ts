import { Prisma } from '../../generated/prisma/client';
import { ERP_STATUS_SALE } from '../../domain/constants/businessRules';
import { ROLES } from '../../domain/types/auth.types';
import { LocalDateRange } from '../../lib/localDateRange';
import {
  TZ,
  VISIT_AT,
  SALE_AT,
  inRange,
  goalsCte,
} from './fragments.sql';

/**
 * One row per seller. Sales are credited to `sale.user_id`, the ERP seller;
 * stops to `visit.user_id`, whoever executed them. Inactive sellers only show
 * up when they still have activity in the period.
 */
export const sellerPerformanceSql = (
  range: LocalDateRange,
  sellerId?: string
): Prisma.Sql => {
  const sellerFilter = sellerId ? Prisma.sql`AND u.id = ${sellerId}::uuid` : Prisma.empty;

  return Prisma.sql`
    WITH
    ${goalsCte(range)},
    vs AS (
      SELECT v.user_id,
             COUNT(*)                                             AS stops,
             COUNT(*) FILTER (WHERE v.visit_type = 'visit')      AS stops_visit,
             COUNT(*) FILTER (WHERE v.visit_type = 'dispatch')   AS stops_dispatch,
             COUNT(*) FILTER (WHERE v.visit_type = 'collection') AS stops_collection,
             COUNT(DISTINCT v.customer_id)                       AS visited_customers,
             COUNT(DISTINCT (v.route_user_id,
                             (v.started_at AT TIME ZONE ${TZ})::date))
               FILTER (WHERE v.route_user_id IS NOT NULL)        AS route_days
      FROM   visit v
      WHERE  v.deleted_at IS NULL
        AND  ${inRange(VISIT_AT, range)}
      GROUP  BY v.user_id
    ),
    ss AS (
      SELECT s.user_id,
             COUNT(*)     AS orders,
             SUM(s.total) AS sales,
             AVG(s.total) AS ticket,
             COALESCE(SUM(s.total) FILTER (WHERE rv.id IS NOT NULL), 0) AS route_sales
      FROM   sale s
      LEFT   JOIN visit rv
             ON rv.id = s.visit_id
            AND rv.deleted_at IS NULL
            AND rv.route_user_id IS NOT NULL
      WHERE  s.deleted_at IS NULL
        AND  s.erp_status = ${ERP_STATUS_SALE}
        AND  ${inRange(SALE_AT, range)}
      GROUP  BY s.user_id
    ),
    others AS (
      -- 1f: dispatches this seller executed whose sale belongs to someone else.
      SELECT v.user_id, COUNT(DISTINCT v.id) AS dispatches
      FROM   visit v
      JOIN   sale s
             ON s.visit_id = v.id
            AND s.deleted_at IS NULL
            AND s.erp_status = ${ERP_STATUS_SALE}
            AND s.user_id IS NOT NULL
            AND s.user_id <> v.user_id
      WHERE  v.deleted_at IS NULL
        AND  ${inRange(VISIT_AT, range)}
        AND  v.visit_type = 'dispatch'
      GROUP  BY v.user_id
    ),
    portfolio AS (
      -- Current composition of the routes currently assigned: it describes
      -- today, like "18 clientes en cartera" in 1f.
      SELECT ru.user_id, COUNT(DISTINCT rc.customer_id) AS customers
      FROM   route_user ru
      JOIN   route_customer rc
             ON rc.route_id = ru.route_id
            AND rc.deleted_at IS NULL
      JOIN   customer c
             ON c.id = rc.customer_id
            AND c.deleted_at IS NULL
      WHERE  ru.deleted_at IS NULL
      GROUP  BY ru.user_id
    )
    SELECT u.id::text AS user_id,
           u.name,
           u.active,
           COALESCE(vs.stops, 0)::int             AS stops_executed,
           COALESCE(vs.stops_visit, 0)::int       AS stops_visit,
           COALESCE(vs.stops_dispatch, 0)::int    AS stops_dispatch,
           COALESCE(vs.stops_collection, 0)::int  AS stops_collection,
           COALESCE(vs.visited_customers, 0)::int AS visited_customers,
           COALESCE(ss.orders, 0)::int            AS orders_count,
           COALESCE(ss.sales, 0)::numeric(14,2)::text AS total_sales,
           ss.ticket::numeric(14,2)::text         AS average_ticket,
           g.goal_amount::numeric(14,2)::text     AS goal_amount,
           ROUND(100.0 * COALESCE(ss.sales, 0)
                 / NULLIF(g.goal_amount, 0), 1)::float8 AS goal_compliance,
           COALESCE(ss.route_sales, 0)::numeric(14,2)::text AS route_sales,
           COALESCE(vs.route_days, 0)::int        AS executed_route_days,
           (ss.route_sales / NULLIF(vs.route_days, 0))::numeric(14,2)::text
             AS sales_per_route,
           COALESCE(o.dispatches, 0)::int         AS dispatches_for_others,
           COALESCE(p.customers, 0)::int          AS portfolio_customers
    FROM   app_user u
    LEFT   JOIN vs        ON vs.user_id = u.id
    LEFT   JOIN ss        ON ss.user_id = u.id
    LEFT   JOIN goals g   ON g.user_id  = u.id
    LEFT   JOIN others o  ON o.user_id  = u.id
    LEFT   JOIN portfolio p ON p.user_id = u.id
    WHERE  u.deleted_at IS NULL
      AND  u.role = ${ROLES.SELLER}
      AND  (u.active OR vs.stops IS NOT NULL OR ss.orders IS NOT NULL)
      ${sellerFilter}
    ORDER  BY COALESCE(ss.sales, 0) DESC, u.name ASC
  `;
};

/**
 * Active customers in the seller's current routes whose last visit, by
 * anyone, is older than the threshold or never happened (1f, "Clientes sin
 * visita en 30 días"). Never-visited customers come first.
 */
export const sellerInactiveCustomersSql = (
  sellerId: string,
  referenceAt: Date,
  inactivityDays: number
): Prisma.Sql => Prisma.sql`
  SELECT c.id::text AS customer_id,
         c.name,
         c.trade_name,
         c.zone,
         lv.last_visit_at,
         FLOOR(EXTRACT(EPOCH FROM (${referenceAt}::timestamptz - lv.last_visit_at))
               / 86400)::int AS days_since_last_visit
  FROM   customer c
  LEFT   JOIN LATERAL (
           SELECT MAX(v.started_at) AS last_visit_at
           FROM   visit v
           WHERE  v.customer_id = c.id
             AND  v.deleted_at IS NULL
             AND  v.started_at < ${referenceAt}
         ) lv ON true
  WHERE  c.deleted_at IS NULL
    AND  c.active
    AND  EXISTS (
           SELECT 1
           FROM   route_user ru
           JOIN   route_customer rc
                  ON rc.route_id = ru.route_id
                 AND rc.deleted_at IS NULL
           WHERE  ru.user_id = ${sellerId}::uuid
             AND  ru.deleted_at IS NULL
             AND  rc.customer_id = c.id
         )
    AND  (lv.last_visit_at IS NULL
          OR lv.last_visit_at < ${referenceAt}::timestamptz
                                - make_interval(days => ${inactivityDays}))
  ORDER  BY lv.last_visit_at ASC NULLS FIRST, c.name ASC
`;
