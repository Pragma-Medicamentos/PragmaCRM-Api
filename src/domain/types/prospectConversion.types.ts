/** A prospect linked to the customer it became (PCRM-186). */
export interface ProspectConversion {
  prospect_id: string;
  prospect_name: string;
  customer_id: string;
  customer_name: string;
  /** Pending stops (today onwards) moved from the prospect to the customer. */
  moved_stops: number;
}

export interface ConversionCandidate {
  customer_id: string;
  name: string;
  erp_customer_id: number | null;
}

/**
 * A prospect whose name matches two or more customers. It is not converted:
 * the name alone cannot tell which one it became, so it is only reported.
 */
export interface ProspectConversionAlert {
  prospect_id: string;
  prospect_name: string;
  candidates: ConversionCandidate[];
}

/** What the import reports about prospects after syncing the customers. */
export interface ProspectConversionSummary {
  converted: ProspectConversion[];
  alerts: ProspectConversionAlert[];
}
