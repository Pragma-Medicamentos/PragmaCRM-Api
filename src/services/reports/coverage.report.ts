import { MetricsCoverageResponse } from '../../domain/types/metrics.types';
import { ReportDefinition } from '../../domain/types/report.types';
import { REPORT_COLORS } from '../../lib/reports/theme';
import { TIMEZONE_NOTE } from './common';

/*
 * Report of GET /metrics/coverage (map "Cobertura de cartera", 1e). A file
 * cannot carry the map, so the report gives the split as a doughnut and the
 * pinned customers with their coordinates.
 */

const SUMMARY_TABLE = 'Resumen de cobertura';
const CUSTOMERS_TABLE = 'Clientes';

export const buildCoverageReport = (
  data: MetricsCoverageResponse,
  generatedAt: Date
): ReportDefinition => {
  const total = data.visited + data.not_visited;
  const coverage = total > 0 ? Math.round((data.visited / total) * 1000) / 10 : null;
  const share = (count: number) => (total > 0 ? Math.round((count / total) * 1000) / 10 : null);

  // Not visited first: those are the ones to act on.
  const customers = [...data.customers].sort(
    (a, b) => Number(a.visited) - Number(b.visited) || a.name.localeCompare(b.name)
  );

  return {
    key: 'cobertura',
    title: 'Reporte de cobertura de cartera',
    description:
      'Clientes activos visitados y no visitados en el periodo seleccionado, con su ubicación GPS.',
    period: data.period,
    generatedAt,
    parameters: [],
    highlights: [
      { label: 'Cobertura', value: coverage, type: 'percent' },
      { label: 'Clientes visitados', value: data.visited, type: 'integer' },
      { label: 'Clientes no visitados', value: data.not_visited, type: 'integer' },
      { label: 'Clientes sin ubicación GPS', value: data.without_location, type: 'integer' },
    ],
    tables: [
      {
        key: SUMMARY_TABLE,
        title: SUMMARY_TABLE,
        columns: [
          { key: 'status', header: 'Estado', type: 'text', width: 18 },
          { key: 'customers', header: 'Clientes', type: 'integer', width: 12 },
          { key: 'share', header: '% de la cartera', type: 'percent', width: 15 },
        ],
        rows:
          total === 0
            ? []
            : [
                { status: 'Visitados', customers: data.visited, share: share(data.visited) },
                {
                  status: 'No visitados',
                  customers: data.not_visited,
                  share: share(data.not_visited),
                },
              ],
        emptyMessage: 'No hay clientes activos.',
      },
      {
        key: CUSTOMERS_TABLE,
        title: 'Clientes con ubicación GPS',
        columns: [
          { key: 'name', header: 'Cliente', type: 'text', width: 34 },
          { key: 'trade_name', header: 'Nombre comercial', type: 'text', width: 30 },
          { key: 'visited', header: 'Visitado', type: 'boolean', width: 10 },
          { key: 'last_visit_at', header: 'Última visita', type: 'datetime', width: 17 },
          { key: 'lat', header: 'Latitud', type: 'text', width: 12, pdf: false },
          { key: 'lng', header: 'Longitud', type: 'text', width: 12, pdf: false },
        ],
        rows: customers.map((customer) => ({
          name: customer.name,
          trade_name: customer.trade_name,
          visited: customer.visited,
          last_visit_at: customer.last_visit_at,
          // Text, not a number: Excel would round the sixth decimal away.
          lat: customer.lat.toFixed(6),
          lng: customer.lng.toFixed(6),
        })),
        emptyMessage: 'Ningún cliente activo tiene ubicación GPS.',
      },
    ],
    charts: [
      {
        title: 'Visitados vs. no visitados',
        kind: 'doughnut',
        table: SUMMARY_TABLE,
        categoryColumn: 'status',
        series: [{ column: 'customers', name: 'Clientes', color: REPORT_COLORS.brand }],
        valueFormat: 'count',
        categoryColors: [REPORT_COLORS.brand, REPORT_COLORS.previous],
      },
    ],
    notes: [
      'Cobertura = clientes activos con al menos una visita en el periodo entre todos los clientes activos. Las visitas que cumplen una parada extra no cuentan como cobertura.',
      'Los clientes sin ubicación GPS cuentan en la cobertura pero no aparecen en la lista de clientes, que es la del mapa. La ubicación se asigna desde la ficha del cliente (RF-02).',
      'La última visita considera cualquier visita, aunque sea anterior al periodo o de una parada extra.',
      TIMEZONE_NOTE,
    ],
  };
};
