export interface CreatedProspect {
  id: string;
  name: string;
  phone: string | null;
  user_id: string;
  location: { lat: number; lng: number };
  created_at: string;
  captured_at: string;
  status: string | null;
  /** PCRM-186: false once converted to a customer. */
  active: boolean;
  /** PCRM-186: the customer it became, null while still a prospect. */
  customer_id: string | null;
  converted_at: string | null;
  sanitary_registration: string | null;
  nrc: string | null;
  nit: string | null;
  email: string | null;
}

/** DELETE /api/v1/prospects/:id: soft delete plus its pending stops removed. */
export interface DeletedProspect {
  id: string;
  deleted: true;
  /** Pending stops (today on, not executed) soft-deleted with the prospect. */
  removed_stops: number;
}

export interface ProspectListItem {
  id: string;
  name: string;
  phone: string | null;
  user_id: string;
  seller_name: string;
  location: { lat: number; lng: number } | null;
  created_at: string;
  status: string | null;
  /** PCRM-186: false once converted to a customer. */
  active: boolean;
  /** PCRM-186: the customer it became, null while still a prospect. */
  customer_id: string | null;
  converted_at: string | null;
  sanitary_registration: string | null;
  nrc: string | null;
  nit: string | null;
  email: string | null;
}
