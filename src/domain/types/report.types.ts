import { MetricsPeriod } from './metrics.types';

/*
 * Format-agnostic description of a KPI report. Each builder in
 * services/reports/ turns a metrics response into one of these, and the
 * renderers in lib/reports/ write it as .xlsx or .pdf. Keeping the two apart is
 * what guarantees the Excel and the PDF show the same figures.
 *
 * Every chart points at a table of the same report, so the data behind a chart
 * always travels with it: in Excel the chart is a native one bound to that
 * sheet's cells; in the PDF the table is printed after the charts.
 */

/**
 * How a column is formatted. `money` and `percent` are numbers (the builders
 * convert the API's money strings); `percent` is already in percentage points
 * (85.3, not 0.853), as every metrics endpoint returns it. `date` is a local
 * `YYYY-MM-DD` string and `datetime` an instant, shown in BUSINESS_TIMEZONE.
 */
export type ReportColumnType =
  | 'text'
  | 'integer'
  | 'decimal'
  | 'money'
  | 'percent'
  | 'date'
  | 'datetime'
  | 'boolean';

export type ReportCellValue = string | number | boolean | Date | null;

export interface ReportColumn {
  key: string;
  header: string;
  type: ReportColumnType;
  /** Excel column width, in characters. */
  width?: number;
  /** False leaves the column out of the PDF, where width is scarce. */
  pdf?: boolean;
}

export interface ReportTable {
  /** Referenced by charts; also the Excel sheet name (31 chars max). */
  key: string;
  title: string;
  columns: ReportColumn[];
  rows: Record<string, ReportCellValue>[];
  /** Shown instead of the table when `rows` is empty. */
  emptyMessage?: string;
}

/**
 * column: vertical bars. bar: horizontal bars, for long category names.
 * line: change over time. doughnut: parts of a whole, single series.
 */
export type ReportChartKind = 'column' | 'bar' | 'line' | 'doughnut';

/** Value-axis format; mirrors the KPI units of the catalog. */
export type ReportValueFormat = 'count' | 'money' | 'percent' | 'days' | 'minutes';

export interface ReportChartSeries {
  /** Column of the source table holding the values. */
  column: string;
  name: string;
  color: string;
}

export interface ReportChart {
  title: string;
  kind: ReportChartKind;
  /** `key` of the table the chart reads from. */
  table: string;
  /** Column of the source table holding the category labels (text). */
  categoryColumn: string;
  series: ReportChartSeries[];
  valueFormat: ReportValueFormat;
  stacked?: boolean;
  /**
   * Plot only the first N rows (the table is already sorted). The Excel range
   * and the PDF drawing both stop there; the table keeps every row.
   */
  maxCategories?: number;
  /** Per-category colors, for a doughnut. */
  categoryColors?: string[];
}

export interface ReportParameter {
  label: string;
  value: string;
}

/** A headline figure, shown as a stat tile on the summary. */
export interface ReportHighlight {
  label: string;
  value: ReportCellValue;
  type: ReportColumnType;
}

export interface ReportDefinition {
  /** File name stem, e.g. `kpis` -> pragma-crm_kpis_2026-09-01_2026-09-30.xlsx */
  key: string;
  title: string;
  description: string;
  period: MetricsPeriod;
  generatedAt: Date;
  /**
   * Name of the admin who downloaded the file (PCRM-159). Optional so the
   * PCRM-162 reports, which never set it, render exactly as before.
   */
  generatedBy?: string;
  /** Filters and thresholds the figures depend on (CLAUDE.md 5.8). */
  parameters: ReportParameter[];
  highlights: ReportHighlight[];
  tables: ReportTable[];
  charts: ReportChart[];
  /** Assumptions and caveats printed at the end of the summary. */
  notes: string[];
  /** Landscape for reports with wide tables. */
  orientation?: 'portrait' | 'landscape';
}

export interface RenderedReport {
  buffer: Buffer;
  filename: string;
  contentType: string;
}
