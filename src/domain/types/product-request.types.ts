/** Off-catalog product request as returned by POST /api/v1/product-requests (RF-11). */
export interface CreatedProductRequest {
  id: string;
  visit_id: string;
  /** Null when the visit was on a prospect (product_request.customer_id is nullable). */
  customer_id: string | null;
  scheduled_visit_id: string;
  quoted_product: { id: string; name: string };
  requested_quantity: number | null;
  requested_at: Date;
}

export interface OffCatalogDemandTotals {
  requests: number;
  products: number;
  // Prospects count too: a request can come from a prospect visit.
  customers: number;
}

export interface OffCatalogDemandProduct {
  id: string;
  name: string;
  requests: number;
  customers: number;
  approx_quantity: number | null;
  last_requested_at: Date;
}

export interface OffCatalogDemandResponse {
  period: { from: string; to: string };
  totals: OffCatalogDemandTotals;
  products: OffCatalogDemandProduct[];
}

export interface OffCatalogDemandRequest {
  id: string;
  requested_at: Date;
  requested_quantity: number | null;
  target_kind: 'customer' | 'prospect' | null;
  target_id: string | null;
  target_name: string | null;
  seller_id: string | null;
  seller_name: string | null;
}

export interface OffCatalogDemandDetailResponse {
  period: { from: string; to: string };
  product: { id: string; name: string };
  requests: OffCatalogDemandRequest[];
}

export interface DemandedProduct {
  id: string;
  name: string;
  requests: number;
}
