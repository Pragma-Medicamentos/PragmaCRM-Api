import { DateTime } from 'luxon';

import { ERP_TIMEZONE } from '../../src/lib/parseErpDate';
import { buildYesterdayDateRangeFilter } from '../lib/download-efactsoft-sales';

describe('buildYesterdayDateRangeFilter', () => {
  it('renders yesterday twice as dd/MM/yyyy - dd/MM/yyyy', () => {
    const now = DateTime.fromISO('2026-09-21T08:00:00', { zone: ERP_TIMEZONE });

    expect(buildYesterdayDateRangeFilter(now)).toBe('20/09/2026 - 20/09/2026');
  });

  it('crosses a month boundary correctly', () => {
    const now = DateTime.fromISO('2026-10-01T08:00:00', { zone: ERP_TIMEZONE });

    expect(buildYesterdayDateRangeFilter(now)).toBe('30/09/2026 - 30/09/2026');
  });
});
