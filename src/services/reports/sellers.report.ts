import {
  MetricsSellerDetailResponse,
  MetricsSellersResponse,
  SellerPerformance,
  TrendPoint,
} from '../../domain/types/metrics.types';
import { ReportCellValue, ReportDefinition } from '../../domain/types/report.types';
import { REPORT_COLORS } from '../../lib/reports/theme';
import {
  SALES_NOTE,
  SELLER_COLUMNS,
  STOP_TYPE_LABELS,
  TIMEZONE_NOTE,
  money,
  thresholdParameters,
} from './common';
import { TREND_COLUMNS, trendRow } from './trends.report';

/*
 * Reports of GET /metrics/sellers (team table, 1d / 1f) and
 * GET /metrics/sellers/:id (expanded row of 1f).
 */

const SELLERS_TABLE = 'Desempeño por vendedor';

const sellerRow = (seller: SellerPerformance): Record<string, ReportCellValue> => ({
  name: seller.name,
  active: seller.active,
  stops_executed: seller.stops_executed,
  stops_visit: seller.stops_by_type.visit,
  stops_dispatch: seller.stops_by_type.dispatch,
  stops_collection: seller.stops_by_type.collection,
  visited_customers: seller.visited_customers,
  orders_count: seller.orders_count,
  total_sales: money(seller.total_sales),
  average_ticket: money(seller.average_ticket),
  goal_amount: money(seller.goal_amount),
  goal_compliance: seller.goal_compliance,
  route_sales: money(seller.route_sales),
  executed_route_days: seller.executed_route_days,
  sales_per_route: money(seller.sales_per_route),
  dispatches_for_others: seller.dispatches_for_others,
  portfolio_customers: seller.portfolio_customers,
});

const SELLER_NOTES = [
  'Cumplimiento de meta = venta del periodo entre la suma de las metas mensuales de los meses que toca el rango. Vacío si el vendedor no tiene meta.',
  'Venta por ruta-día = venta ligada a una visita en ruta entre las rutas-día con al menos una visita. Una venta sin visita asociada no se atribuye a ninguna ruta.',
  'Despachos de otros: despachos que el vendedor ejecutó sobre ventas de otro vendedor.',
  SALES_NOTE,
  TIMEZONE_NOTE,
];

export const buildSellersReport = (
  data: MetricsSellersResponse,
  generatedAt: Date
): ReportDefinition => {
  // Sorted by sales so the bar charts read as a ranking.
  const sellers = [...data.sellers].sort(
    (a, b) => Number(b.total_sales) - Number(a.total_sales) || a.name.localeCompare(b.name)
  );
  const totalSales = sellers.reduce((sum, seller) => sum + Number(seller.total_sales), 0);
  const totalOrders = sellers.reduce((sum, seller) => sum + seller.orders_count, 0);

  return {
    key: 'vendedores',
    title: 'Reporte de desempeño por vendedor',
    description:
      'Paradas ejecutadas, ventas, ticket promedio y cumplimiento de meta de cada vendedor en el periodo seleccionado.',
    period: data.period,
    generatedAt,
    parameters: thresholdParameters(data.thresholds, ['inactivity_days']),
    highlights: [
      { label: 'Vendedores', value: sellers.length, type: 'integer' },
      { label: 'Venta total del equipo', value: totalSales, type: 'money' },
      { label: 'Pedidos', value: totalOrders, type: 'integer' },
      {
        label: 'Paradas ejecutadas',
        value: sellers.reduce((sum, seller) => sum + seller.stops_executed, 0),
        type: 'integer',
      },
      {
        label: 'Ticket promedio del equipo',
        value: totalOrders > 0 ? Math.round((totalSales / totalOrders) * 100) / 100 : null,
        type: 'money',
      },
    ],
    tables: [
      {
        key: SELLERS_TABLE,
        title: SELLERS_TABLE,
        columns: SELLER_COLUMNS,
        rows: sellers.map(sellerRow),
        emptyMessage: 'No hay vendedores registrados.',
      },
    ],
    charts: [
      {
        title: 'Venta total por vendedor',
        kind: 'bar',
        table: SELLERS_TABLE,
        categoryColumn: 'name',
        series: [{ column: 'total_sales', name: 'Venta total', color: REPORT_COLORS.brand }],
        valueFormat: 'money',
      },
      {
        title: 'Cumplimiento de meta por vendedor',
        kind: 'bar',
        table: SELLERS_TABLE,
        categoryColumn: 'name',
        series: [{ column: 'goal_compliance', name: 'Cumplimiento', color: REPORT_COLORS.series[1] }],
        valueFormat: 'percent',
      },
      {
        title: 'Paradas por tipo y vendedor',
        kind: 'bar',
        table: SELLERS_TABLE,
        categoryColumn: 'name',
        stacked: true,
        series: [
          { column: 'stops_visit', name: STOP_TYPE_LABELS.visit, color: REPORT_COLORS.series[0] },
          { column: 'stops_dispatch', name: STOP_TYPE_LABELS.dispatch, color: REPORT_COLORS.series[1] },
          { column: 'stops_collection', name: STOP_TYPE_LABELS.collection, color: REPORT_COLORS.series[2] },
        ],
        valueFormat: 'count',
      },
    ],
    notes: SELLER_NOTES,
    orientation: 'landscape',
  };
};

