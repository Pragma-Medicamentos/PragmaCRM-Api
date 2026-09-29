import { Prisma } from '../../generated/prisma/client';

/**
 * PCRM-161: materializes `scheduled_visit` rows for one seller/date from the
 * seller's weekly route composition (`route_customer` + `route_user`,
 * CLAUDE.md 5.1), the first time either daily-route endpoint reads that day.
 * On-the-fly, not a nightly job: there is no jornada row to backfill, only
 * whatever the next read asks for.
 *
 * Idempotent by two layers, not one:
 *
 *   - The first `NOT EXISTS` is the gate: "has this seller/date already been
 *     generated at all", answered by any planned row (`NOT is_extra AND
 *     customer_id IS NOT NULL`), live *or* soft-deleted. Once true, later
 *     edits to `route_customer` never regenerate or duplicate the day — this
 *     is what freezes a day's plan once it has been opened, per CLAUDE.md
 *     5.1's "planning vs execution" split.
 *
 *   - `scheduled_visit_planned_uq (route_user_id, visit_date, customer_id)
 *     WHERE NOT is_extra AND deleted_at IS NULL AND customer_id IS NOT NULL`
 *     is the real guarantee under concurrency. Two requests for the same
 *     seller/date can both pass the gate before either commits; the index
 *     plus `ON CONFLICT DO NOTHING` make the second statement block on the
 *     first's commit and then skip every row that would collide, rather than
 *     erroring or duplicating. No advisory lock needed. The statement names
 *     no conflict target, so it also tolerates a collision against
 *     `scheduled_visit_extra_uq` (an admin extra already occupying that
 *     customer+type for the day).
 *
 * The second `NOT EXISTS` is PCRM-158 coexistence: a customer+stop_type that
 * already has a live extra stop for this seller/date is skipped, so
 * generation never lays a planned row on top of the extra that is meant to
 * be the one true card for that stop.
 *
 * Customers without a GPS pin are generated like any other member — the
 * stop card degrades to zone-only, same as `customer`'s `without_gps` filter.
 */
export const generateStopsSql = (
  sellerId: string,
  date: string,
  isoWeekday: number
): Prisma.Sql => Prisma.sql`
  INSERT INTO scheduled_visit (route_user_id, visit_date, customer_id, stop_type, sort_order, is_extra)
  SELECT ru.id, ${date}::date, rc.customer_id, rc.stop_type, rc.sort_order, false
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
    AND  ru.day = ${isoWeekday}
    AND  NOT EXISTS (
           SELECT 1
           FROM   scheduled_visit sv
           JOIN   route_user ru2 ON ru2.id = sv.route_user_id
           WHERE  ru2.user_id = ${sellerId}::uuid
             AND  sv.visit_date = ${date}::date
             AND  NOT sv.is_extra
             AND  sv.customer_id IS NOT NULL
         )
    AND  NOT EXISTS (
           SELECT 1
           FROM   scheduled_visit sx
           JOIN   route_user ru3 ON ru3.id = sx.route_user_id
           WHERE  ru3.user_id = ${sellerId}::uuid
             AND  sx.visit_date = ${date}::date
             AND  sx.is_extra
             AND  sx.deleted_at IS NULL
             AND  sx.customer_id = rc.customer_id
             AND  sx.stop_type = rc.stop_type
         )
  ON CONFLICT DO NOTHING
`;
