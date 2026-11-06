import { Client } from '../lib/prisma';
import { CustomError } from '../domain/errors/CustomError';
import { localToday, previousRange, referenceInstant } from '../lib/localDateRange';
import {
  AbcEntity,
  ManagementReportQuery,
  RankingsReportQuery,
  SalesReportGroup,
} from '../domain/schemas/report.schema';
import { ManagementReportContext } from '../domain/types/managementReport.types';
import { RenderedReport } from '../domain/types/report.types';
import {
  findCollectionsBySeller,
  findCustomersWithoutPurchase,
  findGoalsBySeller,
  findNewCustomers,
  findOverduePortfolio,
  findPlannedVsDone,
  findRecoveredCustomers,
  findSalesByGroup,
  findSellersComparison,
  findVisitEffectiveness,
} from '../repositories/managementReports.repository';
import { ReportFilters } from '../repositories/reports/filters.sql';
import { buildContext } from './metrics.service';
import { renderReport } from './reports/common';
import {
  buildAbcReport,
  buildRankingsReport,
  buildSalesReport,
  buildSellersComparisonReport,
} from './reports/management/sales.report';
import {
  buildCustomersWithoutPurchaseReport,
  buildNewCustomersReport,
  buildRecoveredCustomersReport,
} from './reports/management/customers.report';
import {
  buildCollectionsReport,
  buildGoalsReport,
  buildOverduePortfolioReport,
  buildPlannedVsDoneReport,
  buildVisitEffectivenessReport,
} from './reports/management/operations.report';

/*
 * Management reports (PCRM-159): the detailed reports of the "Especificaciones
 * CRM" doc, as .xlsx or .pdf, with zone / seller / route filters. Unlike
 * report.service.ts (PCRM-162), they do not mirror a metrics endpoint: each
 * runs its own SQL (repositories/reports/), built on the same fragments and
 * the same route attribution as the metrics, so their totals still match the
 * panel for the same range.
 *
 *   GET /api/v1/reports/sales/:group               -> generateSalesReport
 *   GET /api/v1/reports/sales/sellers-comparison   -> generateSellersComparisonReport
 *   GET /api/v1/reports/abc/:entity                -> generateAbcReport
 *   GET /api/v1/reports/rankings                   -> generateRankingsReport
 *   GET /api/v1/reports/goals                      -> generateGoalsReport
 *   GET /api/v1/reports/visits/planned-vs-done     -> generatePlannedVsDoneReport
 *   GET /api/v1/reports/visits/effectiveness       -> generateVisitEffectivenessReport
 *   GET /api/v1/reports/customers/new              -> generateNewCustomersReport
 *   GET /api/v1/reports/customers/recovered        -> generateRecoveredCustomersReport
 *   GET /api/v1/reports/customers/no-purchase      -> generateCustomersWithoutPurchaseReport
 *   GET /api/v1/reports/collections                -> generateCollectionsReport
 *   GET /api/v1/reports/overdue-portfolio          -> generateOverduePortfolioReport
 */

interface Request<Q extends ManagementReportQuery = ManagementReportQuery> {
  query: Q;
  /** Name of the admin downloading the file, printed in the header. */
  generatedBy?: string;
  now?: Date;
}

/**
 * Checks the filter ids and labels them for the file header. An id that does
 * not exist is a 404, not an empty file that reads as "this seller sold
 * nothing" (same rule as the sales comparison, PCRM-187). Soft-deleted rows
 * still count: their history is what the report shows.
 */
const resolveFilters = async (
  client: Client,
  query: ManagementReportQuery
): Promise<{ filters: ReportFilters; labels: ManagementReportContext['filters'] }> => {
  const [seller, route] = await Promise.all([
    query.user_id
      ? client.app_user.findUnique({ where: { id: query.user_id }, select: { name: true } })
      : null,
    query.route_id
      ? client.route.findUnique({ where: { id: query.route_id }, select: { name: true } })
      : null,
  ]);

  if (query.user_id && !seller) throw CustomError.notFound('Seller not found');
  if (query.route_id && !route) throw CustomError.notFound('Route not found');

  const labels: ManagementReportContext['filters'] = [];
  if (query.zone) labels.push({ label: 'Zona', value: query.zone });
  if (seller) labels.push({ label: 'Vendedor', value: seller.name });
  if (route) labels.push({ label: 'Ruta', value: route.name });

  return {
    filters: { zone: query.zone, userId: query.user_id, routeId: query.route_id },
    labels,
  };
};

/** Range, filters and the builder context every report starts from. */
const prepare = async (client: Client, { query, generatedBy, now = new Date() }: Request) => {
  const { range, context } = buildContext(query, now);
  const { filters, labels } = await resolveFilters(client, query);
  const reportContext: ManagementReportContext = {
    period: context.period,
    generatedAt: now,
    generatedBy,
    filters: labels,
  };
  return { range, thresholds: context.thresholds, filters, reportContext, now };
};

