import {
  ERP_TIMEZONE,
  parseErpDateOnly,
  parseErpTimestamp,
  parseErpTimestampWithReason,
} from '../parseErpDate';

describe('parseErpTimestamp', () => {
  it('reads dd/MM/yyyy HH:mm:ss as day/month, not month/day', () => {
    // The case this module exists for: `new Date('05/09/2026 17:27:56')` would
    // return May 9th. It has to be September 5th.
    const date = parseErpTimestamp('05/09/2026 17:27:56');

    expect(date).not.toBeNull();
    expect(date!.toISOString()).toBe('2026-09-05T23:27:56.000Z'); // 17:27:56 at UTC-6
  });

  it('reads yyyy-MM-dd HH:mm:ss', () => {
    const date = parseErpTimestamp('2026-09-05 17:27:17');

    expect(date!.toISOString()).toBe('2026-09-05T23:27:17.000Z');
  });

  it('applies the America/El_Salvador offset (UTC-6)', () => {
    // A sale invoiced at 6 p.m. belongs to the same local day even though it is
    // already midnight in UTC. See CLAUDE.md 5.7.
    const date = parseErpTimestamp('05/09/2026 18:00:00');

    expect(date!.toISOString()).toBe('2026-09-06T00:00:00.000Z');
  });

  it.each([
    ['05/09/2026', '2026-09-05T06:00:00.000Z'],
    ['2026-09-05', '2026-09-05T06:00:00.000Z'],
  ])('accepts %s without a time component', (input, expected) => {
    expect(parseErpTimestamp(input)!.toISOString()).toBe(expected);
  });

  it.each([
    ['31/02/2026 10:00:00', 'day that does not exist in the calendar'],
    ['05-09-2026 17:27:56', 'wrong separator'],
    ['2026/09/05 17:27:56', 'wrong order and separator'],
    ['', 'empty string'],
    ['   ', 'whitespace only'],
    ['not a date', 'arbitrary text'],
  ])('returns null for %s (%s)', (input) => {
    expect(parseErpTimestamp(input)).toBeNull();
  });

  it.each([null, undefined, 12345, {}, []])('returns null for the non-string value %p', (input) => {
    expect(parseErpTimestamp(input)).toBeNull();
  });

  it('never throws, so a dirty record cannot abort the batch', () => {
    expect(() => parseErpTimestamp('31/02/2026')).not.toThrow();
  });
});

describe('parseErpTimestampWithReason', () => {
  it('returns the date and a null error on success', () => {
    const result = parseErpTimestampWithReason('05/09/2026 17:27:56');

    expect(result.error).toBeNull();
    expect(result.date!.toISOString()).toBe('2026-09-05T23:27:56.000Z');
  });

  it('reports the rejected value', () => {
    const result = parseErpTimestampWithReason('05-09-2026');

    expect(result.date).toBeNull();
    expect(result.error).toContain('05-09-2026');
  });

  it('tells a missing value apart from an invalid format', () => {
    expect(parseErpTimestampWithReason(null).error).toBe('date is empty or not a string');
  });
});

describe('parseErpDateOnly', () => {
  it('keeps the local day even when the time pushes the instant into the next UTC day', () => {
    // 11:30 p.m. on September 5th in El Salvador is 5:30 a.m. UTC on the 6th.
    // The day that matters for reporting is the 5th.
    const date = parseErpDateOnly('05/09/2026 23:30:00');

    expect(date!.toISOString()).toBe('2026-09-05T00:00:00.000Z');
  });

  it('drops the time', () => {
    expect(parseErpDateOnly('2026-09-05 17:27:17')!.toISOString()).toBe('2026-09-05T00:00:00.000Z');
  });

  it('returns null for an unknown format', () => {
    expect(parseErpDateOnly('05-09-2026')).toBeNull();
  });
});

describe('ERP_TIMEZONE', () => {
  it('is the customer timezone defined in CLAUDE.md 5.7', () => {
    expect(ERP_TIMEZONE).toBe('America/El_Salvador');
  });
});
