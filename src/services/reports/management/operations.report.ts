import { CREDIT_TERM_DAYS } from '../../../domain/constants/businessRules';
import {
  CollectionsRow,
  GoalRow,
  ManagementReportContext,
  OverdueInvoiceRow,
  PlannedVsDoneRow,
  VisitEffectivenessRow,
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
  shareOf,
} from './common';

/*
 * Goals, visits and credit reports of PCRM-159.
 */

const NO_SELLER = 'Sin vendedor asignado';
const CHART_TOP = 15;

const sum = <T>(rows: T[], pick: (row: T) => number | null): number =>
  rows.reduce((total, row) => total + (pick(row) ?? 0), 0);

export const buildGoalsReport = (
  rows: GoalRow[],
  context: ManagementReportContext
): ReportDefinition => {
  const TABLE = 'Cumplimiento de metas';
  const goal = cents(sum(rows, (row) => money(row.goal_amount)));
  const goalSales = cents(sum(rows, (row) => money(row.goal_sales)));

  return {
    key: 'cumplimiento-de-metas',
    title: 'Reporte de cumplimiento de metas',
    description: 'Venta de cada vendedor contra su meta mensual prorrateada al periodo.',
    ...baseDefinition(context),
    highlights: [
      { label: 'Meta del periodo', value: goal, type: 'money' },
      { label: 'Venta contra meta', value: goalSales, type: 'money' },
      { label: 'Cumplimiento del equipo', value: shareOf(goalSales, goal), type: 'percent' },
      {
        label: 'Vendedores que cumplieron',
        value: rows.filter((row) => (row.compliance ?? 0) >= 100).length,
        type: 'integer',
      },
    ],
    tables: [
      {
        key: TABLE,
        title: TABLE,
        columns: [
          { key: 'name', header: 'Vendedor', type: 'text', width: 30 },
          { key: 'active', header: 'Activo', type: 'boolean', width: 9, pdf: false },
          { key: 'goal_amount', header: 'Meta del periodo', type: 'money', width: 16 },
          { key: 'goal_sales', header: 'Venta contra meta', type: 'money', width: 16 },
          { key: 'compliance', header: 'Cumplimiento', type: 'percent', width: 13 },
          { key: 'total_sales', header: 'Venta total del periodo', type: 'money', width: 17 },
        ],
        rows: rows.map((row) => ({
          name: row.seller_name,
          active: row.active,
          goal_amount: money(row.goal_amount),
          goal_sales: money(row.goal_sales),
          compliance: row.compliance,
          total_sales: money(row.total_sales),
        })),
        emptyMessage: EMPTY_PERIOD,
      },
    ],
    charts: [
      {
        title: 'Venta contra meta por vendedor',
        kind: 'bar',
        table: TABLE,
        categoryColumn: 'name',
        series: [
          { column: 'goal_sales', name: 'Venta contra meta', color: REPORT_COLORS.brand },
          { column: 'goal_amount', name: 'Meta', color: REPORT_COLORS.previous },
        ],
        valueFormat: 'money',
        maxCategories: CHART_TOP,
      },
    ],
    notes: [
      'La meta mensual se prorratea por los días del mes que caen en el periodo (7 días de octubre pesan 7/31 de la meta de octubre). Una meta rige desde su mes hasta que otra la reemplaza; meta 0 = sin meta.',
      '"Venta contra meta" solo suma la venta de los meses en que el vendedor tiene meta; "Venta total del periodo" suma toda.',
      'Las metas son por vendedor: este reporte solo aplica el filtro de vendedor.',
      SALES_NOTE,
      TIMEZONE_NOTE,
    ],
  };
};

