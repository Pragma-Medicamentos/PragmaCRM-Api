import { Prisma } from '../../generated/prisma/client';
import { ERP_STATUS_SALE } from '../../domain/constants/businessRules';
import { LocalDateRange } from '../../lib/localDateRange';
import { ReportFilters, filterPredicates, reportVisitsCte } from './filters.sql';

/*
 * Visit reports of the management reports (PCRM-159).
 */

const NO_ROUTE = '00000000-0000-0000-0000-000000000000';

/**
 * Visitas realizadas vs. planificadas, per seller and route.
 *
 * The plan is the agenda: `scheduled_visit` rows of the range's days
 * (generated from route_user.day + route_customer, PCRM-161), split into
 * planned stops and extra stops (PCRM-158). A stop is done when a visit points
 * at it (`visit.scheduled_visit_id`), the same rule as the route workday
 * comparison (repositories/metrics/routeWorkdays.sql.ts). Visits recorded
 * outside the agenda are counted apart, by the route of their assignment.
 *
 * The seller is the one of the assignment that generated the stop. The agenda
 * of a day exists only once someone opened it in the app, so a day nobody
 * opened adds nothing to "planned": the report says so in its notes.
 */
export const plannedVsDoneSql = (range: LocalDateRange, filters: ReportFilters): Prisma.Sql => {
  const predicates = filterPredicates(filters, {
    userId: Prisma.raw('ru.user_id'),
    routeId: Prisma.raw('ru.route_id'),
    zone: Prisma.raw('r.zone'),
  });

  return Prisma.sql`
    WITH ${reportVisitsCte(range, filters)},
    agenda AS (
      SELECT ru.user_id,
             ru.route_id,
             sv.is_extra,
             EXISTS (SELECT 1 FROM visit v
                     WHERE v.scheduled_visit_id = sv.id
                       AND v.deleted_at IS NULL) AS done
      FROM   scheduled_visit sv
      JOIN   route_user ru
             ON ru.id = sv.route_user_id
      LEFT   JOIN route r
             ON r.id = ru.route_id
      WHERE  sv.deleted_at IS NULL
        AND  sv.visit_date BETWEEN ${range.from}::date AND ${range.to}::date
        ${predicates}
    ),
    planned AS (
      SELECT a.user_id,
             a.route_id,
             COUNT(*) FILTER (WHERE NOT a.is_extra)            AS planned,
             COUNT(*) FILTER (WHERE NOT a.is_extra AND a.done) AS planned_done,
             COUNT(*) FILTER (WHERE a.is_extra)                AS extra,
             COUNT(*) FILTER (WHERE a.is_extra AND a.done)     AS extra_done
      FROM   agenda a
      GROUP  BY a.user_id, a.route_id
    ),
    unscheduled AS (
      SELECT rv.user_id,
             rv.route_id,
             COUNT(*) AS outside_agenda
      FROM   report_visits rv
      WHERE  rv.scheduled_visit_id IS NULL
      GROUP  BY rv.user_id, rv.route_id
    )
    SELECT u.name                                            AS seller_name,
           r.name                                            AS route_name,
           r.zone,
           COALESCE(p.planned, 0)::int                       AS planned,
           COALESCE(p.planned_done, 0)::int                  AS planned_done,
           COALESCE(p.extra, 0)::int                         AS extra,
           COALESCE(p.extra_done, 0)::int                    AS extra_done,
           COALESCE(x.outside_agenda, 0)::int                AS outside_agenda,
           ROUND(100.0 * p.planned_done / NULLIF(p.planned, 0), 1)::float8 AS compliance
    FROM   planned p
    -- FULL JOIN only takes hash/merge-joinable conditions, so a NULL route
    -- (visit outside any assignment) is matched through a sentinel uuid
    -- instead of IS NOT DISTINCT FROM.
    FULL   OUTER JOIN unscheduled x
           ON x.user_id = p.user_id
          AND COALESCE(x.route_id, ${NO_ROUTE}::uuid) = COALESCE(p.route_id, ${NO_ROUTE}::uuid)
    LEFT   JOIN app_user u
           ON u.id = COALESCE(p.user_id, x.user_id)
    LEFT   JOIN route r
           ON r.id = COALESCE(p.route_id, x.route_id)
    ORDER  BY u.name NULLS LAST, r.name NULLS LAST
  `;
};

/**
 * Efectividad de visitas, per seller: customer visits (visit_type 'visit',
 * the same subset the customer conversion uses) and how many generated an
 * order, i.e. have a confirmed sale linked through `sale.visit_id`. The
 * seller's own "successful" flag is shown next to it: it is self-declared,
 * which is why the effective_visits_rate KPI warns to contrast it with sales.
 */
export const visitEffectivenessSql = (
  range: LocalDateRange,
  filters: ReportFilters
): Prisma.Sql => Prisma.sql`
  WITH ${reportVisitsCte(range, filters)},
  visits AS (
    SELECT rv.id,
           rv.user_id,
           rv.successful,
           (SELECT COALESCE(SUM(s.total), 0)
            FROM   sale s
            WHERE  s.visit_id = rv.id
              AND  s.deleted_at IS NULL
              AND  s.erp_status = ${ERP_STATUS_SALE}) AS amount,
           EXISTS (SELECT 1
                   FROM   sale s
                   WHERE  s.visit_id = rv.id
                     AND  s.deleted_at IS NULL
                     AND  s.erp_status = ${ERP_STATUS_SALE}) AS with_order
    FROM   report_visits rv
    WHERE  rv.visit_type = 'visit'
      AND  rv.customer_id IS NOT NULL
  )
  SELECT u.name                                               AS seller_name,
         COUNT(*)::int                                        AS visits,
         COUNT(*) FILTER (WHERE v.with_order)::int            AS visits_with_order,
         ROUND(100.0 * COUNT(*) FILTER (WHERE v.with_order)
               / NULLIF(COUNT(*), 0), 1)::float8              AS effectiveness,
         COUNT(*) FILTER (WHERE v.successful)::int            AS marked_successful,
         ROUND(100.0 * COUNT(*) FILTER (WHERE v.successful)
               / NULLIF(COUNT(*), 0), 1)::float8              AS marked_successful_rate,
         SUM(v.amount)::numeric(14,2)::text                   AS amount
  FROM   visits v
  LEFT   JOIN app_user u
         ON u.id = v.user_id
  GROUP  BY v.user_id, u.name
  ORDER  BY 4 DESC NULLS LAST, u.name
`;
