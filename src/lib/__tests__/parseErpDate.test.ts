import {
  ERP_TIMEZONE,
  parseErpDateOnly,
  parseErpTimestamp,
  parseErpTimestampWithReason,
} from '../parseErpDate';

describe('parseErpTimestamp', () => {
  it('lee dd/MM/yyyy HH:mm:ss como dia/mes, no mes/dia', () => {
    // El caso que motiva todo el modulo: `new Date('05/09/2026 17:27:56')`
    // devolveria el 9 de mayo. Aqui tiene que ser el 5 de septiembre.
    const date = parseErpTimestamp('05/09/2026 17:27:56');

    expect(date).not.toBeNull();
    expect(date!.toISOString()).toBe('2026-09-05T23:27:56.000Z'); // 17:27:56 en UTC-6
  });

  it('lee yyyy-MM-dd HH:mm:ss', () => {
    const date = parseErpTimestamp('2026-09-05 17:27:17');

    expect(date!.toISOString()).toBe('2026-09-05T23:27:17.000Z');
  });

  it('aplica el desfase de America/El_Salvador (UTC-6)', () => {
    // Una venta facturada a las 6 p.m. pertenece al mismo dia local, aunque en
    // UTC ya sea medianoche. Ver CLAUDE.md 5.7.
    const date = parseErpTimestamp('05/09/2026 18:00:00');

    expect(date!.toISOString()).toBe('2026-09-06T00:00:00.000Z');
  });

  it.each([
    ['05/09/2026', '2026-09-05T06:00:00.000Z'],
    ['2026-09-05', '2026-09-05T06:00:00.000Z'],
  ])('acepta %s sin hora', (input, expected) => {
    expect(parseErpTimestamp(input)!.toISOString()).toBe(expected);
  });

  it.each([
    ['31/02/2026 10:00:00', 'dia que no existe en el calendario'],
    ['05-09-2026 17:27:56', 'separador equivocado'],
    ['2026/09/05 17:27:56', 'orden y separador equivocados'],
    ['', 'cadena vacia'],
    ['   ', 'solo espacios'],
    ['no es una fecha', 'texto arbitrario'],
  ])('devuelve null para %s (%s)', (input) => {
    expect(parseErpTimestamp(input)).toBeNull();
  });

  it.each([null, undefined, 12345, {}, []])('devuelve null para el valor no textual %p', (input) => {
    expect(parseErpTimestamp(input)).toBeNull();
  });

  it('no lanza nunca, para que un dato sucio no aborte el lote', () => {
    expect(() => parseErpTimestamp('31/02/2026')).not.toThrow();
  });
});

describe('parseErpTimestampWithReason', () => {
  it('devuelve la fecha y error null cuando parsea', () => {
    const result = parseErpTimestampWithReason('05/09/2026 17:27:56');

    expect(result.error).toBeNull();
    expect(result.date!.toISOString()).toBe('2026-09-05T23:27:56.000Z');
  });

  it('explica el formato rechazado', () => {
    const result = parseErpTimestampWithReason('05-09-2026');

    expect(result.date).toBeNull();
    expect(result.error).toContain('05-09-2026');
  });

  it('distingue el valor ausente del formato invalido', () => {
    expect(parseErpTimestampWithReason(null).error).toBe('fecha vacia o no es texto');
  });
});

describe('parseErpDateOnly', () => {
  it('conserva el dia local aunque la hora empuje el instante a UTC del dia siguiente', () => {
    // 23:30 del 5 de septiembre en El Salvador son las 05:30 UTC del 6. El dia
    // que importa para el reporte es el 5.
    const date = parseErpDateOnly('05/09/2026 23:30:00');

    expect(date!.toISOString()).toBe('2026-09-05T00:00:00.000Z');
  });

  it('trunca la hora', () => {
    expect(parseErpDateOnly('2026-09-05 17:27:17')!.toISOString()).toBe('2026-09-05T00:00:00.000Z');
  });

  it('devuelve null ante un formato desconocido', () => {
    expect(parseErpDateOnly('05-09-2026')).toBeNull();
  });
});

describe('ERP_TIMEZONE', () => {
  it('es la zona del cliente definida en CLAUDE.md 5.7', () => {
    expect(ERP_TIMEZONE).toBe('America/El_Salvador');
  });
});