export const buildPlannedVsDoneReport = (
  rows: PlannedVsDoneRow[],
  context: ManagementReportContext
): ReportDefinition => {
  const TABLE = 'Planificadas vs realizadas';
  const planned = sum(rows, (row) => row.planned);
  const plannedDone = sum(rows, (row) => row.planned_done);
  const tableRows = rows.map((row) => ({
    seller_name: row.seller_name ?? NO_SELLER,
    route_name: row.route_name ?? 'Sin ruta (fuera de agenda)',
    label: `${row.seller_name ?? NO_SELLER} · ${row.route_name ?? 'Sin ruta'}`,
    zone: row.zone,
    planned: row.planned,
    planned_done: row.planned_done,
    planned_missed: row.planned - row.planned_done,
    compliance: row.compliance,
    extra: row.extra,
    extra_done: row.extra_done,
    outside_agenda: row.outside_agenda,
  }));

  return {
    key: 'visitas-planificadas-vs-realizadas',
    title: 'Visitas realizadas vs. planificadas',
    description: 'Paradas de la agenda de cada vendedor y ruta, y cuántas se ejecutaron.',
    ...baseDefinition(context),
    highlights: [
      { label: 'Paradas planificadas', value: planned, type: 'integer' },
      { label: 'Planificadas realizadas', value: plannedDone, type: 'integer' },
      { label: 'Cumplimiento de agenda', value: shareOf(plannedDone, planned), type: 'percent' },
      {
        label: 'Visitas fuera de agenda',
        value: sum(rows, (row) => row.outside_agenda),
        type: 'integer',
      },
    ],
    tables: [
      {
        key: TABLE,
        title: TABLE,
        columns: [
          { key: 'seller_name', header: 'Vendedor', type: 'text', width: 26 },
          { key: 'route_name', header: 'Ruta', type: 'text', width: 24 },
          { key: 'label', header: 'Vendedor y ruta', type: 'text', width: 40, pdf: false },
          { key: 'zone', header: 'Zona', type: 'text', width: 14, pdf: false },
          { key: 'planned', header: 'Planificadas', type: 'integer', width: 12 },
          { key: 'planned_done', header: 'Realizadas', type: 'integer', width: 11 },
          { key: 'planned_missed', header: 'No realizadas', type: 'integer', width: 12 },
          { key: 'compliance', header: '% cumplimiento', type: 'percent', width: 13 },
          { key: 'extra', header: 'Paradas extra', type: 'integer', width: 11 },
          { key: 'extra_done', header: 'Extra realizadas', type: 'integer', width: 12 },
          { key: 'outside_agenda', header: 'Fuera de agenda', type: 'integer', width: 12 },
        ],
        rows: tableRows,
        emptyMessage: EMPTY_PERIOD,
      },
    ],
    charts: [
      {
        title: 'Planificadas vs. realizadas por vendedor y ruta',
        kind: 'bar',
        table: TABLE,
        categoryColumn: 'label',
        series: [
          { column: 'planned', name: 'Planificadas', color: REPORT_COLORS.previous },
          { column: 'planned_done', name: 'Realizadas', color: REPORT_COLORS.brand },
        ],
        valueFormat: 'count',
        maxCategories: CHART_TOP,
      },
    ],
    notes: [
      'La agenda de un día se genera cuando el vendedor abre ese día en la app: un día que nadie abrió no tiene paradas planificadas, así que no suma a "Planificadas".',
      'Una parada está realizada cuando una visita la ejecutó. Las visitas registradas fuera de la agenda se cuentan aparte, en la ruta de la asignación con la que se hicieron.',
      FILTERS_NOTE,
      TIMEZONE_NOTE,
    ],
    orientation: 'landscape',
  };
};

