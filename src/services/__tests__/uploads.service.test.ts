import { DateTime } from 'luxon';
import { ERP_TIMEZONE } from '../../lib/parseErpDate';
import { Client } from '../../lib/prisma';
import { getSalesSyncRange } from '../uploads.service';

const buildClient = (row: Record<string, unknown> | undefined) => {
  const $queryRaw = jest.fn().mockResolvedValue(row ? [row] : []);
  return { client: { $queryRaw } as unknown as Client, $queryRaw };
};

// 2026-10-15 08:00 in El Salvador: min start 2026-09-15, max start 2026-04-18.
const now = DateTime.fromISO('2026-10-15T08:00:00', { zone: ERP_TIMEZONE });
const options = { now, minLookbackDays: 30, maxLookbackDays: 180 };

const localInstant = (iso: string) => DateTime.fromISO(iso, { zone: ERP_TIMEZONE }).toJSDate();

describe('getSalesSyncRange', () => {
  it('uses the minimum lookback when nothing owes money', async () => {
    const { client } = buildClient({
      oldest_quoted_at: null,
      pending_sales: 0,
      pending_before_cutoff: 0,
    });

    const range = await getSalesSyncRange(client, options);

    expect(range).toEqual({
      from: '2026-09-15',
      to: '2026-10-15',
      oldest_pending_date: null,
      pending_sales: 0,
      pending_outside_range: 0,
      min_lookback_days: 30,
      max_lookback_days: 180,
    });
  });

  it('keeps the minimum lookback when the oldest pending sale is more recent', async () => {
    const { client } = buildClient({
      oldest_quoted_at: localInstant('2026-10-01T09:00:00'),
      pending_sales: 4,
      pending_before_cutoff: 0,
    });

    const range = await getSalesSyncRange(client, options);

    expect(range.from).toBe('2026-09-15');
    expect(range.oldest_pending_date).toBe('2026-10-01');
  });

  it('starts at the oldest pending sale when it is older than the minimum lookback', async () => {
    const { client } = buildClient({
      oldest_quoted_at: localInstant('2026-07-03T09:00:00'),
      pending_sales: 12,
      pending_before_cutoff: 0,
    });

    const range = await getSalesSyncRange(client, options);

    expect(range.from).toBe('2026-07-03');
    expect(range.to).toBe('2026-10-15');
    expect(range.pending_outside_range).toBe(0);
  });

  it('uses the local day, not UTC, for a sale quoted after 18:00', async () => {
    // 2026-07-03 19:30 local is already 2026-07-04 in UTC.
    const { client } = buildClient({
      oldest_quoted_at: localInstant('2026-07-03T19:30:00'),
      pending_sales: 1,
      pending_before_cutoff: 0,
    });

    const range = await getSalesSyncRange(client, options);

    expect(range.from).toBe('2026-07-03');
  });

  it('caps the range at the maximum lookback and reports what it leaves out', async () => {
    const { client, $queryRaw } = buildClient({
      oldest_quoted_at: localInstant('2025-12-01T09:00:00'),
      pending_sales: 20,
      pending_before_cutoff: 2,
    });

    const range = await getSalesSyncRange(client, options);

    expect(range.from).toBe('2026-04-18');
    expect(range.oldest_pending_date).toBe('2025-12-01');
    expect(range.pending_outside_range).toBe(2);
    expect($queryRaw.mock.calls[0][0].values).toEqual([localInstant('2026-04-18T00:00:00')]);
  });

  it('never lets the maximum lookback fall below the minimum', async () => {
    const { client } = buildClient({
      oldest_quoted_at: null,
      pending_sales: 0,
      pending_before_cutoff: 0,
    });

    const range = await getSalesSyncRange(client, { now, minLookbackDays: 30, maxLookbackDays: 7 });

    expect(range.from).toBe('2026-09-15');
    expect(range.max_lookback_days).toBe(30);
  });
});
