// Settings of the derived A/B/C customer category (screens 1n / 1o). Only
// the customer metrics SQL uses them; they are business rules and belong in
// the technical manual. See docs/Contexto_KPIs_Pragma_CRM.md section 5.

/**
 * Evaluation window of the A/B/C category. Open decision D-5: no document
 * fixes it, so 12 months is our documented assumption.
 */
export const CATEGORY_WINDOW_MONTHS = 12;

/**
 * Weighted scoring of the A/B/C category, per the guide's recommended option.
 * Weights and cutoffs are a proposal, not an agreement (D-4/D-6): they need
 * the PO's and the client's sign-off.
 */
export const CATEGORY_WEIGHT_NET_PURCHASES = 0.5;
export const CATEGORY_WEIGHT_CONVERSION = 0.3;
export const CATEGORY_WEIGHT_PAYMENT_DAYS = 0.2;
export const CATEGORY_THRESHOLD_A = 70;
export const CATEGORY_THRESHOLD_B = 40;
