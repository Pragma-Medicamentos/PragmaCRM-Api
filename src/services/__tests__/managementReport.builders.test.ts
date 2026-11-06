import ExcelJS from 'exceljs';
import {
  ManagementReportContext,
  OverdueInvoiceRow,
  SalesGroupRow,
} from '../../domain/types/managementReport.types';
import { renderReport } from '../reports/common';
import {
  abcClass,
  buildAbcReport,
  buildRankingsReport,
  buildSalesReport,
} from '../reports/management/sales.report';
import { bracketOf } from '../reports/management/customers.report';
import {
  buildOverduePortfolioReport,
  overdueBracketOf,
} from '../reports/management/operations.report';

/*
 * Pure builders of the management reports (PCRM-159), and the file they
 * render to. The SQL behind them runs against Postgres in
 * __tests__/integration/managementReports.integration.test.ts.
 */

const NOW = new Date('2026-10-01T15:00:00Z');

const context = (overrides: Partial<ManagementReportContext> = {}): ManagementReportContext => ({
  period: { from: '2026-09-01', to: '2026-09-30' },
  generatedAt: NOW,
  generatedBy: 'Andrés Admin',
  filters: [{ label: 'Zona', value: 'Norte' }],
  ...overrides,
});

const group = (key: string | null, label: string | null, amount: string, orders = 1): SalesGroupRow => ({
  key,
  label,
  detail: null,
  amount,
  orders_count: orders,
  customers: 1,
  units: null,
});

const loadXlsx = async (buffer: Buffer) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
};

/** Every value of the summary sheet, as text, to look for a label. */
const summaryText = (workbook: ExcelJS.Workbook): string[] => {
  const values: string[] = [];
  workbook.worksheets[0].eachRow((row) =>
    row.eachCell((cell) => values.push(String(cell.value ?? '')))
  );
  return values;
};

describe('buildSalesReport', () => {
  it('labels the unknown group, adds shares and the average ticket', () => {
    const report = buildSalesReport(
      [group('r1', 'Ruta Norte', '300.00', 3), group(null, null, '100.00', 2)],
      'route',
      context()
    );
    const [table] = report.tables;

    expect(report.key).toBe('ventas-por-ruta');
    expect(table.rows).toEqual([
      expect.objectContaining({ name: 'Ruta Norte', amount: 300, average_ticket: 100, share: 75 }),
      expect.objectContaining({ name: 'Sin ruta atribuible', amount: 100, share: 25 }),
    ]);
    expect(report.highlights[0]).toEqual({ label: 'Venta total', value: 400, type: 'money' });
    expect(report.parameters).toContainEqual({ label: 'Zona', value: 'Norte' });
  });

  it('says "Sin datos para el período" when the filters leave nothing', () => {
    const report = buildSalesReport([], 'seller', context({ filters: [] }));

    expect(report.tables[0].rows).toEqual([]);
    expect(report.tables[0].emptyMessage).toBe('Sin datos para el período.');
    expect(report.parameters[0]).toEqual({ label: 'Filtros', value: 'Sin filtros (todo el equipo)' });
  });
});

describe('ABC', () => {
  it('classifies by the cumulative share before each item', () => {
    expect(abcClass(0)).toBe('A');
    expect(abcClass(79.9)).toBe('A');
    expect(abcClass(80)).toBe('B');
    expect(abcClass(94.9)).toBe('B');
    expect(abcClass(95)).toBe('C');
  });

  it('puts a dominant customer in A and leaves out the unknown and zero rows', () => {
    const report = buildAbcReport(
      [
        group('a', 'Grande', '900.00'),
        group('b', 'Mediano', '60.00'),
        group('c', 'Chico', '40.00'),
        group(null, null, '50.00'),
        group('z', 'Cero', '0.00'),
      ],
      'customer',
      context()
    );
    const detail = report.tables.find((t) => t.key === 'Clasificación ABC')!;
    const summary = report.tables.find((t) => t.key === 'Resumen por clase')!;

    expect(detail.rows.map((row) => [row.name, row.class])).toEqual([
      ['Grande', 'A'],
      ['Mediano', 'B'],
      ['Chico', 'C'],
    ]);
    expect(summary.rows.map((row) => row.amount)).toEqual([900, 60, 40]);
  });
});

