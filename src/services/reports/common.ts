import { ReportFormat } from '../../domain/schemas/report.schema';
import { MetricsThresholds } from '../../domain/types/metrics.types';
import {
  RenderedReport,
  ReportColumn,
  ReportDefinition,
  ReportParameter,
} from '../../domain/types/report.types';
import { renderPdf } from '../../lib/reports/pdf/renderPdf';
import { renderXlsx } from '../../lib/reports/xlsx/renderXlsx';

/*
 * Helpers shared by the report builders. Report content (titles, headers,
 * notes) is in Spanish on purpose: the file itself is what the client reads,
 * so unlike an ApiResponse message there is no frontend to translate it.
 */

const CONTENT_TYPES: Record<ReportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/** The API's money strings as numbers; null stays null. */
export const money = (value: string | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value);

/** Percentage change from `previous` to `current`; null when not computable. */
export const changePercent = (
  current: number | null,
  previous: number | null
): number | null => {
  if (current === null || previous === null || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
};

const THRESHOLD_PARAMETERS: Record<keyof MetricsThresholds, (value: number) => ReportParameter> = {
  inactivity_days: (value) => ({ label: 'Umbral de inactividad', value: `${value} días` }),
  credit_term_days: (value) => ({ label: 'Plazo de crédito', value: `${value} días` }),
  gps_radius_meters: (value) => ({ label: 'Radio de validación GPS', value: `${value} m` }),
};

/** The thresholds a report depends on, as parameters (CLAUDE.md 5.8). */
export const thresholdParameters = (
  thresholds: MetricsThresholds,
  keys: (keyof MetricsThresholds)[]
): ReportParameter[] => keys.map((key) => THRESHOLD_PARAMETERS[key](thresholds[key]));

export const TIMEZONE_NOTE =
  'Fechas y horas en hora de El Salvador (America/El_Salvador). Los días del periodo son días locales.';

export const SALES_NOTE =
  'Las ventas solo incluyen documentos con estado 2 (venta realizada) en Efactsoft, fechadas por su fecha de emisión; las cotizaciones quedan fuera.';

/** Stops split by the mandatory classification (CLAUDE.md 5.2). */
export const STOP_TYPE_LABELS = {
  visit: 'Visita',
  dispatch: 'Despacho',
  collection: 'Cobro',
} as const;

/** Columns of a seller's performance row, shared by both seller reports. */
export const SELLER_COLUMNS: ReportColumn[] = [
  { key: 'name', header: 'Vendedor', type: 'text', width: 28 },
  { key: 'active', header: 'Activo', type: 'boolean', width: 9, pdf: false },
  { key: 'stops_executed', header: 'Paradas', type: 'integer', width: 10 },
  { key: 'stops_visit', header: 'Visitas', type: 'integer', width: 10 },
  { key: 'stops_dispatch', header: 'Despachos', type: 'integer', width: 11 },
  { key: 'stops_collection', header: 'Cobros', type: 'integer', width: 10 },
  { key: 'visited_customers', header: 'Clientes visitados', type: 'integer', width: 12 },
  { key: 'orders_count', header: 'Pedidos', type: 'integer', width: 10 },
  { key: 'total_sales', header: 'Venta total', type: 'money', width: 15 },
  { key: 'average_ticket', header: 'Ticket promedio', type: 'money', width: 14 },
  { key: 'goal_amount', header: 'Meta', type: 'money', width: 14 },
  { key: 'goal_compliance', header: 'Cumplimiento', type: 'percent', width: 13 },
  { key: 'route_sales', header: 'Venta en ruta', type: 'money', width: 15, pdf: false },
  { key: 'executed_route_days', header: 'Rutas-día', type: 'integer', width: 10, pdf: false },
  { key: 'sales_per_route', header: 'Venta por ruta-día', type: 'money', width: 15 },
  {
    key: 'dispatches_for_others',
    header: 'Despachos de otros',
    type: 'integer',
    width: 12,
    pdf: false,
  },
  { key: 'portfolio_customers', header: 'Cartera asignada', type: 'integer', width: 12 },
];

/** `pragma-crm_kpis_2026-09-01_2026-09-30.xlsx` */
export const reportFilename = (definition: ReportDefinition, format: ReportFormat): string =>
  `pragma-crm_${definition.key}_${definition.period.from}_${definition.period.to}.${format}`;

export const renderReport = async (
  definition: ReportDefinition,
  format: ReportFormat
): Promise<RenderedReport> => ({
  buffer: format === 'pdf' ? await renderPdf(definition) : await renderXlsx(definition),
  filename: reportFilename(definition, format),
  contentType: CONTENT_TYPES[format],
});
