import { DateTime } from 'luxon';

/**
 * Parseo de las fechas que llegan en el JSON de Efactsoft.
 *
 * El ERP mezcla dos formatos dentro del mismo payload:
 *
 *   venta.created_at / venta.updated_at   -> dd/MM/yyyy HH:mm:ss   (05/09/2026 17:27:56)
 *   venta.fecha_emision                   -> yyyy-MM-dd HH:mm:ss   (2026-09-05 17:27:17)
 *   venta.fecha / fecha_entrega           -> dd/MM/yyyy            (05/09/2026)
 *   detalle.created_at / updated_at       -> yyyy-MM-dd HH:mm:ss   (2026-09-05 17:27:56)
 *
 * Por eso no sirve `new Date(valor)`: con "05/09/2026" el motor aplica la
 * convencion estadounidense MM/dd y lo lee como 9 de mayo en vez del 5 de
 * septiembre. Es un error silencioso — devuelve una fecha valida, solo que
 * equivocada — y corromperia `sale.erp_created_at` y `sale.last_payment_at`,
 * los dos campos que segun CLAUDE.md 5.5 se estampan una vez y nunca se
 * sobrescriben.
 *
 * Ninguna de esas cadenas trae zona horaria, asi que se interpretan en la hora
 * local del cliente (CLAUDE.md 5.7).
 */

/** Zona del cliente. Ver CLAUDE.md 5.7. */
export const ERP_TIMEZONE = 'America/El_Salvador';

/**
 * Formatos aceptados, en orden de intento. Luxon exige el formato exacto, asi
 * que una cadena que no calce con ninguno se rechaza en vez de adivinarse.
 */
const TIMESTAMP_FORMATS = [
  'dd/MM/yyyy HH:mm:ss',
  'yyyy-MM-dd HH:mm:ss',
  'dd/MM/yyyy',
  'yyyy-MM-dd',
] as const;

export interface ErpDateParseResult {
  date: Date | null;
  /** Motivo del fallo, listo para `sale_staging.error`. Null si se parseo bien. */
  error: string | null;
}

const parseToDateTime = (value: unknown): DateTime | null => {
  if (typeof value !== 'string') return null;

  const raw = value.trim();
  if (raw === '') return null;

  for (const format of TIMESTAMP_FORMATS) {
    const parsed = DateTime.fromFormat(raw, format, { zone: ERP_TIMEZONE });
    if (parsed.isValid) return parsed;
  }

  return null;
};

/**
 * Parsea una marca de tiempo del ERP a un Date en UTC.
 *
 * Devuelve null si el formato no se reconoce o si la fecha no existe en el
 * calendario (31/02/2026); nunca lanza, porque el importador necesita marcar
 * esa venta como rechazada y seguir con el resto del lote.
 */
export const parseErpTimestamp = (value: unknown): Date | null =>
  parseToDateTime(value)?.toJSDate() ?? null;

/**
 * Igual que parseErpTimestamp, pero devuelve ademas el motivo del fallo para
 * poder explicarle al administrador que fecha venia mal.
 */
export const parseErpTimestampWithReason = (value: unknown): ErpDateParseResult => {
  if (typeof value !== 'string' || value.trim() === '') {
    return { date: null, error: 'fecha vacia o no es texto' };
  }

  const parsed = parseToDateTime(value);
  if (parsed) return { date: parsed.toJSDate(), error: null };

  return {
    date: null,
    error: `fecha no reconocida: "${value}" (formatos aceptados: ${TIMESTAMP_FORMATS.join(', ')})`,
  };
};

/**
 * Descarta la hora y devuelve la medianoche UTC del dia calendario
 * salvadoreno. Se usa para las columnas `date` de `upload` (range_from /
 * range_to), donde la hora no aporta nada.
 *
 * Se construye con Date.UTC a partir de los componentes locales para que
 * Postgres reciba exactamente el dia que el vendedor vio en su factura: pasar
 * el instante crudo haria que una venta de las 6 p.m. cayera al dia siguiente
 * (CLAUDE.md 5.7).
 */
export const parseErpDateOnly = (value: unknown): Date | null => {
  const parsed = parseToDateTime(value);
  if (!parsed) return null;

  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
};
