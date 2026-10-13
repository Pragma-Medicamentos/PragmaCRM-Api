import { KPI_CATALOG } from '../../domain/constants/kpiCatalog';
import { KPI_NAMES, KpiName } from '../../domain/schemas/metrics.schema';
import {
  KpiError,
  KpiUnit,
  KpiValue,
  MetricsKpiValuesResponse,
  MetricsPeriod,
  StopsByType,
} from '../../domain/types/metrics.types';
import {
  ReportChart,
  ReportColumnType,
  ReportDefinition,
  ReportHighlight,
  ReportTable,
  ReportValueFormat,
} from '../../domain/types/report.types';
import { REPORT_COLORS, formatLocalDay } from '../../lib/reports/theme';
import {
  SALES_NOTE,
  STOP_TYPE_LABELS,
  TIMEZONE_NOTE,
  changePercent,
  money,
  thresholdParameters,
} from './common';

/*
 * Report of GET /metrics/kpis/values (and /kpis/:name, which is the same
 * report with a single KPI). Every KPI is shown against the previous period.
 *
 * A table column has one type, so the KPIs are grouped by unit: money, counts,
 * rates and times each get their own table and chart.
 */

export const KPI_LABELS: Record<KpiName, string> = {
  stops_executed: 'Paradas ejecutadas',
  stops_by_type: 'Paradas por tipo',
  visited_customers: 'Clientes visitados',
  effective_visits_rate: 'Visitas efectivas',
  average_visit_minutes: 'Tiempo promedio por visita (min)',
  total_sales: 'Venta total',
  orders_count: 'Número de pedidos',
  average_ticket: 'Ticket promedio',
  average_monthly_sales: 'Venta promedio mensual',
  route_effectiveness: 'Efectividad de ruta (venta por ruta-día)',
  goal_compliance: 'Cumplimiento de meta',
  customers_without_visit: 'Clientes sin visita',
  recovered_customers: 'Clientes recuperados',
  new_prospects: 'Nuevos prospectos',
  purchase_frequency_days: 'Frecuencia de compra (días)',
  overdue_portfolio: 'Cartera vencida (al día de hoy)',
  pending_collections: 'Cobros pendientes (al día de hoy)',
};

interface UnitGroup {
  key: string;
  title: string;
  units: KpiUnit[];
  type: ReportColumnType;
  valueFormat: ReportValueFormat;
}

const UNIT_GROUPS: UnitGroup[] = [
  { key: 'KPIs de venta', title: 'KPIs monetarios', units: ['money'], type: 'money', valueFormat: 'money' },
  { key: 'KPIs de conteo', title: 'KPIs de conteo', units: ['count'], type: 'integer', valueFormat: 'count' },
  { key: 'KPIs de tasa', title: 'KPIs porcentuales', units: ['percent'], type: 'percent', valueFormat: 'percent' },
  { key: 'KPIs en minutos', title: 'KPIs en minutos', units: ['minutes'], type: 'decimal', valueFormat: 'minutes' },
  { key: 'KPIs en días', title: 'KPIs en días', units: ['days'], type: 'decimal', valueFormat: 'days' },
];

/** KPIs promoted to the summary tiles, in this order, when present. */
const HIGHLIGHTED: KpiName[] = [
  'total_sales',
  'orders_count',
  'average_ticket',
  'goal_compliance',
  'visited_customers',
  'stops_executed',
  'overdue_portfolio',
  'pending_collections',
];

const UNIT_TYPES: Record<KpiUnit, ReportColumnType> = {
  money: 'money',
  count: 'integer',
  percent: 'percent',
  minutes: 'decimal',
  days: 'decimal',
};

const isError = (entry: unknown): entry is KpiError =>
  typeof entry === 'object' && entry !== null && 'error' in entry;

const toNumber = (value: unknown, unit: KpiUnit): number | null => {
  if (value === null || value === undefined) return null;
  return unit === 'money' ? money(value as string) : Number(value);
};

const range = (period: { from: string; to: string }) =>
  `${formatLocalDay(period.from)} – ${formatLocalDay(period.to)}`;

/**
 * The batch response, with `previous_period` nullable so a single snapshot
 * KPI (which has none) fits too.
 */
export type KpisReportData = Omit<MetricsKpiValuesResponse, 'previous_period'> & {
  previous_period: MetricsPeriod | null;
};