export const buildVisitEffectivenessReport = (
  rows: VisitEffectivenessRow[],
  context: ManagementReportContext
): ReportDefinition => {
  const TABLE = 'Efectividad de visitas';
  const visits = sum(rows, (row) => row.visits);
  const withOrder = sum(rows, (row) => row.visits_with_order);

  return {
    key: 'efectividad-de-visitas',
    title: 'Reporte de efectividad de visitas',
    description: 'Visitas a clientes de cada vendedor y cuántas generaron un pedido.',
    ...baseDefinition(context),
    highlights: [
      { label: 'Visitas', value: visits, type: 'integer' },
      { label: 'Visitas con pedido', value: withOrder, type: 'integer' },
      { label: 'Efectividad', value: shareOf(withOrder, visits), type: 'percent' },
      {
        label: 'Venta en visitas',
        value: cents(sum(rows, (row) => money(row.amount))),
        type: 'money',
      },
    ],
    tables: [
      {
        key: TABLE,
        title: TABLE,
        columns: [
          { key: 'name', header: 'Vendedor', type: 'text', width: 30 },
          { key: 'visits', header: 'Visitas', type: 'integer', width: 10 },
          { key: 'visits_with_order', header: 'Con pedido', type: 'integer', width: 11 },
          { key: 'effectiveness', header: 'Efectividad', type: 'percent', width: 12 },
          { key: 'marked_successful', header: 'Marcadas exitosas', type: 'integer', width: 13 },
          { key: 'marked_successful_rate', header: '% marcadas exitosas', type: 'percent', width: 14 },
          { key: 'amount', header: 'Venta en visitas', type: 'money', width: 15 },
        ],
        rows: rows.map((row) => ({
          name: row.seller_name ?? NO_SELLER,
          visits: row.visits,
          visits_with_order: row.visits_with_order,
          effectiveness: row.effectiveness,
          marked_successful: row.marked_successful,
          marked_successful_rate: row.marked_successful_rate,
          amount: money(row.amount),
        })),
        emptyMessage: EMPTY_PERIOD,
      },
    ],
    charts: [
      {
        title: 'Efectividad de visitas por vendedor',
        kind: 'bar',
        table: TABLE,
        categoryColumn: 'name',
        series: [{ column: 'effectiveness', name: 'Efectividad', color: REPORT_COLORS.brand }],
        valueFormat: 'percent',
        maxCategories: CHART_TOP,
      },
    ],
    notes: [
      'Solo visitas a clientes (tipo Visita); despachos, cobros y visitas a prospectos quedan fuera.',
      'Una visita genera pedido cuando tiene una venta confirmada ligada a ella. "Marcadas exitosas" es lo que el vendedor declaró en la app y puede diferir.',
      FILTERS_NOTE,
      SALES_NOTE,
      TIMEZONE_NOTE,
    ],
    orientation: 'landscape',
  };
};

export const buildCollectionsReport = (
  rows: CollectionsRow[],
  context: ManagementReportContext
): ReportDefinition => {
  const TABLE = 'Cobranza por vendedor';
  const collected = cents(sum(rows, (row) => money(row.collected)));

  return {
    key: 'cobranza-por-vendedor',
    title: 'Reporte de cobranza por vendedor',
    description:
      'Lo cobrado en el periodo y los saldos de crédito pendientes y vencidos de cada vendedor.',
    ...baseDefinition(context, [{ label: 'Plazo de crédito', value: `${CREDIT_TERM_DAYS} días` }]),
    highlights: [
      { label: 'Cobrado en el periodo', value: collected, type: 'money' },
      {
        label: 'Saldo pendiente (hoy)',
        value: cents(sum(rows, (row) => money(row.pending))),
        type: 'money',
      },
      {
        label: 'Saldo vencido (hoy)',
        value: cents(sum(rows, (row) => money(row.overdue))),
        type: 'money',
      },
      {
        label: 'Facturas con saldo',
        value: sum(rows, (row) => row.pending_invoices),
        type: 'integer',
      },
    ],
    tables: [
      {
        key: TABLE,
        title: TABLE,
        columns: [
          { key: 'name', header: 'Vendedor', type: 'text', width: 30 },
          { key: 'collected', header: 'Cobrado en el periodo', type: 'money', width: 17 },
          { key: 'payments', header: 'Abonos registrados', type: 'integer', width: 13 },
          { key: 'share', header: '% de lo cobrado', type: 'percent', width: 13 },
          { key: 'pending', header: 'Saldo pendiente (hoy)', type: 'money', width: 17 },
          { key: 'overdue', header: 'Saldo vencido (hoy)', type: 'money', width: 17 },
          { key: 'pending_invoices', header: 'Facturas con saldo', type: 'integer', width: 13 },
        ],
        rows: rows.map((row) => {
          const amount = money(row.collected) as number;
          return {
            name: row.seller_name ?? NO_SELLER,
            collected: amount,
            payments: row.payments,
            share: shareOf(amount, collected),
            pending: money(row.pending),
            overdue: money(row.overdue),
            pending_invoices: row.pending_invoices,
          };
        }),
        emptyMessage: EMPTY_PERIOD,
      },
    ],
    charts: [
      {
        title: 'Cobrado en el periodo por vendedor',
        kind: 'bar',
        table: TABLE,
        categoryColumn: 'name',
        series: [{ column: 'collected', name: 'Cobrado', color: REPORT_COLORS.brand }],
        valueFormat: 'money',
        maxCategories: CHART_TOP,
      },
    ],
    notes: [
      'Efactsoft no informa los pagos, solo el saldo de cada factura en cada carga. "Cobrado" suma las bajas de saldo entre dos cargas consecutivas cuando la carga más reciente cae en el periodo: la fecha es la de la carga, no la del pago, y depende de que se carguen los datos con regularidad.',
      `Saldos al día de hoy, sin importar el periodo. Vencido = saldo de facturas con más de ${CREDIT_TERM_DAYS} días de emitidas. Solo crédito: las ventas de contado quedan fuera.`,
      ROUTE_ATTRIBUTION_NOTE,
      FILTERS_NOTE,
      TIMEZONE_NOTE,
    ],
    orientation: 'landscape',
  };
};

