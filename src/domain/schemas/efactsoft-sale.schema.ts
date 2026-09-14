import { z } from 'zod';
import { parseErpTimestamp } from '../../lib/parseErpDate';

/**
 * Shape of the JSON exported by the ERP (CLAUDE.md 6.2 and 6.3).
 *
 * Two design rules:
 *
 * 1. Only the fields that make a sale processable are validated. The real
 *    payload carries more than 200 fields per sale (tax document data, card
 *    details, bitcoin references, customs offices...) that the CRM ignores;
 *    requiring them would reject perfectly valid sales.
 *
 * 2. Objects are `loose`, so Zod keeps unknown keys instead of stripping them.
 *    Even so, what is written to `sale_staging.payload` is the RAW object, not
 *    the parsed one — PCRM-34 needs the payload untouched.
 */

/**
 * Amounts arrive as decimal text ("3.75", "0.0000") and occasionally as
 * numbers. Either is accepted as long as it converts; no transformation is
 * applied, since the raw value is what goes to staging.
 */
const decimalString = z.union([z.string(), z.number()]).refine(
  (value) => {
    if (typeof value === 'number') return Number.isFinite(value);
    const trimmed = value.trim();
    return trimmed !== '' && Number.isFinite(Number(trimmed));
  },
  { message: 'is not a valid decimal amount' }
);

/** An ERP date, in any of the formats the payload mixes. */
const erpTimestamp = z
  .string({ message: 'is required and must be a date' })
  .refine((value) => parseErpTimestamp(value) !== null, {
    message: 'unrecognized date format (expected dd/MM/yyyy HH:mm:ss or yyyy-MM-dd HH:mm:ss)',
  });

/** Optional text: the ERP sends null, "" or nothing at all interchangeably. */
const optionalText = z.string().nullish();

export const efactsoftSaleDetailSchema = z
  .object({
    id_venta_det: z.number({ message: 'is required and must be a number' }).int(),
    id_producto: z.number({ message: 'the line does not identify a product' }).int(),
    id_venta: z.number().int().optional(),
    nombre: z.string({ message: 'the product has no name' }).min(1, 'the product has no name'),
    codigo: optionalText,
    grupo_prod: optionalText,
    cantidad: decimalString,
    precio: decimalString,
    total: decimalString,
    total_imp: decimalString.nullish(),
    um: optionalText,
    factor: decimalString.nullish(),
  })
  .loose();

export const efactsoftSaleHeaderSchema = z
  .object({
    // ERP linking keys (CLAUDE.md 6.4)
    id_venta: z
      .number({ message: 'the sale has no document number' })
      .int()
      .positive('the document number must be positive'),

    // Nullable on purpose: the real export contains counter sales to walk-in
    // customers (id_venta 4421, cash, $9.40) with no `id_cliente`.
    // `sale.customer_id` is nullable too, so rejecting them would invent a rule
    // the schema does not impose and would skew total sales and average ticket.
    // The service counts them separately as a control figure for PCRM-34.
    id_cliente: z.number().int().nullish(),

    // Nullable for the same reason: sale.user_id is. A sale with no
    // salesperson cannot be attributed to a route (CLAUDE.md Appendix A #2).
    id_usuario: z.number().int().nullish(),

    // 1 = quotation, 2 = completed sale (CLAUDE.md 5.5)
    estado: z.number({ message: 'the sale has no status' }).int(),

    // Source of erp_created_at and last_payment_at. NEVER the import time.
    updated_at: erpTimestamp,
    // Actual invoice date, used for the batch range.
    fecha_emision: erpTimestamp,
    created_at: erpTimestamp.optional(),

    // Amounts
    total: decimalString,
    total_neto: decimalString.nullish(),
    iva: decimalString.nullish(),
    saldop: decimalString,

    // Basis for the cash-sale criterion (CLAUDE.md 5.6).
    // In the real export: 1 = cash, 5 = credit, 6 = credit paid.
    pago: optionalText,
    id_pago: z.number().int().nullish(),

    // Customer data is embedded: the ERP does not send standalone customers
    nombres: optionalText,
    apellidos: optionalText,
    nombre_comercial: optionalText,
    cliente: optionalText,
    credito: z.number().int().nullish(),
    limite_credito: decimalString.nullish(),
    direccion: optionalText,
    telefono: optionalText,
    celular: optionalText,

    // Salesperson data is embedded too
    usuario: optionalText,

    documento: optionalText,
    observaciones: optionalText,
  })
  .loose();

export const efactsoftSaleSchema = z.object({
  venta: efactsoftSaleHeaderSchema,
  detalle: z
    .array(efactsoftSaleDetailSchema, { message: 'the sale has no detail lines' })
    .min(1, 'the sale has no detail lines'),
});

export type EfactsoftSale = z.infer<typeof efactsoftSaleSchema>;
export type EfactsoftSaleHeader = z.infer<typeof efactsoftSaleHeaderSchema>;
export type EfactsoftSaleDetail = z.infer<typeof efactsoftSaleDetailSchema>;

/**
 * Flattens Zod issues into the same shape the validation middleware uses
 * (`field: message`), so a rejection reads the same wherever it comes from.
 * This string goes straight into `sale_staging.error`.
 */
export const formatZodIssues = (error: z.ZodError): string =>
  error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
