import { Prisma } from '../../generated/prisma/client';
import { Client } from '../../lib/prisma';
import {
  currentGoalsBySeller,
  currentYearMonth,
  listSellerGoals,
  setSellerGoal,
} from '../goal.service';

const SELLER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_ID = '22222222-2222-2222-2222-222222222222';
const GOAL_ID = '33333333-3333-3333-3333-333333333333';
// 16 October 2026, 10:00 in El Salvador.
const NOW = new Date('2026-10-16T16:00:00.000Z');

const goal = (year: number, month: number, amount: string, id = `${year}-${month}`) => ({
  id,
  year,
  month,
  goal_amount: new Prisma.Decimal(amount),
  created_at: new Date(),
  updated_at: new Date(),
});

const buildClient = (goalMocks: Record<string, jest.Mock> = {}, sellerFound = true) =>
  ({
    app_user: {
      findFirst: jest.fn().mockResolvedValue(sellerFound ? { id: SELLER_ID } : null),
    },
    goal: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      ...goalMocks,
    },
  }) as unknown as Client;

describe('currentYearMonth', () => {
  it('uses the El Salvador calendar, not UTC', () => {
    // 1 November 03:00 UTC is still 31 October in El Salvador.
    expect(currentYearMonth(new Date('2026-11-01T03:00:00.000Z'))).toEqual({ year: 2026, month: 10 });
  });
});

describe('listSellerGoals', () => {
  const PAGE = { page: 2, limit: 1 };

  it('resolves the goal in force over every row, apart from the history page', async () => {
    const findFirst = jest.fn().mockResolvedValue(goal(2026, 8, '7000'));
    // The row ahead of the page, then the page itself.
    const findMany = jest.fn().mockResolvedValue([goal(2026, 12, '9000'), goal(2026, 8, '7000')]);
    const count = jest.fn().mockResolvedValue(3);

    const result = await listSellerGoals(buildClient({ findFirst, findMany, count }), SELLER_ID, PAGE, NOW);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ year: { lt: 2026 } }, { year: 2026, month: { lte: 10 } }],
        }),
      })
    );
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 2 }));
    expect(result.current).toMatchObject({ year: 2026, month: 8, goal_amount: '7000.00' });
    expect(result.history).toMatchObject({ page: 2, page_size: 1, total: 3, total_pages: 3 });
    expect(result.history.items.map((g) => g.goal_amount)).toEqual(['7000.00']);
  });

  it('closes each entry the month before the next newer one starts', async () => {
    // Page 1: no newer row, so the first entry is still in force.
    const page1 = jest.fn().mockResolvedValue([goal(2026, 7, '3100'), goal(2025, 1, '2700')]);
    const first = await listSellerGoals(
      buildClient({ findFirst: jest.fn(), findMany: page1, count: jest.fn().mockResolvedValue(2) }),
      SELLER_ID,
      { page: 1, limit: 2 },
      NOW
    );
    expect(page1).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 2 }));
    expect(first.history.items.map((g) => g.until)).toEqual([null, { year: 2026, month: 6 }]);

    // Page 2 reads the row just before it to close its first entry.
    const page2 = jest.fn().mockResolvedValue([goal(2025, 1, '2700'), goal(2024, 6, '2000')]);
    const second = await listSellerGoals(
      buildClient({ findFirst: jest.fn(), findMany: page2, count: jest.fn().mockResolvedValue(3) }),
      SELLER_ID,
      { page: 2, limit: 2 },
      NOW
    );
    expect(page2).toHaveBeenCalledWith(expect.objectContaining({ skip: 1, take: 3 }));
    expect(second.history.items).toEqual([
      expect.objectContaining({ year: 2024, month: 6, until: { year: 2024, month: 12 } }),
    ]);
  });

  it('reports no goal when the one in force is 0', async () => {
    const findFirst = jest.fn().mockResolvedValue(goal(2026, 9, '0'));
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(2);

    const result = await listSellerGoals(buildClient({ findFirst, findMany, count }), SELLER_ID, PAGE, NOW);

    expect(result.current).toBeNull();
  });

  it('fails with 404 when the seller does not exist', async () => {
    await expect(listSellerGoals(buildClient({}, false), SELLER_ID, PAGE, NOW)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('currentGoalsBySeller', () => {
  it('keeps the newest goal per seller and drops zero goals', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { user_id: SELLER_ID, goal_amount: new Prisma.Decimal('7000') },
      { user_id: OTHER_ID, goal_amount: new Prisma.Decimal('0') },
      { user_id: SELLER_ID, goal_amount: new Prisma.Decimal('5000') },
      { user_id: OTHER_ID, goal_amount: new Prisma.Decimal('4000') },
    ]);

    const goals = await currentGoalsBySeller(buildClient({ findMany }), [SELLER_ID, OTHER_ID], NOW);

    expect(Object.fromEntries(goals)).toEqual({ [SELLER_ID]: '7000.00' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ year: { lt: 2026 } }, { year: 2026, month: { lte: 10 } }],
        }),
      })
    );
  });
});

describe('setSellerGoal', () => {
  it('creates the goal when the month has none', async () => {
    const create = jest.fn().mockResolvedValue(goal(2026, 10, '8000'));
    const findFirst = jest.fn().mockResolvedValue(null);

    const result = await setSellerGoal(buildClient({ create, findFirst }), SELLER_ID, { goal_amount: 8000 }, NOW);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user_id: SELLER_ID, year: 2026, month: 10, deleted_at: null } })
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { user_id: SELLER_ID, year: 2026, month: 10, goal_amount: 8000 },
      })
    );
    expect(result.goal_amount).toBe('8000.00');
  });

  it('uses the El Salvador month, not UTC', async () => {
    const create = jest.fn().mockResolvedValue(goal(2026, 10, '8000'));
    const findFirst = jest.fn().mockResolvedValue(null);

    // 1 November 03:00 UTC is still 31 October in El Salvador.
    await setSellerGoal(buildClient({ create, findFirst }), SELLER_ID, { goal_amount: 8000 }, new Date('2026-11-01T03:00:00.000Z'));

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ year: 2026, month: 10 }) }));
  });

  it('overwrites the goal already set this month', async () => {
    const update = jest.fn().mockResolvedValue(goal(2026, 10, '8500', GOAL_ID));
    const findFirst = jest.fn().mockResolvedValue({ id: GOAL_ID });
    const create = jest.fn();

    await setSellerGoal(buildClient({ update, findFirst, create }), SELLER_ID, { goal_amount: 8500 }, NOW);

    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: GOAL_ID },
        data: expect.objectContaining({ goal_amount: 8500 }),
      })
    );
  });
});
