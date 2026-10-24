import { DateTime } from 'luxon';
import { ERP_TIMEZONE } from '../parseErpDate';
import {
  ReportCellValue,
  ReportColumnType,
  ReportValueFormat,
} from '../../domain/types/report.types';

/*
 * Look and number formatting shared by the Excel and PDF renderers, so a
 * figure reads the same in both files.
 */

/**
 * Brand green is PragmaCRM-Web's --primary (RNF-09). Series colors are a
 * fixed order: slot 1 is the brand green, slots 2-3 were checked with the
 * dataviz palette validator (all pairs pass the colorblind separation gate).
 * Amber is below 3:1 against white, which is why every chart ships next to
 * its data table.
 */
export const REPORT_COLORS = {
  brand: '#008000',
  brandDeep: '#0f3d1c',
  brandPale: '#e8f5e9',
  series: ['#008000', '#2a78d6', '#eda100'] as const,
  /** The previous period, deliberately recessive next to the current one. */
  previous: '#b5b3ab',
  inkPrimary: '#0b0b0b',
  inkSecondary: '#52514e',
  inkMuted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  surface: '#ffffff',
} as const;

/** Excel number formats per column type. */
export const XLSX_NUMBER_FORMATS: Partial<Record<ReportColumnType, string>> = {
  integer: '#,##0',
  decimal: '#,##0.0',
  money: '"$"#,##0.00',
  percent: '0.0"%"',
  date: 'dd/mm/yyyy',
  datetime: 'dd/mm/yyyy hh:mm',
};

export const XLSX_VALUE_FORMATS: Record<ReportValueFormat, string> = {
  count: '#,##0',
  money: '"$"#,##0',
  percent: '0"%"',
  days: '#,##0',
  minutes: '#,##0',
};

const number = (value: number, decimals: number) =>
  value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

/** A `YYYY-MM-DD` local day as dd/mm/yyyy. */
export const formatLocalDay = (day: string): string => {
  const [year, month, date] = day.split('-');
  return `${date}/${month}/${year}`;
};

/** An instant as wall-clock time in El Salvador (CLAUDE.md 5.7). */
export const toBusinessDateTime = (instant: Date): DateTime =>
  DateTime.fromJSDate(instant).setZone(ERP_TIMEZONE);

/**
 * Excel stores dates without a zone and exceljs serialises a Date by its UTC
 * fields, so the local wall-clock time is re-expressed as if it were UTC.
 * Without this, a visit at 7 p.m. would show up at 1 a.m. the next day.
 */
export const toExcelDate = (value: string | Date, type: 'date' | 'datetime'): Date => {
  if (type === 'date' && typeof value === 'string') {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }
  const local = toBusinessDateTime(value as Date);
  return new Date(
    Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second)
  );
};

/** Text form of a cell, for the PDF and the chart labels. */
export const formatCell = (value: ReportCellValue, type: ReportColumnType): string => {
  if (value === null || value === undefined || value === '') return '—';

  switch (type) {
    case 'integer':
      return number(Number(value), 0);
    case 'decimal':
      return number(Number(value), 1);
    case 'money':
      return `$${number(Number(value), 2)}`;
    case 'percent':
      return `${number(Number(value), 1)}%`;
    case 'boolean':
      return value ? 'Sí' : 'No';
    case 'date':
      return typeof value === 'string'
        ? formatLocalDay(value)
        : toBusinessDateTime(value as Date).toFormat('dd/MM/yyyy');
    case 'datetime':
      return toBusinessDateTime(
        value instanceof Date ? value : new Date(String(value))
      ).toFormat('dd/MM/yyyy HH:mm');
    default:
      return String(value);
  }
};

/** Axis tick label; compact so it fits next to the plot. */
export const formatAxisValue = (value: number, format: ReportValueFormat): string => {
  const compact =
    Math.abs(value) >= 1_000_000
      ? `${number(value / 1_000_000, 1)}M`
      : Math.abs(value) >= 10_000
        ? `${number(value / 1_000, 0)}k`
        : number(value, Number.isInteger(value) ? 0 : 1);

  switch (format) {
    case 'money':
      return `$${compact}`;
    case 'percent':
      return `${compact}%`;
    default:
      return compact;
  }
};

/** Data label on a mark: full precision for money, one decimal for rates. */
export const formatValueLabel = (value: number, format: ReportValueFormat): string => {
  switch (format) {
    case 'money':
      return `$${number(value, 2)}`;
    case 'percent':
      return `${number(value, 1)}%`;
    case 'count':
      return number(value, 0);
    default:
      return number(value, Number.isInteger(value) ? 0 : 1);
  }
};
