import {
  CustomerWithoutPurchaseRow,
  ManagementReportContext,
  NewCustomerRow,
  RecoveredCustomerRow,
} from '../../../domain/types/managementReport.types';
import { ReportDefinition } from '../../../domain/types/report.types';
import { REPORT_COLORS } from '../../../lib/reports/theme';
import { SALES_NOTE, TIMEZONE_NOTE, money } from '../common';
import {
  EMPTY_PERIOD,
  FILTERS_NOTE,
  ROUTE_ATTRIBUTION_NOTE,
  baseDefinition,
  cents,
  localDayOf,
} from './common';

/*
 * Customer reports of PCRM-159: new, recovered and without purchase.
 */

export const buildNewCustomersReport = (
  rows: NewCustomerRow[],
  context: ManagementReportContext
): ReportDefinition => {
  const TABLE = 'Clientes nuevos';
  const amount = cents(rows.reduce((sum, row) => sum + Number(row.amount), 0));

  return {
    key: 'clientes-nuevos',
    title: 'Reporte de clientes nuevos',
    description: 'Clientes cuya primera compra confirmada cae dentro del periodo.',
    ...baseDefinition(context),
    highlights: [
      { label: 'Clientes nuevos', value: rows.length, type: 'integer' },
      { label: 'Venta de clientes nuevos', value: amount, type: 'money' },
      {
        label: 'Venta promedio por cliente nuevo',
        value: rows.length > 0 ? cents(amount / rows.length) : null,
        type: 'money',
      },
    ],
    tables: [
      {
        key: TABLE,
        title: TABLE,
        columns: [
          { key: 'erp_customer_id', header: 'Código ERP', type: 'integer', width: 11, pdf: false },
          { key: 'name', header: 'Cliente', type: 'text', width: 36 },
          { key: 'trade_name', header: 'Nombre comercial', type: 'text', width: 24 },
          { key: 'first_purchase', header: 'Primera compra', type: 'date', width: 14 },
          { key: 'seller_name', header: 'Vendedor', type: 'text', width: 24 },
          { key: 'route_name', header: 'Ruta', type: 'text', width: 20 },
          { key: 'zone', header: 'Zona', type: 'text', width: 14, pdf: false },
          { key: 'amount', header: 'Venta en el periodo', type: 'money', width: 16 },
          { key: 'orders_count', header: 'Pedidos', type: 'integer', width: 10 },
        ],
        rows: rows.map((row) => ({
          erp_customer_id: row.erp_customer_id,
          name: row.name,
          trade_name: row.trade_name,
          first_purchase: localDayOf(row.first_purchase_at),
          seller_name: row.seller_name,
          route_name: row.route_name,
          zone: row.zone,
          amount: money(row.amount),
          orders_count: row.orders_count,
        })),
        emptyMessage: EMPTY_PERIOD,
      },
    ],
    charts: [],
    notes: [
      'Un cliente es nuevo cuando no tiene ninguna venta confirmada antes del inicio del periodo. Vendedor y ruta son los de su primera compra.',
      ROUTE_ATTRIBUTION_NOTE,
      FILTERS_NOTE,
      SALES_NOTE,
      TIMEZONE_NOTE,
    ],
    orientation: 'landscape',
  };
};

export const buildRecoveredCustomersReport = (
  rows: RecoveredCustomerRow[],
  inactivityDays: number,
  context: ManagementReportContext
): ReportDefinition => {
  const TABLE = 'Clientes recuperados';

  return {
    key: 'clientes-recuperados',
    title: 'Reporte de clientes recuperados',
    description: `Clientes que volvieron a comprar en el periodo después de más de ${inactivityDays} días sin comprar.`,
    ...baseDefinition(context, [
      { label: 'Umbral de inactividad', value: `${inactivityDays} días` },
    ]),
    highlights: [
      { label: 'Clientes recuperados', value: rows.length, type: 'integer' },
      {
        label: 'Venta de la compra de regreso',
        value: cents(rows.reduce((sum, row) => sum + Number(row.amount), 0)),
        type: 'money',
      },
    ],
    tables: [
      {
        key: TABLE,
        title: TABLE,
        columns: [
          { key: 'erp_customer_id', header: 'Código ERP', type: 'integer', width: 11, pdf: false },
          { key: 'name', header: 'Cliente', type: 'text', width: 34 },
          { key: 'trade_name', header: 'Nombre comercial', type: 'text', width: 22 },
          { key: 'previous_purchase', header: 'Compra anterior', type: 'date', width: 14 },
          { key: 'recovered', header: 'Compra de regreso', type: 'date', width: 15 },
          { key: 'days_inactive', header: 'Días sin comprar', type: 'integer', width: 12 },
          { key: 'seller_name', header: 'Vendedor', type: 'text', width: 22 },
          { key: 'route_name', header: 'Ruta', type: 'text', width: 18, pdf: false },
          { key: 'amount', header: 'Monto de regreso', type: 'money', width: 15 },
        ],
        rows: rows.map((row) => ({
          erp_customer_id: row.erp_customer_id,
          name: row.name,
          trade_name: row.trade_name,
          previous_purchase: localDayOf(row.previous_purchase_at),
          recovered: localDayOf(row.recovered_at),
          days_inactive: row.days_inactive,
          seller_name: row.seller_name,
          route_name: row.route_name,
          amount: money(row.amount),
        })),
        emptyMessage: EMPTY_PERIOD,
      },
    ],
    charts: [],
    notes: [
      'Misma regla que el indicador "Clientes recuperados": se cuenta la primera compra del periodo que llegó después de un hueco mayor al umbral respecto de la compra anterior del cliente.',
      FILTERS_NOTE,
      SALES_NOTE,
      TIMEZONE_NOTE,
    ],
    orientation: 'landscape',
  };
};

