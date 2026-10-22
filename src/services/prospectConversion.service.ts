import { Client } from '../lib/prisma';
import { CustomError } from '../domain/errors/CustomError';
import { localToday } from '../lib/localDateRange';
import {
  ProspectConversion,
  ProspectConversionSummary,
} from '../domain/types/prospectConversion.types';
import {
  ProspectNameMatch,
  findProspectNameMatches,
  linkProspectToCustomer,
} from '../repositories/prospectConversion.repository';

/*
 * Prospect → customer conversion (PCRM-186):
 *
 *      sales import (STEP 3)                 -> convertProspectsByName
 *      POST /api/v1/prospects/:id/convert    -> convertProspectByName
 *
 * The link is made by exact normalised name only: it is the one datum
 * Efactsoft shares with a prospect (CLAUDE.md 7.3). Exactly one matching
 * customer converts; two or more is an alert and nothing is linked, because
 * the name cannot tell which one it became. No match is the normal state of
 * a prospect that has not bought yet and is not reported.
 */

/** Error codes of the manual conversion, so the web can tell the 409s apart. */
export const CONVERSION_ERROR_CODES = {
  alreadyConverted: 'PROSPECT_ALREADY_CONVERTED',
  inactive: 'PROSPECT_INACTIVE',
  noMatch: 'PROSPECT_NO_MATCHING_CUSTOMER',
  ambiguous: 'PROSPECT_NAME_AMBIGUOUS',
} as const;

const convertMatch = async (
  client: Client,
  match: ProspectNameMatch,
  today: string
): Promise<ProspectConversion | null> => {
  const [customer] = match.customers;
  const linked = await linkProspectToCustomer(client, match.prospect_id, customer.customer_id, today);
  if (!linked) return null;

  return {
    prospect_id: match.prospect_id,
    prospect_name: match.prospect_name,
    customer_id: customer.customer_id,
    customer_name: customer.name,
    moved_stops: linked.moved_stops,
  };
};

/**
 * Runs over every active prospect after an import has upserted its customers.
 * Takes the caller's client so it shares the import's last transaction: if it
 * throws, the reconciliation and the upload finalisation roll back with it.
 */
export const convertProspectsByName = async (
  client: Client,
  now: Date = new Date()
): Promise<ProspectConversionSummary> => {
  const today = localToday(now);
  const matches = await findProspectNameMatches(client);
  const summary: ProspectConversionSummary = { converted: [], alerts: [] };

  for (const match of matches) {
    if (match.customers.length > 1) {
      summary.alerts.push({
        prospect_id: match.prospect_id,
        prospect_name: match.prospect_name,
        candidates: match.customers,
      });
      continue;
    }

    const converted = await convertMatch(client, match, today);
    if (converted) summary.converted.push(converted);
  }

  return summary;
};

/**
 * Manual retry for one prospect, e.g. after its name was corrected so it
 * matches Efactsoft. Same rule as the import; the admin cannot pick a
 * customer, so an ambiguous name stays an alert (409).
 */
export const convertProspectByName = async (
  client: Client,
  prospectId: string,
  now: Date = new Date()
): Promise<ProspectConversion> => {
  const prospect = await client.prospect.findFirst({
    where: { id: prospectId, deleted_at: null },
    select: { active: true, customer_id: true },
  });

  if (!prospect) throw CustomError.notFound('Prospect not found');
  if (prospect.customer_id) {
    throw CustomError.conflict(
      'Prospect is already converted',
      CONVERSION_ERROR_CODES.alreadyConverted
    );
  }
  if (!prospect.active) {
    throw CustomError.conflict('Prospect is inactive', CONVERSION_ERROR_CODES.inactive);
  }

  const [match] = await findProspectNameMatches(client, prospectId);
  if (!match) {
    throw CustomError.conflict(
      'No customer has the same name as this prospect',
      CONVERSION_ERROR_CODES.noMatch
    );
  }
  if (match.customers.length > 1) {
    const names = match.customers
      .map((c) => `${c.name} (ERP ${c.erp_customer_id ?? 'n/a'})`)
      .join(', ');
    throw CustomError.conflict(
      `The prospect name matches ${match.customers.length} customers and was not converted: ${names}`,
      CONVERSION_ERROR_CODES.ambiguous
    );
  }

  const converted = await convertMatch(client, match, localToday(now));
  if (!converted) {
    throw CustomError.conflict(
      'Prospect is already converted',
      CONVERSION_ERROR_CODES.alreadyConverted
    );
  }
  return converted;
};
