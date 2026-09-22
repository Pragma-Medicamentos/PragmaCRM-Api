import { z } from 'zod';

export const createRouteSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(255),
  municipality: z.string().trim().max(255).optional(),
  zone: z.string().trim().max(255).optional(),
});

export type CreateRouteInput = z.infer<typeof createRouteSchema>;

export const updateRouteSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(255).optional(),
    municipality: z.string().trim().max(255).optional(),
    zone: z.string().trim().max(255).optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.municipality !== undefined ||
      data.zone !== undefined ||
      data.active !== undefined,
    { message: 'At least one field must be provided' }
  );

export type UpdateRouteInput = z.infer<typeof updateRouteSchema>;

export const routeParamsSchema = z.object({
  id: z.string().uuid('Invalid route id'),
});

export type RouteParams = z.infer<typeof routeParamsSchema>;

export const routeAssignmentParamsSchema = routeParamsSchema.extend({
  day: z.coerce.number().int().min(1, 'day must be between 1 and 7').max(7, 'day must be between 1 and 7'),
});

export type RouteAssignmentParams = z.infer<typeof routeAssignmentParamsSchema>;

export const listRoutesQuerySchema = z.object({
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export type ListRoutesQuery = z.infer<typeof listRoutesQuerySchema>;

// route_user.day is the day of the week (1 = Monday ... 7 = Sunday), enforced
// at the database level by route_user_day_check. Required here even though
// the column is nullable: an assignment without a day has no recurrence to
// speak of (CLAUDE.md 5.1).
const dayField = z
  .number()
  .int()
  .min(1, 'day must be between 1 and 7')
  .max(7, 'day must be between 1 and 7');

export const assignRouteSchema = z.object({
  user_id: z.string().uuid('Invalid vendor id'),
  day: dayField,
});

export type AssignRouteInput = z.infer<typeof assignRouteSchema>;

export const reassignRouteSchema = z.object({
  user_id: z.string().uuid('Invalid vendor id'),
  day: dayField,
});

export type ReassignRouteInput = z.infer<typeof reassignRouteSchema>;

// route_customer.stop_type mirrors scheduled_visit.stop_type / visit.visit_type
// (CLAUDE.md 5.2): the planned stop kind on the static route package.
export const stopTypeSchema = z.enum(['visit', 'dispatch', 'collection']);

export type StopType = z.infer<typeof stopTypeSchema>;

export const createRouteStopSchema = z.object({
  customer_id: z.string().uuid('Invalid customer id'),
  stop_type: stopTypeSchema.optional(),
  sort_order: z.number().int().optional(),
});

export type CreateRouteStopInput = z.infer<typeof createRouteStopSchema>;

export const updateRouteStopSchema = z
  .object({
    stop_type: stopTypeSchema.optional(),
    sort_order: z.number().int().optional(),
  })
  .refine((data) => data.stop_type !== undefined || data.sort_order !== undefined, {
    message: 'At least one field must be provided',
  });

export type UpdateRouteStopInput = z.infer<typeof updateRouteStopSchema>;

export const routeStopParamsSchema = routeParamsSchema.extend({
  stopId: z.string().uuid('Invalid stop id'),
});

export type RouteStopParams = z.infer<typeof routeStopParamsSchema>;

export const reorderRouteStopsSchema = z.object({
  stop_ids: z.array(z.string().uuid('Invalid stop id')).min(1, 'stop_ids must not be empty'),
});

export type ReorderRouteStopsInput = z.infer<typeof reorderRouteStopsSchema>;
