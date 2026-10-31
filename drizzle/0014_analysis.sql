CREATE TABLE "deviations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"study_id" uuid NOT NULL,
	"number" text NOT NULL,
	"source" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"position_id" uuid,
	"instrument_id" uuid,
	"precal_id" uuid,
	"opened_by_user_id" uuid,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assessment" text DEFAULT '' NOT NULL,
	"assessed_by_user_id" uuid,
	"assessed_at" timestamp with time zone,
	"decision" text,
	"decided_by_name" text,
	"decided_by_title" text,
	"decided_on" date,
	"decision_note" text DEFAULT '' NOT NULL,
	"decision_file_id" uuid,
	"decision_recorded_by_user_id" uuid,
	"closed_at" timestamp with time zone,
	CONSTRAINT "deviations_id_org_key" UNIQUE("id","organisation_id"),
	CONSTRAINT "deviations_source_check" CHECK ("deviations"."source" in ('post_cal', 'excursion', 'manual')),
	CONSTRAINT "deviations_decision_check" CHECK ("deviations"."decision" is null or "deviations"."decision" in ('no_impact', 'exclude_probe', 'repeat_study')),
	CONSTRAINT "deviations_closed_check" CHECK (("deviations"."closed_at" is null) = ("deviations"."decision" is null)),
	CONSTRAINT "deviations_decided_check" CHECK ("deviations"."decision" is null or ("deviations"."decided_by_name" is not null and "deviations"."decided_on" is not null))
);
--> statement-breakpoint
CREATE TABLE "study_analysis_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"study_id" uuid NOT NULL,
	"run_no" integer NOT NULL,
	"kind" text DEFAULT 'analysis' NOT NULL,
	"deviation_id" uuid,
	"engine_version" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_analysis_runs_id_org_key" UNIQUE("id","organisation_id"),
	CONSTRAINT "study_analysis_runs_kind_check" CHECK ("study_analysis_runs"."kind" in ('analysis', 'impact'))
);
--> statement-breakpoint
CREATE TABLE "study_excursion_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"study_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"decision" text NOT NULL,
	"reason" text NOT NULL,
	"deviation_id" uuid,
	"by_user_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by_user_id" uuid,
	CONSTRAINT "study_excursion_reviews_decision_check" CHECK ("study_excursion_reviews"."decision" in ('accepted', 'deviation')),
	CONSTRAINT "study_excursion_reviews_reason_check" CHECK (length(trim("study_excursion_reviews"."reason")) > 0)
);
--> statement-breakpoint
ALTER TABLE "number_series" DROP CONSTRAINT "number_series_kind_check";--> statement-breakpoint
ALTER TABLE "study_precal" ADD COLUMN "phase" text DEFAULT 'pre' NOT NULL;--> statement-breakpoint
ALTER TABLE "studies" ADD COLUMN "analysis_run_id" uuid;--> statement-breakpoint
ALTER TABLE "studies" ADD COLUMN "analysis_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "studies" ADD COLUMN "analysis_approved_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_opened_by_user_id_users_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_assessed_by_user_id_users_id_fk" FOREIGN KEY ("assessed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_decision_file_id_stored_files_id_fk" FOREIGN KEY ("decision_file_id") REFERENCES "public"."stored_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_decision_recorded_by_user_id_users_id_fk" FOREIGN KEY ("decision_recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_study_fk" FOREIGN KEY ("study_id","organisation_id") REFERENCES "public"."studies"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_instrument_fk" FOREIGN KEY ("instrument_id","organisation_id") REFERENCES "public"."instruments"("id","organisation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_analysis_runs" ADD CONSTRAINT "study_analysis_runs_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_analysis_runs" ADD CONSTRAINT "study_analysis_runs_study_fk" FOREIGN KEY ("study_id","organisation_id") REFERENCES "public"."studies"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_excursion_reviews" ADD CONSTRAINT "study_excursion_reviews_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_excursion_reviews" ADD CONSTRAINT "study_excursion_reviews_withdrawn_by_user_id_users_id_fk" FOREIGN KEY ("withdrawn_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_excursion_reviews" ADD CONSTRAINT "study_excursion_reviews_study_fk" FOREIGN KEY ("study_id","organisation_id") REFERENCES "public"."studies"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deviations_org_number_key" ON "deviations" USING btree ("organisation_id",lower("number"));--> statement-breakpoint
CREATE UNIQUE INDEX "deviations_precal_key" ON "deviations" USING btree ("precal_id") WHERE "deviations"."precal_id" is not null;--> statement-breakpoint
CREATE INDEX "deviations_study_idx" ON "deviations" USING btree ("study_id");--> statement-breakpoint
CREATE UNIQUE INDEX "study_analysis_runs_no_key" ON "study_analysis_runs" USING btree ("study_id","run_no");--> statement-breakpoint
CREATE INDEX "study_analysis_runs_deviation_idx" ON "study_analysis_runs" USING btree ("deviation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "study_excursion_reviews_live_key" ON "study_excursion_reviews" USING btree ("study_id","fingerprint") WHERE "study_excursion_reviews"."withdrawn_at" is null;--> statement-breakpoint
ALTER TABLE "study_precal" ADD CONSTRAINT "study_precal_phase_check" CHECK ("study_precal"."phase" in ('pre', 'post'));--> statement-breakpoint
ALTER TABLE "number_series" ADD CONSTRAINT "number_series_kind_check" CHECK ("number_series"."kind" in ('job', 'certificate', 'deviation'));--> statement-breakpoint
-- An analysis run is never changed once made: recalculating makes a new run.
-- Reuses audit_log_reject_change() from migration 0001 (deleting the study still cascades).
CREATE TRIGGER study_analysis_runs_no_update
  BEFORE UPDATE ON "study_analysis_runs"
  FOR EACH ROW EXECUTE FUNCTION audit_log_reject_change();
