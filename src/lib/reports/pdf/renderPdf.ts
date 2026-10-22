import pdfmake from 'pdfmake';
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import {
  ReportColumn,
  ReportDefinition,
  ReportTable,
} from '../../../domain/types/report.types';
import { BRAND_LOGO_HEIGHT, BRAND_LOGO_PNG_BASE64, BRAND_LOGO_WIDTH } from '../brandLogo';
import { resolveChartData } from '../chartData';
import { REPORT_COLORS, formatCell, formatLocalDay, toBusinessDateTime } from '../theme';
import { chartHeightFor, renderChartSvg } from './svgChart';

/*
 * Writes a ReportDefinition as PDF: header with the Pragma logo, period and
 * parameters, headline figures as tiles, the charts (vector SVG) and the data
 * tables behind them.
 *
 * Uses the 14 standard PDF fonts, so nothing is read from disk and the
 * Docker image needs no font files. Helvetica's WinAnsi encoding covers
 * Spanish (á, ñ, ¿, ¡).
 */

const STANDARD_FONTS = {
  normal: 'Helvetica',
  bold: 'Helvetica-Bold',
  italics: 'Helvetica-Oblique',
  bolditalics: 'Helvetica-BoldOblique',
};
pdfmake.setFonts({ Helvetica: STANDARD_FONTS });
// Report content is built by the API, never by the caller, but nothing in it
// needs a URL or a file: deny both so a stray reference cannot fetch one. The
// standard font names do go through the local policy (pdfkit resolves them
// internally, no disk read), so exactly those are let through.
const ALLOWED_LOCAL = new Set<string>(Object.values(STANDARD_FONTS));
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((path: string) => ALLOWED_LOCAL.has(path));

const PAGE_MARGIN = 36;
const PAGE_WIDTH = { portrait: 595.28, landscape: 841.89 } as const;

const NUMERIC_TYPES = new Set(['integer', 'decimal', 'money', 'percent']);

const header = (definition: ReportDefinition): Content => {
  const logoHeight = 34;
  return {
    columns: [
      {
        image: `data:image/png;base64,${BRAND_LOGO_PNG_BASE64}`,
        width: (BRAND_LOGO_WIDTH / BRAND_LOGO_HEIGHT) * logoHeight,
      },
      {
        width: '*',
        alignment: 'right',
        stack: [
          { text: definition.title, style: 'title' },
          {
            text: `Periodo: ${formatLocalDay(definition.period.from)} – ${formatLocalDay(
              definition.period.to
            )}`,
            style: 'muted',
          },
          {
            text: `Generado: ${toBusinessDateTime(definition.generatedAt).toFormat(
              'dd/MM/yyyy HH:mm'
            )}`,
            style: 'muted',
          },
          ...(definition.generatedBy
            ? [{ text: `Generado por: ${definition.generatedBy}`, style: 'muted' }]
            : []),
        ],
      },
    ],
    margin: [0, 0, 0, 6],
  };
};

const rule = (width: number): Content => ({
  canvas: [
    { type: 'line', x1: 0, y1: 0, x2: width, y2: 0, lineWidth: 1.5, lineColor: REPORT_COLORS.brand },
  ],
  margin: [0, 0, 0, 10],
});

const sectionTitle = (text: string): Content => ({ text, style: 'section' });

const parameters = (definition: ReportDefinition): Content[] => {
  if (definition.parameters.length === 0) return [];
  return [
    {
      text: definition.parameters.flatMap((parameter, i) => [
        { text: `${parameter.label}: `, color: REPORT_COLORS.inkMuted },
        { text: parameter.value, color: REPORT_COLORS.inkSecondary },
        ...(i < definition.parameters.length - 1 ? [{ text: '   ·   ', color: REPORT_COLORS.axis }] : []),
      ]),
      fontSize: 8,
      margin: [0, 0, 0, 10],
    },
  ];
};

/** Headline figures as tiles, four per row. */
const highlights = (definition: ReportDefinition, contentWidth: number): Content[] => {
  if (definition.highlights.length === 0) return [];
  const perRow = contentWidth > 600 ? 5 : 4;
  const rows: TableCell[][] = [];
  for (let i = 0; i < definition.highlights.length; i += perRow) {
    const slice = definition.highlights.slice(i, i + perRow);
    const cells: TableCell[] = slice.map((highlight) => ({
      stack: [
        { text: highlight.label, fontSize: 7.5, color: REPORT_COLORS.inkSecondary },
        {
          text: formatCell(highlight.value, highlight.type),
          fontSize: 14,
          bold: true,
          color: REPORT_COLORS.inkPrimary,
          margin: [0, 3, 0, 0],
        },
      ],
      fillColor: REPORT_COLORS.brandPale,
      margin: [6, 6, 6, 6],
    }));
    while (cells.length < perRow) cells.push({ text: '' });
    rows.push(cells);
  }

  return [
    sectionTitle('Indicadores clave'),
    {
      table: { widths: Array(perRow).fill('*'), body: rows },
      layout: {
        hLineWidth: () => 4,
        vLineWidth: () => 4,
        hLineColor: () => REPORT_COLORS.surface,
        vLineColor: () => REPORT_COLORS.surface,
        paddingLeft: () => 0,
        paddingRight: () => 0,
        paddingTop: () => 0,
        paddingBottom: () => 0,
      },
      margin: [-4, 0, -4, 8],
    },
  ];
};

