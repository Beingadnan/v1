ALTER TABLE "equipment" ADD CONSTRAINT "equipment_id_org_key" UNIQUE("id","organisation_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_id_org_key" UNIQUE("id","organisation_id");--> statement-breakpoint
CREATE TABLE "job_instruments" (
	"organisation_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"booked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"booked_by_user_id" uuid,
	CONSTRAINT "job_instruments_job_id_instrument_id_pk" PRIMARY KEY("job_id","instrument_id")
);
--> statement-breakpoint
CREATE TABLE "job_readiness" (
	"organisation_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"key" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_readiness_job_id_key_pk" PRIMARY KEY("job_id","key"),
	CONSTRAINT "job_readiness_key_check" CHECK ("job_readiness"."key" in ('purchase_order', 'protocol', 'site_access', 'loggers_booked', 'loggers_valid', 'masters_valid', 'previous_report')),
	CONSTRAINT "job_readiness_state_check" CHECK ("job_readiness"."state" in ('ready', 'pending', 'na'))
);
--> statement-breakpoint
CREATE TABLE "job_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"by_user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_team" (
	"organisation_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "job_team_job_id_user_id_role_pk" PRIMARY KEY("job_id","user_id","role"),
	CONSTRAINT "job_team_role_check" CHECK ("job_team"."role" in ('team_leader', 'field_engineer', 'report_preparer'))
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"number" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"held_from" text,
	"company_id" uuid NOT NULL,
	"client_site_id" uuid NOT NULL,
	"site_id" uuid,
	"title" text DEFAULT '' NOT NULL,
	"po_number" text DEFAULT '' NOT NULL,
	"po_date" date,
	"po_value" numeric(12, 2),
	"quoted_value" numeric(12, 2),
	"planned_start" date NOT NULL,
	"planned_end" date NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"cancelled_reason" text,
	"hold_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_id_org_key" UNIQUE("id","organisation_id"),
	CONSTRAINT "jobs_status_check" CHECK ("jobs"."status" in ('created', 'ready', 'field_work', 'data_issue', 'data_received', 'analysis', 'report_draft', 'rework', 'checked', 'sent_to_client', 'client_signed', 'wcr_signed', 'invoiced', 'paid', 'closed', 'on_hold', 'cancelled')),
	CONSTRAINT "jobs_dates_check" CHECK ("jobs"."planned_end" >= "jobs"."planned_start"),
	CONSTRAINT "jobs_money_check" CHECK (("jobs"."po_value" is null or "jobs"."po_value" >= 0) and ("jobs"."quoted_value" is null or "jobs"."quoted_value" >= 0))
);
--> statement-breakpoint
CREATE TABLE "rate_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"work_type" text NOT NULL,
	"equipment_type" text DEFAULT '' NOT NULL,
	"duration_hours" integer,
	"basis" text NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_cards_work_type_check" CHECK ("rate_cards"."work_type" in ('temperature_mapping', 'temperature_rh_mapping', 'thermal_validation', 'onsite_calibration')),
	CONSTRAINT "rate_cards_basis_check" CHECK ("rate_cards"."basis" in ('per_study', 'per_cycle', 'per_logger', 'per_m3')),
	CONSTRAINT "rate_cards_price_check" CHECK ("rate_cards"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "studies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"equipment_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"work_type" text NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"report_number" text NOT NULL,
	"cycles" text[] DEFAULT '{}'::text[] NOT NULL,
	"season" text DEFAULT '' NOT NULL,
	"set_point_c" numeric(6, 2),
	"temp_min_c" numeric(6, 2),
	"temp_max_c" numeric(6, 2),
	"rh_min_pct" numeric(5, 1),
	"rh_max_pct" numeric(5, 1),
	"logger_count" integer DEFAULT 0 NOT NULL,
	"interval_minutes" integer,
	"duration_hours" integer,
	"post_cal_required" boolean DEFAULT false NOT NULL,
	"price" numeric(12, 2),
	"price_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "studies_id_org_key" UNIQUE("id","organisation_id"),
	CONSTRAINT "studies_work_type_check" CHECK ("studies"."work_type" in ('temperature_mapping', 'temperature_rh_mapping', 'thermal_validation', 'onsite_calibration')),
	CONSTRAINT "studies_season_check" CHECK ("studies"."season" in ('', 'summer', 'winter', 'monsoon')),
	CONSTRAINT "studies_loggers_check" CHECK ("studies"."logger_count" between 0 and 500)
);
--> statement-breakpoint
ALTER TABLE "job_instruments" ADD CONSTRAINT "job_instruments_booked_by_user_id_users_id_fk" FOREIGN KEY ("booked_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_instruments" ADD CONSTRAINT "job_instruments_job_fk" FOREIGN KEY ("job_id","organisation_id") REFERENCES "public"."jobs"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_instruments" ADD CONSTRAINT "job_instruments_instrument_fk" FOREIGN KEY ("instrument_id","organisation_id") REFERENCES "public"."instruments"("id","organisation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_readiness" ADD CONSTRAINT "job_readiness_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_readiness" ADD CONSTRAINT "job_readiness_job_fk" FOREIGN KEY ("job_id","organisation_id") REFERENCES "public"."jobs"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_status_history" ADD CONSTRAINT "job_status_history_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_status_history" ADD CONSTRAINT "job_status_history_job_fk" FOREIGN KEY ("job_id","organisation_id") REFERENCES "public"."jobs"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_team" ADD CONSTRAINT "job_team_job_fk" FOREIGN KEY ("job_id","organisation_id") REFERENCES "public"."jobs"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_team" ADD CONSTRAINT "job_team_user_fk" FOREIGN KEY ("user_id","organisation_id") REFERENCES "public"."users"("id","organisation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_company_fk" FOREIGN KEY ("company_id","organisation_id") REFERENCES "public"."client_companies"("id","organisation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_client_site_fk" FOREIGN KEY ("client_site_id","company_id") REFERENCES "public"."client_sites"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studies" ADD CONSTRAINT "studies_job_fk" FOREIGN KEY ("job_id","organisation_id") REFERENCES "public"."jobs"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studies" ADD CONSTRAINT "studies_equipment_fk" FOREIGN KEY ("equipment_id","organisation_id") REFERENCES "public"."equipment"("id","organisation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_instruments_instrument_idx" ON "job_instruments" USING btree ("instrument_id");--> statement-breakpoint
CREATE INDEX "job_status_history_job_idx" ON "job_status_history" USING btree ("job_id","at");--> statement-breakpoint
CREATE INDEX "job_team_user_idx" ON "job_team" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_org_number_key" ON "jobs" USING btree ("organisation_id","number");--> statement-breakpoint
CREATE INDEX "jobs_org_po_idx" ON "jobs" USING btree ("organisation_id",lower("po_number"));--> statement-breakpoint
CREATE INDEX "jobs_org_status_idx" ON "jobs" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_cards_org_line_key" ON "rate_cards" USING btree ("organisation_id","work_type","equipment_type","basis",coalesce("duration_hours", 0)) WHERE "rate_cards"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "studies_org_report_number_key" ON "studies" USING btree ("organisation_id",lower("report_number"));--> statement-breakpoint
CREATE INDEX "studies_job_idx" ON "studies" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "studies_equipment_idx" ON "studies" USING btree ("equipment_id");