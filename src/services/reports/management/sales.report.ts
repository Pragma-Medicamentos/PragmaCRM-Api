import { AbcEntity, SalesReportGroup } from '../../../domain/schemas/report.schema';
import {
  ManagementReportContext,
  SalesGroupRow,
  SellerComparisonRow,
} from '../../../domain/types/managementReport.types';
import { ReportColumn, ReportDefinition, ReportTable } from '../../../domain/types/report.types';
import { REPORT_COLORS } from '../../../lib/reports/theme';
import { SALES_NOTE, TIMEZONE_NOTE, changePercent, money } from '../common';
import {
  EMPTY_PERIOD,
  FILTERS_NOTE,
  ROUTE_ATTRIBUTION_NOTE,
  baseDefinition,
  cents,
  shareOf,
} from './common';

/*
 * Sales reports of PCRM-159: sales by a dimension, the sellers comparison,
 * the ABC classification and the general rankings.
 */

/** Bars past this many stop being readable; the table keeps every row. */
const CHART_TOP = 15;

interface GroupMeta {
  key: string;
  title: string;
  /** Header of the name column. */
  header: string;
  /** Plural, for "N <plural> con venta". */
  plural: string;
  /** Header of the detail column, when the group has one. */
  detailHeader?: string;
  /** Label of the rows whose dimension is unknown. */
  unknown: string;
  /** Whether "Clientes" adds information (not for the customer group). */
  customers: boolean;
}

export const SALES_GROUPS: Record<SalesReportGroup, GroupMeta> = {
  seller: {
    key: 'ventas-por-vendedor',
    title: 'Ventas por vendedor',
    header: 'Vendedor',
    plural: 'Vendedores',
    unknown: 'Sin vendedor asignado',
    customers: true,
  },
  customer: {
    key: 'ventas-por-cliente',
    title: 'Ventas por cliente',
    header: 'Cliente',
    plural: 'Clientes',
    detailHeader: 'Nombre comercial',
    unknown: 'Sin cliente',
    customers: false,
  },
  municipality: {
    key: 'ventas-por-municipio',
    title: 'Ventas por municipio',
    header: 'Municipio',
    plural: 'Municipios',
    unknown: 'Sin municipio (sin ruta atribuible o ruta sin municipio)',
    customers: true,
  },
  route: {
    key: 'ventas-por-ruta',
    title: 'Ventas por ruta',
    header: 'Ruta',
    plural: 'Rutas',
    detailHeader: 'Zona',
    unknown: 'Sin ruta atribuible',
    customers: true,
  },
  zone: {
    key: 'ventas-por-zona',
    title: 'Ventas por zona',
    header: 'Zona',
    plural: 'Zonas',
    unknown: 'Sin zona (sin ruta atribuible o ruta sin zona)',
    customers: true,
  },
  product: {
    key: 'ventas-por-producto',
    title: 'Ventas por producto',
    header: 'Producto',
    plural: 'Productos',
    detailHeader: 'Código',
    unknown: 'Sin producto',
    customers: true,
  },
};

const groupColumns = (meta: GroupMeta, product: boolean): ReportColumn[] => [
  { key: 'position', header: '#', type: 'integer', width: 6 },
  { key: 'name', header: meta.header, type: 'text', width: 40 },
  ...(meta.detailHeader
    ? [{ key: 'detail', header: meta.detailHeader, type: 'text' as const, width: 24 }]
    : []),
  { key: 'amount', header: 'Monto vendido', type: 'money', width: 16 },
  { key: 'orders_count', header: 'Pedidos', type: 'integer', width: 10 },
  { key: 'average_ticket', header: 'Ticket promedio', type: 'money', width: 15 },
  ...(meta.customers
    ? [{ key: 'customers', header: 'Clientes', type: 'integer' as const, width: 10 }]
    : []),
  ...(product
    ? [{ key: 'units', header: 'Unidades', type: 'decimal' as const, width: 12 }]
    : []),
  { key: 'share', header: '% del total', type: 'percent', width: 12 },
];

