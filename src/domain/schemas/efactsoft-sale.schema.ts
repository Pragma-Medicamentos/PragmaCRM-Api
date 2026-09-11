import { z } from 'zod';
import { parseErpTimestamp } from '../../lib/parseErpDate';

/**
 * Estructura del JSON que exporta Efactsoft (CLAUDE.md 6.2 y 6.3).
 *
 * Dos criterios de diseno:
 *
 * 1. Se validan SOLO los campos que hacen a una venta procesable. El payload
 *    real trae mas de 200 campos por venta (datos de DTE, tarjetas, bitcoin,
 *    recintos fiscales...) que el CRM ignora; exigirlos rechazaria ventas
 *    perfectamente validas.
 *
 * 2. Los objetos son `loose`: Zod conserva las claves desconocidas en vez de
 *    descartarlas. Aun asi, a `sale_staging.payload` se escribe el objeto
 *    CRUDO, nunca el parseado — PCRM-34 necesita el payload integro.
 */

/**
 * Los importes llegan como texto decimal ("3.75", "0.0000") y a veces como
 * numero. Se acepta cualquiera de los dos siempre que sea convertible; no se
 * transforma, porque a staging va el valor crudo.
 */
const decimalString = z.union([z.string(), z.number()]).refine(
  (value) => {
    if (typeof value === 'number') return Number.isFinite(value);
    const trimmed = value.trim();
    return trimmed !== '' && Number.isFinite(Number(trimmed));
  },
  { message: 'no es un decimal valido' }
);

/** Fecha del ERP en cualquiera de los formatos que mezcla el payload. */
const erpTimestamp = z
  .string()
  .refine((value) => parseErpTimestamp(value) !== null, {
    message: 'formato de fecha no reconocido (se espera dd/MM/yyyy HH:mm:ss o yyyy-MM-dd HH:mm:ss)',
  });

/** Texto opcional: el ERP manda null, "" o ausencia indistintamente. */
const optionalText = z.string().nullish();

export const efactsoftSaleDetailSchema = z
  .object({
    id_venta_det: z.number().int(),
    id_producto: z.number().int(),
    id_venta: z.number().int().optional(),
    nombre: z.string().min(1, 'el producto no tiene nombre'),
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
    // Llaves de vinculacion con el ERP (CLAUDE.md 6.4)
    id_venta: z.number().int().positive(),

    // Nullable a proposito: el archivo real trae ventas de mostrador a cliente
    // eventual (id_venta 4421, contado, $9.40) sin `id_cliente`. `sale.customer_id`
    // tambien es nullable en la base, asi que rechazarlas seria inventar una
    // regla que el esquema no impone y sesgaria venta total y ticket promedio.
    // El service las cuenta aparte como dato de control para PCRM-34.
    id_cliente: z.number().int().nullish(),

    // Nullable por el mismo motivo: sale.user_id lo es. Una venta sin vendedor
    // no es atribuible a ninguna ruta (CLAUDE.md Anexo A punto 2).
    id_usuario: z.number().int().nullish(),

    // 1 = cotizacion, 2 = venta realizada (CLAUDE.md 5.5)
    estado: z.number().int(),

    // Fuente de erp_created_at y last_payment_at. NUNCA la hora de importacion.
    updated_at: erpTimestamp,
    // Fecha real de la factura, base del rango del lote.
    fecha_emision: erpTimestamp,
    created_at: erpTimestamp.optional(),

    // Importes
    total: decimalString,
    total_neto: decimalString.nullish(),
    iva: decimalString.nullish(),
    saldop: decimalString,

    // Base del criterio de ventas de contado (CLAUDE.md 5.6).
    // En el archivo real: 1 = Contado, 5 = Credito, 6 = Credito Pagado.
    pago: optionalText,
    id_pago: z.number().int().nullish(),

    // Datos de cliente embebidos: el ERP no manda objetos de cliente aparte
    nombres: optionalText,
    apellidos: optionalText,
    nombre_comercial: optionalText,
    cliente: optionalText,
    credito: z.number().int().nullish(),
    limite_credito: decimalString.nullish(),
    direccion: optionalText,
    telefono: optionalText,
    celular: optionalText,

    // Datos de vendedor embebidos
    usuario: optionalText,

    documento: optionalText,
    observaciones: optionalText,
  })
  .loose();

export const efactsoftSaleSchema = z.object({
  venta: efactsoftSaleHeaderSchema,
  detalle: z
    .array(efactsoftSaleDetailSchema)
    .min(1, 'la venta no tiene lineas de detalle'),
});

export type EfactsoftSale = z.infer<typeof efactsoftSaleSchema>;
export type EfactsoftSaleHeader = z.infer<typeof efactsoftSaleHeaderSchema>;
export type EfactsoftSaleDetail = z.infer<typeof efactsoftSaleDetailSchema>;

/**
 * Aplana los issues de Zod al mismo formato que usa el middleware de
 * validacion (`campo: mensaje`), para que el motivo de rechazo se lea igual
 * venga de donde venga. Va tal cual a `sale_staging.error`.
 */
export const formatZodIssues = (error: z.ZodError): string =>
  error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
