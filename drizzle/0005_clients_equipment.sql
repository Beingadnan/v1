CREATE TABLE "client_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"gstin" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"post_cal_required" boolean DEFAULT false NOT NULL,
	"requalification_months" integer DEFAULT 12 NOT NULL,
	"report_number_format" text DEFAULT '{CLIENT}/{SITE}/{MM}/{YY}/{EQUIPMENT}/{EQUIPMENT_ID}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_companies_id_org_key" UNIQUE("id","organisation_id"),
	CONSTRAINT "client_companies_requal_check" CHECK ("client_companies"."requalification_months" between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "client_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"site_id" uuid,
	"name" text NOT NULL,
	"designation" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"signatory" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_contacts_signatory_check" CHECK ("client_contacts"."signatory" is null or "client_contacts"."signatory" in ('reviewed_by', 'approved_by'))
);
--> statement-breakpoint
CREATE TABLE "client_departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_departments_id_site_key" UNIQUE("id","site_id")
);
--> statement-breakpoint
CREATE TABLE "client_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"gstin" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_sites_id_company_key" UNIQUE("id","company_id")
);
--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"department_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"make" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"serial_no" text DEFAULT '' NOT NULL,
	"length_m" numeric(8, 2),
	"width_m" numeric(8, 2),
	"height_m" numeric(8, 2),
	"set_point_c" numeric(6, 2),
	"temp_min_c" numeric(6, 2),
	"temp_max_c" numeric(6, 2),
	"rh_min_pct" numeric(5, 1),
	"rh_max_pct" numeric(5, 1),
	"default_channels" integer,
	"reading_interval_minutes" integer,
	"study_duration_hours" integer,
	"requalification_months" integer,
	"last_study_on" date,
	"notes" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_type_check" CHECK ("equipment"."type" in ('refrigerator', 'freezer', 'deep_freezer', 'walk_in_freezer', 'cold_room', 'warehouse', 'stability_chamber', 'incubator', 'vehicle', 'autoclave', 'dry_heat_oven', 'other')),
	CONSTRAINT "equipment_temp_limits_check" CHECK ("equipment"."temp_min_c" is null or "equipment"."temp_max_c" is null or "equipment"."temp_min_c" < "equipment"."temp_max_c"),
	CONSTRAINT "equipment_rh_limits_check" CHECK (("equipment"."rh_min_pct" is null or "equipment"."rh_min_pct" between 0 and 100) and ("equipment"."rh_max_pct" is null or "equipment"."rh_max_pct" between 0 and 100) and ("equipment"."rh_min_pct" is null or "equipment"."rh_max_pct" is null or "equipment"."rh_min_pct" < "equipment"."rh_max_pct")),
	CONSTRAINT "equipment_counts_check" CHECK (("equipment"."default_channels" is null or "equipment"."default_channels" between 1 and 500) and ("equipment"."reading_interval_minutes" is null or "equipment"."reading_interval_minutes" between 1 and 1440) and ("equipment"."study_duration_hours" is null or "equipment"."study_duration_hours" between 1 and 2160) and ("equipment"."requalification_months" is null or "equipment"."requalification_months" between 1 and 60))
);
--> statement-breakpoint
ALTER TABLE "client_companies" ADD CONSTRAINT "client_companies_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_companies" ADD CONSTRAINT "client_companies_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_company_fk" FOREIGN KEY ("company_id","organisation_id") REFERENCES "public"."client_companies"("id","organisation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_site_fk" FOREIGN KEY ("site_id","company_id") REFERENCES "public"."client_sites"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_departments" ADD CONSTRAINT "client_departments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_departments" ADD CONSTRAINT "client_departments_company_fk" FOREIGN KEY ("company_id","organisation_id") REFERENCES "public"."client_companies"("id","organisation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_departments" ADD CONSTRAINT "client_departments_site_fk" FOREIGN KEY ("site_id","company_id") REFERENCES "public"."client_sites"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_sites" ADD CONSTRAINT "client_sites_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_sites" ADD CONSTRAINT "client_sites_company_fk" FOREIGN KEY ("company_id","organisation_id") REFERENCES "public"."client_companies"("id","organisation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_company_fk" FOREIGN KEY ("company_id","organisation_id") REFERENCES "public"."client_companies"("id","organisation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_site_fk" FOREIGN KEY ("site_id","company_id") REFERENCES "public"."client_sites"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_department_fk" FOREIGN KEY ("department_id","site_id") REFERENCES "public"."client_departments"("id","site_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_companies_org_name_key" ON "client_companies" USING btree ("organisation_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "client_companies_org_code_key" ON "client_companies" USING btree ("organisation_id",lower("code"));--> statement-breakpoint
CREATE INDEX "client_contacts_company_idx" ON "client_contacts" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_departments_site_name_key" ON "client_departments" USING btree ("site_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "client_sites_company_name_key" ON "client_sites" USING btree ("company_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "client_sites_company_code_key" ON "client_sites" USING btree ("company_id",lower("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_company_code_key" ON "equipment" USING btree ("company_id",lower("code"));--> statement-breakpoint
CREATE INDEX "equipment_site_idx" ON "equipment" USING btree ("site_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_client_company_fk" FOREIGN KEY ("client_company_id","organisation_id") REFERENCES "public"."client_companies"("id","organisation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_client_company_check" CHECK (("users"."role" in ('client_qa', 'client_qa_head')) = ("users"."client_company_id" is not null));