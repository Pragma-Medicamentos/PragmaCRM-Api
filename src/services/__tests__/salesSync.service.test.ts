import { Client } from '../../lib/prisma';
import { syncStagedSales } from '../salesSync.service';

/**
 * Prisma client double: records what the synchronizer writes without
 * touching the database. Verification against real Postgres lives in the
 * integration tests.
 */
const createClientMock = (
  options: {
    existingCustomerId?: string | null;
    existingSale?: {
      erp_created_at: Date | null;
      last_payment_at: Date | null;
      visit_id?: string | null;
    } | null;
    existingUserId?: string | null;
    matchingVisitId?: string | null;
  } = {}
) => {
  const customers: Record<string, unknown>[] = [];
  const customerUpdates: Record<string, unknown>[] = [];
  const sales: Record<string, unknown>[] = [];
  const saleDetails: Record<string, unknown>[] = [];
  const products: Record<string, unknown>[] = [];
  const balanceSnapshots: Record<string, unknown>[] = [];
  const stagingUpdates: Record<string, unknown>[] = [];
  const uploadUpdates: Record<string, unknown>[] = [];

  const client = {
    sale_staging: {
      findMany: jest.fn(),
      update: jest.fn(async ({ where, data }: { where: { id: bigint }; data: Record<string, unknown> }) => {
        stagingUpdates.push({ id: where.id, ...data });
        return { id: where.id, ...data };
      }),
    },
    customer: {
      findFirst: jest.fn(async () =>
        options.existingCustomerId !== undefined && options.existingCustomerId !== null
          ? { id: options.existingCustomerId }
          : null
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const created = { id: 'new-customer-id', ...data };
        customers.push(created);
        return created;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        customerUpdates.push({ id: where.id, ...data });
        return { id: where.id, ...data };
      }),
    },
    app_user: {
      findFirst: jest.fn(async () =>
        options.existingUserId !== undefined && options.existingUserId !== null
          ? { id: options.existingUserId }
          : null
      ),
    },
    visit: {
      findFirst: jest.fn(async () =>
        options.matchingVisitId !== undefined && options.matchingVisitId !== null
          ? { id: options.matchingVisitId }
          : null
      ),
    },
    sale: {
      findUnique: jest.fn(async () => options.existingSale ?? null),
      upsert: jest.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const row = options.existingSale ? update : create;
        sales.push(row);
        return row;
      }),
    },
    product: {
      upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => {
        products.push(create);
        return create;
      }),
    },
    sale_detail: {
      upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => {
        saleDetails.push(create);
        return create;
      }),
    },
    balance_snapshot: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        balanceSnapshots.push(data);
        return data;
      }),
    },
    upload: {
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        uploadUpdates.push(data);
        return data;
      }),
    },
  };

  return {
    client: client as unknown as Client,
    spies: client,
    customers,
    customerUpdates,
    sales,
    saleDetails,
    products,
    balanceSnapshots,
    stagingUpdates,
    uploadUpdates,
  };
};

const stagingRow = (id: number, overrides: Record<string, unknown> = {}) => ({
  id: BigInt(id),
  upload_id: 'upload-1',
  erp_sale_id: overrides.erp_sale_id ?? 100 + id,
  status: 'pending',
  payload: {
    venta: {
      id_venta: 100 + id,
      id_cliente: 25,
      id_usuario: 26,
      estado: 2,
      updated_at: '05/09/2026 17:27:56',
      fecha_emision: '2026-09-05 17:27:17',
      total: '3.75',
      saldop: '0.00',
      ...((overrides.venta as Record<string, unknown>) ?? {}),
    },
    detalle: [
      {
        id_venta_det: (100 + id) * 10,
        id_producto: 2,
        nombre: 'ACETAMINOFEN',
        cantidad: '1',
        precio: '3.75',
        total: '3.75',
      },
    ],
  },
  error: null,
  processed_at: null,
  created_at: new Date(),
});

