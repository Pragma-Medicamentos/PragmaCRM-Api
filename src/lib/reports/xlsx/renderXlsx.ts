import ExcelJS from 'exceljs';
import {
  ReportCellValue,
  ReportColumnType,
  ReportDefinition,
  ReportTable,
} from '../../../domain/types/report.types';
import { BRAND_LOGO_HEIGHT, BRAND_LOGO_PNG_BASE64, BRAND_LOGO_WIDTH } from '../brandLogo';
import { resolveChartData } from '../chartData';
import {
  REPORT_COLORS,
  XLSX_NUMBER_FORMATS,
  formatCell,
  formatLocalDay,
  toBusinessDateTime,
  toExcelDate,
} from '../theme';
import { ChartAnchor, ChartBinding } from './chartXml';
import { ChartSheetPlan, injectCharts } from './injectCharts';

/*
 * Writes a ReportDefinition as .xlsx:
 *
 *   Resumen    logo, title, period, parameters, headline figures and notes
 *   Gráficas   native Excel charts, each bound to the cells of a data sheet
 *   <tables>   one sheet per table: the data behind every figure and chart
 *
 * Cells hold real numbers and dates with a number format, never preformatted
 * text, so the client can keep working with them (sum, filter, pivot).
 */

const SUMMARY_SHEET = 'Resumen';
const CHARTS_SHEET = 'Gráficas';

/** Rows and columns one chart takes on the charts sheet. */
const CHART_ROWS = 20;
const CHART_COLS = 10;
const CHART_GAP_ROWS = 2;

const argb = (color: string) => `FF${color.replace('#', '').toUpperCase()}`;

/** Excel forbids []:*?/\ in sheet names and caps them at 31 characters. */
const sheetNameFor = (title: string, used: Set<string>): string => {
  const base = title.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Datos';
  let name = base;
  let suffix = 2;
  while (used.has(name.toLowerCase())) {
    const tag = ` (${suffix})`;
    name = base.slice(0, 31 - tag.length) + tag;
    suffix += 1;
  }
  used.add(name.toLowerCase());
  return name;
};

const toCellValue = (value: ReportCellValue, type: ReportColumnType): ExcelJS.CellValue => {
  if (value === null || value === undefined || value === '') return null;
  switch (type) {
    case 'integer':
    case 'decimal':
    case 'money':
    case 'percent': {
      const parsed = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    case 'date':
    case 'datetime':
      return toExcelDate(value as string | Date, type);
    case 'boolean':
      return value ? 'Sí' : 'No';
    default:
      return String(value);
  }
};

const styleHeaderRow = (row: ExcelJS.Row) => {
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: argb(REPORT_COLORS.surface) } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(REPORT_COLORS.brand) } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
};

const writeTableSheet = (workbook: ExcelJS.Workbook, sheetName: string, table: ReportTable) => {
  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = table.columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width ?? Math.max(12, column.header.length + 4),
    style: XLSX_NUMBER_FORMATS[column.type]
      ? { numFmt: XLSX_NUMBER_FORMATS[column.type] }
      : undefined,
  }));
  styleHeaderRow(sheet.getRow(1));

  if (table.rows.length === 0) {
    sheet.getCell('A2').value = table.emptyMessage ?? 'Sin datos para el periodo seleccionado.';
    sheet.getCell('A2').font = { italic: true, color: { argb: argb(REPORT_COLORS.inkSecondary) } };
    return;
  }

  table.rows.forEach((row, index) => {
    const values: Record<string, ExcelJS.CellValue> = {};
    for (const column of table.columns) {
      values[column.key] = toCellValue(row[column.key], column.type);
    }
    const added = sheet.addRow(values);
    if (index % 2 === 1) {
      added.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: argb(REPORT_COLORS.brandPale) },
        };
      });
    }
  });

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: table.columns.length },
  };
};

