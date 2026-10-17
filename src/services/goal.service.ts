import { DateTime } from 'luxon';
import { Prisma } from '../generated/prisma/client';
import { Client } from '../lib/prisma';
import { CustomError } from '../domain/errors/CustomError';
import { ERP_TIMEZONE } from '../lib/parseErpDate';
import { YearMonth } from '../lib/localDateRange';
import { SetGoalInput } from '../domain/schemas/goal.schema';
import { getSellerById } from './seller.service';

/*
 * Seller goals (PCRM-173). A `goal` row is the seller's monthly goal from its
 * month onward, until a later row replaces it: the goal stays fixed without
 * loading it every month, and changing it never rewrites past months. A goal
 * of 0 means "no goal from that month on". The metrics read the same rule in
 * repositories/metrics/fragments.sql.ts (goalSlicesCte).
 */

export interface GoalRecord {
  id: string;
  year: number;
  month: number;
  goal_amount: string;
  created_at: Date;
  updated_at: Date;
}

export interface SellerGoals {
  /** Goal in force this month, or null when there is none (or it is 0). */
  current: GoalRecord | null;
  /** Every change, newest month first. */
  history: GoalRecord[];
}

const GOAL_SELECT = {
  id: true,
  year: true,
  month: true,
  goal_amount: true,
  created_at: true,
  updated_at: true,
} as const;

type GoalRow = Omit<GoalRecord, 'goal_amount'> & { goal_amount: Prisma.Decimal };

const toRecord = (row: GoalRow): GoalRecord => ({ ...row, goal_amount: row.goal_amount.toFixed(2) });

/** Calendar month of `now` in El Salvador (CLAUDE.md 5.7). */
export const currentYearMonth = (now: Date = new Date()): YearMonth => {
  const local = DateTime.fromJSDate(now, { zone: ERP_TIMEZONE });
  return { year: local.year, month: local.month };
};

const isOnOrBefore = (goal: YearMonth, month: YearMonth): boolean =>
  goal.year * 100 + goal.month <= month.year * 100 + month.month;

/** Latest goal at or before `month`, from rows sorted newest month first. */
const inForce = <T extends YearMonth>(rows: T[], month: YearMonth): T | undefined =>
  rows.find((row) => isOnOrBefore(row, month));

export const listSellerGoals = async (
  client: Client,
  sellerId: string,
  now: Date = new Date()
): Promise<SellerGoals> => {
  await getSellerById(client, sellerId);

  const rows = await client.goal.findMany({
    where: { user_id: sellerId, deleted_at: null },
    select: GOAL_SELECT,
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  });
  const history = rows.map(toRecord);
  const current = inForce(history, currentYearMonth(now));

  return {
    current: current && Number(current.goal_amount) > 0 ? current : null,
    history,
  };
};

/**
 * Goal in force this month per seller, as a money string; sellers without
 * one are absent. One query for the whole list.
 */
export const currentGoalsBySeller = async (
  client: Client,
  sellerIds: string[],
  now: Date = new Date()
): Promise<Map<string, string>> => {
  const month = currentYearMonth(now);
  const rows = await client.goal.findMany({
    where: {
      user_id: { in: sellerIds },
      deleted_at: null,
      OR: [{ year: { lt: month.year } }, { year: month.year, month: { lte: month.month } }],
    },
    select: { user_id: true, goal_amount: true },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  });

  const goals = new Map<string, string>();
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.user_id)) continue;
    seen.add(row.user_id);
    if (row.goal_amount.gt(0)) goals.set(row.user_id, row.goal_amount.toFixed(2));
  }

  return goals;
};

/**
 * Sets the goal from `year`/`month` onward. The unique index on (user_id,
 * year, month) is partial (WHERE deleted_at IS NULL), which Prisma's upsert
 * cannot target, so it is a find-then-write; a concurrent insert of the same
 * month hits the index and surfaces as a 409 (P2002).
 */
export const setSellerGoal = async (
  client: Client,
  sellerId: string,
  input: SetGoalInput
): Promise<GoalRecord> => {
  await getSellerById(client, sellerId);

  const existing = await client.goal.findFirst({
    where: { user_id: sellerId, year: input.year, month: input.month, deleted_at: null },
    select: { id: true },
  });

  const row = existing
    ? await client.goal.update({
        where: { id: existing.id },
        data: { goal_amount: input.goal_amount, updated_at: new Date() },
        select: GOAL_SELECT,
      })
    : await client.goal.create({
        data: {
          user_id: sellerId,
          year: input.year,
          month: input.month,
          goal_amount: input.goal_amount,
        },
        select: GOAL_SELECT,
      });

  return toRecord(row);
};

/**
 * Soft-deletes one goal change, for undoing a mistake: the previous goal is
 * back in force from that month on.
 */
export const deleteSellerGoal = async (
  client: Client,
  sellerId: string,
  goalId: string
): Promise<void> => {
  await getSellerById(client, sellerId);

  const { count } = await client.goal.updateMany({
    where: { id: goalId, user_id: sellerId, deleted_at: null },
    data: { deleted_at: new Date(), updated_at: new Date() },
  });

  if (count === 0) throw CustomError.notFound('Goal not found');
};