export const generateSalesReport = async (
  client: Client,
  group: SalesReportGroup,
  request: Request
): Promise<RenderedReport> => {
  const { range, filters, reportContext } = await prepare(client, request);
  const rows = await findSalesByGroup(client, range, filters, group);
  return renderReport(buildSalesReport(rows, group, reportContext), request.query.format);
};

export const generateSellersComparisonReport = async (
  client: Client,
  request: Request
): Promise<RenderedReport> => {
  const { range, filters, reportContext } = await prepare(client, request);
  const previous = previousRange(range);
  const rows = await findSellersComparison(
    client,
    { start: previous.start, end: range.end },
    range.start,
    filters
  );
  return renderReport(
    buildSellersComparisonReport(rows, { from: previous.from, to: previous.to }, reportContext),
    request.query.format
  );
};

export const generateAbcReport = async (
  client: Client,
  entity: AbcEntity,
  request: Request
): Promise<RenderedReport> => {
  const { range, filters, reportContext } = await prepare(client, request);
  const rows = await findSalesByGroup(client, range, filters, entity);
  return renderReport(buildAbcReport(rows, entity, reportContext), request.query.format);
};

export const generateRankingsReport = async (
  client: Client,
  request: Request<RankingsReportQuery>
): Promise<RenderedReport> => {
  const { range, filters, reportContext } = await prepare(client, request);
  const [sellers, customers, products] = await Promise.all([
    findSalesByGroup(client, range, filters, 'seller'),
    findSalesByGroup(client, range, filters, 'customer'),
    findSalesByGroup(client, range, filters, 'product'),
  ]);
  return renderReport(
    buildRankingsReport({ sellers, customers, products }, request.query.limit, reportContext),
    request.query.format
  );
};

export const generateGoalsReport = async (
  client: Client,
  request: Request
): Promise<RenderedReport> => {
  const { range, filters, reportContext } = await prepare(client, request);
  const rows = await findGoalsBySeller(client, range, filters.userId);
  return renderReport(buildGoalsReport(rows, reportContext), request.query.format);
};

export const generatePlannedVsDoneReport = async (
  client: Client,
  request: Request
): Promise<RenderedReport> => {
  const { range, filters, reportContext } = await prepare(client, request);
  const rows = await findPlannedVsDone(client, range, filters);
  return renderReport(buildPlannedVsDoneReport(rows, reportContext), request.query.format);
};

export const generateVisitEffectivenessReport = async (
  client: Client,
  request: Request
): Promise<RenderedReport> => {
  const { range, filters, reportContext } = await prepare(client, request);
  const rows = await findVisitEffectiveness(client, range, filters);
  return renderReport(buildVisitEffectivenessReport(rows, reportContext), request.query.format);
};

export const generateNewCustomersReport = async (
  client: Client,
  request: Request
): Promise<RenderedReport> => {
  const { range, filters, reportContext } = await prepare(client, request);
  const rows = await findNewCustomers(client, range, filters);
  return renderReport(buildNewCustomersReport(rows, reportContext), request.query.format);
};

export const generateRecoveredCustomersReport = async (
  client: Client,
  request: Request
): Promise<RenderedReport> => {
  const { range, thresholds, filters, reportContext } = await prepare(client, request);
  const rows = await findRecoveredCustomers(client, range, filters, thresholds.inactivity_days);
  return renderReport(
    buildRecoveredCustomersReport(rows, thresholds.inactivity_days, reportContext),
    request.query.format
  );
};

export const generateCustomersWithoutPurchaseReport = async (
  client: Client,
  request: Request
): Promise<RenderedReport> => {
  const { range, filters, reportContext, now } = await prepare(client, request);
  const reference = referenceInstant(range, now);
  const rows = await findCustomersWithoutPurchase(client, reference, filters);
  // The reference is an exclusive bound (midnight after `to`), so the day it
  // stands for is the one before it unless it is "now".
  const referenceDay = reference === now ? localToday(now) : range.to;
  return renderReport(
    buildCustomersWithoutPurchaseReport(rows, referenceDay, reportContext),
    request.query.format
  );
};

export const generateCollectionsReport = async (
  client: Client,
  request: Request
): Promise<RenderedReport> => {
  const { range, filters, reportContext, now } = await prepare(client, request);
  const rows = await findCollectionsBySeller(client, range, now, filters);
  return renderReport(buildCollectionsReport(rows, reportContext), request.query.format);
};

export const generateOverduePortfolioReport = async (
  client: Client,
  request: Request
): Promise<RenderedReport> => {
  const { filters, reportContext, now } = await prepare(client, request);
  const rows = await findOverduePortfolio(client, now, filters);
  return renderReport(
    buildOverduePortfolioReport(rows, localToday(now), reportContext),
    request.query.format
  );
};
