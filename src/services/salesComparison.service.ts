import { Client } from '../lib/prisma';
import { CustomError } from '../domain/errors/CustomError';
import { previousRange } from '../lib/localDateRange';
import { SalesComparisonQuery } from '../domain/schemas/salesComparison.schema';
import { SalesComparisonResponse } from '../domain/types/salesComparison.types';
import { buildPage } from '../domain/types/pagination.types';
import { KpiWindow } from '../repositories/metrics/fragments.sql';
import {
  findSalesComparisonBreakdown,
  findSalesComparisonTotals,
} from '../repositories/salesComparison.repository';
import { buildContext } from './metrics.service';

/*
 * Sales comparison (PCRM-187):
 *
 *      GET /api/v1/metrics/sales/comparison -> getSalesComparison
 *
 * Same `from` / `to` as the rest of the panel, and the same previous period
 * as the KPI cards: the one of equal length right before the selected range
 * (previousRange). The contract is documented in docs/METRICS_API.md.
 */

/**
 * A filter on an id that does not exist would answer a page of zeros that
 * looks like "this customer bought nothing". It is a 404 instead. Soft-deleted
 * rows still count: their sales are history the comparison must show.
 */
const assertFiltersExist = async (
  client: Client,
  query: SalesComparisonQuery
): Promise<void> => {
  const [customer, seller] = await Promise.all([
    query.customer_id
      ? client.customer.findUnique({ where: { id: query.customer_id }, select: { id: true } })
      : true,
    query.user_id
      ? client.app_user.findUnique({ where: { id: query.user_id }, select: { id: true } })
      : true,
  ]);

  if (!customer) throw CustomError.notFound('Customer not found');
  if (!seller) throw CustomError.notFound('Seller not found');
};

export const getSalesComparison = async (
  client: Client,
  query: SalesComparisonQuery,
  now: Date = new Date()
): Promise<SalesComparisonResponse> => {
  await assertFiltersExist(client, query);

  const { range, context } = buildContext(query, now);
  const previous = previousRange(range);
  const window: KpiWindow = {
    range,
    previous,
    inactivityDays: context.thresholds.inactivity_days,
    now,
  };
  const filters = { customerId: query.customer_id, userId: query.user_id };

  const [totals, breakdown] = await Promise.all([
    findSalesComparisonTotals(client, window, filters),
    query.group_by
      ? findSalesComparisonBreakdown(
          client,
          window,
          filters,
          query.group_by,
          query.limit,
          (query.page - 1) * query.limit
        )
      : null,
  ]);

  return {
    ...context,
    previous_period: { from: previous.from, to: previous.to },
    filters: {
      customer_id: query.customer_id ?? null,
      user_id: query.user_id ?? null,
    },
    totals,
    breakdown:
      breakdown && query.group_by
        ? {
            group_by: query.group_by,
            ...buildPage(breakdown.items, breakdown.total, query.page, query.limit),
          }
        : null,
  };
};
