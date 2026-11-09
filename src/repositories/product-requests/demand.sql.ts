import { Prisma } from '../../generated/prisma/client';
import { LocalDateRange } from '../../lib/localDateRange';
import { inRange } from '../metrics/fragments.sql';


const REQUESTED_AT = Prisma.sql`pr.requested_at`;

const liveRequestsInRange = (range: LocalDateRange): Prisma.Sql => Prisma.sql`
  SELECT pr.id,
         pr.quoted_product_id,
         pr.requested_quantity,
         pr.requested_at,
         -- A request on a prospect visit counts the prospect as the customer.
         COALESCE(pr.customer_id, v.prospect_id) AS target_id
  FROM   product_request pr
  JOIN   quoted_product qp
         ON qp.id = pr.quoted_product_id
        AND qp.deleted_at IS NULL
  LEFT   JOIN visit v
         ON v.id = pr.visit_id
  WHERE  pr.deleted_at IS NULL
    AND  ${inRange(REQUESTED_AT, range)}
`;

export const demandTotalsSql = (range: LocalDateRange): Prisma.Sql => Prisma.sql`
  WITH req AS (${liveRequestsInRange(range)})
  SELECT COUNT(*)::int                           AS requests,
         COUNT(DISTINCT quoted_product_id)::int  AS products,
         COUNT(DISTINCT target_id)::int          AS customers
  FROM   req
`;

export const demandProductsSql = (range: LocalDateRange): Prisma.Sql => Prisma.sql`
  WITH req AS (${liveRequestsInRange(range)})
  SELECT qp.id,
         qp.name,
         COUNT(*)::int                    AS requests,
         COUNT(DISTINCT req.target_id)::int AS customers,
         SUM(req.requested_quantity)::text AS approx_quantity,
         MAX(req.requested_at)            AS last_requested_at
  FROM   req
  JOIN   quoted_product qp
         ON qp.id = req.quoted_product_id
  GROUP  BY qp.id, qp.name
  ORDER  BY requests DESC, last_requested_at DESC, qp.name
`;

export const demandProductRequestsSql = (
  range: LocalDateRange,
  productId: string
): Prisma.Sql => Prisma.sql`
  SELECT pr.id,
         pr.requested_at,
         pr.requested_quantity::text AS requested_quantity,
         CASE
           WHEN pr.customer_id IS NOT NULL THEN 'customer'
           WHEN v.prospect_id  IS NOT NULL THEN 'prospect'
         END                                         AS target_kind,
         COALESCE(pr.customer_id, v.prospect_id)     AS target_id,
         COALESCE(c.trade_name, c.name, p.trade_name, p.name) AS target_name,
         u.id                                        AS seller_id,
         u.name                                      AS seller_name
  FROM   product_request pr
  LEFT   JOIN visit v     ON v.id = pr.visit_id
  LEFT   JOIN customer c  ON c.id = pr.customer_id
  LEFT   JOIN prospect p  ON p.id = v.prospect_id
  LEFT   JOIN app_user u  ON u.id = pr.user_id
  WHERE  pr.quoted_product_id = ${productId}::uuid
    AND  pr.deleted_at IS NULL
    AND  ${inRange(REQUESTED_AT, range)}
  ORDER  BY pr.requested_at DESC, pr.id
`;

// quoted_product only, never product (the Efactsoft catalog); the term's LIKE wildcards are escaped.
export const demandedProductsSql = (search: string | undefined, limit: number): Prisma.Sql => {
  const pattern = search
    ? Prisma.sql`replace(replace(replace(public.normalize_name(${search}), '\\', '\\\\'), '%', '\\%'), '_', '\\_')`
    : null;

  return Prisma.sql`
    SELECT qp.id,
           qp.name,
           COUNT(pr.id)::int AS requests
    FROM   quoted_product qp
    LEFT   JOIN product_request pr
           ON pr.quoted_product_id = qp.id
          AND pr.deleted_at IS NULL
    WHERE  qp.deleted_at IS NULL
           ${pattern ? Prisma.sql`AND public.normalize_name(qp.name) LIKE '%' || ${pattern} || '%'` : Prisma.empty}
    GROUP  BY qp.id, qp.name
    ORDER  BY ${pattern ? Prisma.sql`(public.normalize_name(qp.name) LIKE ${pattern} || '%') DESC,` : Prisma.empty}
           requests DESC, qp.name
    LIMIT  ${limit}
  `;
};
