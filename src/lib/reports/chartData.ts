import {
  ReportChart,
  ReportDefinition,
  ReportTable,
} from '../../domain/types/report.types';
import { formatCell } from './theme';

/** What a chart plots, resolved from its source table. */
export interface ResolvedChartData {
  table: ReportTable;
  /** How many leading rows of the table are plotted. */
  rowCount: number;
  categories: string[];
  /** One array per series; null where the cell has no number. */
  values: (number | null)[][];
}

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Resolves the rows a chart plots. Null when there is nothing to draw (empty
 * table, or every value missing): an empty chart frame says less than the
 * table's "no data" message, so the chart is left out instead.
 *
 * Shared by both renderers so the Excel range and the PDF drawing cover the
 * same rows.
 */
export const resolveChartData = (
  definition: ReportDefinition,
  chart: ReportChart
): ResolvedChartData | null => {
  const table = definition.tables.find((candidate) => candidate.key === chart.table);
  if (!table) {
    throw new Error(`Chart "${chart.title}" points at unknown table "${chart.table}"`);
  }

  const rows = table.rows.slice(0, chart.maxCategories ?? table.rows.length);
  if (rows.length === 0) return null;

  const categoryType =
    table.columns.find((column) => column.key === chart.categoryColumn)?.type ?? 'text';
  const values = chart.series.map((serie) => rows.map((row) => toNumber(row[serie.column])));
  if (values.every((serie) => serie.every((value) => value === null))) return null;

  return {
    table,
    rowCount: rows.length,
    categories: rows.map((row) => formatCell(row[chart.categoryColumn], categoryType)),
    values,
  };
};
