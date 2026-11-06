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
 *
 * The stop targets a customer or a prospect ("Asignar visitas únicas
 * (clientes / prospectos)", CLAUDE.md 3.2), never both.
 */
export const createExtraStopSchema = z
  .object({
    date: z.iso.date('Invalid date, expected YYYY-MM-DD'),
    customer_id: z.string().uuid('Invalid customer id').optional(),
    prospect_id: z.string().uuid('Invalid prospect id').optional(),
    stop_type: z.enum(STOP_TYPES, {
      error: 'Invalid stop_type: expected visit, dispatch or collection',
    }),
    route_id: z.string().uuid('Invalid route id').optional(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  // Same rule as the table's `num_nonnulls(customer_id, prospect_id) = 1`.
  .refine((body) => (body.customer_id === undefined) !== (body.prospect_id === undefined), {
    message: 'Exactly one of customer_id or prospect_id is required',
    path: ['customer_id'],
  })
  // A prospect has no orders or credit yet: there is nothing to dispatch or
  // collect, only to visit.
  .refine((body) => body.prospect_id === undefined || body.stop_type === 'visit', {
    message: 'Stops on prospects must be of type visit',
    path: ['stop_type'],
  });

export type CreateExtraStopInput = z.infer<typeof createExtraStopSchema>;
