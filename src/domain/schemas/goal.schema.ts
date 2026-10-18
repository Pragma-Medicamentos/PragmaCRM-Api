import { z } from 'zod';

/**
 * PUT /api/v1/sellers/:id/goals (PCRM-173). Sets the seller's monthly goal
 * from the current month onward, until a later goal replaces it. A goal of 0
 * means "no goal from this month on". Strict: the month is not the client's
 * to choose, so a body still sending year/month is rejected instead of being
 * silently applied to this month.
 */
export const setGoalSchema = z.object({
  // numeric(14,2): at most 12 integer digits and 2 decimals.
  goal_amount: z
    .number()
    .nonnegative('goal_amount must be zero or positive')
    .max(999_999_999_999.99)
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
      message: 'goal_amount accepts at most 2 decimals',
    }),
}).strict();

export type SetGoalInput = z.infer<typeof setGoalSchema>;

/** GET /api/v1/sellers/:id/goals/history (PCRM-198): the last `months` months. */
export const goalHistoryQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(24).default(12),
});

export type GoalHistoryQuery = z.infer<typeof goalHistoryQuerySchema>;
