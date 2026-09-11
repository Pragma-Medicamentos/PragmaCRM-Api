import { CustomError } from '../../domain/errors/CustomError';
import { Client } from '../../lib/prisma';
import { MAX_REJECTIONS_IN_RESPONSE, stageSalesFile } from '../salesStaging.service';

/**
 * Doble del cliente de Prisma: registra lo que el service intenta escribir sin
 * tocar la base. La verificacion contra Postgres real esta en los tests de
 * integracion.
 */
const createClientMock = () => {
  const createdUploads: Record<string, unknown>[] = [];
  const stagedRows: Record<string, unknown>[] = [];

  const client = {
    upload: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        createdUploads.push(data);
        return { id: 'upload-uuid-1', ...data };
      }),
    },
    sale_staging: {
      createMany: jest.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        stagedRows.push(...data);
        return { count: data.length };
      }),
    },
  };

  return { client: client as unknown as Client, createdUploads, stagedRows, spies: client };
};

const validSale = (id: number) => ({
  venta: {
    id_venta: id,
    id_cliente: 25,
    id_usuario: 26,
    estado: 2,
    updated_at: '05/09/2026 17:27:56',
    fecha_emision: '2026-09-05 17:27:17',
    total: '3.75',
    saldop: '0.00',
  },
  detalle: [
    { id_venta_det: id * 10, id_producto: 2, nombre: 'ACETAMINOFEN', cantidad: '1', precio: '3.75', total: '3.75' },
  ],
});

const toBuffer = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf-8');

