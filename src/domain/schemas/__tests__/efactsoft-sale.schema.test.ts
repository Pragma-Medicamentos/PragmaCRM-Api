import { efactsoftSaleSchema, formatZodIssues } from '../efactsoft-sale.schema';

/** Minimal valid sale, shaped like the real ERP export. */
const validSale = () => ({
  venta: {
    id_venta: 4778,
    id_cliente: 25,
    id_usuario: 26,
    estado: 2,
    updated_at: '05/09/2026 17:27:56',
    fecha_emision: '2026-09-05 17:27:17',
    total: '3.75',
    total_neto: '3.32',
    saldop: '0.00',
    pago: 'Contado',
    id_pago: 1,
    nombres: 'David',
    apellidos: 'Galan',
    nombre_comercial: 'DISTRIBUIDORA DE MEDICAMENTOS',
    credito: 0,
    limite_credito: '0.00',
    usuario: 'DAVID',
  },
  detalle: [
    {
      id_venta_det: 15151,
      id_producto: 2,
      nombre: 'ACETAMINOFEN 500MG TAB',
      codigo: '33670478659982011402239',
      cantidad: '1.0000',
      precio: '3.7500',
      total: '3.7500',
      um: 'CAJA X 100 TAB',
      factor: '1.00',
    },
  ],
});

describe('efactsoftSaleSchema', () => {
  it('accepts a sale shaped like the real ERP export', () => {
    expect(efactsoftSaleSchema.safeParse(validSale()).success).toBe(true);
  });

  it('keeps the fields it does not validate', () => {
    // The payload carries 200+ fields the CRM ignores, but PCRM-34 needs them.
    // Without `.loose()` Zod would strip them.
    const sale = validSale();
    const withExtras = {
      ...sale,
      venta: { ...sale.venta, num_control: '000000000000000', dte: null, tpv: 'TERMINAL 1' },
    };

    const result = efactsoftSaleSchema.safeParse(withExtras);

    expect(result.success).toBe(true);
    expect(result.data!.venta).toMatchObject({ num_control: '000000000000000', tpv: 'TERMINAL 1' });
  });

  it('accepts a counter sale with no customer', () => {
    // Real case from the export: id_venta 4421, cash, no id_cliente.
    // `sale.customer_id` is nullable, so there is no reason to reject it.
    const sale = validSale();
    sale.venta.id_cliente = null as never;

    expect(efactsoftSaleSchema.safeParse(sale).success).toBe(true);
  });

  it.each([
    ['dd/MM/yyyy HH:mm:ss', '05/09/2026 17:27:56'],
    ['yyyy-MM-dd HH:mm:ss', '2026-09-05 17:27:56'],
    ['dd/MM/yyyy', '05/09/2026'],
  ])('accepts updated_at in %s format', (_label, value) => {
    const sale = validSale();
    sale.venta.updated_at = value;

    expect(efactsoftSaleSchema.safeParse(sale).success).toBe(true);
  });

  it('rejects a date in an unknown format', () => {
    const sale = validSale();
    sale.venta.updated_at = '2026/09/05T17:27';

    const result = efactsoftSaleSchema.safeParse(sale);

    expect(result.success).toBe(false);
    expect(formatZodIssues(result.error!)).toContain('venta.updated_at');
  });

  it('rejects a sale with no id_venta', () => {
    const sale = validSale();
    delete (sale.venta as { id_venta?: number }).id_venta;

    const result = efactsoftSaleSchema.safeParse(sale);

    expect(result.success).toBe(false);
    expect(formatZodIssues(result.error!)).toContain('venta.id_venta');
  });

  it('rejects a sale with no detail lines', () => {
    const sale = validSale();
    sale.detalle = [];

    const result = efactsoftSaleSchema.safeParse(sale);

    expect(result.success).toBe(false);
    expect(formatZodIssues(result.error!)).toContain('detalle');
  });

  it('rejects an amount that is not a decimal', () => {
    const sale = validSale();
    sale.venta.total = 'three seventy five';

    const result = efactsoftSaleSchema.safeParse(sale);

    expect(result.success).toBe(false);
    expect(formatZodIssues(result.error!)).toContain('venta.total');
  });

  it.each([
    ['3.75', 'decimal text'],
    [3.75, 'number'],
    ['0.0000', 'zero with decimals'],
  ])('accepts the amount %p (%s)', (value: string | number, _label: string) => {
    const sale = validSale();
    sale.venta.total = value as never;

    expect(efactsoftSaleSchema.safeParse(sale).success).toBe(true);
  });

  it('rejects a detail line with no product', () => {
    const sale = validSale();
    delete (sale.detalle[0] as { id_producto?: number }).id_producto;

    const result = efactsoftSaleSchema.safeParse(sale);

    expect(result.success).toBe(false);
    expect(formatZodIssues(result.error!)).toContain('detalle.0.id_producto');
  });

  it.each([null, undefined, 'text', 42, []])('rejects the payload %p', (payload) => {
    expect(efactsoftSaleSchema.safeParse(payload).success).toBe(false);
  });
});

describe('formatZodIssues', () => {
  it('uses the "field: message" shape the rest of the API uses', () => {
    const result = efactsoftSaleSchema.safeParse({ venta: {}, detalle: [] });

    const message = formatZodIssues(result.error!);

    expect(message).toMatch(/venta\.id_venta: /);
    expect(message).toContain('; ');
  });

  it('reports rejection reasons in plain language, not Zod internals', () => {
    const result = efactsoftSaleSchema.safeParse({ venta: {}, detalle: [] });

    const message = formatZodIssues(result.error!);

    expect(message).toContain('the sale has no document number');
    expect(message).toContain('the sale has no detail lines');
  });
});
