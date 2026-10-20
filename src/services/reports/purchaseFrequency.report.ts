import { MetricsPurchaseFrequencyResponse } from '../../domain/types/metrics.types';
import { ReportDefinition } from '../../domain/types/report.types';
import { REPORT_COLORS } from '../../lib/reports/theme';
import { SALES_NOTE, TIMEZONE_NOTE } from './common';

/*
 * Report of GET /metrics/purchase-frequency (histogram "Frecuencia de compra
 * por cliente", 1e).
 */

const TABLE = 'Frecuencia de compra';

export const buildPurchaseFrequencyReport = (
  data: MetricsPurchaseFrequencyResponse,
  generatedAt: Date
): ReportDefinition => {
  const withData = data.buckets.reduce((sum, bucket) => sum + bucket.customers, 0);
  const share = (count: number) =>
    withData > 0 ? Math.round((count / withData) * 1000) / 10 : null;

  return {
    key: 'frecuencia-compra',
    title: 'Reporte de frecuencia de compra',
    description:
      'Clientes agrupados por el promedio de días entre compras consecutivas, sobre las compras del periodo seleccionado.',
    period: data.period,
    generatedAt,
    parameters: [],
    highlights: [
      { label: 'Días promedio entre compras', value: data.average_days, type: 'integer' },
      { label: 'Clientes con frecuencia', value: withData, type: 'integer' },
      { label: 'Clientes sin compra previa', value: data.insufficient_data, type: 'integer' },
    ],
    tables: [
      {
        key: TABLE,
        title: 'Clientes por rango de días entre compras',
        columns: [
          { key: 'label', header: 'Rango (días)', type: 'text', width: 14 },
          { key: 'min_days', header: 'Desde', type: 'integer', width: 9 },
          { key: 'max_days', header: 'Hasta', type: 'integer', width: 9 },
          { key: 'customers', header: 'Clientes', type: 'integer', width: 11 },
          { key: 'share', header: '% de clientes', type: 'percent', width: 14 },
        ],
        rows:
          withData === 0
            ? []
            : data.buckets.map((bucket) => ({
                label: bucket.label,
                min_days: bucket.min_days,
                max_days: bucket.max_days,
                customers: bucket.customers,
                share: share(bucket.customers),
              })),
        emptyMessage: 'Ningún cliente tiene dos compras para comparar en el periodo.',
      },
    ],
    charts: [
      {
        title: 'Clientes por días promedio entre compras',
        kind: 'column',
        table: TABLE,
        categoryColumn: 'label',
        series: [{ column: 'customers', name: 'Clientes', color: REPORT_COLORS.brand }],
        valueFormat: 'count',
      },
    ],
    notes: [
      'Para cada cliente con compras en el periodo se promedian los días entre compras consecutivas; la primera compra del periodo se compara con la anterior aunque esta sea previa al periodo.',
      'Clientes sin compra previa: compraron en el periodo pero no tienen otra compra con la cual comparar; no entran en el histograma.',
      'El último rango es abierto ("Hasta" vacío).',
      SALES_NOTE,
      TIMEZONE_NOTE,
    ],
  };
};