const charts = (definition: ReportDefinition, contentWidth: number): Content[] => {
  const drawn = definition.charts
    .map((chart) => ({ chart, data: resolveChartData(definition, chart) }))
    .filter((entry) => entry.data !== null);
  if (drawn.length === 0) return [];

  return [
    sectionTitle('Gráficas'),
    ...drawn.map(
      ({ chart, data }): Content => ({
        stack: [
          { text: chart.title, style: 'chartTitle' },
          ...(chart.maxCategories && data!.table.rows.length > chart.maxCategories
            ? [
                {
                  text: `Primeros ${chart.maxCategories} de ${data!.table.rows.length}; la tabla incluye todos.`,
                  style: 'muted',
                } as Content,
              ]
            : []),
          {
            svg: renderChartSvg(chart, data!, contentWidth, chartHeightFor(chart, data!)),
            margin: [0, 4, 0, 0],
          },
        ],
        unbreakable: true,
        margin: [0, 0, 0, 14],
      })
    ),
  ];
};

const cellAlignment = (column: ReportColumn) =>
  NUMERIC_TYPES.has(column.type) ? 'right' : 'left';

const dataTable = (table: ReportTable): Content[] => {
  const columns = table.columns.filter((column) => column.pdf !== false);
  const title: Content = { text: table.title, style: 'chartTitle', margin: [0, 4, 0, 4] };

  if (table.rows.length === 0) {
    return [
      title,
      {
        text: table.emptyMessage ?? 'Sin datos para el periodo seleccionado.',
        style: 'muted',
        italics: true,
        margin: [0, 0, 0, 12],
      },
    ];
  }

  const head: TableCell[] = columns.map((column) => ({
    text: column.header,
    style: 'tableHeader',
    alignment: cellAlignment(column),
  }));
  const body: TableCell[][] = table.rows.map((row) =>
    columns.map((column) => ({
      text: formatCell(row[column.key], column.type),
      alignment: cellAlignment(column),
    }))
  );

  return [
    title,
    {
      table: {
        headerRows: 1,
        // Text columns stretch, numbers take their natural width.
        widths: columns.map((column) => (NUMERIC_TYPES.has(column.type) ? 'auto' : '*')),
        body: [head, ...body],
      },
      layout: {
        hLineWidth: (i: number) => (i === 1 ? 1 : 0.5),
        vLineWidth: () => 0,
        hLineColor: (i: number) => (i === 1 ? REPORT_COLORS.brand : REPORT_COLORS.grid),
        fillColor: (rowIndex: number) =>
          rowIndex === 0 ? REPORT_COLORS.brand : rowIndex % 2 === 0 ? REPORT_COLORS.brandPale : null,
        paddingTop: () => 3,
        paddingBottom: () => 3,
      },
      fontSize: 7.5,
      margin: [0, 0, 0, 14],
    },
  ];
};

const notes = (definition: ReportDefinition): Content[] =>
  definition.notes.length === 0
    ? []
    : [
        sectionTitle('Notas'),
        { ul: definition.notes, fontSize: 8, color: REPORT_COLORS.inkSecondary, margin: [0, 0, 0, 8] },
      ];

export const buildPdfDefinition = (definition: ReportDefinition): TDocumentDefinitions => {
  const orientation = definition.orientation ?? 'portrait';
  const contentWidth = PAGE_WIDTH[orientation] - PAGE_MARGIN * 2;

  return {
    pageSize: 'A4',
    pageOrientation: orientation,
    pageMargins: [PAGE_MARGIN, PAGE_MARGIN, PAGE_MARGIN, 40],
    info: { title: definition.title, author: 'Pragma CRM', creator: 'Pragma CRM' },
    defaultStyle: { font: 'Helvetica', fontSize: 9, color: REPORT_COLORS.inkPrimary },
    styles: {
      title: { fontSize: 16, bold: true, color: REPORT_COLORS.brandDeep },
      section: { fontSize: 11, bold: true, color: REPORT_COLORS.brand, margin: [0, 6, 0, 6] },
      chartTitle: { fontSize: 9.5, bold: true, color: REPORT_COLORS.inkPrimary },
      muted: { fontSize: 8, color: REPORT_COLORS.inkSecondary },
      tableHeader: { bold: true, color: REPORT_COLORS.surface },
    },
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: `Pragma CRM · ${definition.title}`, color: REPORT_COLORS.inkMuted },
        { text: `Página ${currentPage} de ${pageCount}`, alignment: 'right', color: REPORT_COLORS.inkMuted },
      ],
      fontSize: 7.5,
      margin: [PAGE_MARGIN, 14, PAGE_MARGIN, 0],
    }),
    content: [
      header(definition),
      rule(contentWidth),
      { text: definition.description, style: 'muted', margin: [0, 0, 0, 6] },
      ...parameters(definition),
      ...highlights(definition, contentWidth),
      ...charts(definition, contentWidth),
      ...(definition.tables.length > 0 ? [sectionTitle('Datos utilizados')] : []),
      ...definition.tables.flatMap(dataTable),
      ...notes(definition),
    ],
  };
};

export const renderPdf = async (definition: ReportDefinition): Promise<Buffer> =>
  pdfmake.createPdf(buildPdfDefinition(definition)).getBuffer();
