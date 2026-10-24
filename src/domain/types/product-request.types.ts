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
