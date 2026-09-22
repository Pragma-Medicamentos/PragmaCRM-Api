import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DateTime } from 'luxon';

import { ERP_TIMEZONE } from '../../src/lib/parseErpDate';
import {
  ErpSale,
  formatQuantity,
  formatWhatsAppMessage,
  summarizeYesterdaySales,
} from '../lib/summarize-yesterday-sales';

const fixtureSales: ErpSale[] = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/daily-sales-sample.json'), 'utf-8'),
);

// "Today" for the fixture: yesterday is 2026-09-05, so the window is
// [2026-09-05 10:30, 2026-09-06 00:00) in America/El_Salvador.
const now = DateTime.fromISO('2026-09-06T08:00:00', { zone: ERP_TIMEZONE });

describe('summarizeYesterdaySales', () => {
  it('aggregates quantity per product for completed sales after the cutoff, on the previous calendar day', () => {
    const result = summarizeYesterdaySales(fixtureSales, { now });

    expect(result).toEqual([
      { id_producto: 1, nombre: 'Amoxicilina 500mg (nombre actualizado)', cantidad: 24 },
      { id_producto: 2, nombre: 'Ibuprofeno 400mg', cantidad: 12.5 },
    ]);
  });

  it('excludes a sale emitted before the cutoff on the previous day', () => {
    const result = summarizeYesterdaySales(fixtureSales, { now });

    expect(result.find((line) => line.id_producto === 3)).toBeUndefined();
  });

  it('excludes a sale from a day other than yesterday', () => {
    const result = summarizeYesterdaySales(fixtureSales, { now });

    expect(result.find((line) => line.id_producto === 4)).toBeUndefined();
  });

  it('excludes quotations (estado 1)', () => {
    const result = summarizeYesterdaySales(fixtureSales, { now });

    expect(result.find((line) => line.id_producto === 5)).toBeUndefined();
  });

  it('honors a custom cutoff', () => {
    // At a 19:00 cutoff, only the 18:30 sale falls out of the window too.
    const result = summarizeYesterdaySales(fixtureSales, { now, cutoff: '19:00' });

    expect(result).toEqual([]);
  });

  it('returns an empty array when nothing qualifies', () => {
    const result = summarizeYesterdaySales([], { now });

    expect(result).toEqual([]);
  });
});

describe('formatQuantity', () => {
  it.each([
    [24, '24'],
    [12.5, '12.5'],
    [12.55, '12.55'],
    [12.0, '12'],
  ])('formats %s as %s', (quantity, expected) => {
    expect(formatQuantity(quantity)).toBe(expected);
  });
});

describe('formatWhatsAppMessage', () => {
  it('renders one line per product', () => {
    const message = formatWhatsAppMessage(
      [
        { id_producto: 1, nombre: 'Amoxicilina 500mg', cantidad: 24 },
        { id_producto: 2, nombre: 'Ibuprofeno 400mg', cantidad: 12.5 },
      ],
      '10:30',
    );

    expect(message).toBe(
      '*Ventas de ayer (después de 10:30)*\n\nAmoxicilina 500mg — 24\nIbuprofeno 400mg — 12.5',
    );
  });

  it('reports an empty window explicitly', () => {
    expect(formatWhatsAppMessage([], '10:30')).toBe('Sin ventas después de las 10:30 ayer.');
  });
});
