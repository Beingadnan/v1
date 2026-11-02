CREATE TABLE "report_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"study_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"section" text NOT NULL,
	"page" integer,
	"body" text NOT NULL,
	"side" text NOT NULL,
	"by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answer" text,
	"answered_by_user_id" uuid,
	"answered_at" timestamp with time zone,
	CONSTRAINT "report_comments_section_check" CHECK ("report_comments"."section" in ('general', 'cover', 'details', 'diagram', 'graphs', 'conclusion', 'raw', 'postcal', 'deviations', 'certificates')),
	CONSTRAINT "report_comments_side_check" CHECK ("report_comments"."side" in ('qa_tech', 'client')),
	CONSTRAINT "report_comments_body_check" CHECK (length(trim("report_comments"."body")) > 0),
	CONSTRAINT "report_comments_answer_check" CHECK (("report_comments"."answer" is null) = ("report_comments"."answered_at" is null))
);
--> statement-breakpoint
CREATE TABLE "report_paper_signoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"scan_sha256" text NOT NULL,
	"report_sha256" text NOT NULL,
	"reviewed_by_name" text NOT NULL,
	"reviewed_on" date NOT NULL,
	"approved_by_name" text NOT NULL,
	"approved_by_title" text DEFAULT '' NOT NULL,
	"approved_on" date NOT NULL,
	"recorded_by_user_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_paper_signoffs_dates_check" CHECK ("report_paper_signoffs"."approved_on" >= "report_paper_signoffs"."reviewed_on")
);
--> statement-breakpoint
ALTER TABLE "study_reports" DROP CONSTRAINT "study_reports_status_check";--> statement-breakpoint
-- Phase 8's "frozen" is phase 9's "checking": frozen, waiting for QA Tech's checker.
UPDATE "study_reports" SET "status" = 'checking' WHERE "status" = 'frozen';--> statement-breakpoint
ALTER TABLE "deviations" ADD COLUMN "decision_signature_id" uuid;--> statement-breakpoint
ALTER TABLE "studies" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "study_reports" ADD COLUMN "layout" jsonb;--> statement-breakpoint
ALTER TABLE "study_reports" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "study_reports" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "study_reports" ADD COLUMN "released_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "study_reports" ADD COLUMN "released_to" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "study_reports" ADD COLUMN "returned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "study_reports" ADD COLUMN "signed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "study_reports" ADD COLUMN "signed_via" text;--> statement-breakpoint
ALTER TABLE "study_reports" ADD COLUMN "signed_file_id" uuid;--> statement-breakpoint
ALTER TABLE "study_reports" ADD COLUMN "signed_sha256" text;--> statement-breakpoint
ALTER TABLE "report_comments" ADD CONSTRAINT "report_comments_report_id_study_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."study_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_comments" ADD CONSTRAINT "report_comments_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_comments" ADD CONSTRAINT "report_comments_answered_by_user_id_users_id_fk" FOREIGN KEY ("answered_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_comments" ADD CONSTRAINT "report_comments_study_fk" FOREIGN KEY ("study_id","organisation_id") REFERENCES "public"."studies"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_paper_signoffs" ADD CONSTRAINT "report_paper_signoffs_report_id_study_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."study_reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_paper_signoffs" ADD CONSTRAINT "report_paper_signoffs_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_paper_signoffs" ADD CONSTRAINT "report_paper_signoffs_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_comments_study_idx" ON "report_comments" USING btree ("study_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "report_paper_signoffs_report_key" ON "report_paper_signoffs" USING btree ("report_id");--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_decision_signature_id_signatures_id_fk" FOREIGN KEY ("decision_signature_id") REFERENCES "public"."signatures"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_reports" ADD CONSTRAINT "study_reports_released_by_user_id_users_id_fk" FOREIGN KEY ("released_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_reports" ADD CONSTRAINT "study_reports_signed_file_id_stored_files_id_fk" FOREIGN KEY ("signed_file_id") REFERENCES "public"."stored_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_reports" ADD CONSTRAINT "study_reports_signed_check" CHECK (("study_reports"."signed_at" is null) = ("study_reports"."signed_via" is null) and ("study_reports"."signed_via" is null or "study_reports"."signed_via" in ('app', 'paper')));--> statement-breakpoint
ALTER TABLE "study_reports" ADD CONSTRAINT "study_reports_status_check" CHECK ("study_reports"."status" in ('draft', 'checking', 'checked', 'released', 'reviewed', 'signed', 'returned', 'superseded'));