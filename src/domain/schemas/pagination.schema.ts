import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * Paging fields every listing endpoint accepts.
 *
 * Values in `req.query` always arrive as strings, so they are coerced here
 * instead of in each controller. The cap on `limit` keeps a caller from
 * pulling a whole table in one request.
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Query params arrive as strings, so a boolean flag is a literal 'true'/'false'. */
export const booleanQueryParam = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');
