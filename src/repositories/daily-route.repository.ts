import { Client } from '../lib/prisma';
import { generateStopsSql } from './daily-route/generate-stops.sql';

/**
 * Runs the PCRM-161 generation statement and returns how many rows it
 * actually inserted. 0 is an ordinary result — a day already generated, or a
 * seller with no weekly route on that weekday — not a failure.
 */
export const generateDailyStops = async (
  client: Client,
  sellerId: string,
  date: string,
  isoWeekday: number
): Promise<number> => client.$executeRaw(generateStopsSql(sellerId, date, isoWeekday));
