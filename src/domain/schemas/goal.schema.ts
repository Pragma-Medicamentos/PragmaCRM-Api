import { z } from 'zod';

/**
 * PUT /api/v1/sellers/:id/goals (PCRM-173). Sets the seller's monthly goal
 * from `year`/`month` onward, until a later goal replaces it. A goal of 0
 * means "no goal from that month on".
 */
export const setGoalSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  // numeric(14,2): at most 12 integer digits and 2 decimals.
  goal_amount: z
    .number()
    .nonnegative('goal_amount must be zero or positive')
    .max(999_999_999_999.99)
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
      message: 'goal_amount accepts at most 2 decimals',
    }),
});

export type SetGoalInput = z.infer<typeof setGoalSchema>;

export const goalParamsSchema = z.object({
  id: z.string().uuid('Invalid seller id'),
  goalId: z.string().uuid('Invalid goal id'),
});

export type GoalParams = z.infer<typeof goalParamsSchema>;