const WEEKLY_TABLE = 'Tendencia semanal';
const STOPS_TABLE = 'Paradas por tipo';
const INACTIVE_TABLE = 'Clientes sin visita';

export const buildSellerDetailReport = (
  data: MetricsSellerDetailResponse,
  generatedAt: Date
): ReportDefinition => {
  const { seller } = data;
  const weekly = data.weekly_trend.map((point: TrendPoint) => trendRow(point));

  return {
    key: `vendedor_${seller.name.normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}`,
    title: `Reporte del vendedor: ${seller.name}`,
    description:
      'Desempeño individual en el periodo, tendencia semanal y clientes de sus rutas que superan el umbral de inactividad sin visita.',
    period: data.period,
    generatedAt,
    parameters: [
      { label: 'Vendedor', value: seller.name },
      { label: 'Estado', value: seller.active ? 'Activo' : 'Deshabilitado' },
      ...thresholdParameters(data.thresholds, ['inactivity_days']),
    ],
    highlights: [
      { label: 'Venta total', value: money(seller.total_sales), type: 'money' },
      { label: 'Pedidos', value: seller.orders_count, type: 'integer' },
      { label: 'Ticket promedio', value: money(seller.average_ticket), type: 'money' },
      { label: 'Cumplimiento de meta', value: seller.goal_compliance, type: 'percent' },
      { label: 'Paradas ejecutadas', value: seller.stops_executed, type: 'integer' },
      { label: 'Clientes visitados', value: seller.visited_customers, type: 'integer' },
      { label: 'Venta por ruta-día', value: money(seller.sales_per_route), type: 'money' },
      { label: 'Clientes sin visita', value: data.customers_without_visit.length, type: 'integer' },
    ],
    tables: [
      {
        key: 'Desempeño',
        title: 'Desempeño en el periodo',
        columns: SELLER_COLUMNS,
        rows: [sellerRow(seller)],
      },
      {
        key: STOPS_TABLE,
        title: 'Paradas por tipo',
        columns: [
          { key: 'type', header: 'Tipo de parada', type: 'text', width: 18 },
          { key: 'stops', header: 'Paradas', type: 'integer', width: 12 },
        ],
        rows: (Object.keys(STOP_TYPE_LABELS) as (keyof typeof STOP_TYPE_LABELS)[]).map((type) => ({
          type: STOP_TYPE_LABELS[type],
          stops: seller.stops_by_type[type],
        })),
      },
      {
        key: WEEKLY_TABLE,
        title: 'Tendencia semanal',
        columns: TREND_COLUMNS,
        rows: weekly,
        emptyMessage: 'Sin actividad en el periodo.',
      },
      {
        key: INACTIVE_TABLE,
        title: `Clientes sin visita en más de ${data.thresholds.inactivity_days} días`,
        columns: [
          { key: 'name', header: 'Cliente', type: 'text', width: 32 },
          { key: 'trade_name', header: 'Nombre comercial', type: 'text', width: 28 },
          { key: 'zone', header: 'Zona', type: 'text', width: 16 },
          { key: 'last_visit_at', header: 'Última visita', type: 'datetime', width: 17 },
          { key: 'days_since_last_visit', header: 'Días sin visita', type: 'integer', width: 13 },
        ],
        rows: data.customers_without_visit.map((customer) => ({
          name: customer.name,
          trade_name: customer.trade_name,
          zone: customer.zone,
          last_visit_at: customer.last_visit_at,
          days_since_last_visit: customer.days_since_last_visit,
        })),
        emptyMessage: 'Todos los clientes de sus rutas tienen una visita reciente.',
      },
    ],
    charts: [
      {
        title: 'Venta semanal',
        kind: 'column',
        table: WEEKLY_TABLE,
        categoryColumn: 'bucket_start',
        series: [{ column: 'total_sales', name: 'Venta total', color: REPORT_COLORS.brand }],
        valueFormat: 'money',
      },
      {
        title: 'Paradas por semana',
        kind: 'line',
        table: WEEKLY_TABLE,
        categoryColumn: 'bucket_start',
        series: [{ column: 'stops', name: 'Paradas', color: REPORT_COLORS.series[1] }],
        valueFormat: 'count',
      },
      {
        title: 'Distribución de paradas por tipo',
        kind: 'doughnut',
        table: STOPS_TABLE,
        categoryColumn: 'type',
        series: [{ column: 'stops', name: 'Paradas', color: REPORT_COLORS.brand }],
        valueFormat: 'count',
        categoryColors: [...REPORT_COLORS.series],
      },
    ],
    notes: [
      'Clientes sin visita: clientes de las rutas asignadas hoy al vendedor cuya última visita (de cualquier vendedor) supera el umbral de inactividad, o que nunca fueron visitados (sin fecha).',
      'Cada semana empieza en lunes; la primera puede comenzar antes del inicio del periodo.',
      ...SELLER_NOTES,
    ],
    orientation: 'landscape',
  };
};