/** The rows of a sales group as table rows, with position and share. */
export const salesGroupTable = (
  rows: SalesGroupRow[],
  group: SalesReportGroup,
  tableKey: string,
  title: string
): ReportTable => {
  const meta = SALES_GROUPS[group];
  const total = rows.reduce((sum, row) => sum + Number(row.amount), 0);

  return {
    key: tableKey,
    title,
    columns: groupColumns(meta, group === 'product'),
    rows: rows.map((row, index) => {
      const amount = money(row.amount) as number;
      return {
        position: index + 1,
        name: row.key === null ? meta.unknown : (row.label ?? meta.unknown),
        detail: row.detail,
        amount,
        orders_count: row.orders_count,
        average_ticket: row.orders_count > 0 ? cents(amount / row.orders_count) : null,
        customers: row.customers,
        units: row.units === null ? null : Number(row.units),
        share: shareOf(amount, total),
      };
    }),
    emptyMessage: EMPTY_PERIOD,
  };
};

export const buildSalesReport = (
  rows: SalesGroupRow[],
  group: SalesReportGroup,
  context: ManagementReportContext
): ReportDefinition => {
  const meta = SALES_GROUPS[group];
  const total = cents(rows.reduce((sum, row) => sum + Number(row.amount), 0));
  const known = rows.filter((row) => row.key !== null);
  const orders = rows.reduce((sum, row) => sum + row.orders_count, 0);
  const table = salesGroupTable(rows, group, meta.title, meta.title);

  return {
    key: meta.key,
    title: `Reporte de ${meta.title.toLowerCase()}`,
    description: `Venta confirmada del periodo agrupada por ${meta.header.toLowerCase()}, con los filtros aplicados.`,
    ...baseDefinition(context),
    highlights: [
      { label: 'Venta total', value: total, type: 'money' },
      // Product lines: one invoice counts once per product it carries.
      {
        label: group === 'product' ? 'Productos vendidos' : 'Pedidos',
        value: group === 'product' ? known.length : orders,
        type: 'integer',
      },
      {
        label: group === 'product' ? 'Producto líder (% del total)' : `${meta.plural} con venta`,
        value:
          group === 'product'
            ? known[0]
              ? shareOf(Number(known[0].amount), total)
              : null
            : known.length,
        type: group === 'product' ? 'percent' : 'integer',
      },
      {
        label: 'Ticket promedio',
        value: group !== 'product' && orders > 0 ? cents(total / orders) : null,
        type: 'money',
      },
    ],
    tables: [table],
    charts: [
      {
        title: `Top ${CHART_TOP}: monto vendido por ${meta.header.toLowerCase()}`,
        kind: 'bar',
        table: table.key,
        categoryColumn: 'name',
        series: [{ column: 'amount', name: 'Monto vendido', color: REPORT_COLORS.brand }],
        valueFormat: 'money',
        maxCategories: CHART_TOP,
      },
    ],
    notes: [
      group === 'product'
        ? 'Monto por línea de factura con IVA. Unidades en la unidad base del producto (cantidad × factor). Un pedido cuenta una vez por cada producto que lleva.'
        : 'Monto por factura, IVA incluido. El ticket promedio divide el monto entre los pedidos.',
      ...(group === 'route' || group === 'zone' || group === 'municipality'
        ? [ROUTE_ATTRIBUTION_NOTE]
        : []),
      FILTERS_NOTE,
      SALES_NOTE,
      TIMEZONE_NOTE,
    ],
    orientation: meta.detailHeader ? 'landscape' : 'portrait',
  };
};

