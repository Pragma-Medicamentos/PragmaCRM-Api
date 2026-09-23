ALTER TABLE public.route_customer
  ADD COLUMN stop_type text NOT NULL DEFAULT 'visit';

ALTER TABLE public.route_customer
  ADD CONSTRAINT route_customer_stop_type_check
  CHECK (stop_type IN ('visit', 'dispatch', 'collection'));

COMMENT ON COLUMN public.route_customer.stop_type IS
  'Planned stop kind for this customer on the route: visit | dispatch | collection.';