describe('rankings', () => {
  it('keeps the top N of each ranking, without the unknown group', () => {
    const rows = [group('1', 'Uno', '30.00'), group('2', 'Dos', '20.00'), group(null, null, '5.00')];
    const report = buildRankingsReport(
      { sellers: rows, customers: rows, products: rows },
      1,
      context()
    );

    expect(report.tables.map((t) => t.rows.map((row) => row.name))).toEqual([
      ['Uno'],
      ['Uno'],
      ['Uno'],
    ]);
  });
});

describe('brackets', () => {
  it.each([
    [31, '31 a 60 días'],
    [60, '31 a 60 días'],
    [61, '61 a 90 días'],
    [91, 'Más de 90 días'],
  ])('%i days without purchase -> %s', (days, label) => {
    expect(bracketOf(days)).toBe(label);
  });

  it.each([
    [1, '1 a 30 días'],
    [45, '31 a 60 días'],
    [90, '61 a 90 días'],
    [400, 'Más de 90 días'],
  ])('%i days overdue -> %s', (days, label) => {
    expect(overdueBracketOf(days)).toBe(label);
  });
});

describe('buildOverduePortfolioReport', () => {
  const invoice = (id: number, customer: number, balance: string, days: number): OverdueInvoiceRow => ({
    erp_sale_id: id,
    document: `F-${id}`,
    erp_customer_id: customer,
    customer_name: `Cliente ${customer}`,
    trade_name: null,
    issued_at: new Date('2026-06-01T12:00:00Z'),
    days_overdue: days,
    total: '500.00',
    pending_balance: balance,
    seller_name: null,
    route_name: null,
    zone: null,
  });

  it('adds up by customer and by age', () => {
    const report = buildOverduePortfolioReport(
      [invoice(1, 10, '100.00', 10), invoice(2, 10, '50.00', 100), invoice(3, 20, '25.00', 40)],
      '2026-10-01',
      context()
    );
    const byCustomer = report.tables.find((t) => t.key === 'Vencido por cliente')!;
    const aging = report.tables.find((t) => t.key === 'Antigüedad')!;

    expect(report.highlights[0]).toEqual({ label: 'Cartera vencida', value: 175, type: 'money' });
    expect(byCustomer.rows).toEqual([
      expect.objectContaining({ name: 'Cliente 10', invoices: 2, balance: 150, oldest: 100 }),
      expect.objectContaining({ name: 'Cliente 20', invoices: 1, balance: 25 }),
    ]);
    expect(aging.rows.map((row) => row.balance)).toEqual([100, 25, 0, 50]);
  });
});

describe('rendering', () => {
  it('prints who generated the file and the filters', async () => {
    const report = buildSalesReport([group('s1', 'Ana', '10.00')], 'seller', context());
    const rendered = await renderReport(report, 'xlsx');
    const text = summaryText(await loadXlsx(rendered.buffer));

    expect(rendered.filename).toBe('pragma-crm_ventas-por-vendedor_2026-09-01_2026-09-30.xlsx');
    expect(text).toEqual(expect.arrayContaining(['Generado por', 'Andrés Admin', 'Zona', 'Norte']));
  });

  it('omits "Generado por" when the definition has no author (PCRM-162 reports)', async () => {
    const report = buildSalesReport([], 'seller', context({ generatedBy: undefined }));
    const text = summaryText(await loadXlsx((await renderReport(report, 'xlsx')).buffer));

    expect(text).not.toContain('Generado por');
  });

  it('renders a pdf', async () => {
    const report = buildOverduePortfolioReport([], '2026-10-01', context());
    const rendered = await renderReport(report, 'pdf');

    expect(rendered.buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