describe('syncStagedSales — new sale', () => {
  it('inserts customer, product, sale, sale_detail and a balance_snapshot', async () => {
    const { client, sales, products, saleDetails, balanceSnapshots, stagingUpdates, uploadUpdates } =
      createClientMock();
    (client.sale_staging.findMany as jest.Mock).mockResolvedValue([stagingRow(1)]);

    const result = await syncStagedSales(client, 'upload-1');

    expect(result).toEqual({ processed: 1, inserted: 1, updated: 0, sync_failed: 0 });
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ erp_sale_id: 101, upload_id: 'upload-1' });
    expect(products).toHaveLength(1);
    expect(saleDetails).toHaveLength(1);
    expect(balanceSnapshots).toHaveLength(1);
    expect(stagingUpdates[0]).toMatchObject({ status: 'processed' });
    expect(uploadUpdates[0]).toMatchObject({ inserted: 1, updated: 0, status: 'completed' });
  });

  it('stamps erp_created_at and last_payment_at from updated_at, never the import time', async () => {
    const { client, sales } = createClientMock();
    (client.sale_staging.findMany as jest.Mock).mockResolvedValue([stagingRow(1)]);

    await syncStagedSales(client, 'upload-1');

    // saldop is '0.00' -> already paid on arrival, so last_payment_at stamps too.
    expect((sales[0].erp_created_at as Date).toISOString()).toBe('2026-09-05T23:27:56.000Z');
    expect((sales[0].last_payment_at as Date).toISOString()).toBe('2026-09-05T23:27:56.000Z');
  });

  it('leaves last_payment_at null when the sale still has a pending balance', async () => {
    const { client, sales } = createClientMock();
    (client.sale_staging.findMany as jest.Mock).mockResolvedValue([
      stagingRow(1, { venta: { saldop: '15.00' } }),
    ]);

    await syncStagedSales(client, 'upload-1');

    expect(sales[0].last_payment_at).toBeNull();
    expect(sales[0].pending_balance).toBe('15.00');
  });

  it('leaves customer_id null for a counter sale with no id_cliente', async () => {
    const { client, sales, spies } = createClientMock();
    (client.sale_staging.findMany as jest.Mock).mockResolvedValue([
      stagingRow(1, { venta: { id_cliente: null } }),
    ]);

    await syncStagedSales(client, 'upload-1');

    expect(sales[0].customer_id).toBeNull();
    expect(spies.customer.findFirst).not.toHaveBeenCalled();
  });

  it('leaves user_id null when the ERP salesperson does not map to an app_user', async () => {
    const { client, sales } = createClientMock({ existingUserId: null });
    (client.sale_staging.findMany as jest.Mock).mockResolvedValue([stagingRow(1)]);

    await syncStagedSales(client, 'upload-1');

    expect(sales[0].user_id).toBeNull();
  });

  it('links the sale to the visit of the same customer and Salvadoran calendar day', async () => {
    const { client, sales, spies } = createClientMock({
      existingCustomerId: 'existing-customer-id',
      matchingVisitId: 'matching-visit-id',
    });
    (client.sale_staging.findMany as jest.Mock).mockResolvedValue([stagingRow(1)]);

    await syncStagedSales(client, 'upload-1');

    expect(sales[0].visit_id).toBe('matching-visit-id');
    expect(spies.visit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ customer_id: 'existing-customer-id', deleted_at: null }),
      })
    );
  });

  it('leaves visit_id null when no visit matches, without failing the import', async () => {
    const { client, sales } = createClientMock({
      existingCustomerId: 'existing-customer-id',
      matchingVisitId: null,
    });
    (client.sale_staging.findMany as jest.Mock).mockResolvedValue([stagingRow(1)]);

    await syncStagedSales(client, 'upload-1');

    expect(sales[0].visit_id).toBeNull();
  });

  it('does not look up a visit for a counter sale with no customer', async () => {
    const { client, sales, spies } = createClientMock();
    (client.sale_staging.findMany as jest.Mock).mockResolvedValue([
      stagingRow(1, { venta: { id_cliente: null } }),
    ]);

    await syncStagedSales(client, 'upload-1');

    expect(sales[0].visit_id).toBeNull();
    expect(spies.visit.findFirst).not.toHaveBeenCalled();
  });
});

describe('syncStagedSales — re-processing an existing sale (idempotency)', () => {
  it('updates instead of duplicating, and does not overwrite erp_created_at / last_payment_at', async () => {
    const firstStamp = new Date('2026-08-01T00:00:00.000Z');
    const { client, sales, uploadUpdates } = createClientMock({
      existingCustomerId: 'existing-customer-id',
      existingSale: { erp_created_at: firstStamp, last_payment_at: firstStamp },
    });
    (client.sale_staging.findMany as jest.Mock).mockResolvedValue([
      stagingRow(1, { venta: { saldop: '10.00' } }),
    ]);

    const result = await syncStagedSales(client, 'upload-1');

    expect(result).toEqual({ processed: 1, inserted: 0, updated: 1, sync_failed: 0 });
    expect(sales[0].erp_created_at).toBe(firstStamp);
    expect(sales[0].last_payment_at).toBe(firstStamp);
    // pending_balance is the one field always overwritten (CLAUDE.md 5.5).
    expect(sales[0].pending_balance).toBe('10.00');
    expect(uploadUpdates[0]).toMatchObject({ inserted: 0, updated: 1 });
  });

  it('does not overwrite an already-linked visit_id, and does not query for a new match', async () => {
    const firstStamp = new Date('2026-08-01T00:00:00.000Z');
    const { client, sales, spies } = createClientMock({
      existingCustomerId: 'existing-customer-id',
      existingSale: { erp_created_at: firstStamp, last_payment_at: firstStamp, visit_id: 'already-linked-visit' },
      matchingVisitId: 'a-different-visit',
    });
    (client.sale_staging.findMany as jest.Mock).mockResolvedValue([stagingRow(1)]);

    await syncStagedSales(client, 'upload-1');

    expect(sales[0].visit_id).toBe('already-linked-visit');
    expect(spies.visit.findFirst).not.toHaveBeenCalled();
  });

  it('updates the existing customer instead of creating a duplicate', async () => {
    const { client, customerUpdates, customers } = createClientMock({
      existingCustomerId: 'existing-customer-id',
    });
    (client.sale_staging.findMany as jest.Mock).mockResolvedValue([stagingRow(1)]);

    await syncStagedSales(client, 'upload-1');

    expect(customers).toHaveLength(0);
    expect(customerUpdates).toHaveLength(1);
    expect(customerUpdates[0].id).toBe('existing-customer-id');
  });
});

describe('syncStagedSales — every processed row is marked', () => {
  it('stamps processed_at and status processed on every row it drains', async () => {
    const { client, stagingUpdates } = createClientMock();
    (client.sale_staging.findMany as jest.Mock).mockResolvedValue([stagingRow(1), stagingRow(2)]);

    await syncStagedSales(client, 'upload-1');

    expect(stagingUpdates).toHaveLength(2);
    expect(stagingUpdates.every((row) => row.status === 'processed' && row.processed_at)).toBe(true);
  });

  it('only reads rows still pending for this upload', async () => {
    const { client, spies } = createClientMock();
    (client.sale_staging.findMany as jest.Mock).mockResolvedValue([]);

    await syncStagedSales(client, 'upload-1');

    expect(spies.sale_staging.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { upload_id: 'upload-1', status: 'pending' } })
    );
  });
});