const writeSummarySheet = (
  workbook: ExcelJS.Workbook,
  definition: ReportDefinition,
  tableSheets: { title: string; sheetName: string }[],
  hasCharts: boolean
) => {
  const sheet = workbook.addWorksheet(SUMMARY_SHEET, {
    views: [{ showGridLines: false }],
  });
  sheet.columns = [{ width: 3 }, { width: 38 }, { width: 42 }];

  const logo = workbook.addImage({ base64: BRAND_LOGO_PNG_BASE64, extension: 'png' });
  const logoHeight = 60;
  sheet.addImage(logo, {
    tl: { col: 1, row: 0.3 },
    ext: { width: (BRAND_LOGO_WIDTH / BRAND_LOGO_HEIGHT) * logoHeight, height: logoHeight },
  });

  let rowNumber = 5;
  const put = (label: string, value: ExcelJS.CellValue, numFmt?: string) => {
    sheet.getCell(rowNumber, 2).value = label;
    sheet.getCell(rowNumber, 2).font = { color: { argb: argb(REPORT_COLORS.inkSecondary) } };
    const cell = sheet.getCell(rowNumber, 3);
    cell.value = value;
    cell.alignment = { horizontal: 'left' };
    if (numFmt) cell.numFmt = numFmt;
    rowNumber += 1;
  };
  const heading = (text: string) => {
    rowNumber += 1;
    const cell = sheet.getCell(rowNumber, 2);
    cell.value = text;
    cell.font = { bold: true, size: 12, color: { argb: argb(REPORT_COLORS.brand) } };
    sheet.getCell(rowNumber, 2).border = {
      bottom: { style: 'thin', color: { argb: argb(REPORT_COLORS.brand) } },
    };
    sheet.getCell(rowNumber, 3).border = {
      bottom: { style: 'thin', color: { argb: argb(REPORT_COLORS.brand) } },
    };
    rowNumber += 1;
  };

  const titleCell = sheet.getCell(rowNumber, 2);
  titleCell.value = definition.title;
  titleCell.font = { bold: true, size: 18, color: { argb: argb(REPORT_COLORS.brandDeep) } };
  rowNumber += 1;
  sheet.getCell(rowNumber, 2).value = definition.description;
  sheet.getCell(rowNumber, 2).font = { color: { argb: argb(REPORT_COLORS.inkSecondary) } };
  sheet.mergeCells(rowNumber, 2, rowNumber, 3);
  sheet.getCell(rowNumber, 2).alignment = { wrapText: true, vertical: 'top' };
  sheet.getRow(rowNumber).height = 30;
  rowNumber += 1;

  heading('Periodo');
  put(
    'Desde – hasta',
    `${formatLocalDay(definition.period.from)} – ${formatLocalDay(definition.period.to)}`
  );
  put('Generado', toBusinessDateTime(definition.generatedAt).toFormat('dd/MM/yyyy HH:mm'));
  if (definition.generatedBy) put('Generado por', definition.generatedBy);

  if (definition.parameters.length > 0) {
    heading('Parámetros');
    definition.parameters.forEach((parameter) => put(parameter.label, parameter.value));
  }

  if (definition.highlights.length > 0) {
    heading('Indicadores clave');
    definition.highlights.forEach((highlight) => {
      const value = toCellValue(highlight.value, highlight.type);
      put(
        highlight.label,
        value ?? formatCell(null, highlight.type),
        XLSX_NUMBER_FORMATS[highlight.type]
      );
      sheet.getCell(rowNumber - 1, 3).font = { bold: true };
    });
  }

  heading('Contenido');
  if (hasCharts) put(CHARTS_SHEET, 'Gráficas del reporte, ligadas a las hojas de datos');
  tableSheets.forEach(({ title, sheetName }) => put(sheetName, title));

  if (definition.notes.length > 0) {
    heading('Notas');
    definition.notes.forEach((note) => {
      sheet.getCell(rowNumber, 2).value = `• ${note}`;
      sheet.mergeCells(rowNumber, 2, rowNumber, 3);
      sheet.getCell(rowNumber, 2).alignment = { wrapText: true, vertical: 'top' };
      sheet.getCell(rowNumber, 2).font = { color: { argb: argb(REPORT_COLORS.inkSecondary) } };
      sheet.getRow(rowNumber).height = Math.max(15, Math.ceil(note.length / 85) * 15);
      rowNumber += 1;
    });
  }
};

export const renderXlsx = async (definition: ReportDefinition): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Pragma CRM';
  workbook.created = definition.generatedAt;
  workbook.title = definition.title;

  const usedNames = new Set([SUMMARY_SHEET.toLowerCase(), CHARTS_SHEET.toLowerCase()]);
  const tableSheets = definition.tables.map((table) => ({
    table,
    title: table.title,
    sheetName: sheetNameFor(table.key, usedNames),
  }));

  const charts = definition.charts
    .map((chart) => ({ chart, data: resolveChartData(definition, chart) }))
    .filter((entry) => entry.data !== null);

  writeSummarySheet(workbook, definition, tableSheets, charts.length > 0);

  let chartPlan: ChartSheetPlan | null = null;
  if (charts.length > 0) {
    const chartSheet = workbook.addWorksheet(CHARTS_SHEET, {
      views: [{ showGridLines: false }],
    });
    chartSheet.getCell('B1').value = `${definition.title} — gráficas`;
    chartSheet.getCell('B1').font = {
      bold: true,
      size: 14,
      color: { argb: argb(REPORT_COLORS.brandDeep) },
    };

    const anchors: ChartAnchor[] = [];
    const bindings: ChartBinding[] = [];
    charts.forEach(({ chart, data }, index) => {
      const resolved = data!;
      const sheet = tableSheets.find((entry) => entry.table.key === chart.table)!;
      const columnOf = (key: string) =>
        resolved.table.columns.findIndex((column) => column.key === key) + 1;

      const fromRow = 2 + index * (CHART_ROWS + CHART_GAP_ROWS);
      anchors.push({ fromCol: 1, fromRow, toCol: 1 + CHART_COLS, toRow: fromRow + CHART_ROWS });
      bindings.push({
        sheetName: sheet.sheetName,
        firstRow: 2,
        lastRow: 1 + resolved.rowCount,
        categoryColumn: columnOf(chart.categoryColumn),
        seriesColumns: chart.series.map((serie) => columnOf(serie.column)),
        categories: resolved.categories,
        values: resolved.values,
      });
    });

    chartPlan = {
      sheetName: CHARTS_SHEET,
      charts: charts.map((entry) => entry.chart),
      anchors,
      bindings,
    };
  }

  tableSheets.forEach(({ table, sheetName }) => writeTableSheet(workbook, sheetName, table));

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return chartPlan ? injectCharts(buffer, [chartPlan]) : buffer;
};
