import { MetricsTrendsResponse, TrendPoint } from '../../domain/types/metrics.types';
import {
  ReportCellValue,
  ReportColumn,
  ReportDefinition,
} from '../../domain/types/report.types';
import { REPORT_COLORS } from '../../lib/reports/theme';
import { SALES_NOTE, TIMEZONE_NOTE, money } from './common';

/*
 * Report of GET /metrics/trends (charts of 1e and the Home chart). The
 * columns are shared with the seller detail report, whose weekly trend has
 * the same shape.
 */

export const TREND_COLUMNS: ReportColumn[] = [
  { key: 'bucket_start', header: 'Inicio', type: 'date', width: 13 },
  { key: 'stops', header: 'Paradas', type: 'integer', width: 11 },
  { key: 'orders_count', header: 'Pedidos', type: 'integer', width: 11 },
  { key: 'total_sales', header: 'Venta total', type: 'money', width: 16 },
  { key: 'average_ticket', header: 'Ticket promedio', type: 'money', width: 16 },
];

export const trendRow = (point: TrendPoint): Record<string, ReportCellValue> => ({
  bucket_start: point.bucket_start,
  stops: point.stops,
  orders_count: point.orders_count,
  total_sales: money(point.total_sales),
  average_ticket: money(point.average_ticket),
});

const TABLE = 'Tendencia';

const GRANULARITY_LABELS = { week: 'Semanal', month: 'Mensual' } as const;

export const buildTrendsReport = (
  data: MetricsTrendsResponse,
  generatedAt: Date
): ReportDefinition => {
  const unit = data.granularity === 'week' ? 'semana' : 'mes';
  const totalSales = data.points.reduce((sum, point) => sum + Number(point.total_sales), 0);
  const totalOrders = data.points.reduce((sum, point) => sum + point.orders_count, 0);

  return {
    key: `tendencias_${data.granularity === 'week' ? 'semanal' : 'mensual'}`,
    title: 'Reporte de tendencias',
    description: `Paradas, pedidos, venta y ticket promedio por ${unit} en el periodo seleccionado.`,
    period: data.period,
    generatedAt,
    parameters: [{ label: 'Agrupación', value: GRANULARITY_LABELS[data.granularity] }],
    highlights: [
      { label: 'Venta total', value: totalSales, type: 'money' },
      { label: 'Pedidos', value: totalOrders, type: 'integer' },
      {
        label: 'Ticket promedio',
        value: totalOrders > 0 ? Math.round((totalSales / totalOrders) * 100) / 100 : null,
        type: 'money',
      },
      {
        label: 'Paradas ejecutadas',
        value: data.points.reduce((sum, point) => sum + point.stops, 0),
        type: 'integer',
      },
    ],
    tables: [
      {
        key: TABLE,
        title: `Tendencia ${GRANULARITY_LABELS[data.granularity].toLowerCase()}`,
        columns: TREND_COLUMNS,
        rows: data.points.map(trendRow),
        emptyMessage: 'Sin actividad en el periodo.',
      },
    ],
    charts: [
      {
        title: `Venta por ${unit}`,
        kind: 'column',
        table: TABLE,
        categoryColumn: 'bucket_start',
        series: [{ column: 'total_sales', name: 'Venta total', color: REPORT_COLORS.brand }],
        valueFormat: 'money',
      },
      {
        title: `Paradas y pedidos por ${unit}`,
        kind: 'line',
        table: TABLE,
        categoryColumn: 'bucket_start',
        series: [
          { column: 'stops', name: 'Paradas', color: REPORT_COLORS.series[0] },
          { column: 'orders_count', name: 'Pedidos', color: REPORT_COLORS.series[1] },
        ],
        valueFormat: 'count',
      },
      {
        title: `Ticket promedio por ${unit}`,
        kind: 'line',
        table: TABLE,
        categoryColumn: 'bucket_start',
        series: [{ column: 'average_ticket', name: 'Ticket promedio', color: REPORT_COLORS.series[2] }],
        valueFormat: 'money',
      },
    ],
    notes: [
      `Cada fila es un${data.granularity === 'week' ? 'a semana (de lunes a domingo)' : ' mes calendario'} identificado por su primer día; el primero y el último pueden extenderse fuera del periodo, pero solo cuentan la actividad dentro de él.`,
      'El ticket promedio del encabezado es la venta total entre los pedidos del periodo, no el promedio de los tickets de cada fila.',
      SALES_NOTE,
      TIMEZONE_NOTE,
    ],
  };
};
