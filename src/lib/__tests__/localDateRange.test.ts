import {
  monthsTouched,
  previousRange,
  rangeDays,
  resolveRange,
} from '../localDateRange';

describe('resolveRange', () => {
  it('turns local days into El Salvador midnights (UTC-6)', () => {
    const range = resolveRange('2026-09-01', '2026-09-30');

    expect(range.start.toISOString()).toBe('2026-09-01T06:00:00.000Z');
    // Exclusive: midnight after the last day.
    expect(range.end.toISOString()).toBe('2026-10-01T06:00:00.000Z');
  });

  it('keeps a 7 p.m. local sale on the last day inside the range', () => {
    const range = resolveRange('2026-09-01', '2026-09-30');
    const sevenPm = new Date('2026-09-30T19:00:00-06:00');

    expect(sevenPm >= range.start && sevenPm < range.end).toBe(true);
  });

  it('defaults to the current local month', () => {
    // 1 October 03:00 UTC is still 30 September in El Salvador.
    const range = resolveRange(undefined, undefined, new Date('2026-10-01T03:00:00Z'));

    expect(range.from).toBe('2026-09-01');
    expect(range.to).toBe('2026-09-30');
  });

  it('defaults `to` to the end of the month of `from`', () => {
    expect(resolveRange('2026-02-10').to).toBe('2026-02-28');
  });
});

describe('previousRange', () => {
  it('returns the period of equal length right before', () => {
    const previous = previousRange(resolveRange('2026-09-01', '2026-09-30'));

    expect(previous.from).toBe('2026-08-02');
    expect(previous.to).toBe('2026-08-31');
    expect(rangeDays(previous)).toBe(30);
  });

  it('crosses the year boundary', () => {
    const previous = previousRange(resolveRange('2026-01-01', '2026-01-07'));

    expect(previous.from).toBe('2025-12-25');
    expect(previous.to).toBe('2025-12-31');
  });
});

describe('monthsTouched', () => {
  it('lists every calendar month the range overlaps', () => {
    expect(monthsTouched(resolveRange('2025-11-20', '2026-01-05'))).toEqual([
      { year: 2025, month: 11 },
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
    ]);
  });

  it('returns a single month for a range inside it', () => {
    expect(monthsTouched(resolveRange('2026-09-10', '2026-09-12'))).toEqual([
      { year: 2026, month: 9 },
    ]);
  });
});
