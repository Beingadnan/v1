CREATE TABLE "study_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"study_id" uuid NOT NULL,
	"cycle" text NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"voided" boolean DEFAULT false NOT NULL,
	"by_user_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_events_cycle_check" CHECK ("study_events"."cycle" in ('empty', 'loaded', 'door_open', 'power_failure', 'routine')),
	CONSTRAINT "study_events_kind_check" CHECK ("study_events"."kind" in ('start', 'end', 'door_opened', 'door_closed', 'power_off', 'power_on'))
);
--> statement-breakpoint
CREATE TABLE "study_photos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"study_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"position_label" text DEFAULT '' NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"by_user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"study_id" uuid NOT NULL,
	"label" text NOT NULL,
	"sort" integer NOT NULL,
	"x" numeric(5, 4) NOT NULL,
	"y" numeric(5, 4) NOT NULL,
	"z" numeric(5, 4) NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"ambient" boolean DEFAULT false NOT NULL,
	"instrument_id" uuid,
	"placed_at" timestamp with time zone,
	"placed_by_user_id" uuid,
	CONSTRAINT "study_positions_xyz_check" CHECK ("study_positions"."x" between 0 and 1 and "study_positions"."y" between 0 and 1 and "study_positions"."z" between 0 and 1),
	CONSTRAINT "study_positions_label_check" CHECK (length("study_positions"."label") between 1 and 20)
);
--> statement-breakpoint
CREATE TABLE "study_precal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"study_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"master_instrument_id" uuid,
	"quantity" text DEFAULT 'temperature' NOT NULL,
	"reference" numeric(10, 4) NOT NULL,
	"reading" numeric(10, 4) NOT NULL,
	"deviation" numeric(10, 4) NOT NULL,
	"tolerance" numeric(8, 4) NOT NULL,
	"result" text NOT NULL,
	"by_user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_precal_result_check" CHECK ("study_precal"."result" in ('pass', 'fail')),
	CONSTRAINT "study_precal_quantity_check" CHECK ("study_precal"."quantity" in ('temperature', 'humidity'))
);
--> statement-breakpoint
ALTER TABLE "study_events" ADD CONSTRAINT "study_events_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_events" ADD CONSTRAINT "study_events_study_fk" FOREIGN KEY ("study_id","organisation_id") REFERENCES "public"."studies"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_photos" ADD CONSTRAINT "study_photos_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_photos" ADD CONSTRAINT "study_photos_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_photos" ADD CONSTRAINT "study_photos_study_fk" FOREIGN KEY ("study_id","organisation_id") REFERENCES "public"."studies"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_positions" ADD CONSTRAINT "study_positions_placed_by_user_id_users_id_fk" FOREIGN KEY ("placed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_positions" ADD CONSTRAINT "study_positions_study_fk" FOREIGN KEY ("study_id","organisation_id") REFERENCES "public"."studies"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_positions" ADD CONSTRAINT "study_positions_instrument_fk" FOREIGN KEY ("instrument_id","organisation_id") REFERENCES "public"."instruments"("id","organisation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_precal" ADD CONSTRAINT "study_precal_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_precal" ADD CONSTRAINT "study_precal_study_fk" FOREIGN KEY ("study_id","organisation_id") REFERENCES "public"."studies"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_precal" ADD CONSTRAINT "study_precal_instrument_fk" FOREIGN KEY ("instrument_id","organisation_id") REFERENCES "public"."instruments"("id","organisation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_precal" ADD CONSTRAINT "study_precal_master_fk" FOREIGN KEY ("master_instrument_id","organisation_id") REFERENCES "public"."instruments"("id","organisation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "study_events_study_idx" ON "study_events" USING btree ("study_id","at");--> statement-breakpoint
CREATE INDEX "study_photos_study_idx" ON "study_photos" USING btree ("study_id");--> statement-breakpoint
CREATE UNIQUE INDEX "study_positions_label_key" ON "study_positions" USING btree ("study_id",lower("label"));--> statement-breakpoint
CREATE UNIQUE INDEX "study_positions_instrument_key" ON "study_positions" USING btree ("study_id","instrument_id") WHERE "study_positions"."instrument_id" is not null;--> statement-breakpoint
CREATE INDEX "study_positions_instrument_idx" ON "study_positions" USING btree ("instrument_id");--> statement-breakpoint
CREATE INDEX "study_precal_study_idx" ON "study_precal" USING btree ("study_id","instrument_id");--> statement-breakpoint
ALTER TABLE "studies" ADD CONSTRAINT "studies_status_check" CHECK ("studies"."status" in ('planned', 'in_progress', 'completed'));