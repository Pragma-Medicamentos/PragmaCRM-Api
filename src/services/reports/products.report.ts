import { MetricsProductsResponse } from '../../domain/types/metrics.types';
import { ReportDefinition } from '../../domain/types/report.types';
import { REPORT_COLORS } from '../../lib/reports/theme';
import { SALES_NOTE, TIMEZONE_NOTE, money } from './common';

/*
 * Report of GET /metrics/products (ranking "Productos más vendidos",
 * PCRM-172).
 */

const TABLE = 'Ranking de productos';

/** Bars past this many stop being readable; the table keeps every row. */
const CHART_TOP = 15;

export const buildProductsReport = (
  data: MetricsProductsResponse,
  limit: number,
  generatedAt: Date
): ReportDefinition => {
  const totalAmount = Number(data.total_amount);
  const share = (amount: number) =>
    totalAmount > 0 ? Math.round((amount / totalAmount) * 1000) / 10 : null;
  const listedAmount = data.products.reduce((sum, product) => sum + Number(product.amount), 0);

  return {
    key: 'productos',
    title: 'Reporte de productos más vendidos',
    description: 'Ranking de productos por monto vendido en el periodo seleccionado.',
    period: data.period,
    generatedAt,
    parameters: [{ label: 'Productos en el ranking', value: `Primeros ${limit}` }],
    highlights: [
      { label: 'Venta total de productos', value: totalAmount, type: 'money' },
      { label: 'Productos listados', value: data.products.length, type: 'integer' },
      { label: 'Participación de los listados', value: share(listedAmount), type: 'percent' },
      {
        // The share, not the name: a product name does not fit a tile.
        label: 'Participación del producto líder',
        value: data.products[0] ? share(Number(data.products[0].amount)) : null,
        type: 'percent',
      },
    ],
    tables: [
      {
        key: TABLE,
        title: TABLE,
        columns: [
          { key: 'position', header: '#', type: 'integer', width: 6 },
          { key: 'product_id', header: 'ID ERP', type: 'integer', width: 10, pdf: false },
          { key: 'code', header: 'Código', type: 'text', width: 14 },
          { key: 'name', header: 'Producto', type: 'text', width: 46 },
          { key: 'units', header: 'Unidades', type: 'decimal', width: 12 },
          { key: 'amount', header: 'Monto vendido', type: 'money', width: 16 },
          { key: 'share', header: '% del total', type: 'percent', width: 12 },
        ],
        rows: data.products.map((product) => {
          const amount = money(product.amount) as number;
          return {
            position: product.position,
            product_id: product.product_id,
            code: product.code,
            name: product.name,
            units: Number(product.units),
            amount,
            share: share(amount),
          };
        }),
        emptyMessage: 'No hay ventas de productos en el periodo.',
      },
    ],
    charts: [
      {
        title: `Top ${CHART_TOP} productos por monto vendido`,
        kind: 'bar',
        table: TABLE,
        categoryColumn: 'name',
        series: [{ column: 'amount', name: 'Monto vendido', color: REPORT_COLORS.brand }],
        valueFormat: 'money',
        maxCategories: CHART_TOP,
      },
    ],
    notes: [
      'Monto con IVA incluido. Unidades en la unidad base del producto (cantidad × factor).',
      '"% del total" se calcula sobre la venta de todos los productos del periodo, no solo de los listados.',
      SALES_NOTE,
      TIMEZONE_NOTE,
    ],
  };
};