/** Aging of overdue invoices, in days past the credit term. */
const OVERDUE_BRACKETS = [
  { label: '1 a 30 días', min: 1, max: 30 },
  { label: '31 a 60 días', min: 31, max: 60 },
  { label: '61 a 90 días', min: 61, max: 90 },
  { label: 'Más de 90 días', min: 91, max: Infinity },
] as const;

export const overdueBracketOf = (daysOverdue: number): string =>
  OVERDUE_BRACKETS.find((b) => daysOverdue >= b.min && daysOverdue <= b.max)?.label ??
  OVERDUE_BRACKETS[0].label;

export const buildOverduePortfolioReport = (
  rows: OverdueInvoiceRow[],
  asOfDay: string,
  context: ManagementReportContext
): ReportDefinition => {
  const DETAIL = 'Facturas vencidas';
  const BY_CUSTOMER = 'Vencido por cliente';
  const AGING = 'Antigüedad';
  const total = cents(sum(rows, (row) => money(row.pending_balance)));

  const detail = rows.map((row) => ({
    document: row.document ?? String(row.erp_sale_id),
    erp_sale_id: row.erp_sale_id,
    customer_key: String(row.erp_customer_id ?? row.customer_name),
    customer_name: row.customer_name ?? 'Sin cliente',
    trade_name: row.trade_name,
    issued: localDayOf(row.issued_at),
    days_overdue: row.days_overdue,
    bracket: overdueBracketOf(row.days_overdue),
    total: money(row.total),
    pending_balance: money(row.pending_balance) as number,
    seller_name: row.seller_name ?? NO_SELLER,
    route_name: row.route_name,
    zone: row.zone,
  }));

  const customers = new Map<string, { name: string; invoices: number; balance: number; oldest: number }>();
  for (const row of detail) {
    const entry = customers.get(row.customer_key) ?? {
      name: row.customer_name,
      invoices: 0,
      balance: 0,
      oldest: 0,
    };
    entry.invoices += 1;
    entry.balance += row.pending_balance;
    entry.oldest = Math.max(entry.oldest, row.days_overdue);
    customers.set(row.customer_key, entry);
  }
  const byCustomer = [...customers.values()]
    .sort((a, b) => b.balance - a.balance)
    .map((entry) => ({
      name: entry.name,
      invoices: entry.invoices,
      balance: cents(entry.balance),
      share: shareOf(entry.balance, total),
      oldest: entry.oldest,
    }));

  const aging = OVERDUE_BRACKETS.map((b) => {
    const ofBracket = detail.filter((row) => row.bracket === b.label);
    const balance = cents(sum(ofBracket, (row) => row.pending_balance));
    return {
      bracket: b.label,
      invoices: ofBracket.length,
      balance,
      share: shareOf(balance, total),
    };
  });

  return {
    key: 'cartera-vencida',
    title: 'Reporte de cartera vencida',
    description: `Facturas a crédito con saldo y más de ${CREDIT_TERM_DAYS} días de emitidas, al ${asOfDay}.`,
    ...baseDefinition(context, [
      { label: 'Saldos al', value: asOfDay },
      { label: 'Plazo de crédito', value: `${CREDIT_TERM_DAYS} días` },
    ]),
    highlights: [
      { label: 'Cartera vencida', value: total, type: 'money' },
      { label: 'Facturas vencidas', value: detail.length, type: 'integer' },
      { label: 'Clientes con saldo vencido', value: byCustomer.length, type: 'integer' },
      { label: 'Vencido a más de 90 días', value: aging[3].balance, type: 'money' },
    ],
    tables: [
      {
        key: AGING,
        title: 'Antigüedad de la cartera vencida',
        columns: [
          { key: 'bracket', header: 'Días vencida', type: 'text', width: 16 },
          { key: 'invoices', header: 'Facturas', type: 'integer', width: 10 },
          { key: 'balance', header: 'Saldo', type: 'money', width: 16 },
          { key: 'share', header: '% de la cartera', type: 'percent', width: 13 },
        ],
        rows: detail.length > 0 ? aging : [],
        emptyMessage: EMPTY_PERIOD,
      },
      {
        key: BY_CUSTOMER,
        title: BY_CUSTOMER,
        columns: [
          { key: 'name', header: 'Cliente', type: 'text', width: 36 },
          { key: 'invoices', header: 'Facturas', type: 'integer', width: 10 },
          { key: 'balance', header: 'Saldo vencido', type: 'money', width: 16 },
          { key: 'share', header: '% de la cartera', type: 'percent', width: 13 },
          { key: 'oldest', header: 'Días vencida (máx.)', type: 'integer', width: 14 },
        ],
        rows: byCustomer,
        emptyMessage: EMPTY_PERIOD,
      },
      {
        key: DETAIL,
        title: DETAIL,
        columns: [
          { key: 'document', header: 'Documento', type: 'text', width: 14 },
          { key: 'erp_sale_id', header: 'ID venta ERP', type: 'integer', width: 12, pdf: false },
          { key: 'customer_name', header: 'Cliente', type: 'text', width: 32 },
          { key: 'trade_name', header: 'Nombre comercial', type: 'text', width: 22, pdf: false },
          { key: 'issued', header: 'Emisión', type: 'date', width: 12 },
          { key: 'days_overdue', header: 'Días vencida', type: 'integer', width: 11 },
          { key: 'bracket', header: 'Tramo', type: 'text', width: 14, pdf: false },
          { key: 'total', header: 'Total factura', type: 'money', width: 14 },
          { key: 'pending_balance', header: 'Saldo', type: 'money', width: 14 },
          { key: 'seller_name', header: 'Vendedor', type: 'text', width: 22 },
          { key: 'route_name', header: 'Ruta', type: 'text', width: 18, pdf: false },
          { key: 'zone', header: 'Zona', type: 'text', width: 12, pdf: false },
        ],
        rows: detail,
        emptyMessage: EMPTY_PERIOD,
      },
    ],
    charts: [
      {
        title: 'Saldo vencido por antigüedad',
        kind: 'column',
        table: AGING,
        categoryColumn: 'bracket',
        series: [{ column: 'balance', name: 'Saldo', color: REPORT_COLORS.brand }],
        valueFormat: 'money',
      },
    ],
    notes: [
      `Es una foto al día de hoy: el periodo seleccionado no cambia la lista. Días vencida = días desde la emisión menos el plazo de crédito (${CREDIT_TERM_DAYS} días).`,
      'Misma condición que el indicador "Cartera vencida": ventas confirmadas a crédito (sin contado) con saldo. Sin filtros, el total coincide con el indicador.',
      ROUTE_ATTRIBUTION_NOTE,
      FILTERS_NOTE,
      TIMEZONE_NOTE,
    ],
    orientation: 'landscape',
  };
};
