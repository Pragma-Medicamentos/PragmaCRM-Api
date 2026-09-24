export interface ProductListItem {
  erp_product_id: number;
  code: string | null;
  name: string;
  product_group: string | null;
  last_seen_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
