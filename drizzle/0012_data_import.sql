CREATE TABLE "study_data_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"study_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"message" text NOT NULL,
	"reason" text NOT NULL,
	"accepted_by_user_id" uuid NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by_user_id" uuid,
	CONSTRAINT "study_data_acceptances_reason_check" CHECK (length("study_data_acceptances"."reason") between 5 and 500)
);
--> statement-breakpoint
CREATE TABLE "study_data_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"data_file_id" uuid NOT NULL,
	"column" integer NOT NULL,
	"header" text NOT NULL,
	"serial" text,
	"quantity" text NOT NULL,
	"ambient" boolean DEFAULT false NOT NULL,
	"values" double precision[] NOT NULL,
	"unreadable" integer[] DEFAULT '{}'::int[] NOT NULL,
	"manual_position_id" uuid,
	"ignored" boolean DEFAULT false NOT NULL,
	"manual_by_user_id" uuid,
	"manual_at" timestamp with time zone,
	CONSTRAINT "study_data_channels_quantity_check" CHECK ("study_data_channels"."quantity" in ('temp', 'rh'))
);
--> statement-breakpoint
CREATE TABLE "study_data_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"study_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"sheet" text NOT NULL,
	"times" bigint[] NOT NULL,
	"first_data_row" integer NOT NULL,
	"last_data_row" integer NOT NULL,
	"interval_minutes" integer,
	"notes" text[] DEFAULT '{}'::text[] NOT NULL,
	"bad_time_rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"replaced_at" timestamp with time zone,
	"replaced_by_user_id" uuid,
	"replace_reason" text DEFAULT '' NOT NULL,
	CONSTRAINT "study_data_files_id_org_key" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "study_data_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"study_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"message" text NOT NULL,
	"cycle" text,
	"position_id" uuid,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_data_issues_kind_check" CHECK ("study_data_issues"."kind" in ('missing_logger', 'missing_rh', 'duplicate_channel', 'unmatched_channel', 'interval', 'not_covered', 'gap', 'single_missing', 'duplicate_time', 'impossible', 'unreadable', 'bad_time', 'stuck', 'no_times', 'outside_window')),
	CONSTRAINT "study_data_issues_severity_check" CHECK ("study_data_issues"."severity" in ('blocker', 'warning', 'info'))
);
--> statement-breakpoint
CREATE TABLE "study_data_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"study_id" uuid NOT NULL,
	"note" text NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by_user_id" uuid,
	"closed_note" text DEFAULT '' NOT NULL,
	CONSTRAINT "study_data_requests_note_check" CHECK (length("study_data_requests"."note") between 3 and 1000)
);
--> statement-breakpoint
ALTER TABLE "equipment" DROP CONSTRAINT "equipment_cycles_check";--> statement-breakpoint
ALTER TABLE "equipment_type_defaults" DROP CONSTRAINT "equipment_type_defaults_cycles_check";--> statement-breakpoint
ALTER TABLE "study_events" DROP CONSTRAINT "study_events_cycle_check";--> statement-breakpoint
ALTER TABLE "study_events" DROP CONSTRAINT "study_events_kind_check";--> statement-breakpoint
ALTER TABLE "job_team" DROP CONSTRAINT "job_team_role_check";--> statement-breakpoint
ALTER TABLE "studies" ADD COLUMN "data_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "studies" ADD COLUMN "data_received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "studies" ADD COLUMN "data_received_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "study_data_acceptances" ADD CONSTRAINT "study_data_acceptances_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_data_acceptances" ADD CONSTRAINT "study_data_acceptances_withdrawn_by_user_id_users_id_fk" FOREIGN KEY ("withdrawn_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_data_acceptances" ADD CONSTRAINT "study_data_acceptances_study_fk" FOREIGN KEY ("study_id","organisation_id") REFERENCES "public"."studies"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_data_channels" ADD CONSTRAINT "study_data_channels_manual_by_user_id_users_id_fk" FOREIGN KEY ("manual_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_data_channels" ADD CONSTRAINT "study_data_channels_file_fk" FOREIGN KEY ("data_file_id","organisation_id") REFERENCES "public"."study_data_files"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_data_channels" ADD CONSTRAINT "study_data_channels_position_fk" FOREIGN KEY ("manual_position_id") REFERENCES "public"."study_positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_data_files" ADD CONSTRAINT "study_data_files_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_data_files" ADD CONSTRAINT "study_data_files_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_data_files" ADD CONSTRAINT "study_data_files_replaced_by_user_id_users_id_fk" FOREIGN KEY ("replaced_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_data_files" ADD CONSTRAINT "study_data_files_study_fk" FOREIGN KEY ("study_id","organisation_id") REFERENCES "public"."studies"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_data_issues" ADD CONSTRAINT "study_data_issues_study_fk" FOREIGN KEY ("study_id","organisation_id") REFERENCES "public"."studies"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_data_requests" ADD CONSTRAINT "study_data_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_data_requests" ADD CONSTRAINT "study_data_requests_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_data_requests" ADD CONSTRAINT "study_data_requests_study_fk" FOREIGN KEY ("study_id","organisation_id") REFERENCES "public"."studies"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "study_data_acceptances_key" ON "study_data_acceptances" USING btree ("study_id","fingerprint") WHERE "study_data_acceptances"."withdrawn_at" is null;--> statement-breakpoint
CREATE INDEX "study_data_channels_file_idx" ON "study_data_channels" USING btree ("data_file_id");--> statement-breakpoint
CREATE INDEX "study_data_files_study_idx" ON "study_data_files" USING btree ("study_id");--> statement-breakpoint
CREATE UNIQUE INDEX "study_data_issues_key" ON "study_data_issues" USING btree ("study_id","fingerprint");--> statement-breakpoint
CREATE INDEX "study_data_requests_open_idx" ON "study_data_requests" USING btree ("study_id") WHERE "study_data_requests"."closed_at" is null;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_cycles_check" CHECK ("equipment"."cycles" <@ array['empty', 'loaded', 'door_open', 'power_failure', 'min_load', 'max_load']::text[]);--> statement-breakpoint
ALTER TABLE "equipment_type_defaults" ADD CONSTRAINT "equipment_type_defaults_cycles_check" CHECK ("equipment_type_defaults"."cycles" <@ array['empty', 'loaded', 'door_open', 'power_failure', 'min_load', 'max_load']::text[]);--> statement-breakpoint
ALTER TABLE "study_events" ADD CONSTRAINT "study_events_cycle_check" CHECK ("study_events"."cycle" in ('empty', 'loaded', 'door_open', 'power_failure', 'min_load', 'max_load', 'routine'));--> statement-breakpoint
ALTER TABLE "study_events" ADD CONSTRAINT "study_events_kind_check" CHECK ("study_events"."kind" in ('start', 'end', 'door_opened', 'door_closed', 'power_off', 'power_on', 'hold_start', 'hold_end'));--> statement-breakpoint
ALTER TABLE "job_team" ADD CONSTRAINT "job_team_role_check" CHECK ("job_team"."role" in ('team_leader', 'field_engineer', 'data_provider', 'report_preparer'));--> statement-breakpoint
ALTER TABLE "studies" ADD CONSTRAINT "studies_data_status_check" CHECK ("studies"."data_status" in ('none', 'issues', 'checked', 'received'));