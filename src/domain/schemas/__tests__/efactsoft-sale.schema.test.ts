import { efactsoftSaleSchema, formatZodIssues } from '../efactsoft-sale.schema';

/** Venta minima valida, con la forma real del export de Efactsoft. */
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
  it('acepta una venta con la forma real del ERP', () => {
    expect(efactsoftSaleSchema.safeParse(validSale()).success).toBe(true);
  });

  it('conserva los campos que no valida', () => {
    // El payload trae 200+ campos que el CRM ignora, pero PCRM-34 los necesita.
    // Sin `.loose()` Zod los descartaria.
    const sale = validSale();
    const withExtras = {
      ...sale,
      venta: { ...sale.venta, num_control: '000000000000000', dte: null, tpv: 'TERMINAL 1' },
    };

    const result = efactsoftSaleSchema.safeParse(withExtras);

    expect(result.success).toBe(true);
    expect(result.data!.venta).toMatchObject({ num_control: '000000000000000', tpv: 'TERMINAL 1' });
  });

  it('acepta la venta de mostrador sin cliente', () => {
    // Caso real del archivo: id_venta 4421, contado, sin id_cliente.
    // `sale.customer_id` es nullable, asi que no hay motivo para rechazarla.
    const sale = validSale();
    sale.venta.id_cliente = null as never;

    expect(efactsoftSaleSchema.safeParse(sale).success).toBe(true);
  });

  it.each([
    ['dd/MM/yyyy HH:mm:ss', '05/09/2026 17:27:56'],
    ['yyyy-MM-dd HH:mm:ss', '2026-09-05 17:27:56'],
    ['dd/MM/yyyy', '05/09/2026'],
  ])('acepta updated_at en formato %s', (_label, value) => {
    const sale = validSale();
    sale.venta.updated_at = value;

    expect(efactsoftSaleSchema.safeParse(sale).success).toBe(true);
  });

  it('rechaza una fecha con formato desconocido', () => {
    const sale = validSale();
    sale.venta.updated_at = '2026/09/05T17:27';

    const result = efactsoftSaleSchema.safeParse(sale);

    expect(result.success).toBe(false);
    expect(formatZodIssues(result.error!)).toContain('venta.updated_at');
  });

  it('rechaza una venta sin id_venta', () => {
    const sale = validSale();
    delete (sale.venta as { id_venta?: number }).id_venta;

    const result = efactsoftSaleSchema.safeParse(sale);

    expect(result.success).toBe(false);
    expect(formatZodIssues(result.error!)).toContain('venta.id_venta');
  });

  it('rechaza una venta sin lineas de detalle', () => {
    const sale = validSale();
    sale.detalle = [];

    const result = efactsoftSaleSchema.safeParse(sale);

    expect(result.success).toBe(false);
    expect(formatZodIssues(result.error!)).toContain('detalle');
  });

  it('rechaza un importe que no es decimal', () => {
    const sale = validSale();
    sale.venta.total = 'tres con setenta y cinco';

    const result = efactsoftSaleSchema.safeParse(sale);

    expect(result.success).toBe(false);
    expect(formatZodIssues(result.error!)).toContain('venta.total');
  });

  it.each([
    ['3.75', 'texto decimal'],
    [3.75, 'numero'],
    ['0.0000', 'cero con decimales'],
  ])('acepta el importe %p (%s)', (value: string | number, _label: string) => {
    const sale = validSale();
    sale.venta.total = value as never;

    expect(efactsoftSaleSchema.safeParse(sale).success).toBe(true);
  });

  it('rechaza una linea de detalle sin producto', () => {
    const sale = validSale();
    delete (sale.detalle[0] as { id_producto?: number }).id_producto;

    const result = efactsoftSaleSchema.safeParse(sale);

    expect(result.success).toBe(false);
    expect(formatZodIssues(result.error!)).toContain('detalle.0.id_producto');
  });

  it.each([null, undefined, 'texto', 42, []])('rechaza el payload %p', (payload) => {
    expect(efactsoftSaleSchema.safeParse(payload).success).toBe(false);
  });
});

describe('formatZodIssues', () => {
  it('usa el formato "campo: mensaje" del resto de la API', () => {
    const result = efactsoftSaleSchema.safeParse({ venta: {}, detalle: [] });

    const message = formatZodIssues(result.error!);

    expect(message).toMatch(/venta\.id_venta: /);
    expect(message).toContain('; ');
  });
});
