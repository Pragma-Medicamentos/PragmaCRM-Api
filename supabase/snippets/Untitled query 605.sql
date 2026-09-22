SELECT
  s.erp_sale_id,
  s.erp_created_at,
  s.total,
  s.net_total,
  s.pending_balance,
  s.erp_status,
  c.id AS customer_id,
  c.erp_customer_id,
  c.name AS customer_name,
  c.trade_name,
  c.municipality,
  c.zone
FROM sale s
JOIN customer c ON c.id = s.customer_id
WHERE s.deleted_at IS NULL
  AND c.deleted_at IS NULL
  AND s.erp_status = 2
ORDER BY s.erp_created_at DESC