export const buildSellersComparisonReport = (
  rows: SellerComparisonRow[],
  previousPeriod: { from: string; to: string },
  context: ManagementReportContext
): ReportDefinition => {
  const TABLE = 'Comparativo de vendedores';
  const current = cents(rows.reduce((sum, row) => sum + Number(row.cur_amount), 0));
  const previous = cents(rows.reduce((sum, row) => sum + Number(row.prev_amount), 0));

  return {
    key: 'comparativo-vendedores',
    title: 'Comparativo entre vendedores',
    description:
      'Venta de cada vendedor en el periodo frente al periodo anterior de igual duración.',
    ...baseDefinition(context, [
      { label: 'Periodo anterior', value: `${previousPeriod.from} – ${previousPeriod.to}` },
    ]),
    highlights: [
      { label: 'Venta del periodo', value: current, type: 'money' },
      { label: 'Venta del periodo anterior', value: previous, type: 'money' },
      { label: 'Variación', value: changePercent(current, previous), type: 'percent' },
      { label: 'Vendedores', value: rows.filter((row) => row.key !== null).length, type: 'integer' },
    ],
    tables: [
      {
        key: TABLE,
        title: TABLE,
        columns: [
          { key: 'name', header: 'Vendedor', type: 'text', width: 30 },
          { key: 'cur_amount', header: 'Venta del periodo', type: 'money', width: 17 },
          { key: 'prev_amount', header: 'Venta periodo anterior', type: 'money', width: 17 },
          { key: 'change', header: 'Variación', type: 'percent', width: 11 },
          { key: 'cur_orders', header: 'Pedidos', type: 'integer', width: 10 },
          { key: 'prev_orders', header: 'Pedidos anterior', type: 'integer', width: 12 },
          { key: 'cur_ticket', header: 'Ticket promedio', type: 'money', width: 15 },
          { key: 'share', header: '% de la venta', type: 'percent', width: 12 },
        ],
        rows: rows.map((row) => {
          const cur = money(row.cur_amount) as number;
          const prev = money(row.prev_amount) as number;
          return {
            name: row.label ?? SALES_GROUPS.seller.unknown,
            cur_amount: cur,
            prev_amount: prev,
            change: changePercent(cur, prev),
            cur_orders: row.cur_orders,
            prev_orders: row.prev_orders,
            cur_ticket: row.cur_orders > 0 ? cents(cur / row.cur_orders) : null,
            share: shareOf(cur, current),
          };
        }),
        emptyMessage: EMPTY_PERIOD,
      },
    ],
    charts: [
      {
        title: 'Venta por vendedor: periodo actual vs. anterior',
        kind: 'bar',
        table: TABLE,
        categoryColumn: 'name',
        series: [
          { column: 'cur_amount', name: 'Periodo actual', color: REPORT_COLORS.brand },
          { column: 'prev_amount', name: 'Periodo anterior', color: REPORT_COLORS.previous },
        ],
        valueFormat: 'money',
        maxCategories: CHART_TOP,
      },
    ],
    notes: [
      'La variación compara contra el periodo anterior de igual duración, con los mismos filtros.',
      FILTERS_NOTE,
      SALES_NOTE,
      TIMEZONE_NOTE,
    ],
    orientation: 'landscape',
  };
};

/*
 * ABC (Pareto): items sorted by amount; an item is A while the cumulative
 * share BEFORE it is under 80%, B under 95%, C the rest. Measuring before the
 * item puts the one that crosses 80% in A, so a single dominant customer is A.
 */
const ABC_LIMITS = { A: 80, B: 95 } as const;

export const abcClass = (cumulativeBefore: number): 'A' | 'B' | 'C' =>
  cumulativeBefore < ABC_LIMITS.A ? 'A' : cumulativeBefore < ABC_LIMITS.B ? 'B' : 'C';

const ABC_META: Record<AbcEntity, { key: string; title: string; header: string }> = {
  customer: { key: 'abc-clientes', title: 'Reporte ABC de clientes', header: 'Cliente' },
  product: { key: 'abc-productos', title: 'Reporte ABC de productos', header: 'Producto' },
};

