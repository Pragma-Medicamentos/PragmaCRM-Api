import { DateTime } from 'luxon';
import { envs } from '../config/envs';

/**
 * Parsing for the date formats found in the ERP sales export.
 *
 * The ERP mixes two formats within the same payload:
 *
 *   venta.created_at / venta.updated_at   -> dd/MM/yyyy HH:mm:ss   (05/09/2026 17:27:56)
 *   venta.fecha_emision                   -> yyyy-MM-dd HH:mm:ss   (2026-09-05 17:27:17)
 *   venta.fecha / fecha_entrega           -> dd/MM/yyyy            (05/09/2026)
 *   detalle.created_at / updated_at       -> yyyy-MM-dd HH:mm:ss   (2026-09-05 17:27:56)
 *
 * This is why `new Date(value)` cannot be used: for "05/09/2026" the engine
 * applies the US MM/dd convention and reads it as May 9th instead of September
 * 5th. The failure is silent — it returns a valid date, just the wrong one —
 * and would corrupt `sale.erp_created_at` and `sale.last_payment_at`, the two
 * columns that are stamped once and never overwritten (CLAUDE.md 5.5).
 *
 * None of these strings carry a timezone, so they are interpreted in the
 * customer's local time (CLAUDE.md 5.7).
 */

/**
 * Customer timezone, from envs.BUSINESS_TIMEZONE (default America/El_Salvador).
 * See CLAUDE.md 5.7. Kept under this name because the importer, the visits
 * service and the metrics engine already import it from here.
 */
export const ERP_TIMEZONE = envs.BUSINESS_TIMEZONE;

/**
 * Accepted formats, in the order they are tried. Luxon requires an exact
 * match, so a string that fits none of them is rejected rather than guessed.
 */
const TIMESTAMP_FORMATS = [
  'dd/MM/yyyy HH:mm:ss',
  'yyyy-MM-dd HH:mm:ss',
  'dd/MM/yyyy',
  'yyyy-MM-dd',
] as const;

export interface ErpDateParseResult {
  date: Date | null;
  /** Failure reason, ready for `sale_staging.error`. Null when parsing succeeds. */
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
 * Parses an ERP timestamp into a UTC Date.
 *
 * Returns null when the format is unknown or the date does not exist in the
 * calendar (31/02/2026). It never throws: the importer needs to flag that one
 * sale as rejected and carry on with the rest of the batch.
 */
export const parseErpTimestamp = (value: unknown): Date | null =>
  parseToDateTime(value)?.toJSDate() ?? null;

/**
 * Same as parseErpTimestamp, but also reports why parsing failed so the
 * administrator can be told which date was malformed.
 */
export const parseErpTimestampWithReason = (value: unknown): ErpDateParseResult => {
  if (typeof value !== 'string' || value.trim() === '') {
    return { date: null, error: 'date is empty or not a string' };
  }

  const parsed = parseToDateTime(value);
  if (parsed) return { date: parsed.toJSDate(), error: null };

  return {
    date: null,
    error: `unrecognized date: "${value}" (accepted formats: ${TIMESTAMP_FORMATS.join(', ')})`,
  };
};

/**
 * Drops the time and returns UTC midnight of the Salvadoran calendar day. Used
 * for the `date` columns of `upload` (range_from / range_to), where the time
 * adds nothing.
 *
 * It is rebuilt with Date.UTC from the local components so Postgres stores the
 * same day the salesperson saw on the invoice: passing the raw instant would
 * push a 6 p.m. sale into the following day (CLAUDE.md 5.7).
 */
export const parseErpDateOnly = (value: unknown): Date | null => {
  const parsed = parseToDateTime(value);
  if (!parsed) return null;

  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
};
