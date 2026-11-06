import { Client } from '../lib/prisma';
import { LocalDateRange } from '../lib/localDateRange';
import { SalesReportGroup } from '../domain/schemas/report.schema';
import {
  CollectionsRow,
  CustomerWithoutPurchaseRow,
  GoalRow,
  NewCustomerRow,
  OverdueInvoiceRow,
  PlannedVsDoneRow,
  RecoveredCustomerRow,
  SalesGroupRow,
  SellerComparisonRow,
  VisitEffectivenessRow,
} from '../domain/types/managementReport.types';
import { DateSpan } from './metrics/fragments.sql';
import { ReportFilters } from './reports/filters.sql';
import { salesByGroupSql, sellersComparisonSql } from './reports/sales.sql';
import {
  customersWithoutPurchaseSql,
  newCustomersSql,
  recoveredCustomersSql,
} from './reports/customers.sql';
import { plannedVsDoneSql, visitEffectivenessSql } from './reports/visits.sql';
import { collectionsBySellerSql, overduePortfolioSql } from './reports/credit.sql';
import { goalsBySellerSql } from './reports/goals.sql';

/*
 * Data access of the management reports (PCRM-159). The SQL text lives in
 * ./reports/*.sql.ts; this file only runs it.
 */

export const findSalesByGroup = (
  client: Client,
  span: DateSpan,
  filters: ReportFilters,
  group: SalesReportGroup
): Promise<SalesGroupRow[]> =>
  client.$queryRaw<SalesGroupRow[]>(salesByGroupSql(span, filters, group));

export const findSellersComparison = (
  client: Client,
  span: DateSpan,
  currentStart: Date,
  filters: ReportFilters
): Promise<SellerComparisonRow[]> =>
  client.$queryRaw<SellerComparisonRow[]>(sellersComparisonSql(span, currentStart, filters));

export const findNewCustomers = (
  client: Client,
  span: DateSpan,
  filters: ReportFilters
): Promise<NewCustomerRow[]> => client.$queryRaw<NewCustomerRow[]>(newCustomersSql(span, filters));

export const findRecoveredCustomers = (
  client: Client,
  span: DateSpan,
  filters: ReportFilters,
  inactivityDays: number
): Promise<RecoveredCustomerRow[]> =>
  client.$queryRaw<RecoveredCustomerRow[]>(recoveredCustomersSql(span, filters, inactivityDays));

export const findCustomersWithoutPurchase = (
  client: Client,
  reference: Date,
  filters: ReportFilters
): Promise<CustomerWithoutPurchaseRow[]> =>
  client.$queryRaw<CustomerWithoutPurchaseRow[]>(customersWithoutPurchaseSql(reference, filters));

export const findPlannedVsDone = (
  client: Client,
  range: LocalDateRange,
  filters: ReportFilters
): Promise<PlannedVsDoneRow[]> =>
  client.$queryRaw<PlannedVsDoneRow[]>(plannedVsDoneSql(range, filters));

export const findVisitEffectiveness = (
  client: Client,
  range: LocalDateRange,
  filters: ReportFilters
): Promise<VisitEffectivenessRow[]> =>
  client.$queryRaw<VisitEffectivenessRow[]>(visitEffectivenessSql(range, filters));

export const findCollectionsBySeller = (
  client: Client,
  span: DateSpan,
  now: Date,
  filters: ReportFilters
): Promise<CollectionsRow[]> =>
  client.$queryRaw<CollectionsRow[]>(collectionsBySellerSql(span, now, filters));

export const findOverduePortfolio = (
  client: Client,
  now: Date,
  filters: ReportFilters
): Promise<OverdueInvoiceRow[]> =>
  client.$queryRaw<OverdueInvoiceRow[]>(overduePortfolioSql(now, filters));

export const findGoalsBySeller = (
  client: Client,
  range: LocalDateRange,
  userId?: string
): Promise<GoalRow[]> => client.$queryRaw<GoalRow[]>(goalsBySellerSql(range, userId));
