import { assignRoute } from '../assign-route.use-case';
import {
  RouteAssignmentRecord,
  assertActiveSeller,
  createRouteAssignment,
  getActiveAssignmentForDay,
  getRouteById,
  lockRouteDay,
} from '../../services/route.service';
import { PrismaClient } from '../../generated/prisma/client';

jest.mock('../../services/route.service');

const getRouteByIdMock = getRouteById as jest.Mock;
const assertActiveSellerMock = assertActiveSeller as jest.Mock;
const lockRouteDayMock = lockRouteDay as jest.Mock;
const getActiveAssignmentForDayMock = getActiveAssignmentForDay as jest.Mock;
const createRouteAssignmentMock = createRouteAssignment as jest.Mock;

const ROUTE_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const TX = { marker: 'tx' };

const assignment: RouteAssignmentRecord = {
  id: '33333333-3333-3333-3333-333333333333',
  route_id: ROUTE_ID,
  user_id: USER_ID,
  user_name: 'Juan Pérez',
  day: 1,
  status: null,
  created_at: new Date(),
  updated_at: new Date(),
};

const buildPrisma = () =>
  ({
    $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(TX)),
  }) as unknown as PrismaClient;

beforeEach(() => {
  jest.clearAllMocks();
  getRouteByIdMock.mockResolvedValue({ id: ROUTE_ID });
  assertActiveSellerMock.mockResolvedValue(undefined);
  lockRouteDayMock.mockResolvedValue(undefined);
});

describe('assignRoute', () => {
  it('creates the assignment when the day is free', async () => {
    getActiveAssignmentForDayMock.mockResolvedValue(null);
    createRouteAssignmentMock.mockResolvedValue(assignment);
    const client = buildPrisma();

    const result = await assignRoute(client, ROUTE_ID, { user_id: USER_ID, day: 1 });

    expect(getRouteByIdMock).toHaveBeenCalledWith(client, ROUTE_ID);
    expect(assertActiveSellerMock).toHaveBeenCalledWith(client, USER_ID);
    expect(lockRouteDayMock).toHaveBeenCalledWith(TX, ROUTE_ID, 1);
    expect(createRouteAssignmentMock).toHaveBeenCalledWith(TX, ROUTE_ID, {
      user_id: USER_ID,
      day: 1,
    });
    expect(result).toEqual(assignment);
  });

  it('fails with 409 when the day already has an active vendor', async () => {
    getActiveAssignmentForDayMock.mockResolvedValue({ id: 'existing', user_id: 'someone-else' });
    const client = buildPrisma();

    await expect(assignRoute(client, ROUTE_ID, { user_id: USER_ID, day: 1 })).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(createRouteAssignmentMock).not.toHaveBeenCalled();
  });

  it('propagates the route-not-found error without opening a transaction', async () => {
    const notFound = Object.assign(new Error('Route not found'), { statusCode: 404 });
    getRouteByIdMock.mockRejectedValue(notFound);
    const client = buildPrisma();

    await expect(assignRoute(client, ROUTE_ID, { user_id: USER_ID, day: 1 })).rejects.toThrow(
      notFound
    );
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it('propagates the vendor-validation error without opening a transaction', async () => {
    const badRequest = Object.assign(new Error('Vendor is not active'), { statusCode: 400 });
    assertActiveSellerMock.mockRejectedValue(badRequest);
    const client = buildPrisma();

    await expect(assignRoute(client, ROUTE_ID, { user_id: USER_ID, day: 1 })).rejects.toThrow(
      badRequest
    );
    expect(client.$transaction).not.toHaveBeenCalled();
  });
});
