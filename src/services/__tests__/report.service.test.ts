import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { Client } from '../../lib/prisma';
import {
  generateCoverageReport,
  generateKpiReport,
  generateKpisReport,
  generateProductsReport,
  generatePurchaseFrequencyReport,
  generateSellerDetailReport,
  generateSellersReport,
  generateTrendsReport,
} from '../report.service';
import {
  getCoverage,
  getKpi,
  getKpiValues,
  getProductRanking,
  getPurchaseFrequency,
  getSellerDetail,
  getTrends,
  listSellerPerformance,
} from '../metrics.service';
import { KPI_LABELS, buildKpisReport } from '../reports/kpis.report';
import { RenderedReport } from '../../domain/types/report.types';

// The metrics service is the report's only data source; it has its own
// tests. Rendering runs for real: the point is that every report produces a
// file Excel and a PDF reader can open.
jest.mock('../metrics.service', () => ({
  getKpiValues: jest.fn(),
  getKpi: jest.fn(),
  listSellerPerformance: jest.fn(),
  getSellerDetail: jest.fn(),
  getTrends: jest.fn(),
  getCoverage: jest.fn(),
  getProductRanking: jest.fn(),
  getPurchaseFrequency: jest.fn(),
}));

const client = {} as Client;
const NOW = new Date('2026-10-01T02:30:00.000Z'); // 30/09/2026 20:30 local

const context = {
  period: { from: '2026-09-01', to: '2026-09-30' },
  thresholds: { inactivity_days: 30, credit_term_days: 60, gps_radius_meters: 80 },
};

const seller = {
  user_id: '11111111-1111-1111-1111-111111111101',
  name: 'Ana Pérez',
  active: true,
  stops_executed: 40,
  stops_by_type: { visit: 30, dispatch: 7, collection: 3 },
  visited_customers: 28,
  orders_count: 22,
  total_sales: '12500.50',
  average_ticket: '568.20',
  goal_amount: '15000.00',
  goal_compliance: 83.3,
  route_sales: '10000.00',
  executed_route_days: 18,
  sales_per_route: '555.56',
  dispatches_for_others: 1,
  portfolio_customers: 70,
};

const trendPoints = [
  { bucket_start: '2026-08-31', stops: 10, orders_count: 5, total_sales: '2500.00', average_ticket: '500.00' },
  { bucket_start: '2026-09-07', stops: 12, orders_count: 0, total_sales: '0.00', average_ticket: null },
];

const kpiValues = {
  ...context,
  previous_period: { from: '2026-08-02', to: '2026-08-31' },
  kpis: {
    stops_executed: { value: 120, previous_value: 100 },
    stops_by_type: {
      value: { visit: 90, dispatch: 20, collection: 10 },
      previous_value: { visit: 80, dispatch: 15, collection: 5 },
    },
    total_sales: { value: '65263.96', previous_value: '60000.00' },
    goal_compliance: { value: 92.4, previous_value: null },
    average_visit_minutes: { value: 14.5, previous_value: 12 },
    overdue_portfolio: { value: '8000.00', previous_value: null },
    recovered_customers: { error: 'KPI could not be computed' },
  },
};

const isXlsx = (report: RenderedReport) => report.buffer.subarray(0, 2).toString() === 'PK';
const isPdf = (report: RenderedReport) => report.buffer.subarray(0, 5).toString() === '%PDF-';

const loadWorkbook = async (report: RenderedReport) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(report.buffer as unknown as ArrayBuffer);
  return workbook;
};

beforeEach(() => {
  jest.clearAllMocks();
  (getKpiValues as jest.Mock).mockResolvedValue(kpiValues);
  (getKpi as jest.Mock).mockResolvedValue({
    ...context,
    name: 'overdue_portfolio',
    unit: 'money',
    has_previous_period: false,
    previous_period: null,
    value: '8000.00',
    previous_value: null,
  });
  (listSellerPerformance as jest.Mock).mockResolvedValue({
    ...context,
    sellers: [
      { ...seller, name: 'Bruno', total_sales: '100.00', goal_compliance: null, goal_amount: null },
      seller,
    ],
  });
  (getSellerDetail as jest.Mock).mockResolvedValue({
    ...context,
    seller,
    weekly_trend: trendPoints,
    customers_without_visit: [
      {
        customer_id: 'c1',
        name: 'Farmacia Central',
        trade_name: null,
        zone: 'Escalón',
        last_visit_at: null,
        days_since_last_visit: null,
      },
    ],
  });
  (getTrends as jest.Mock).mockResolvedValue({ ...context, granularity: 'week', points: trendPoints });
  (getCoverage as jest.Mock).mockResolvedValue({
    ...context,
    visited: 1,
    not_visited: 1,
    without_location: 0,
    customers: [
      { customer_id: 'c1', name: 'Zeta', trade_name: null, lat: 13.7, lng: -89.2, visited: true, last_visit_at: new Date('2026-09-10T15:00:00Z') },
      { customer_id: 'c2', name: 'Alfa', trade_name: 'Alfa SA', lat: 13.71, lng: -89.21, visited: false, last_visit_at: null },
    ],
  });
  (getProductRanking as jest.Mock).mockResolvedValue({
    ...context,
    total_amount: '1000.00',
    products: [
      { position: 1, product_id: 7, code: 'A1', name: 'Acetaminofén 500 mg', amount: '600.00', units: '120.0000' },
      { position: 2, product_id: 8, code: null, name: 'Ibuprofeno', amount: '300.00', units: '45.5000' },
    ],
  });
  (getPurchaseFrequency as jest.Mock).mockResolvedValue({
    ...context,
    buckets: [
      { label: '0-7', min_days: 0, max_days: 7, customers: 3 },
      { label: '61+', min_days: 61, max_days: null, customers: 1 },
    ],
    insufficient_data: 2,
    average_days: 12,
  });
});

