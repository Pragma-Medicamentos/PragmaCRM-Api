SET local check_function_bodies = off;

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "service_role";

CREATE EXTENSION "postgis" SCHEMA "extensions";

CREATE SEQUENCE "public"."balance_snapshot_id_seq" AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;

CREATE SEQUENCE "public"."sale_staging_id_seq" AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;

CREATE TABLE "public"."app_user" (
  "id"            uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "erp_user_id"   integer,
  "clerk_user_id" text,
  "role"          text                     NOT NULL,
  "name"          text                     NOT NULL,
  "email"         text,
  "active"        boolean                  NOT NULL DEFAULT true,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at"    timestamp with time zone,
  CONSTRAINT "app_user_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."app_user"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."balance_snapshot" (
  "id"              bigint                   NOT NULL DEFAULT nextval('public.balance_snapshot_id_seq'::regclass),
  "upload_id"       uuid,
  "erp_sale_id"     integer,
  "pending_balance" numeric(14,2),
  "payment"         text,
  "captured_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "balance_snapshot_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."balance_snapshot"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."customer" (
  "id"                 uuid                             NOT NULL DEFAULT gen_random_uuid(),
  "erp_customer_id"    integer,
  "personality"        text,
  "potential"          text,
  "name"               text                             NOT NULL,
  "trade_name"         text,
  "establishment_type" text,
  "address"            text,
  "municipality"       text,
  "zone"               text,
  "phone"              text,
  "mobile"             text,
  "location"           extensions.geography(Point,4326),
  "place_id"           text,
  "attends"            text,
  "credit"             boolean                          NOT NULL DEFAULT false,
  "credit_limit"       numeric(14,2),
  "origin"             text,
  "active"             boolean                          NOT NULL DEFAULT true,
  "created_at"         timestamp with time zone         NOT NULL DEFAULT now(),
  "updated_at"         timestamp with time zone         NOT NULL DEFAULT now(),
  "deleted_at"         timestamp with time zone,
  CONSTRAINT "customer_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."customer"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."goal" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "user_id"     uuid                     NOT NULL,
  "year"        smallint                 NOT NULL,
  "month"       smallint                 NOT NULL,
  "goal_amount" numeric(14,2)            NOT NULL,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at"  timestamp with time zone,
  CONSTRAINT "goal_month_check" CHECK (((month >= 1) AND (month <= 12))),
  CONSTRAINT "goal_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."goal"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."product_request" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "visit_id"           uuid,
  "customer_id"        uuid,
  "user_id"            uuid,
  "quoted_product_id"  uuid,
  "requested_quantity" numeric(12,3),
  "requested_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at"         timestamp with time zone,
  CONSTRAINT "product_request_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."product_request"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."product" (
  "erp_product_id" integer                  NOT NULL,
  "code"           text,
  "name"           text                     NOT NULL,
  "product_group"  text,
  "last_seen_at"   timestamp with time zone,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at"     timestamp with time zone,
  CONSTRAINT "product_pkey" PRIMARY KEY (erp_product_id)
);

ALTER TABLE "public"."product"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."prospect" (
  "id"         uuid                             NOT NULL DEFAULT gen_random_uuid(),
  "user_id"    uuid                             NOT NULL,
  "name"       text                             NOT NULL,
  "trade_name" text,
  "address"    text,
  "phone"      text,
  "location"   extensions.geography(Point,4326),
  "status"     text,
  "created_at" timestamp with time zone         NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone         NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone,
  CONSTRAINT "prospect_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."prospect"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."quoted_product" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"       text                     NOT NULL,
  "code"       text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone,
  CONSTRAINT "quoted_product_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."quoted_product"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."route_customer" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "route_id"    uuid                     NOT NULL,
  "customer_id" uuid                     NOT NULL,
  "sort_order"  smallint,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at"  timestamp with time zone,
  CONSTRAINT "route_customer_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."route_customer"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."route_user" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "route_id"   uuid                     NOT NULL,
  "user_id"    uuid                     NOT NULL,
  "day"        smallint,
  "status"     text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone,
  CONSTRAINT "route_user_day_check" CHECK (((day >= 1) AND (day <= 7))),
  CONSTRAINT "route_user_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."route_user"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."route" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"         text                     NOT NULL,
  "municipality" text,
  "zone"         text,
  "active"       boolean                  NOT NULL DEFAULT true,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at"   timestamp with time zone,
  CONSTRAINT "route_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."route"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."sale_detail" (
  "sale_detail_id"  integer                  NOT NULL,
  "erp_sale_id"     integer                  NOT NULL,
  "product_id"      integer,
  "quantity"        numeric(12,4),
  "unit_of_measure" text,
  "factor"          numeric(10,2),
  "price"           numeric(14,4),
  "total"           numeric(14,2),
  "tax_total"       numeric(14,4),
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "sale_detail_pkey" PRIMARY KEY (sale_detail_id)
);

ALTER TABLE "public"."sale_detail"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."sale_staging" (
  "id"           bigint                   NOT NULL DEFAULT nextval('public.sale_staging_id_seq'::regclass),
  "upload_id"    uuid                     NOT NULL,
  "erp_sale_id"  integer,
  "payload"      jsonb                    NOT NULL,
  "status"       text                     NOT NULL DEFAULT 'pending'::text,
  "error"        text,
  "processed_at" timestamp with time zone,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "sale_staging_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."sale_staging"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."sale" (
  "erp_sale_id"     integer                  NOT NULL,
  "customer_id"     uuid,
  "upload_id"       uuid,
  "user_id"         uuid,
  "visit_id"        uuid,
  "erp_created_at"  timestamp with time zone,
  "last_payment_at" timestamp with time zone,
  "total"           numeric(14,2),
  "net_total"       numeric(14,2),
  "vat"             numeric(14,2),
  "pending_balance" numeric(14,2),
  "payment"         text,
  "payment_id"      smallint,
  "erp_status"      smallint,
  "document"        text,
  "remarks"         text,
  "absent"          boolean                  NOT NULL DEFAULT false,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at"      timestamp with time zone,
  CONSTRAINT "sale_pkey" PRIMARY KEY (erp_sale_id)
);

ALTER TABLE "public"."sale"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."scheduled_visit" (
  "id"            uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "route_user_id" uuid                     NOT NULL,
  "visit_date"    date                     NOT NULL,
  "customer_id"   uuid,
  "prospect_id"   uuid,
  "stop_type"     text                     NOT NULL DEFAULT 'visit'::text,
  "reason"        text,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at"    timestamp with time zone,
  CONSTRAINT "scheduled_visit_pkey" PRIMARY KEY (id),
  CONSTRAINT "scheduled_visit_target_chk" CHECK ((num_nonnulls(customer_id, prospect_id) = 1))
);

ALTER TABLE "public"."scheduled_visit"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."upload" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "uploaded_by"    uuid,
  "range_from"     date,
  "range_to"       date,
  "sales_received" integer                  NOT NULL DEFAULT 0,
  "inserted"       integer                  NOT NULL DEFAULT 0,
  "updated"        integer                  NOT NULL DEFAULT 0,
  "failed"         integer                  NOT NULL DEFAULT 0,
  "status"         text                     NOT NULL DEFAULT 'pending'::text,
  "uploaded_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "upload_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."upload"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."visit" (
  "id"                uuid                             NOT NULL DEFAULT gen_random_uuid(),
  "customer_id"       uuid                             NOT NULL,
  "user_id"           uuid                             NOT NULL,
  "route_user_id"     uuid,
  "route_customer_id" uuid,
  "started_at"        timestamp with time zone,
  "finished_at"       timestamp with time zone,
  "checkin_location"  extensions.geography(Point,4326),
  "distance_meters"   numeric(8,2),
  "visit_type"        text,
  "successful"        boolean,
  "no_order_reason"   text,
  "notes"             text,
  "created_at"        timestamp with time zone         NOT NULL DEFAULT now(),
  "updated_at"        timestamp with time zone         NOT NULL DEFAULT now(),
  "deleted_at"        timestamp with time zone,
  CONSTRAINT "visit_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."visit"
  ENABLE ROW LEVEL SECURITY;

ALTER SEQUENCE "public"."balance_snapshot_id_seq" OWNED BY "public"."balance_snapshot"."id";

ALTER SEQUENCE "public"."sale_staging_id_seq" OWNED BY "public"."sale_staging"."id";

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
  RETURNS event_trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog'
  AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
    new.updated_at := now();
    return new;
end;
$function$;

ALTER TABLE "public"."goal"
  ADD CONSTRAINT "goal_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.app_user(id);

ALTER TABLE "public"."product_request"
  ADD CONSTRAINT "product_request_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES public.customer(id);

ALTER TABLE "public"."product_request"
  ADD CONSTRAINT "product_request_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.app_user(id);

ALTER TABLE "public"."prospect"
  ADD CONSTRAINT "prospect_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.app_user(id);

ALTER TABLE "public"."product_request"
  ADD CONSTRAINT "product_request_quoted_product_id_fkey" FOREIGN KEY (quoted_product_id) REFERENCES public.quoted_product(id);

ALTER TABLE "public"."route_customer"
  ADD CONSTRAINT "route_customer_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES public.customer(id);

ALTER TABLE "public"."route_customer"
  ADD CONSTRAINT "route_customer_route_id_fkey" FOREIGN KEY (route_id) REFERENCES public.route(id);

ALTER TABLE "public"."route_user"
  ADD CONSTRAINT "route_user_route_id_fkey" FOREIGN KEY (route_id) REFERENCES public.route(id);

ALTER TABLE "public"."route_user"
  ADD CONSTRAINT "route_user_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.app_user(id);

ALTER TABLE "public"."sale"
  ADD CONSTRAINT "sale_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES public.customer(id);

ALTER TABLE "public"."balance_snapshot"
  ADD CONSTRAINT "balance_snapshot_erp_sale_id_fkey" FOREIGN KEY (erp_sale_id) REFERENCES public.sale(erp_sale_id);

ALTER TABLE "public"."sale"
  ADD CONSTRAINT "sale_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.app_user(id);

ALTER TABLE "public"."sale_detail"
  ADD CONSTRAINT "sale_detail_erp_sale_id_fkey" FOREIGN KEY (erp_sale_id) REFERENCES public.sale(erp_sale_id) ON DELETE CASCADE;

ALTER TABLE "public"."sale_detail"
  ADD CONSTRAINT "sale_detail_product_id_fkey" FOREIGN KEY (product_id) REFERENCES public.product(erp_product_id);

ALTER TABLE "public"."scheduled_visit"
  ADD CONSTRAINT "scheduled_visit_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES public.customer(id);

ALTER TABLE "public"."scheduled_visit"
  ADD CONSTRAINT "scheduled_visit_prospect_id_fkey" FOREIGN KEY (prospect_id) REFERENCES public.prospect(id);

ALTER TABLE "public"."scheduled_visit"
  ADD CONSTRAINT "scheduled_visit_route_user_id_fkey" FOREIGN KEY (route_user_id) REFERENCES public.route_user(id);

ALTER TABLE "public"."balance_snapshot"
  ADD CONSTRAINT "balance_snapshot_upload_id_fkey" FOREIGN KEY (upload_id) REFERENCES public.upload(id);

ALTER TABLE "public"."sale"
  ADD CONSTRAINT "sale_upload_id_fkey" FOREIGN KEY (upload_id) REFERENCES public.upload(id);

ALTER TABLE "public"."sale_staging"
  ADD CONSTRAINT "sale_staging_upload_id_fkey" FOREIGN KEY (upload_id) REFERENCES public.upload(id) ON DELETE CASCADE;

ALTER TABLE "public"."upload"
  ADD CONSTRAINT "upload_uploaded_by_fkey" FOREIGN KEY (uploaded_by) REFERENCES public.app_user(id);

ALTER TABLE "public"."visit"
  ADD CONSTRAINT "visit_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES public.customer(id);

ALTER TABLE "public"."product_request"
  ADD CONSTRAINT "product_request_visit_id_fkey" FOREIGN KEY (visit_id) REFERENCES public.visit(id);

ALTER TABLE "public"."sale"
  ADD CONSTRAINT "sale_visit_id_fkey" FOREIGN KEY (visit_id) REFERENCES public.visit(id);

ALTER TABLE "public"."visit"
  ADD CONSTRAINT "visit_route_customer_id_fkey" FOREIGN KEY (route_customer_id) REFERENCES public.route_customer(id);

ALTER TABLE "public"."visit"
  ADD CONSTRAINT "visit_route_user_id_fkey" FOREIGN KEY (route_user_id) REFERENCES public.route_user(id);

ALTER TABLE "public"."visit"
  ADD CONSTRAINT "visit_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.app_user(id);

CREATE UNIQUE INDEX app_user_clerk_user_id_key ON public.app_user USING btree (clerk_user_id)
  WHERE (deleted_at IS NULL);

CREATE UNIQUE INDEX app_user_erp_user_id_key ON public.app_user USING btree (erp_user_id)
  WHERE (deleted_at IS NULL);

CREATE INDEX balance_snapshot_sale_idx ON public.balance_snapshot USING btree (erp_sale_id, captured_at DESC);

CREATE INDEX balance_snapshot_upload_id_idx ON public.balance_snapshot USING btree (upload_id);

CREATE UNIQUE INDEX customer_erp_customer_id_key ON public.customer USING btree (erp_customer_id)
  WHERE (deleted_at IS NULL);

CREATE UNIQUE INDEX goal_unique_key ON public.goal USING btree (user_id, year, month)
  WHERE (deleted_at IS NULL);

CREATE INDEX product_request_visit_id_idx ON public.product_request USING btree (visit_id)
  WHERE (deleted_at IS NULL);

CREATE UNIQUE INDEX route_customer_unique_key ON public.route_customer USING btree (route_id, customer_id)
  WHERE (deleted_at IS NULL);

CREATE UNIQUE INDEX route_user_unique_key ON public.route_user USING btree (route_id, user_id, day)
  WHERE (deleted_at IS NULL);

CREATE INDEX sale_customer_date_idx ON public.sale USING btree (customer_id, erp_created_at)
  WHERE (deleted_at IS NULL);

CREATE INDEX sale_detail_erp_sale_id_idx ON public.sale_detail USING btree (erp_sale_id);

CREATE INDEX sale_detail_product_id_idx ON public.sale_detail USING btree (product_id);

CREATE INDEX sale_erp_created_at_idx ON public.sale USING btree (erp_created_at)
  WHERE (deleted_at IS NULL);

CREATE INDEX sale_pending_balance_idx ON public.sale USING btree (customer_id, erp_created_at)
  WHERE ((pending_balance > (0)::numeric) AND (deleted_at IS NULL));

CREATE INDEX sale_staging_upload_status_idx ON public.sale_staging USING btree (upload_id, status);

CREATE INDEX sale_upload_id_idx ON public.sale USING btree (upload_id);

CREATE INDEX sale_user_date_idx ON public.sale USING btree (user_id, erp_created_at)
  WHERE (deleted_at IS NULL);

CREATE INDEX sale_visit_id_idx ON public.sale USING btree (visit_id)
  WHERE (deleted_at IS NULL);

CREATE INDEX scheduled_visit_customer_date_idx ON public.scheduled_visit USING btree (customer_id, visit_date)
  WHERE (deleted_at IS NULL);

CREATE INDEX scheduled_visit_prospect_id_idx ON public.scheduled_visit USING btree (prospect_id)
  WHERE ((prospect_id IS NOT NULL) AND (deleted_at IS NULL));

CREATE INDEX scheduled_visit_route_user_date_idx ON public.scheduled_visit USING btree (route_user_id, visit_date)
  WHERE (deleted_at IS NULL);

CREATE INDEX visit_customer_started_idx ON public.visit USING btree (customer_id, started_at DESC)
  WHERE (deleted_at IS NULL);

CREATE INDEX visit_route_user_id_idx ON public.visit USING btree (route_user_id)
  WHERE (deleted_at IS NULL);

CREATE INDEX visit_user_started_idx ON public.visit USING btree (user_id, started_at)
  WHERE (deleted_at IS NULL);

CREATE TRIGGER app_user_set_updated_at
  BEFORE UPDATE ON public.app_user
  FOR EACH ROW
  WHEN ((old.* IS DISTINCT FROM new.*))
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER customer_set_updated_at
  BEFORE UPDATE ON public.customer
  FOR EACH ROW
  WHEN ((old.* IS DISTINCT FROM new.*))
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER goal_set_updated_at
  BEFORE UPDATE ON public.goal
  FOR EACH ROW
  WHEN ((old.* IS DISTINCT FROM new.*))
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER product_set_updated_at
  BEFORE UPDATE ON public.product
  FOR EACH ROW
  WHEN ((old.* IS DISTINCT FROM new.*))
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER product_request_set_updated_at
  BEFORE UPDATE ON public.product_request
  FOR EACH ROW
  WHEN ((old.* IS DISTINCT FROM new.*))
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER prospect_set_updated_at
  BEFORE UPDATE ON public.prospect
  FOR EACH ROW
  WHEN ((old.* IS DISTINCT FROM new.*))
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER quoted_product_set_updated_at
  BEFORE UPDATE ON public.quoted_product
  FOR EACH ROW
  WHEN ((old.* IS DISTINCT FROM new.*))
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER route_set_updated_at
  BEFORE UPDATE ON public.route
  FOR EACH ROW
  WHEN ((old.* IS DISTINCT FROM new.*))
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER route_customer_set_updated_at
  BEFORE UPDATE ON public.route_customer
  FOR EACH ROW
  WHEN ((old.* IS DISTINCT FROM new.*))
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER route_user_set_updated_at
  BEFORE UPDATE ON public.route_user
  FOR EACH ROW
  WHEN ((old.* IS DISTINCT FROM new.*))
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER sale_set_updated_at
  BEFORE UPDATE ON public.sale
  FOR EACH ROW
  WHEN ((old.* IS DISTINCT FROM new.*))
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER sale_detail_set_updated_at
  BEFORE UPDATE ON public.sale_detail
  FOR EACH ROW
  WHEN ((old.* IS DISTINCT FROM new.*))
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER scheduled_visit_set_updated_at
  BEFORE UPDATE ON public.scheduled_visit
  FOR EACH ROW
  WHEN ((old.* IS DISTINCT FROM new.*))
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER upload_set_updated_at
  BEFORE UPDATE ON public.upload
  FOR EACH ROW
  WHEN ((old.* IS DISTINCT FROM new.*))
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER visit_set_updated_at
  BEFORE UPDATE ON public.visit
  FOR EACH ROW
  WHEN ((old.* IS DISTINCT FROM new.*))
  EXECUTE FUNCTION public.set_updated_at();

CREATE EVENT TRIGGER "ensure_rls"
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION "public"."rls_auto_enable"();

COMMENT ON EXTENSION "postgis" IS 'PostGIS geometry and geography spatial types and functions';

COMMENT ON FUNCTION "public"."set_updated_at"() IS 'Sella updated_at con now() en cada UPDATE que modifique la fila.';

GRANT EXECUTE ON FUNCTION "public"."rls_auto_enable"() TO PUBLIC, "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_updated_at"() TO PUBLIC, "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."balance_snapshot_id_seq" TO "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."sale_staging_id_seq" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."app_user" TO "anon", "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."app_user" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."app_user" TO "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."balance_snapshot" TO "anon", "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."balance_snapshot" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."balance_snapshot" TO "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."customer" TO "anon", "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."customer" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."customer" TO "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."goal" TO "anon", "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."goal" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."goal" TO "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."product" TO "anon", "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."product" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."product" TO "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."product_request" TO "anon", "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."product_request" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."product_request" TO "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."prospect" TO "anon", "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."prospect" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."prospect" TO "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."quoted_product" TO "anon", "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."quoted_product" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."quoted_product" TO "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."route" TO "anon", "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."route" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."route" TO "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."route_customer" TO "anon", "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."route_customer" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."route_customer" TO "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."route_user" TO "anon", "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."route_user" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."route_user" TO "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."sale" TO "anon", "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."sale" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."sale" TO "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."sale_detail" TO "anon", "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."sale_detail" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."sale_detail" TO "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."sale_staging" TO "anon", "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."sale_staging" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."sale_staging" TO "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."scheduled_visit" TO "anon", "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."scheduled_visit" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."scheduled_visit" TO "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."upload" TO "anon", "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."upload" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."upload" TO "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."visit" TO "anon", "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."visit" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."visit" TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLES TO "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLES TO "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLES TO "service_role";

