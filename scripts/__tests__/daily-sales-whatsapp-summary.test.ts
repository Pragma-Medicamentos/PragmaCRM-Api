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
// [2026-09-05 10:00, 2026-09-06 00:00) in America/El_Salvador.
const now = DateTime.fromISO('2026-09-06T08:00:00', { zone: ERP_TIMEZONE });

describe('summarizeYesterdaySales', () => {
  it('aggregates quantity per product for completed sales after the cutoff, on the previous calendar day', () => {
    const result = summarizeYesterdaySales(fixtureSales, { now });

    expect(result).toEqual([
      { id_producto: 1, nombre: 'Amoxicilina 500mg (nombre actualizado)', cantidad: 24 },
      { id_producto: 2, nombre: 'Ibuprofeno 400mg', cantidad: 12.5 },
    ]);
  });

  it('excludes a sale created before the cutoff, even if fecha_emision is later (batch finalize)', () => {
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

  it('excludes sales from a different salesperson (defaults to IRIS)', () => {
    const result = summarizeYesterdaySales(fixtureSales, { now });

    expect(result.find((line) => line.id_producto === 6)).toBeUndefined();
  });

  it('honors an explicit user, case-insensitively', () => {
    const result = summarizeYesterdaySales(fixtureSales, { now, user: 'david' });

    expect(result).toEqual([
      { id_producto: 6, nombre: 'Otro vendedor, no debería contar', cantidad: 7 },
    ]);
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
      '10:00',
    );

    expect(message).toBe(
      '*Ventas de ayer (después de 10:00)*\n\nAmoxicilina 500mg — 24\nIbuprofeno 400mg — 12.5',
    );
  });

  it('reports an empty window explicitly', () => {
    expect(formatWhatsAppMessage([], '10:00')).toBe('Sin ventas después de las 10:00 ayer.');
  });
});
