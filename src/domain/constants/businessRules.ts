// Business rules shared by every service that aggregates sales.
//
// None of these live in the database. They change the result of several
// indicators at once, so they belong in the technical manual as well.
// See docs/Contexto_KPIs_Pragma_CRM.md sections 2 and 5.3, and CLAUDE.md 5.6/5.8.

/**
 * ERP sale states. 1 is an unprocessed quote, 2 is a confirmed sale.
 *
 * Quotes are out of scope as of 13 Sep: they are still landed in sale_staging
 * (the importer does not filter by state) but no endpoint exposes them and no
 * aggregate ever counted them.
 */
export const ERP_STATUS_SALE = 2;

/**
 * Cash sales, excluded from collections and from the payment-days input:
 * they are born with a zero balance and would read as instant payers.
 *
 * Measured against the real ERP export: `id_pago` only ever takes 1 (Contado),
 * 5 (Crédito) and 6 (Crédito Pagado). This closes open decision D-9, which
 * assumed the criterion had to be parsed out of free text.
 */
export const CASH_PAYMENT_ID = 1;

/** Uniform credit term for every customer. Client decision, CLAUDE.md 5.6. */
export const CREDIT_TERM_DAYS = 60;