export const buildKpisReport = (
  data: KpisReportData,
  generatedAt: Date
): ReportDefinition => {
  const names = KPI_NAMES.filter((name) => data.kpis[name] !== undefined);
  const failed = names.filter((name) => isError(data.kpis[name]));
  const computed = names.filter((name) => !isError(data.kpis[name]));

  const tables: ReportTable[] = [];
  const charts: ReportChart[] = [];

  for (const group of UNIT_GROUPS) {
    const rows = computed
      .filter((name) => name !== 'stops_by_type' && group.units.includes(KPI_CATALOG[name].unit))
      .map((name) => {
        const { unit, has_previous_period } = KPI_CATALOG[name];
        const kpi = data.kpis[name] as KpiValue<unknown>;
        const current = toNumber(kpi.value, unit);
        const previous = has_previous_period ? toNumber(kpi.previous_value, unit) : null;
        return {
          kpi: KPI_LABELS[name],
          name,
          current,
          previous,
          change: changePercent(current, previous),
        };
      });
    if (rows.length === 0) continue;

    tables.push({
      key: group.key,
      title: group.title,
      columns: [
        { key: 'kpi', header: 'KPI', type: 'text', width: 42 },
        { key: 'name', header: 'Clave', type: 'text', width: 26, pdf: false },
        { key: 'current', header: 'Periodo actual', type: group.type, width: 16 },
        { key: 'previous', header: 'Periodo anterior', type: group.type, width: 16 },
        { key: 'change', header: 'Variación', type: 'percent', width: 12 },
      ],
      rows,
    });
    charts.push({
      title: `${group.title}: periodo actual vs. anterior`,
      kind: 'bar',
      table: group.key,
      categoryColumn: 'kpi',
      series: [
        { column: 'current', name: 'Periodo actual', color: REPORT_COLORS.brand },
        { column: 'previous', name: 'Periodo anterior', color: REPORT_COLORS.previous },
      ],
      valueFormat: group.valueFormat,
    });
  }

  if (computed.includes('stops_by_type')) {
    const kpi = data.kpis.stops_by_type as KpiValue<StopsByType>;
    tables.push({
      key: 'Paradas por tipo',
      title: 'Paradas por tipo (Visita / Despacho / Cobro)',
      columns: [
        { key: 'type', header: 'Tipo de parada', type: 'text', width: 18 },
        { key: 'current', header: 'Periodo actual', type: 'integer', width: 16 },
        { key: 'previous', header: 'Periodo anterior', type: 'integer', width: 16 },
        { key: 'change', header: 'Variación', type: 'percent', width: 12 },
      ],
      rows: (Object.keys(STOP_TYPE_LABELS) as (keyof StopsByType)[]).map((type) => {
        const current = kpi.value[type];
        const previous = kpi.previous_value?.[type] ?? null;
        return {
          type: STOP_TYPE_LABELS[type],
          current,
          previous,
          change: changePercent(current, previous),
        };
      }),
    });
    charts.push({
      title: 'Distribución de paradas por tipo (periodo actual)',
      kind: 'doughnut',
      table: 'Paradas por tipo',
      categoryColumn: 'type',
      series: [{ column: 'current', name: 'Paradas', color: REPORT_COLORS.brand }],
      valueFormat: 'count',
      categoryColors: [...REPORT_COLORS.series],
    });
  }

  const highlights: ReportHighlight[] = HIGHLIGHTED.filter((name) =>
    computed.includes(name)
  ).map((name) => {
    const { unit } = KPI_CATALOG[name];
    return {
      label: KPI_LABELS[name],
      value: toNumber((data.kpis[name] as KpiValue<unknown>).value, unit),
      type: UNIT_TYPES[unit],
    };
  });

  const notes = [
    'La variación compara contra el periodo anterior de igual duración. Cartera vencida y cobros pendientes son una foto al día de hoy y no tienen periodo anterior.',
    SALES_NOTE,
    'La efectividad de ruta divide la venta atribuida a una ruta (venta ligada a una visita) entre las rutas-día ejecutadas; una venta sin visita asociada no es atribuible a ninguna ruta.',
    TIMEZONE_NOTE,
    ...failed.map((name) => `No se pudo calcular "${KPI_LABELS[name]}"; el resto del reporte sí.`),
  ];

  return {
    key: names.length === 1 ? `kpi_${names[0]}` : 'kpis',
    title: names.length === 1 ? `Reporte de KPI: ${KPI_LABELS[names[0]]}` : 'Reporte de KPIs',
    description:
      'Indicadores del panel de métricas (RF-09) para el periodo seleccionado, comparados con el periodo anterior.',
    period: data.period,
    generatedAt,
    parameters: [
      ...(data.previous_period
        ? [{ label: 'Periodo anterior', value: range(data.previous_period) }]
        : []),
      ...thresholdParameters(data.thresholds, ['inactivity_days', 'credit_term_days']),
    ],
    highlights,
    tables,
    charts,
    notes,
  };
};
