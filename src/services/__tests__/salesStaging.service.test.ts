import { CustomError } from '../../domain/errors/CustomError';
import { Client } from '../../lib/prisma';
import { MAX_REJECTIONS_IN_RESPONSE, stageSalesFile } from '../salesStaging.service';

const UPLOADED_BY = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

/**
 * Prisma client double: records what the service tries to write without
 * touching the database. Verification against real Postgres lives in the
 * integration tests.
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
    {
      id_venta_det: id * 10,
      id_producto: 2,
      nombre: 'ACETAMINOFEN',
      cantidad: '1',
      precio: '3.75',
      total: '3.75',
    },
  ],
});

const toBuffer = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf-8');

describe('stageSalesFile — invalid file (all or nothing)', () => {
  it('rejects JSON that does not parse, without creating the upload', async () => {
    const { client, spies } = createClientMock();

    await expect(stageSalesFile(client, Buffer.from('{"broken":', 'utf-8'), UPLOADED_BY)).rejects.toThrow(
      CustomError
    );
    expect(spies.upload.create).not.toHaveBeenCalled();
  });

  it('rejects an object at the root instead of an array', async () => {
    const { client, spies } = createClientMock();

    await expect(stageSalesFile(client, toBuffer({}), UPLOADED_BY)).rejects.toMatchObject({ statusCode: 422 });
    expect(spies.upload.create).not.toHaveBeenCalled();
  });

  it('rejects an empty array', async () => {
    const { client, spies } = createClientMock();

    await expect(stageSalesFile(client, toBuffer([]), UPLOADED_BY)).rejects.toMatchObject({ statusCode: 422 });
    expect(spies.upload.create).not.toHaveBeenCalled();
  });

  it('rejects the file when no sale is valid', async () => {
    const { client, spies } = createClientMock();

    await expect(
      stageSalesFile(client, toBuffer([{ something_else: 1 }, { nope: 2 }]), UPLOADED_BY)
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(spies.upload.create).not.toHaveBeenCalled();
  });

  it('explains what failed in terms of the file (CA2 of HU-02)', async () => {
    const { client } = createClientMock();

    await expect(stageSalesFile(client, Buffer.from('not json', 'utf-8'), UPLOADED_BY)).rejects.toThrow(
      /not valid JSON/i
    );
  });

  it.each([
    ['broken JSON', Buffer.from('{"broken":', 'utf-8')],
    ['non-array root', Buffer.from('{}', 'utf-8')],
    ['no valid sale', Buffer.from('[{"nothing":1}]', 'utf-8')],
  ])('the %s message does not leak internals or the source ERP', async (_label, buffer) => {
    const { client } = createClientMock();

    // These messages are read by a pharmacy administrator, not a developer, so
    // they must not carry Zod phrasing ("Invalid input: expected number,
    // received undefined") or JSON.parse wording ("Unexpected end of JSON
    // input"). The source system is not named either, so the copy does not go
    // stale if the customer switches ERP.
    await expect(stageSalesFile(client, buffer, UPLOADED_BY)).rejects.toMatchObject({
      message: expect.not.stringMatching(
        /efactsoft|Invalid input|expected \w+, received|Unexpected end of|Unexpected token/i
      ),
    });
  });
});

describe('stageSalesFile — valid batch', () => {
  it('queues every sale as pending and returns the counters', async () => {
    const { client, createdUploads, stagedRows } = createClientMock();

    const result = await stageSalesFile(client, toBuffer([validSale(1), validSale(2)]), UPLOADED_BY);

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

  it('stores the raw payload, not the parsed one', async () => {
    // PCRM-34 needs all 200+ ERP fields, not just the ones Zod validates.
    const { client, stagedRows } = createClientMock();
    const sale = validSale(1);
    const withExtras = { ...sale, venta: { ...sale.venta, num_control: 'ABC', tpv: 'TERMINAL 1' } };

    await stageSalesFile(client, toBuffer([withExtras]), UPLOADED_BY);

    expect(stagedRows[0].payload).toMatchObject({
      venta: expect.objectContaining({ num_control: 'ABC', tpv: 'TERMINAL 1' }),
    });
  });

  it('computes the batch range from fecha_emision', async () => {
    const { client } = createClientMock();
    const older = validSale(1);
    older.venta.fecha_emision = '2026-08-08 08:08:24';

    const result = await stageSalesFile(client, toBuffer([validSale(2), older]), UPLOADED_BY);

    expect(result.range.from!.toISOString()).toBe('2026-08-08T00:00:00.000Z');
    expect(result.range.to!.toISOString()).toBe('2026-09-05T00:00:00.000Z');
  });

  it('records who uploaded the file', async () => {
    const { client, createdUploads } = createClientMock();

    await stageSalesFile(client, toBuffer([validSale(1)]), UPLOADED_BY);

    expect(createdUploads[0].uploaded_by).toBe(UPLOADED_BY);
  });

  it('does not touch the live tables', async () => {
    // CA2 holds by construction: a service that does not know those tables
    // cannot corrupt them.
    const { client, spies } = createClientMock();

    await stageSalesFile(client, toBuffer([validSale(1)]), UPLOADED_BY);

    expect(Object.keys(spies)).toEqual(['upload', 'sale_staging']);
  });
});

describe('stageSalesFile — partial batch', () => {
  it('accepts the good sales and flags the bad ones', async () => {
    const { client, stagedRows, createdUploads } = createClientMock();
    const badSale = { venta: { id_venta: 9 }, detalle: [] };

    const result = await stageSalesFile(client, toBuffer([validSale(1), badSale, validSale(2)]), UPLOADED_BY);

    expect(result).toMatchObject({ sales_received: 3, accepted: 2, rejected: 1 });
    expect(createdUploads[0]).toMatchObject({ sales_received: 3, failed: 1 });

    const failed = stagedRows.filter((row) => row.status === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0].error).toEqual(expect.any(String));
  });

  it('reports the position and id of every rejection', async () => {
    const { client } = createClientMock();
    const badSale = { venta: { id_venta: 777, estado: 'two' }, detalle: [] };

    const result = await stageSalesFile(client, toBuffer([validSale(1), badSale]), UPLOADED_BY);

    expect(result.rejections[0]).toMatchObject({ index: 1, erp_sale_id: 777 });
    expect(result.rejections[0].reason).toContain('detalle');
  });

  it('keeps the rejected sale in staging so it can be audited', async () => {
    const { client, stagedRows } = createClientMock();

    await stageSalesFile(client, toBuffer([validSale(1), { venta: { id_venta: 5 }, detalle: [] }]), UPLOADED_BY);

    const failed = stagedRows.find((row) => row.status === 'failed');
    expect(failed!.payload).toMatchObject({ venta: { id_venta: 5 } });
  });

  it('rejects an id_venta repeated within the same file', async () => {
    // A duplicate would break the PCRM-34 upsert against the natural key.
    const { client } = createClientMock();

    const result = await stageSalesFile(client, toBuffer([validSale(1), validSale(1)]), UPLOADED_BY);

    expect(result).toMatchObject({ accepted: 1, rejected: 1 });
    expect(result.rejections[0].reason).toContain('more than once');
  });

  it('truncates the rejection list but keeps the real total', async () => {
    const { client, stagedRows } = createClientMock();
    const many = Array.from({ length: MAX_REJECTIONS_IN_RESPONSE + 25 }, () => ({
      venta: { id_venta: 1 },
      detalle: [],
    }));

    const result = await stageSalesFile(client, toBuffer([validSale(1), ...many]), UPLOADED_BY);

    expect(result.rejected).toBe(MAX_REJECTIONS_IN_RESPONSE + 25);
    expect(result.rejections).toHaveLength(MAX_REJECTIONS_IN_RESPONSE);
    expect(result.rejections_truncated).toBe(25);
    // Staging keeps them all, truncated or not.
    expect(stagedRows).toHaveLength(MAX_REJECTIONS_IN_RESPONSE + 26);
  });
});

describe('stageSalesFile — control figures', () => {
  it('counts counter sales with no customer', async () => {
    const { client } = createClientMock();
    const counterSale = validSale(2);
    counterSale.venta.id_cliente = null as never;

    const result = await stageSalesFile(client, toBuffer([validSale(1), counterSale]), UPLOADED_BY);

    expect(result.accepted).toBe(2);
    expect(result.warnings.sales_without_customer).toBe(1);
  });

  it('counts sales with no salesperson, which no route can claim', async () => {
    const { client } = createClientMock();
    const orphan = validSale(2);
    orphan.venta.id_usuario = null as never;

    const result = await stageSalesFile(client, toBuffer([validSale(1), orphan]), UPLOADED_BY);

    expect(result.warnings.sales_without_user).toBe(1);
  });
});

describe('stageSalesFile — volume', () => {
  it('splits the insert into batches instead of one giant INSERT', async () => {
    const { client, spies, stagedRows } = createClientMock();
    const sales = Array.from({ length: 1200 }, (_, i) => validSale(i + 1));

    const result = await stageSalesFile(client, toBuffer(sales), UPLOADED_BY);

    expect(result.accepted).toBe(1200);
    expect(stagedRows).toHaveLength(1200);
    expect(spies.sale_staging.createMany).toHaveBeenCalledTimes(3); // 500 + 500 + 200
  });
});
