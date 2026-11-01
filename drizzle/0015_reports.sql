CREATE TABLE "study_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"study_id" uuid NOT NULL,
	"rev" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"observation" text,
	"conclusion" text,
	"run_id" uuid,
	"file_id" uuid,
	"sha256" text,
	"pages" integer,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"frozen_by_user_id" uuid,
	"frozen_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "study_reports_status_check" CHECK ("study_reports"."status" in ('draft', 'frozen', 'superseded')),
	CONSTRAINT "study_reports_rev_check" CHECK ("study_reports"."rev" between 0 and 99),
	CONSTRAINT "study_reports_frozen_check" CHECK (("study_reports"."status" = 'draft') = ("study_reports"."file_id" is null) and ("study_reports"."status" = 'draft') = ("study_reports"."sha256" is null) and ("study_reports"."status" = 'draft') = ("study_reports"."run_id" is null)),
	CONSTRAINT "study_reports_reason_check" CHECK ("study_reports"."rev" = 0 or length(trim("study_reports"."reason")) > 0)
);
--> statement-breakpoint
ALTER TABLE "study_reports" ADD CONSTRAINT "study_reports_run_id_study_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."study_analysis_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_reports" ADD CONSTRAINT "study_reports_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_reports" ADD CONSTRAINT "study_reports_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_reports" ADD CONSTRAINT "study_reports_frozen_by_user_id_users_id_fk" FOREIGN KEY ("frozen_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_reports" ADD CONSTRAINT "study_reports_study_fk" FOREIGN KEY ("study_id","organisation_id") REFERENCES "public"."studies"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "study_reports_rev_key" ON "study_reports" USING btree ("study_id","rev");--> statement-breakpoint
CREATE UNIQUE INDEX "study_reports_one_draft_key" ON "study_reports" USING btree ("study_id") WHERE "study_reports"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "study_reports_org_idx" ON "study_reports" USING btree ("organisation_id","created_at");