export const buildAbcReport = (
  rows: SalesGroupRow[],
  entity: AbcEntity,
  context: ManagementReportContext
): ReportDefinition => {
  const meta = ABC_META[entity];
  const DETAIL = 'Clasificación ABC';
  const SUMMARY = 'Resumen por clase';
  const items = rows.filter((row) => row.key !== null && Number(row.amount) > 0);
  const total = items.reduce((sum, row) => sum + Number(row.amount), 0);

  let cumulative = 0;
  const detailRows = items.map((row, index) => {
    const amount = money(row.amount) as number;
    const share = total > 0 ? (amount / total) * 100 : 0;
    const klass = abcClass(cumulative);
    cumulative += share;
    return {
      position: index + 1,
      name: row.label,
      detail: row.detail,
      amount,
      orders_count: row.orders_count,
      share: Math.round(share * 10) / 10,
      cumulative: Math.round(cumulative * 10) / 10,
      class: klass,
    };
  });

  const summaryRows = (['A', 'B', 'C'] as const).map((klass) => {
    const ofClass = detailRows.filter((row) => row.class === klass);
    const amount = cents(ofClass.reduce((sum, row) => sum + row.amount, 0));
    return {
      class: `Clase ${klass}`,
      items: ofClass.length,
      items_share: shareOf(ofClass.length, detailRows.length),
      amount,
      amount_share: shareOf(amount, total),
    };
  });

  return {
    key: meta.key,
    title: meta.title,
    description: `${meta.header}s clasificados por su aporte a la venta del periodo (Pareto 80/15/5).`,
    ...baseDefinition(context, [
      { label: 'Corte de clases', value: 'A: hasta 80% acumulado · B: hasta 95% · C: resto' },
    ]),
    highlights: summaryRows.map((row) => ({
      label: `${row.class} (${meta.header.toLowerCase()}s)`,
      value: row.items,
      type: 'integer' as const,
    })),
    tables: [
      {
        key: SUMMARY,
        title: SUMMARY,
        columns: [
          { key: 'class', header: 'Clase', type: 'text', width: 12 },
          { key: 'items', header: `${meta.header}s`, type: 'integer', width: 12 },
          { key: 'items_share', header: `% de ${meta.header.toLowerCase()}s`, type: 'percent', width: 14 },
          { key: 'amount', header: 'Monto vendido', type: 'money', width: 16 },
          { key: 'amount_share', header: '% de la venta', type: 'percent', width: 14 },
        ],
        rows: detailRows.length > 0 ? summaryRows : [],
        emptyMessage: EMPTY_PERIOD,
      },
      {
        key: DETAIL,
        title: DETAIL,
        columns: [
          { key: 'position', header: '#', type: 'integer', width: 6 },
          { key: 'name', header: meta.header, type: 'text', width: 40 },
          {
            key: 'detail',
            header: entity === 'customer' ? 'Nombre comercial' : 'Código',
            type: 'text',
            width: 22,
          },
          { key: 'amount', header: 'Monto vendido', type: 'money', width: 16 },
          { key: 'orders_count', header: 'Pedidos', type: 'integer', width: 10 },
          { key: 'share', header: '% de la venta', type: 'percent', width: 12 },
          { key: 'cumulative', header: '% acumulado', type: 'percent', width: 12 },
          { key: 'class', header: 'Clase', type: 'text', width: 8 },
        ],
        rows: detailRows,
        emptyMessage: EMPTY_PERIOD,
      },
    ],
    charts: [
      {
        title: 'Venta por clase',
        kind: 'doughnut',
        table: SUMMARY,
        categoryColumn: 'class',
        series: [{ column: 'amount', name: 'Monto vendido', color: REPORT_COLORS.brand }],
        valueFormat: 'money',
        categoryColors: [...REPORT_COLORS.series],
      },
    ],
    notes: [
      'Clase A: los que juntos hacen el primer 80% de la venta; B: el siguiente 15%; C: el 5% restante. Solo entran los que vendieron en el periodo.',
      FILTERS_NOTE,
      SALES_NOTE,
      TIMEZONE_NOTE,
    ],
    orientation: 'landscape',
  };
};

export const buildRankingsReport = (
  data: { sellers: SalesGroupRow[]; customers: SalesGroupRow[]; products: SalesGroupRow[] },
  limit: number,
  context: ManagementReportContext
): ReportDefinition => {
  const top = (rows: SalesGroupRow[]) => rows.filter((row) => row.key !== null).slice(0, limit);
  const tables = [
    salesGroupTable(top(data.sellers), 'seller', 'Ranking de vendedores', 'Ranking de vendedores'),
    salesGroupTable(top(data.customers), 'customer', 'Ranking de clientes', 'Ranking de clientes'),
    salesGroupTable(top(data.products), 'product', 'Ranking de productos', 'Ranking de productos'),
  ];
  const total = cents(data.sellers.reduce((sum, row) => sum + Number(row.amount), 0));

  return {
    key: 'rankings',
    title: 'Rankings generales',
    description: 'Vendedores, clientes y productos ordenados por monto vendido en el periodo.',
    ...baseDefinition(context, [{ label: 'Filas por ranking', value: `Primeros ${limit}` }]),
    highlights: [
      { label: 'Venta total', value: total, type: 'money' },
      { label: 'Vendedor líder', value: tables[0].rows[0]?.name ?? null, type: 'text' },
      { label: 'Cliente líder', value: tables[1].rows[0]?.name ?? null, type: 'text' },
      { label: 'Producto líder', value: tables[2].rows[0]?.name ?? null, type: 'text' },
    ],
    tables,
    charts: tables.map((table) => ({
      title: `${table.title} (top ${Math.min(limit, CHART_TOP)})`,
      kind: 'bar' as const,
      table: table.key,
      categoryColumn: 'name',
      series: [{ column: 'amount', name: 'Monto vendido', color: REPORT_COLORS.brand }],
      valueFormat: 'money' as const,
      maxCategories: CHART_TOP,
    })),
    notes: [
      '"% del total" se calcula sobre los listados en cada ranking. Los productos suman líneas de factura; vendedores y clientes, facturas completas.',
      FILTERS_NOTE,
      SALES_NOTE,
      TIMEZONE_NOTE,
    ],
    orientation: 'landscape',
  };
};
