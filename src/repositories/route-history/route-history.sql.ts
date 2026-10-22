import { Prisma } from '../../generated/prisma/client';
import { StopType } from '../../domain/schemas/daily-route.schema';

/**
 * Business timezone (CLAUDE.md 5.7). Same constant as daily-route.service.ts;
 * repeated rather than imported so this SQL module does not depend on a
 * service.
 */
const BUSINESS_TIME_ZONE = 'America/El_Salvador';

/**
 * PCRM-203: which stops of a day already gone still belong to the seller's
 * record. Expects the aliases of dailyRouteSql: `ru` (route_user), `r`
 * (route), `sv` (scheduled_visit) and `v` (visit).
 *
 * The live route filters out a soft-deleted `route_user` or `route`, and it
 * should: today's plan follows the current assignment. A past day cannot use
 * that filter. A reassignment (RF-04: sick leave, vacations) soft-deletes the
 * old `route_user`, and filtering on it would wipe every past week the seller
 * ran on that route, which is exactly what the history is for.
 *
 * So, for a past day, a stop stays when:
 *
 *   - it was executed (`v.id IS NOT NULL`): the visit happened, whatever was
 *     reassigned or deleted afterwards; or
 *   - its date is before the day the assignment (or its route) was retired.
 *     The PCRM-161 generation freezes days ahead of time, so a dead
 *     assignment can keep stops dated after its death; those never were the
 *     seller's to run, and showing them would invent "skipped" stops.
 *
 * LEAST ignores NULLs, so a live assignment on a live route has no retirement
 * date and the COALESCE to 'infinity' keeps every one of its stops.
 */
export const historicalStopVisibleSql = Prisma.sql`(
  v.id IS NOT NULL
  OR sv.visit_date < COALESCE(
       (LEAST(ru.deleted_at, r.deleted_at) AT TIME ZONE ${BUSINESS_TIME_ZONE})::date,
       'infinity'::date
     )
)`;

/**
 * Row of routeHistorySql: one per stop of the returned days. Only what the
 * day summary needs; the full stop of a day comes from GET /me/route?date=.
 */
export interface RouteHistoryStopRow {
  /** `YYYY-MM-DD`. */
  visit_date: string;
  id: string;
  route_user_id: string;
  route_id: string;
  route_name: string;
  route_municipality: string | null;
  route_zone: string | null;
  stop_type: StopType;
  name: string;
  completed: boolean;
}

/**
 * PCRM-203: every stop of the seller's `dayCount` most recent days before
 * `before` that had at least one stop, newest day first.
 *
 * Paged by date (keyset), not by offset: `before` is the last date the client
 * already has, so a day generated or executed meanwhile never shifts a page.
 * The caller asks for one day more than it shows, to know if there is a next
 * page without a second count query.
 *
 * Same joins and target filters as dailyRouteSql, so a day's counts here and
 * its stops in GET /me/route?date= always agree; and the same
 * historicalStopVisibleSql, which that query applies to past days.
 */
export const routeHistorySql = (
  sellerId: string,
  before: string,
  dayCount: number
): Prisma.Sql => Prisma.sql`
  WITH stops AS (
    SELECT to_char(sv.visit_date, 'YYYY-MM-DD') AS visit_date,
           sv.id::text              AS id,
           ru.id::text              AS route_user_id,
           r.id::text               AS route_id,
           r.name                   AS route_name,
           r.municipality           AS route_municipality,
           r.zone                   AS route_zone,
           sv.stop_type,
           COALESCE(c.name, p.name) AS name,
           (v.id IS NOT NULL)       AS completed,
           CASE WHEN sv.is_extra OR sv.prospect_id IS NOT NULL THEN NULL ELSE sv.sort_order END AS sort_order
    FROM   route_user ru
    JOIN   route r ON r.id = ru.route_id
    JOIN   scheduled_visit sv ON sv.route_user_id = ru.id
                             AND sv.visit_date < ${before}::date
                             AND sv.deleted_at IS NULL
    LEFT   JOIN customer c ON c.id = sv.customer_id
                          AND c.deleted_at IS NULL
    LEFT   JOIN prospect p ON p.id = sv.prospect_id
                          AND p.deleted_at IS NULL
    LEFT   JOIN visit v ON v.scheduled_visit_id = sv.id
                       AND v.deleted_at IS NULL
    WHERE  ru.user_id = ${sellerId}::uuid
      AND  COALESCE(c.id, p.id) IS NOT NULL
      AND  ${historicalStopVisibleSql}
  ),
  days AS (
    SELECT DISTINCT visit_date
    FROM   stops
    ORDER  BY visit_date DESC
    LIMIT  ${dayCount}
  )
  SELECT s.visit_date, s.id, s.route_user_id, s.route_id, s.route_name,
         s.route_municipality, s.route_zone, s.stop_type, s.name, s.completed
  FROM   stops s
  JOIN   days d ON d.visit_date = s.visit_date
  ORDER  BY s.visit_date DESC,
            COALESCE(s.sort_order, 32767) ASC,
            lower(s.name) ASC,
            s.id ASC
`;
