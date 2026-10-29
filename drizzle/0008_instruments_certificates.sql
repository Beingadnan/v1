CREATE TABLE "certificate_items" (
	"organisation_id" uuid NOT NULL,
	"certificate_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"result" text,
	CONSTRAINT "certificate_items_certificate_id_instrument_id_pk" PRIMARY KEY("certificate_id","instrument_id"),
	CONSTRAINT "certificate_items_result_check" CHECK ("certificate_items"."result" is null or "certificate_items"."result" in ('pass', 'fail', 'no_limit'))
);
--> statement-breakpoint
CREATE TABLE "certificate_masters" (
	"organisation_id" uuid NOT NULL,
	"certificate_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"master_certificate_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "certificate_masters_certificate_id_instrument_id_pk" PRIMARY KEY("certificate_id","instrument_id")
);
--> statement-breakpoint
CREATE TABLE "certificate_points" (
	"organisation_id" uuid NOT NULL,
	"certificate_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"quantity" text NOT NULL,
	"reference" numeric NOT NULL,
	"condition" text DEFAULT '' NOT NULL,
	CONSTRAINT "certificate_points_certificate_id_seq_pk" PRIMARY KEY("certificate_id","seq"),
	CONSTRAINT "certificate_points_quantity_check" CHECK ("certificate_points"."quantity" in ('temperature', 'humidity', 'pressure'))
);
--> statement-breakpoint
CREATE TABLE "certificate_readings" (
	"organisation_id" uuid NOT NULL,
	"certificate_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"instrument_id" uuid NOT NULL,
	"reading" numeric NOT NULL,
	"deviation" numeric NOT NULL,
	"uncertainty" numeric,
	"tolerance" numeric,
	"judgement" text NOT NULL,
	CONSTRAINT "certificate_readings_certificate_id_seq_instrument_id_pk" PRIMARY KEY("certificate_id","seq","instrument_id"),
	CONSTRAINT "certificate_readings_judgement_check" CHECK ("certificate_readings"."judgement" in ('pass', 'fail', 'no_limit'))
);
--> statement-breakpoint
CREATE TABLE "certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"number" text NOT NULL,
	"ulr_no" text DEFAULT '' NOT NULL,
	"lab_name" text DEFAULT '' NOT NULL,
	"lab_accreditation" text DEFAULT '' NOT NULL,
	"certificate_kind" text DEFAULT '' NOT NULL,
	"site_id" uuid,
	"calibrated_on" date NOT NULL,
	"calibrated_until" date,
	"valid_until" date,
	"issued_on" date,
	"customer_company_id" uuid,
	"customer_name" text DEFAULT '' NOT NULL,
	"customer_address" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"department" text DEFAULT '' NOT NULL,
	"equipment_name" text DEFAULT '' NOT NULL,
	"make" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"range_text" text DEFAULT '' NOT NULL,
	"resolution_text" text DEFAULT '' NOT NULL,
	"accuracy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"accuracy_text" text DEFAULT '' NOT NULL,
	"sop_no" text DEFAULT '' NOT NULL,
	"condition_on_receipt" text DEFAULT '' NOT NULL,
	"environment_temperature" text DEFAULT '' NOT NULL,
	"environment_humidity" text DEFAULT '' NOT NULL,
	"remarks" text DEFAULT '' NOT NULL,
	"file_id" uuid,
	"performed_by_user_id" uuid,
	"performed_by_name" text DEFAULT '' NOT NULL,
	"prepared_by_name" text DEFAULT '' NOT NULL,
	"cancelled_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certificates_id_org_key" UNIQUE("id","organisation_id"),
	CONSTRAINT "certificates_kind_check" CHECK ("certificates"."kind" in ('internal', 'external', 'imported')),
	CONSTRAINT "certificates_status_check" CHECK ("certificates"."status" in ('draft', 'checking', 'approving', 'issued', 'cancelled')),
	CONSTRAINT "certificates_dates_check" CHECK (("certificates"."valid_until" is null or "certificates"."valid_until" >= "certificates"."calibrated_on") and ("certificates"."calibrated_until" is null or "certificates"."calibrated_until" >= "certificates"."calibrated_on"))
);
--> statement-breakpoint
CREATE TABLE "instrument_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"type" text NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"equipment_name" text NOT NULL,
	"quantities" text[] NOT NULL,
	"range_text" text DEFAULT '' NOT NULL,
	"resolution_text" text DEFAULT '' NOT NULL,
	"accuracy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"accuracy_text" text DEFAULT '' NOT NULL,
	"calibration_sop" text DEFAULT '' NOT NULL,
	"default_points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"interval_months" integer DEFAULT 12 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instrument_models_id_org_key" UNIQUE("id","organisation_id"),
	CONSTRAINT "instrument_models_type_check" CHECK ("instrument_models"."type" in ('portable_logger', 'rtd', 'thermocouple', 'pressure_transmitter', 'temperature_indicator', 'humidity_indicator', 'reference_thermometer', 'data_acquisition', 'calibration_bath', 'other')),
	CONSTRAINT "instrument_models_interval_check" CHECK ("instrument_models"."interval_months" between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "instruments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"model_id" uuid,
	"type" text NOT NULL,
	"tier" text DEFAULT 'working' NOT NULL,
	"code" text NOT NULL,
	"serial_no" text DEFAULT '' NOT NULL,
	"make" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"equipment_name" text DEFAULT '' NOT NULL,
	"range_text" text DEFAULT '' NOT NULL,
	"resolution_text" text DEFAULT '' NOT NULL,
	"accuracy" jsonb,
	"accuracy_text" text DEFAULT '' NOT NULL,
	"home_site_id" uuid,
	"owner_company_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"interval_months" integer,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instruments_id_org_key" UNIQUE("id","organisation_id"),
	CONSTRAINT "instruments_type_check" CHECK ("instruments"."type" in ('portable_logger', 'rtd', 'thermocouple', 'pressure_transmitter', 'temperature_indicator', 'humidity_indicator', 'reference_thermometer', 'data_acquisition', 'calibration_bath', 'other')),
	CONSTRAINT "instruments_tier_check" CHECK ("instruments"."tier" in ('working', 'master')),
	CONSTRAINT "instruments_status_check" CHECK ("instruments"."status" in ('active', 'out_of_service', 'retired', 'lost')),
	CONSTRAINT "instruments_interval_check" CHECK ("instruments"."interval_months" is null or "instruments"."interval_months" between 1 and 60)
);
--> statement-breakpoint
DROP INDEX "number_series_key";--> statement-breakpoint
ALTER TABLE "organisation_settings" ALTER COLUMN "certificate_number_format" SET DEFAULT 'QATECH/{SITE_NAME}/{MM}/{YY}/{KIND}-{SEQ:2}';--> statement-breakpoint
ALTER TABLE "number_series" ADD COLUMN "period" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "number_series" ADD COLUMN "series" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "certificate_items" ADD CONSTRAINT "certificate_items_certificate_fk" FOREIGN KEY ("certificate_id","organisation_id") REFERENCES "public"."certificates"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_items" ADD CONSTRAINT "certificate_items_instrument_fk" FOREIGN KEY ("instrument_id","organisation_id") REFERENCES "public"."instruments"("id","organisation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_masters" ADD CONSTRAINT "certificate_masters_certificate_fk" FOREIGN KEY ("certificate_id","organisation_id") REFERENCES "public"."certificates"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_masters" ADD CONSTRAINT "certificate_masters_instrument_fk" FOREIGN KEY ("instrument_id","organisation_id") REFERENCES "public"."instruments"("id","organisation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_masters" ADD CONSTRAINT "certificate_masters_master_certificate_fk" FOREIGN KEY ("master_certificate_id","organisation_id") REFERENCES "public"."certificates"("id","organisation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_points" ADD CONSTRAINT "certificate_points_certificate_fk" FOREIGN KEY ("certificate_id","organisation_id") REFERENCES "public"."certificates"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_readings" ADD CONSTRAINT "certificate_readings_point_fk" FOREIGN KEY ("certificate_id","seq") REFERENCES "public"."certificate_points"("certificate_id","seq") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_readings" ADD CONSTRAINT "certificate_readings_item_fk" FOREIGN KEY ("certificate_id","instrument_id") REFERENCES "public"."certificate_items"("certificate_id","instrument_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_performed_by_user_id_users_id_fk" FOREIGN KEY ("performed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_customer_fk" FOREIGN KEY ("customer_company_id","organisation_id") REFERENCES "public"."client_companies"("id","organisation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instrument_models" ADD CONSTRAINT "instrument_models_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instrument_models" ADD CONSTRAINT "instrument_models_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_home_site_id_sites_id_fk" FOREIGN KEY ("home_site_id") REFERENCES "public"."sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_model_fk" FOREIGN KEY ("model_id","organisation_id") REFERENCES "public"."instrument_models"("id","organisation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_owner_fk" FOREIGN KEY ("owner_company_id","organisation_id") REFERENCES "public"."client_companies"("id","organisation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "certificate_items_instrument_idx" ON "certificate_items" USING btree ("instrument_id");--> statement-breakpoint
CREATE INDEX "certificate_masters_master_idx" ON "certificate_masters" USING btree ("master_certificate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_org_lab_number_key" ON "certificates" USING btree ("organisation_id",lower("lab_name"),"number");--> statement-breakpoint
CREATE INDEX "certificates_org_date_idx" ON "certificates" USING btree ("organisation_id","calibrated_on");--> statement-breakpoint
CREATE UNIQUE INDEX "instrument_models_org_make_model_key" ON "instrument_models" USING btree ("organisation_id",lower("make"),lower("model"));--> statement-breakpoint
CREATE UNIQUE INDEX "instruments_org_code_key" ON "instruments" USING btree ("organisation_id",lower("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "instruments_org_serial_key" ON "instruments" USING btree ("organisation_id",lower("make"),lower("serial_no")) WHERE "instruments"."serial_no" <> '';--> statement-breakpoint
CREATE INDEX "instruments_serial_idx" ON "instruments" USING btree ("organisation_id","serial_no");--> statement-breakpoint
CREATE UNIQUE INDEX "number_series_key" ON "number_series" USING btree ("organisation_id","kind","site_code","year","period","series");--> statement-breakpoint
ALTER TABLE "number_series" ADD CONSTRAINT "number_series_period_check" CHECK ("number_series"."period" between 0 and 12);--> statement-breakpoint
-- QA Tech's real certificate numbers (QATECH/BHIWANDI/03/26/PDL-17) restart monthly per kind.
-- Move organisations still on the phase 1 placeholder format to it.
UPDATE "organisation_settings" SET "certificate_number_format" = 'QATECH/{SITE_NAME}/{MM}/{YY}/{KIND}-{SEQ:2}' WHERE "certificate_number_format" = 'CERT-{SITE}-{YYYY}-{SEQ:4}';
