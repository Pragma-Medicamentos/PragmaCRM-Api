import { reassignRoute } from '../reassign-route.use-case';
import {
  RouteAssignmentRecord,
  assertActiveSeller,
  createRouteAssignment,
  getActiveAssignmentForDay,
  getRouteById,
  lockRouteDay,
  softDeleteRouteAssignment,
} from '../../services/route.service';
import { PrismaClient } from '../../generated/prisma/client';

jest.mock('../../services/route.service');

const getRouteByIdMock = getRouteById as jest.Mock;
const assertActiveSellerMock = assertActiveSeller as jest.Mock;
const lockRouteDayMock = lockRouteDay as jest.Mock;
const getActiveAssignmentForDayMock = getActiveAssignmentForDay as jest.Mock;
const softDeleteRouteAssignmentMock = softDeleteRouteAssignment as jest.Mock;
const createRouteAssignmentMock = createRouteAssignment as jest.Mock;

const ROUTE_ID = '11111111-1111-1111-1111-111111111111';
const OLD_USER_ID = '22222222-2222-2222-2222-222222222222';
const NEW_USER_ID = '44444444-4444-4444-4444-444444444444';
const CURRENT_ASSIGNMENT_ID = '55555555-5555-5555-5555-555555555555';
const TX = { marker: 'tx' };

const newAssignment: RouteAssignmentRecord = {
  id: '33333333-3333-3333-3333-333333333333',
  route_id: ROUTE_ID,
  user_id: NEW_USER_ID,
  user_name: 'Nuevo Vendedor',
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

describe('reassignRoute', () => {
  it('closes the active assignment and opens a new one for the new vendor', async () => {
    getActiveAssignmentForDayMock.mockResolvedValue({
      id: CURRENT_ASSIGNMENT_ID,
      user_id: OLD_USER_ID,
    });
    createRouteAssignmentMock.mockResolvedValue(newAssignment);
    const client = buildPrisma();

    const result = await reassignRoute(client, ROUTE_ID, { user_id: NEW_USER_ID, day: 1 });

    expect(lockRouteDayMock).toHaveBeenCalledWith(TX, ROUTE_ID, 1);
    expect(softDeleteRouteAssignmentMock).toHaveBeenCalledWith(TX, CURRENT_ASSIGNMENT_ID);
    expect(createRouteAssignmentMock).toHaveBeenCalledWith(TX, ROUTE_ID, {
      user_id: NEW_USER_ID,
      day: 1,
    });
    expect(result).toEqual(newAssignment);
  });

  it('fails with 400 when the day has no active assignment', async () => {
    getActiveAssignmentForDayMock.mockResolvedValue(null);
    const client = buildPrisma();

    await expect(
      reassignRoute(client, ROUTE_ID, { user_id: NEW_USER_ID, day: 2 })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(softDeleteRouteAssignmentMock).not.toHaveBeenCalled();
    expect(createRouteAssignmentMock).not.toHaveBeenCalled();
  });

  it('fails with 409 when reassigning to the vendor already covering that day', async () => {
    getActiveAssignmentForDayMock.mockResolvedValue({
      id: CURRENT_ASSIGNMENT_ID,
      user_id: OLD_USER_ID,
    });
    const client = buildPrisma();

    await expect(
      reassignRoute(client, ROUTE_ID, { user_id: OLD_USER_ID, day: 1 })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(softDeleteRouteAssignmentMock).not.toHaveBeenCalled();
  });

  it('propagates the vendor-validation error without opening a transaction', async () => {
    const notFound = Object.assign(new Error('Vendor not found'), { statusCode: 404 });
    assertActiveSellerMock.mockRejectedValue(notFound);
    const client = buildPrisma();

    await expect(
      reassignRoute(client, ROUTE_ID, { user_id: NEW_USER_ID, day: 1 })
    ).rejects.toThrow(notFound);
    expect(client.$transaction).not.toHaveBeenCalled();
  });
});
