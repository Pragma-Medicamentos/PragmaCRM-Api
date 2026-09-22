import { DateTime } from 'luxon';

import { ERP_TIMEZONE, parseErpTimestamp } from '../../src/lib/parseErpDate';

/** Default lower bound of "yesterday", per CLAUDE.md's daily summary rule 3. */
export const DEFAULT_CUTOFF = '10:30';

/** Default Efactsoft username (`venta.usuario`) this summary is scoped to. */
export const DEFAULT_USER = 'IRIS';

export interface ErpSaleDetailLine {
  id_producto: number;
  nombre: string;
  cantidad: string | number;
}

export interface ErpSale {
  venta: {
    estado: number;
    fecha_emision: string;
    usuario: string;
  };
  detalle: ErpSaleDetailLine[];
}

export interface ProductAggregate {
  id_producto: number;
  nombre: string;
  cantidad: number;
}

export interface SummarizeYesterdaySalesOptions {
  /** Reference instant for "today"/"yesterday". Defaults to the current time. */
  now?: DateTime;
  /** Lower bound of the window, as "HH:mm" local time. Defaults to {@link DEFAULT_CUTOFF}. */
  cutoff?: string;
  /** Efactsoft username (`venta.usuario`) to filter by, case-insensitive. Defaults to {@link DEFAULT_USER}. */
  user?: string;
}

const parseCutoff = (cutoff: string): { hour: number; minute: number } => {
  const [hour, minute] = cutoff.split(':').map(Number);
  return { hour, minute };
};

/**
 * Aggregates quantity sold per product for "yesterday" in El Salvador,
 * counting only completed sales (estado 2) from the given salesperson
 * (`venta.usuario`, defaults to {@link DEFAULT_USER}) emitted at or after
 * the cutoff time on the previous calendar day and before today.
 *
 * Uses `parseErpTimestamp` for `fecha_emision` so the window boundaries are
 * evaluated in America/El_Salvador rather than the host machine's timezone
 * (CLAUDE.md 5.7) — a naive `new Date` on a dd/MM string would also silently
 * misread the date as MM/dd (CLAUDE.md, parseErpDate.ts).
 */
export const summarizeYesterdaySales = (
  sales: ErpSale[],
  options: SummarizeYesterdaySalesOptions = {},
): ProductAggregate[] => {
  const now = options.now ?? DateTime.now().setZone(ERP_TIMEZONE);
  const { hour, minute } = parseCutoff(options.cutoff ?? DEFAULT_CUTOFF);
  const targetUser = (options.user ?? DEFAULT_USER).trim().toLowerCase();

  const today = now.setZone(ERP_TIMEZONE).startOf('day');
  const windowStart = today.minus({ days: 1 }).set({ hour, minute, second: 0, millisecond: 0 });
  const windowEnd = today;

  const windowStartDate = windowStart.toJSDate();
  const windowEndDate = windowEnd.toJSDate();

  const totals = new Map<number, { nombre: string; cantidad: number }>();

  for (const sale of sales) {
    if (sale?.venta?.estado !== 2) continue;
    if ((sale.venta.usuario ?? '').trim().toLowerCase() !== targetUser) continue;

    const emittedAt = parseErpTimestamp(sale.venta.fecha_emision);
    if (!emittedAt) continue;
    if (emittedAt < windowStartDate || emittedAt >= windowEndDate) continue;

    for (const line of sale.detalle ?? []) {
      if (typeof line?.id_producto !== 'number') continue;

      const quantity = Number(line.cantidad);
      if (!Number.isFinite(quantity)) continue;

      const existing = totals.get(line.id_producto);
      totals.set(line.id_producto, {
        nombre: line.nombre,
        cantidad: (existing?.cantidad ?? 0) + quantity,
      });
    }
  }

  return Array.from(totals, ([id_producto, { nombre, cantidad }]) => ({
    id_producto,
    nombre,
    cantidad,
  }));
};

/** "24" for a whole number, "12.5" for a fraction — never trailing zeros. */
export const formatQuantity = (quantity: number): string => {
  if (Number.isInteger(quantity)) return String(quantity);
  return quantity.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
};

/** Renders the aggregate as the plain-text message described in CLAUDE.md. */
export const formatWhatsAppMessage = (
  aggregates: ProductAggregate[],
  cutoff: string = DEFAULT_CUTOFF,
): string => {
  if (aggregates.length === 0) {
    return `Sin ventas después de las ${cutoff} ayer.`;
  }

  const lines = aggregates.map(
    (aggregate) => `${aggregate.nombre} — ${formatQuantity(aggregate.cantidad)}`,
  );

  return [`*Ventas de ayer (después de ${cutoff})*`, '', ...lines].join('\n');
};
