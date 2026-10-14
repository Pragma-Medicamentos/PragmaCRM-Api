import { Prisma } from '../../generated/prisma/client';
import { DateSpan, TZ } from '../metrics/fragments.sql';

/*
 * SQL of the executed-routes history (HU-08). `visit.checkin_location` is
 * Unsupported("geography") in Prisma, which is why the read is raw.
 *
 * Both queries filter `visit.started_at` with a [start, end) predicate on the
 * raw timestamptz (CLAUDE.md 5.7), and carry `deleted_at IS NULL` so
 * `visit_user_started_idx` stays usable (CLAUDE.md 7.5).
 */

const sellerFilter = (sellerId?: string): Prisma.Sql =>
  sellerId ? Prisma.sql`AND v.user_id = ${sellerId}::uuid` : Prisma.empty;

/** One row per executed stop in the range. */
export const executedStopsSql = (span: DateSpan, sellerId?: string): Prisma.Sql => Prisma.sql`
  SELECT v.id::text                    AS visit_id,
         v.scheduled_visit_id::text    AS scheduled_visit_id,
         v.user_id::text               AS seller_id,
         u.name                        AS seller_name,
         to_char((v.started_at AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS local_date,
         ru.id::text                   AS route_user_id,
         r.id::text                    AS route_id,
         r.name                        AS route_name,
         c.id::text                    AS customer_id,
         c.name                        AS customer_name,
         c.trade_name                  AS customer_trade_name,
         COALESCE(v.visit_type, sv.stop_type) AS stop_type,
         (sv.id IS NULL OR sv.is_extra) AS is_extra,
         v.started_at,
         v.finished_at,
         extensions.st_y(v.checkin_location::extensions.geometry)::float8 AS lat,
         extensions.st_x(v.checkin_location::extensions.geometry)::float8 AS lng,
         v.distance_meters::float8     AS distance_meters,
         v.successful,
         v.no_order_reason,
         v.notes
  FROM   visit v
  JOIN   app_user u ON u.id = v.user_id
  JOIN   customer c ON c.id = v.customer_id
  LEFT   JOIN scheduled_visit sv ON sv.id = v.scheduled_visit_id
  /* The assignment comes from the visit itself, or from its planned stop when
     the app only linked the latter. */
  LEFT   JOIN route_user ru ON ru.id = COALESCE(v.route_user_id, sv.route_user_id)
  LEFT   JOIN route r ON r.id = ru.route_id
  WHERE  v.deleted_at IS NULL
    AND  v.started_at >= ${span.start}
    AND  v.started_at <  ${span.end}
    ${sellerFilter(sellerId)}
  ORDER  BY local_date DESC, lower(u.name), v.user_id, lower(r.name) NULLS LAST,
            ru.id NULLS LAST, v.started_at ASC, v.id
`;

/**
 * Planned stops per (assignment, day) for the assignments that executed at
 * least one visit in the range, so the history can show "8 de 10 paradas".
 */
export const plannedStopsSql = (routeUserIds: string[], from: string, to: string): Prisma.Sql => Prisma.sql`
  SELECT sv.route_user_id::text                  AS route_user_id,
         to_char(sv.visit_date, 'YYYY-MM-DD')    AS local_date,
         COUNT(*)::int                           AS planned
  FROM   scheduled_visit sv
  WHERE  sv.deleted_at IS NULL
    AND  sv.route_user_id = ANY(${routeUserIds}::uuid[])
    AND  sv.visit_date BETWEEN ${from}::date AND ${to}::date
  GROUP  BY sv.route_user_id, sv.visit_date
`;
