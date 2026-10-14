import { Client } from '../lib/prisma';
import {
  ReportKpisQuery,
  ReportProductsQuery,
  ReportRangeQuery,
  ReportTrendsQuery,
} from '../domain/schemas/report.schema';
import { RenderedReport } from '../domain/types/report.types';
import {
  getCoverage,
  getKpi,
  getKpiValues,
  getProductRanking,
  getPurchaseFrequency,
  getSellerDetail,
  getTrends,
  listSellerPerformance,
} from './metrics.service';
import { renderReport } from './reports/common';
import { buildCoverageReport } from './reports/coverage.report';
import { buildKpisReport } from './reports/kpis.report';
import { buildProductsReport } from './reports/products.report';
import { buildPurchaseFrequencyReport } from './reports/purchaseFrequency.report';
import { buildSellerDetailReport, buildSellersReport } from './reports/sellers.report';
import { buildTrendsReport } from './reports/trends.report';

/*
 * KPI reports as .xlsx or .pdf: one per metrics endpoint, fed by that same
 * endpoint's service function so a report can never disagree with the panel.
 * Each call is metrics service -> builder (services/reports/) -> renderer
 * (lib/reports/).
 *
 *   GET /api/v1/reports/kpis                -> getKpiValues
 *   GET /api/v1/reports/kpis/:name          -> getKpi
 *   GET /api/v1/reports/sellers             -> listSellerPerformance
 *   GET /api/v1/reports/sellers/:id         -> getSellerDetail
 *   GET /api/v1/reports/trends              -> getTrends
 *   GET /api/v1/reports/coverage            -> getCoverage
 *   GET /api/v1/reports/products            -> getProductRanking
 *   GET /api/v1/reports/purchase-frequency  -> getPurchaseFrequency
 *
 * GET /metrics/kpis (the catalog) has no report: it computes nothing.
 */

export const generateKpisReport = async (
  client: Client,
  query: ReportKpisQuery,
  now: Date = new Date()
): Promise<RenderedReport> => {
  const data = await getKpiValues(client, query, now);
  return renderReport(buildKpisReport(data, now), query.format);
};

/** The KPIs report narrowed to one KPI. An unknown name is a 404, as in metrics. */
export const generateKpiReport = async (
  client: Client,
  name: string,
  query: ReportRangeQuery,
  now: Date = new Date()
): Promise<RenderedReport> => {
  const { period, thresholds, previous_period, value, previous_value } = await getKpi(
    client,
    name,
    query,
    now
  );
  const data = {
    period,
    thresholds,
    previous_period,
    kpis: { [name]: { value, previous_value } },
  };
  return renderReport(buildKpisReport(data, now), query.format);
};

export const generateSellersReport = async (
  client: Client,
  query: ReportRangeQuery,
  now: Date = new Date()
): Promise<RenderedReport> => {
  const data = await listSellerPerformance(client, query, now);
  return renderReport(buildSellersReport(data, now), query.format);
};

export const generateSellerDetailReport = async (
  client: Client,
  sellerId: string,
  query: ReportRangeQuery,
  now: Date = new Date()
): Promise<RenderedReport> => {
  const data = await getSellerDetail(client, sellerId, query, now);
  return renderReport(buildSellerDetailReport(data, now), query.format);
};

export const generateTrendsReport = async (
  client: Client,
  query: ReportTrendsQuery,
  now: Date = new Date()
): Promise<RenderedReport> => {
  const data = await getTrends(client, query, now);
  return renderReport(buildTrendsReport(data, now), query.format);
};

export const generateCoverageReport = async (
  client: Client,
  query: ReportRangeQuery,
  now: Date = new Date()
): Promise<RenderedReport> => {
  const data = await getCoverage(client, query, now);
  return renderReport(buildCoverageReport(data, now), query.format);
};

export const generateProductsReport = async (
  client: Client,
  query: ReportProductsQuery,
  now: Date = new Date()
): Promise<RenderedReport> => {
  const data = await getProductRanking(client, query, now);
  return renderReport(buildProductsReport(data, query.limit, now), query.format);
};

export const generatePurchaseFrequencyReport = async (
  client: Client,
  query: ReportRangeQuery,
  now: Date = new Date()
): Promise<RenderedReport> => {
  const data = await getPurchaseFrequency(client, query, now);
  return renderReport(buildPurchaseFrequencyReport(data, now), query.format);
};