describe('every report renders in both formats', () => {
  const cases: [string, (format: 'xlsx' | 'pdf') => Promise<RenderedReport>][] = [
    ['kpis', (format) => generateKpisReport(client, { format }, NOW)],
    ['kpi', (format) => generateKpiReport(client, 'overdue_portfolio', { format }, NOW)],
    ['sellers', (format) => generateSellersReport(client, { format }, NOW)],
    ['seller detail', (format) => generateSellerDetailReport(client, seller.user_id, { format }, NOW)],
    ['trends', (format) => generateTrendsReport(client, { format, granularity: 'week' }, NOW)],
    ['coverage', (format) => generateCoverageReport(client, { format }, NOW)],
    ['products', (format) => generateProductsReport(client, { format, limit: 50 }, NOW)],
    ['purchase frequency', (format) => generatePurchaseFrequencyReport(client, { format }, NOW)],
  ];

  it.each(cases)('%s as xlsx', async (_name, generate) => {
    const report = await generate('xlsx');
    expect(isXlsx(report)).toBe(true);
    expect(report.filename).toMatch(/^pragma-crm_.+_2026-09-01_2026-09-30\.xlsx$/);
    expect(report.contentType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  });

  it.each(cases)('%s as pdf', async (_name, generate) => {
    const report = await generate('pdf');
    expect(isPdf(report)).toBe(true);
    expect(report.filename).toMatch(/\.pdf$/);
    expect(report.contentType).toBe('application/pdf');
  });
});

describe('xlsx content', () => {
  it('binds native charts to the data sheets', async () => {
    const report = await generateSellersReport(client, { format: 'xlsx' }, NOW);
    const zip = await JSZip.loadAsync(new Uint8Array(report.buffer));

    const charts = Object.keys(zip.files).filter((path) => /^xl\/charts\/chart\d+\.xml$/.test(path));
    expect(charts).toHaveLength(3);
    const chartXml = await zip.file(charts[0])!.async('string');
    expect(chartXml).toContain('&apos;Desempeño por vendedor&apos;!$I$2:$I$3');
  });

  it('writes real numbers, sorted by sales', async () => {
    const workbook = await loadWorkbook(await generateSellersReport(client, { format: 'xlsx' }, NOW));
    const sheet = workbook.getWorksheet('Desempeño por vendedor')!;

    expect(sheet.getCell('A2').value).toBe('Ana Pérez');
    expect(sheet.getCell('I2').value).toBe(12500.5);
    expect(sheet.getCell('L3').value).toBeNull();
  });

  it('puts not-visited customers first in coverage', async () => {
    const workbook = await loadWorkbook(await generateCoverageReport(client, { format: 'xlsx' }, NOW));
    const sheet = workbook.getWorksheet('Clientes')!;

    expect(sheet.getCell('A2').value).toBe('Alfa');
    expect(sheet.getCell('C2').value).toBe('No');
  });
});

describe('buildKpisReport', () => {
  it('groups KPIs by unit and compares with the previous period', () => {
    const definition = buildKpisReport(kpiValues as never, NOW);
    const money = definition.tables.find((table) => table.key === 'KPIs de venta')!;

    const sales = money.rows.find((row) => row.kpi === KPI_LABELS.total_sales)!;
    expect(sales.current).toBe(65263.96);
    expect(sales.change).toBe(8.8);
    // Snapshot KPI: no previous period, so no change either.
    expect(money.rows.find((row) => row.kpi === KPI_LABELS.overdue_portfolio)!.change).toBeNull();
    expect(definition.tables.map((table) => table.key)).toEqual([
      'KPIs de venta',
      'KPIs de conteo',
      'KPIs de tasa',
      'KPIs en minutos',
      'Paradas por tipo',
    ]);
  });

  it('reports a failed KPI as a note instead of dropping the report', () => {
    const definition = buildKpisReport(kpiValues as never, NOW);

    expect(definition.notes.some((note) => note.includes('Clientes recuperados'))).toBe(true);
    expect(
      definition.tables.flatMap((table) => table.rows).some((row) => row.kpi === KPI_LABELS.recovered_customers)
    ).toBe(false);
  });

  it('names a single-KPI report after the KPI', async () => {
    const report = await generateKpiReport(client, 'overdue_portfolio', { format: 'xlsx' }, NOW);
    expect(report.filename).toBe('pragma-crm_kpi_overdue_portfolio_2026-09-01_2026-09-30.xlsx');
  });
});