/** Brackets of days without purchase the ticket asks for (30/60/90). */
const NO_PURCHASE_BRACKETS = [
  { label: '31 a 60 días', min: 31, max: 60 },
  { label: '61 a 90 días', min: 61, max: 90 },
  { label: 'Más de 90 días', min: 91, max: Infinity },
] as const;

export const bracketOf = (days: number): string =>
  NO_PURCHASE_BRACKETS.find((b) => days >= b.min && days <= b.max)?.label ??
  NO_PURCHASE_BRACKETS[0].label;

export const buildCustomersWithoutPurchaseReport = (
  rows: CustomerWithoutPurchaseRow[],
  referenceDay: string,
  context: ManagementReportContext
): ReportDefinition => {
  const DETAIL = 'Clientes sin compra';
  const SUMMARY = 'Clientes por tramo';
  const detail = rows.map((row) => ({
    erp_customer_id: row.erp_customer_id,
    name: row.name,
    trade_name: row.trade_name,
    last_purchase: localDayOf(row.last_purchase_at),
    days: row.days_without_purchase,
    bracket: bracketOf(row.days_without_purchase),
    last_amount: money(row.last_amount),
    seller_name: row.seller_name,
    routes: row.routes,
  }));
  const summary = NO_PURCHASE_BRACKETS.map((b) => ({
    bracket: b.label,
    customers: detail.filter((row) => row.bracket === b.label).length,
  }));

  return {
    key: 'clientes-sin-compra',
    title: 'Clientes sin compra (30 / 60 / 90 días)',
    description: `Clientes activos cuya última compra tiene más de 30 días al ${referenceDay}.`,
    ...baseDefinition(context, [{ label: 'Días contados al', value: referenceDay }]),
    highlights: summary.map((row) => ({
      label: row.bracket,
      value: row.customers,
      type: 'integer' as const,
    })),
    tables: [
      {
        key: SUMMARY,
        title: SUMMARY,
        columns: [
          { key: 'bracket', header: 'Tramo sin compra', type: 'text', width: 18 },
          { key: 'customers', header: 'Clientes', type: 'integer', width: 12 },
        ],
        rows: detail.length > 0 ? summary : [],
        emptyMessage: EMPTY_PERIOD,
      },
      {
        key: DETAIL,
        title: DETAIL,
        columns: [
          { key: 'erp_customer_id', header: 'Código ERP', type: 'integer', width: 11, pdf: false },
          { key: 'name', header: 'Cliente', type: 'text', width: 34 },
          { key: 'trade_name', header: 'Nombre comercial', type: 'text', width: 22 },
          { key: 'last_purchase', header: 'Última compra', type: 'date', width: 14 },
          { key: 'days', header: 'Días sin compra', type: 'integer', width: 12 },
          { key: 'bracket', header: 'Tramo', type: 'text', width: 15 },
          { key: 'last_amount', header: 'Monto última compra', type: 'money', width: 16 },
          { key: 'seller_name', header: 'Vendedor última venta', type: 'text', width: 22 },
          { key: 'routes', header: 'Rutas', type: 'text', width: 24, pdf: false },
        ],
        rows: detail,
        emptyMessage: EMPTY_PERIOD,
      },
    ],
    charts: [
      {
        title: 'Clientes por tramo sin compra',
        kind: 'column',
        table: SUMMARY,
        categoryColumn: 'bracket',
        series: [{ column: 'customers', name: 'Clientes', color: REPORT_COLORS.brand }],
        valueFormat: 'count',
      },
    ],
    notes: [
      'Solo clientes activos con al menos una compra registrada. Los días se cuentan desde la última venta confirmada hasta el fin del periodo (o hasta hoy si el periodo no ha terminado); el inicio del periodo no cambia la lista.',
      'Los filtros de ruta y zona usan las rutas actuales del cliente; el de vendedor, el vendedor de su última venta.',
      SALES_NOTE,
      TIMEZONE_NOTE,
    ],
    orientation: 'landscape',
  };
};
