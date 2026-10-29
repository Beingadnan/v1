CREATE TABLE "equipment_type_defaults" (
	"organisation_id" uuid NOT NULL,
	"type" text NOT NULL,
	"set_point_c" numeric(6, 2),
	"temp_min_c" numeric(6, 2),
	"temp_max_c" numeric(6, 2),
	"rh_min_pct" numeric(5, 1),
	"rh_max_pct" numeric(5, 1),
	"default_channels" integer,
	"reading_interval_minutes" integer,
	"study_duration_hours" integer,
	"requalification_months" integer,
	"cycles" text[] DEFAULT '{}'::text[] NOT NULL,
	"seasonal_mapping" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" uuid,
	CONSTRAINT "equipment_type_defaults_organisation_id_type_pk" PRIMARY KEY("organisation_id","type"),
	CONSTRAINT "equipment_type_defaults_type_check" CHECK ("equipment_type_defaults"."type" in ('refrigerator', 'freezer', 'deep_freezer', 'walk_in_freezer', 'cold_room', 'warehouse', 'stability_chamber', 'incubator', 'vehicle', 'autoclave', 'dry_heat_oven', 'other')),
	CONSTRAINT "equipment_type_defaults_cycles_check" CHECK ("equipment_type_defaults"."cycles" <@ array['empty', 'loaded', 'door_open', 'power_failure']::text[])
);
--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "cycles" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "seasonal_mapping" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment_type_defaults" ADD CONSTRAINT "equipment_type_defaults_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_type_defaults" ADD CONSTRAINT "equipment_type_defaults_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_cycles_check" CHECK ("equipment"."cycles" <@ array['empty', 'loaded', 'door_open', 'power_failure']::text[]);