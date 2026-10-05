// Product metrics constants (PCRM-177). Like the rest of businessRules, they
// change several figures at once and belong in the technical manual
// (CLAUDE.md 5.8); none of them lives in the database.

/**
 * ABC (Pareto) cuts of the product detail, as a cumulative percentage of the
 * period's sold amount: A up to 80 %, B up to 95 %, C the rest.
 *
 * They match the "Reporte ABC" of docs/Contexto_KPIs_Pragma_CRM.md section 4
 * (80 % / next 15 % / rest), which is written for customers; this is the same
 * split applied to products. A product is A when the products ranked ABOVE it
 * do not yet reach 80 %, so the best seller is always A even when it is the
 * only product with sales.
 */
export const ABC_CLASS_A_MAX_SHARE = 80;
export const ABC_CLASS_B_MAX_SHARE = 95;

/** Windows of "no movement", in days, counted back from the end of the range. */
export const NO_MOVEMENT_WINDOWS_DAYS = [30, 60, 90] as const;
