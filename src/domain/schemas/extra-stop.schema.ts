import { z } from 'zod';
import { STOP_TYPES } from './daily-route.schema';

export const sellerIdParamSchema = z.object({
  sellerId: z.string().uuid('Invalid seller id'),
});

export type SellerIdParam = z.infer<typeof sellerIdParamSchema>;

export const extraStopParamsSchema = sellerIdParamSchema.extend({
  stopId: z.string().uuid('Invalid stop id'),
});

export type ExtraStopParams = z.infer<typeof extraStopParamsSchema>;

/**
 * Body of POST /api/v1/sellers/:sellerId/daily-route/extra-stops (PCRM-158).
 * Only an Administrador adds a stop for a single day, outside the route's
 * planned composition (route_customer / route_user stay untouched —
 * CLAUDE.md 5.1). The seller comes from the URL, not the body.
 */
export const createExtraStopSchema = z
  .object({
    date: z.iso.date('Invalid date, expected YYYY-MM-DD'),
    customer_id: z.string().uuid('Invalid customer id'),
    stop_type: z.enum(STOP_TYPES, {
      error: 'Invalid stop_type: expected visit, dispatch or collection',
    }),
    route_id: z.string().uuid('Invalid route id').optional(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export type CreateExtraStopInput = z.infer<typeof createExtraStopSchema>;
