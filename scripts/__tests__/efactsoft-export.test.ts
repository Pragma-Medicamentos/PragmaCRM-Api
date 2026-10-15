import {
  buildDateRangeFilter,
  readCreatedDate,
  summarizeExport,
  toEfactsoftDate,
} from '../lib/efactsoft-export';

const sale = (created_at: unknown) => ({ venta: { created_at }, detalle: [] });

describe('buildDateRangeFilter', () => {
  it('renders the API range as Efactsoft expects it', () => {
    expect(buildDateRangeFilter('2026-07-03', '2026-10-15')).toBe('03/07/2026 - 15/10/2026');
  });

  it('rejects a date that is not YYYY-MM-DD', () => {
    expect(() => toEfactsoftDate('15/10/2026')).toThrow('YYYY-MM-DD');
  });
});

describe('readCreatedDate', () => {
  it('reads the dd/MM/yyyy format Efactsoft uses for created_at', () => {
    expect(readCreatedDate(sale('05/09/2026 17:27:56'))).toBe('2026-09-05');
  });

  it('also reads yyyy-MM-dd', () => {
    expect(readCreatedDate(sale('2026-09-05 17:27:56'))).toBe('2026-09-05');
  });

  it('returns null when created_at is missing', () => {
    expect(readCreatedDate({ venta: {} })).toBeNull();
    expect(readCreatedDate(null)).toBeNull();
  });
});

describe('summarizeExport', () => {
  it('reports the created_at span of an export inside the range', () => {
    const summary = summarizeExport(
      [sale('03/07/2026 09:00:00'), sale('15/10/2026 18:30:00'), sale('01/09/2026 10:00:00')],
      '2026-07-03',
      '2026-10-15'
    );

    expect(summary).toEqual({
      sales: 3,
      created_from: '2026-07-03',
      created_to: '2026-10-15',
      outside_range: 0,
    });
  });

  it('counts sales outside the range or without created_at', () => {
    const summary = summarizeExport(
      [sale('02/07/2026 23:59:59'), sale('16/10/2026 00:00:00'), sale(undefined), sale('10/09/2026 08:00:00')],
      '2026-07-03',
      '2026-10-15'
    );

    expect(summary.outside_range).toBe(3);
    expect(summary.created_from).toBe('2026-09-10');
  });
});
