import { Client } from '../lib/prisma';
import {
  linkProspectSql,
  moveProspectStopsSql,
  prospectNameMatchesSql,
} from './prospect-conversion/conversion.sql';

/*
 * Data access of the prospect conversion (PCRM-186). The SQL text lives in
 * ./prospect-conversion/conversion.sql.ts; services/prospectConversion.service.ts
 * decides what to do with each match.
 */

export interface CustomerCandidate {
  customer_id: string;
  name: string;
  erp_customer_id: number | null;
}

export interface ProspectNameMatch {
  prospect_id: string;
  prospect_name: string;
  customers: CustomerCandidate[];
}

export const findProspectNameMatches = (
  client: Client,
  prospectId?: string
): Promise<ProspectNameMatch[]> =>
  client.$queryRaw<ProspectNameMatch[]>(prospectNameMatchesSql(prospectId));

/**
 * Links and deactivates the prospect, then moves its pending stops. Returns
 * null when the prospect was converted by someone else in between (the link
 * touched no row), so nothing is moved twice.
 */
export const linkProspectToCustomer = async (
  client: Client,
  prospectId: string,
  customerId: string,
  today: string
): Promise<{ moved_stops: number } | null> => {
  const linked = await client.$executeRaw(linkProspectSql(prospectId, customerId));
  if (linked === 0) return null;

  const moved = await client.$executeRaw(moveProspectStopsSql(prospectId, customerId, today));
  return { moved_stops: moved };
};