describe('stageSalesFile — archivo invalido (todo o nada)', () => {
  it('rechaza un JSON que no parsea, sin crear el upload', async () => {
    const { client, spies } = createClientMock();

    await expect(stageSalesFile(client, Buffer.from('{"roto":', 'utf-8'))).rejects.toThrow(
      CustomError
    );
    expect(spies.upload.create).not.toHaveBeenCalled();
  });

  it('rechaza un objeto en la raiz en vez de un arreglo', async () => {
    const { client, spies } = createClientMock();

    await expect(stageSalesFile(client, toBuffer({}))).rejects.toMatchObject({ statusCode: 422 });
    expect(spies.upload.create).not.toHaveBeenCalled();
  });

  it('rechaza un arreglo vacio', async () => {
    const { client, spies } = createClientMock();

    await expect(stageSalesFile(client, toBuffer([]))).rejects.toMatchObject({ statusCode: 422 });
    expect(spies.upload.create).not.toHaveBeenCalled();
  });

  it('rechaza el archivo si ninguna venta es valida', async () => {
    const { client, spies } = createClientMock();

    await expect(
      stageSalesFile(client, toBuffer([{ otra_cosa: 1 }, { tampoco: 2 }]))
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(spies.upload.create).not.toHaveBeenCalled();
  });

  it('explica que fallo en terminos del archivo (CA2 de la HU-02)', async () => {
    const { client } = createClientMock();

    await expect(stageSalesFile(client, Buffer.from('no soy json', 'utf-8'))).rejects.toThrow(
      /no es un JSON valido/i
    );
  });

  it.each([
    ['JSON roto', Buffer.from('{"roto":', 'utf-8')],
    ['raiz que no es arreglo', Buffer.from('{}', 'utf-8')],
    ['ninguna venta valida', Buffer.from('[{"nada":1}]', 'utf-8')],
  ])('el mensaje de %s no filtra detalle interno ni el ERP de origen', async (_label, buffer) => {
    const { client } = createClientMock();

    // Los mensajes los lee un administrador de drogueria, no un desarrollador:
    // nada de jerga de Zod o del runtime. Y no se nombra el sistema de origen,
    // para que no queden mintiendo si el cliente cambia de ERP.
    await expect(stageSalesFile(client, buffer)).rejects.toMatchObject({
      message: expect.not.stringMatching(/efactsoft|Invalid input|expected |received |Unexpected /i),
    });
  });
});

describe('stageSalesFile — lote valido', () => {
  it('encola cada venta como pending y devuelve los contadores', async () => {
    const { client, createdUploads, stagedRows } = createClientMock();

    const result = await stageSalesFile(client, toBuffer([validSale(1), validSale(2)]));

    expect(result).toMatchObject({
      upload_id: 'upload-uuid-1',
      sales_received: 2,
      accepted: 2,
      rejected: 0,
    });
    expect(stagedRows).toHaveLength(2);
    expect(stagedRows.every((row) => row.status === 'pending')).toBe(true);
    expect(createdUploads[0]).toMatchObject({ sales_received: 2, failed: 0, status: 'staged' });
  });

  it('guarda el payload crudo, no el parseado', async () => {
    // PCRM-34 necesita los 200+ campos del ERP, no solo los que valida Zod.
    const { client, stagedRows } = createClientMock();
    const sale = validSale(1);
    const withExtras = { ...sale, venta: { ...sale.venta, num_control: 'ABC', tpv: 'TERMINAL 1' } };

    await stageSalesFile(client, toBuffer([withExtras]));

    expect(stagedRows[0].payload).toMatchObject({
      venta: expect.objectContaining({ num_control: 'ABC', tpv: 'TERMINAL 1' }),
    });
  });

  it('calcula el rango del lote desde fecha_emision', async () => {
    const { client } = createClientMock();
    const older = validSale(1);
    older.venta.fecha_emision = '2026-08-08 08:08:24';

    const result = await stageSalesFile(client, toBuffer([validSale(2), older]));

    expect(result.range.from!.toISOString()).toBe('2026-08-08T00:00:00.000Z');
    expect(result.range.to!.toISOString()).toBe('2026-09-05T00:00:00.000Z');
  });

  it('deja uploaded_by en null mientras no haya autenticacion', async () => {
    const { client, createdUploads } = createClientMock();

    await stageSalesFile(client, toBuffer([validSale(1)]));

    expect(createdUploads[0].uploaded_by).toBeNull();
  });

  it('no toca las tablas vivas', async () => {
    // El CA2 se cumple por construccion: si el service no conoce esas tablas,
    // no puede corromperlas.
    const { client, spies } = createClientMock();

    await stageSalesFile(client, toBuffer([validSale(1)]));

    expect(Object.keys(spies)).toEqual(['upload', 'sale_staging']);
  });
});

describe('stageSalesFile — lote parcial', () => {
  it('acepta las ventas buenas y marca las malas', async () => {
    const { client, stagedRows, createdUploads } = createClientMock();
    const badSale = { venta: { id_venta: 9 }, detalle: [] };

    const result = await stageSalesFile(client, toBuffer([validSale(1), badSale, validSale(2)]));

    expect(result).toMatchObject({ sales_received: 3, accepted: 2, rejected: 1 });
    expect(createdUploads[0]).toMatchObject({ sales_received: 3, failed: 1 });

    const failed = stagedRows.filter((row) => row.status === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0].error).toEqual(expect.any(String));
  });

  it('reporta la posicion y el id de cada rechazo', async () => {
    const { client } = createClientMock();
    const badSale = { venta: { id_venta: 777, estado: 'dos' }, detalle: [] };

    const result = await stageSalesFile(client, toBuffer([validSale(1), badSale]));

    expect(result.rejections[0]).toMatchObject({ index: 1, erp_sale_id: 777 });
    expect(result.rejections[0].reason).toContain('detalle');
  });

  it('conserva en staging la venta rechazada para poder auditarla', async () => {
    const { client, stagedRows } = createClientMock();

    await stageSalesFile(client, toBuffer([validSale(1), { venta: { id_venta: 5 }, detalle: [] }]));

    const failed = stagedRows.find((row) => row.status === 'failed');
    expect(failed!.payload).toMatchObject({ venta: { id_venta: 5 } });
  });

  it('rechaza el id_venta repetido dentro del mismo archivo', async () => {
    // Un duplicado reventaria el upsert de PCRM-34 contra la PK natural.
    const { client } = createClientMock();

    const result = await stageSalesFile(client, toBuffer([validSale(1), validSale(1)]));

    expect(result).toMatchObject({ accepted: 1, rejected: 1 });
    expect(result.rejections[0].reason).toContain('mas de una vez');
  });

  it('trunca la lista de rechazos pero conserva el total', async () => {
    const { client, stagedRows } = createClientMock();
    const many = Array.from({ length: MAX_REJECTIONS_IN_RESPONSE + 25 }, () => ({
      venta: { id_venta: 1 },
      detalle: [],
    }));

    const result = await stageSalesFile(client, toBuffer([validSale(1), ...many]));

    expect(result.rejected).toBe(MAX_REJECTIONS_IN_RESPONSE + 25);
    expect(result.rejections).toHaveLength(MAX_REJECTIONS_IN_RESPONSE);
    expect(result.rejections_truncated).toBe(25);
    // En staging quedan todos, truncados o no.
    expect(stagedRows).toHaveLength(MAX_REJECTIONS_IN_RESPONSE + 26);
  });
});

describe('stageSalesFile — datos de control', () => {
  it('cuenta las ventas de mostrador sin cliente', async () => {
    const { client } = createClientMock();
    const counterSale = validSale(2);
    counterSale.venta.id_cliente = null as never;

    const result = await stageSalesFile(client, toBuffer([validSale(1), counterSale]));

    expect(result.accepted).toBe(2);
    expect(result.warnings.sales_without_customer).toBe(1);
  });

  it('cuenta las ventas sin vendedor, que no son atribuibles a ninguna ruta', async () => {
    const { client } = createClientMock();
    const orphan = validSale(2);
    orphan.venta.id_usuario = null as never;

    const result = await stageSalesFile(client, toBuffer([validSale(1), orphan]));

    expect(result.warnings.sales_without_user).toBe(1);
  });
});

describe('stageSalesFile — volumen', () => {
  it('parte la insercion en lotes en vez de un solo INSERT gigante', async () => {
    const { client, spies, stagedRows } = createClientMock();
    const sales = Array.from({ length: 1200 }, (_, i) => validSale(i + 1));

    const result = await stageSalesFile(client, toBuffer(sales));

    expect(result.accepted).toBe(1200);
    expect(stagedRows).toHaveLength(1200);
    expect(spies.sale_staging.createMany).toHaveBeenCalledTimes(3); // 500 + 500 + 200
  });
});
