import { DateTime } from 'luxon';
import { ERP_TIMEZONE } from './parseErpDate';

/**
 * Date ranges expressed in the customer's calendar (CLAUDE.md 5.7).
 *
 * The dashboard speaks in local days ("1 to 30 September"); the database stores
 * instants. Converting here, once, lets every query use range predicates on the
 * raw timestamptz column: no `::date` in a WHERE, so the partial indexes on
 * erp_created_at / started_at stay usable, and a sale invoiced at 7 p.m. on
 * the last day stays inside the range instead of spilling into the next.
 */
export interface LocalDateRange {
  /** First local day, inclusive. `YYYY-MM-DD`. */
  from: string;
  /** Last local day, inclusive. `YYYY-MM-DD`. */
  to: string;
  /** Instant of local midnight at the start of `from`. */
  start: Date;
  /** Instant of local midnight after `to`: exclusive upper bound. */
  end: Date;
}

export interface YearMonth {
  year: number;
  month: number;
}

const localDay = (isoDate: string): DateTime =>
  DateTime.fromISO(isoDate, { zone: ERP_TIMEZONE }).startOf('day');

const build = (first: DateTime, last: DateTime): LocalDateRange => ({
  from: first.toISODate() as string,
  to: last.toISODate() as string,
  start: first.toJSDate(),
  end: last.plus({ days: 1 }).toJSDate(),
});

/**
 * Builds the range from two optional local days. Missing bounds default to the
 * current month in El Salvador, the period every panel opens with.
 */
export const resolveRange = (
  from?: string,
  to?: string,
  now: Date = new Date()
): LocalDateRange => {
  const today = DateTime.fromJSDate(now, { zone: ERP_TIMEZONE });
  const first = from ? localDay(from) : today.startOf('month');
  const last = to ? localDay(to) : first.endOf('month').startOf('day');

  return build(first, last);
};

/** Number of local days covered by the range, both ends included. */
export const rangeDays = (range: LocalDateRange): number =>
  Math.round(localDay(range.to).diff(localDay(range.from), 'days').days) + 1;

/**
 * The period of equal length that ends the day before `range` starts. Feeds
 * the deltas of the summary cards ("+8% vs. previous period").
 */
export const previousRange = (range: LocalDateRange): LocalDateRange => {
  const last = localDay(range.from).minus({ days: 1 });
  const first = last.minus({ days: rangeDays(range) - 1 });

  return build(first, last);
};

/**
 * The instant "customers without visit" is measured from: the end of the
 * range, or now if the range reaches into the future. Measuring from the end
 * of September on 22 September would count 8 days that have not happened.
 */
export const referenceInstant = (range: LocalDateRange, now: Date): Date =>
  range.end.getTime() < now.getTime() ? range.end : now;

/**
 * Calendar months the range touches, in order. Goals are monthly
 * (`goal.year`, `goal.month`), and the average monthly sale divides by this.
 */
export const monthsTouched = (range: LocalDateRange): YearMonth[] => {
  const months: YearMonth[] = [];
  const last = localDay(range.to).startOf('month');

  for (let cursor = localDay(range.from).startOf('month'); cursor <= last; cursor = cursor.plus({ months: 1 })) {
    months.push({ year: cursor.year, month: cursor.month });
  }

  return months;
};
