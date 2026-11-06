import { Prisma } from '../../generated/prisma/client';

/**
 * Sort key given to a stop with no `route_customer.sort_order` — extras and
 * prospects — so they land after every planned stop of the day. Same value
 * and same reason as daily-route.service.ts's UNPLANNED_SORT_ORDER.
 */
const UNPLANNED_SORT_ORDER = 32767;

/**
 * PCRM-170: the seller's assigned week, Monday `weekStart` through Sunday
 * `weekEnd`, as one row per stop.
 *
 * A pure read. Unlike the daily route, it never goes through
 * generate-stops.sql.ts: generating a future day freezes it, and this view
 * exists precisely to show the *live* template, so a reassignment made in the
 * web panel (Wednesday moved from Santa Ana to San Salvador) shows up on the
 * next refresh.
 *
 * Two halves glued with UNION ALL, both projecting the DailyRouteStop columns
 * plus `day`/`visit_date`:
 *
 *   - Template: `route_user` (the weekday assignment) → `route` →
 *     `route_customer` → `customer`, with the same filters the generation
 *     statement applies (live, active route, live membership, active
 *     customer). Its `id` is `route_customer.id`: there is no scheduled_visit
 *     to point at, and the membership is what stays stable across refetches.
 *
 *   - Extras: live `scheduled_visit` rows flagged `is_extra` (or pointing at a
 *     prospect, extra by definition) dated inside the week, hanging off a live
 *     assignment of this seller. Same derivations as dailyRouteSql.
 *
 * A template stop is dropped when a live extra already covers the same
 * customer + stop_type on that date — the coexistence rule
 * generate-stops.sql.ts applies, so the week shows the one card the day will
 * actually have instead of two.
 */
export const weeklyRouteSql = (
  sellerId: string,
  weekStart: string,
  weekEnd: string
): Prisma.Sql => Prisma.sql`
  SELECT *
  FROM (
    SELECT rc.id::text             AS id,
           ru.day::int             AS day,
           to_char(${weekStart}::date + (ru.day - 1), 'YYYY-MM-DD') AS visit_date,
           ru.id::text             AS route_user_id,
           r.id::text              AS route_id,
           r.name                  AS route_name,
           r.municipality          AS route_municipality,
           r.zone                  AS route_zone,
           rc.stop_type,
           'customer'              AS target_kind,
           c.id::text              AS target_id,
           c.name,
           c.trade_name,
           c.address,
           c.zone,
           c.municipality,
           c.phone,
           c.personality,
           c.potential,
           c.establishment_type,
           c.credit_limit::float8  AS credit_limit,
           extensions.st_y(c.location::extensions.geometry)::float8 AS lat,
           extensions.st_x(c.location::extensions.geometry)::float8 AS lng,
           rc.sort_order::int      AS sort_order,
           false                   AS is_extra,
           NULL::text              AS reason
    FROM   route_user ru
    JOIN   route r ON r.id = ru.route_id
                  AND r.deleted_at IS NULL
                  AND r.active
    JOIN   route_customer rc ON rc.route_id = ru.route_id
                            AND rc.deleted_at IS NULL
    JOIN   customer c ON c.id = rc.customer_id
                     AND c.deleted_at IS NULL
                     AND c.active
    WHERE  ru.user_id = ${sellerId}::uuid
      AND  ru.deleted_at IS NULL
      AND  ru.day IS NOT NULL
      AND  NOT EXISTS (
             SELECT 1
             FROM   scheduled_visit sx
             JOIN   route_user ru2 ON ru2.id = sx.route_user_id
             WHERE  ru2.user_id = ${sellerId}::uuid
               AND  sx.visit_date = ${weekStart}::date + (ru.day - 1)
               AND  sx.is_extra
               AND  sx.deleted_at IS NULL
               AND  sx.customer_id = rc.customer_id
               AND  sx.stop_type = rc.stop_type
           )

    UNION ALL

    SELECT sv.id::text             AS id,
           extract(isodow FROM sv.visit_date)::int AS day,
           to_char(sv.visit_date, 'YYYY-MM-DD')    AS visit_date,
           ru.id::text             AS route_user_id,
           r.id::text              AS route_id,
           r.name                  AS route_name,
           r.municipality          AS route_municipality,
           r.zone                  AS route_zone,
           sv.stop_type,
           CASE WHEN sv.prospect_id IS NOT NULL THEN 'prospect'
                ELSE 'customer'
           END                     AS target_kind,
           COALESCE(c.id, p.id)::text           AS target_id,
           COALESCE(c.name, p.name)             AS name,
           COALESCE(c.trade_name, p.trade_name) AS trade_name,
           COALESCE(c.address, p.address)       AS address,
           c.zone,
           c.municipality,
           COALESCE(c.phone, p.phone)           AS phone,
           c.personality,
           c.potential,
           c.establishment_type,
           c.credit_limit::float8  AS credit_limit,
           extensions.st_y(COALESCE(c.location, p.location)::extensions.geometry)::float8 AS lat,
           extensions.st_x(COALESCE(c.location, p.location)::extensions.geometry)::float8 AS lng,
           NULL::int               AS sort_order,
           true                    AS is_extra,
           sv.reason
    FROM   route_user ru
    /* INNER, like dailyRouteSql: RouteRef.name is never null. */
    JOIN   route r ON r.id = ru.route_id
                  AND r.deleted_at IS NULL
    JOIN   scheduled_visit sv ON sv.route_user_id = ru.id
                             AND sv.visit_date BETWEEN ${weekStart}::date AND ${weekEnd}::date
                             AND sv.deleted_at IS NULL
                             AND (sv.is_extra OR sv.prospect_id IS NOT NULL)
    LEFT   JOIN customer c ON c.id = sv.customer_id
                          AND c.deleted_at IS NULL
    LEFT   JOIN prospect p ON p.id = sv.prospect_id
                          AND p.deleted_at IS NULL
    WHERE  ru.user_id = ${sellerId}::uuid
      AND  ru.deleted_at IS NULL
      /* Same silent drop as dailyRouteSql: a soft-deleted target has no name
         to show. */
      AND  COALESCE(c.id, p.id) IS NOT NULL
  ) week
  ORDER  BY day ASC,
            is_extra ASC,
            COALESCE(sort_order, ${UNPLANNED_SORT_ORDER}) ASC,
            lower(name) ASC,
            id ASC
`;
