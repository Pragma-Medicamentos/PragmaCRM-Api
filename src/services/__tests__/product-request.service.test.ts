import { Client } from '../../lib/prisma';
import { CustomError } from '../../domain/errors/CustomError';
import { CreateProductRequestInput } from '../../domain/schemas/product-request.schema';
import { createProductRequest } from '../product-request.service';

const SELLER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STOP_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CUSTOMER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const VISIT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const REQUESTED_AT = new Date('2026-10-15T18:00:00.000Z');

const input = (
  overrides: Partial<CreateProductRequestInput> = {}
): CreateProductRequestInput => ({
  scheduled_visit_id: STOP_ID,
  product_name: 'Ibuprofeno 400 mg',
  requested_quantity: 12,
  ...overrides,
});

const buildClient = (opts: {
  stop?: unknown;
  visit?: unknown;
  existingProduct?: unknown;
} = {}) => {
  const client = {
    scheduled_visit: {
      findFirst: jest.fn().mockResolvedValue(
        'stop' in opts
          ? opts.stop
          : { id: STOP_ID, route_user: { user_id: SELLER_ID } }
      ),
    },
    visit: {
      findFirst: jest.fn().mockResolvedValue(
        'visit' in opts ? opts.visit : { id: VISIT_ID, customer_id: CUSTOMER_ID }
      ),
    },
    quoted_product: {
      findFirst: jest.fn().mockResolvedValue(opts.existingProduct ?? null),
      create: jest.fn().mockResolvedValue({ id: 'product-new', name: 'Ibuprofeno 400 mg' }),
    },
    product_request: {
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'request-1',
          // Prisma hands numeric columns back as Decimal; any object with a
          // numeric valueOf stands in for it here.
          requested_quantity:
            data.requested_quantity === null
              ? null
              : { valueOf: () => data.requested_quantity },
          requested_at: REQUESTED_AT,
        })
      ),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };

  return { client: client as unknown as Client, mocks: client };
};

const rejection = async (promise: Promise<unknown>): Promise<CustomError> => {
  try {
    await promise;
  } catch (error) {
    return error as CustomError;
  }
  throw new Error('Expected the promise to reject');
};

describe('createProductRequest', () => {
  it('ties the request to the visit, its customer and the seller', async () => {
    const { client, mocks } = buildClient();

    const result = await createProductRequest(client, SELLER_ID, input());

    expect(mocks.product_request.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          visit_id: VISIT_ID,
          customer_id: CUSTOMER_ID,
          user_id: SELLER_ID,
          quoted_product_id: 'product-new',
          requested_quantity: 12,
        },
      })
    );
    expect(result).toEqual({
      id: 'request-1',
      visit_id: VISIT_ID,
      customer_id: CUSTOMER_ID,
      scheduled_visit_id: STOP_ID,
      quoted_product: { id: 'product-new', name: 'Ibuprofeno 400 mg' },
      requested_quantity: 12,
      requested_at: REQUESTED_AT,
    });
  });

  it('looks the visit up by the stop', async () => {
    const { client, mocks } = buildClient();

    await createProductRequest(client, SELLER_ID, input());

    expect(mocks.visit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scheduled_visit_id: STOP_ID, deleted_at: null },
      })
    );
  });

  it('reuses an existing product matched without case', async () => {
    const { client, mocks } = buildClient({
      existingProduct: { id: 'product-old', name: 'IBUPROFENO 400 MG' },
    });

    const result = await createProductRequest(client, SELLER_ID, input());

    expect(mocks.quoted_product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          name: { equals: 'Ibuprofeno 400 mg', mode: 'insensitive' },
          deleted_at: null,
        },
      })
    );
    expect(mocks.quoted_product.create).not.toHaveBeenCalled();
    expect(result.quoted_product).toEqual({ id: 'product-old', name: 'IBUPROFENO 400 MG' });
  });

  it('locks on the product name before looking it up', async () => {
    const { client, mocks } = buildClient();

    await createProductRequest(client, SELLER_ID, input());

    expect(mocks.$executeRaw).toHaveBeenCalledTimes(1);
    const values = mocks.$executeRaw.mock.calls[0].slice(1);
    expect(values).toEqual(['quoted_product:ibuprofeno 400 mg']);
    expect(mocks.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.quoted_product.findFirst.mock.invocationCallOrder[0]
    );
  });

  it('stores a missing quantity as null', async () => {
    const { client, mocks } = buildClient();

    const result = await createProductRequest(
      client,
      SELLER_ID,
      input({ requested_quantity: undefined })
    );

    expect(mocks.product_request.create.mock.calls[0][0].data.requested_quantity).toBeNull();
    expect(result.requested_quantity).toBeNull();
  });

  it('answers 404 when the stop does not exist', async () => {
    const { client, mocks } = buildClient({ stop: null });

    const error = await rejection(createProductRequest(client, SELLER_ID, input()));

    expect(error.statusCode).toBe(404);
    expect(mocks.product_request.create).not.toHaveBeenCalled();
  });

  it('answers 403 when the stop belongs to another seller', async () => {
    const { client, mocks } = buildClient({
      stop: { id: STOP_ID, route_user: { user_id: 'other-seller' } },
    });

    const error = await rejection(createProductRequest(client, SELLER_ID, input()));

    expect(error.statusCode).toBe(403);
    expect(mocks.product_request.create).not.toHaveBeenCalled();
  });

  it('answers 422 when the stop has not been confirmed', async () => {
    const { client, mocks } = buildClient({ visit: null });

    const error = await rejection(createProductRequest(client, SELLER_ID, input()));

    expect(error.statusCode).toBe(422);
    expect(mocks.quoted_product.create).not.toHaveBeenCalled();
    expect(mocks.product_request.create).not.toHaveBeenCalled();
  });
});
