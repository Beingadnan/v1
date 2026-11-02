CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"number" text NOT NULL,
	"financial_year" text NOT NULL,
	"invoice_date" date NOT NULL,
	"taxable" numeric(12, 2) NOT NULL,
	"gst" numeric(12, 2) NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"cancel_reason" text,
	"cleared_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_status_check" CHECK ("invoices"."status" in ('open', 'cleared', 'cancelled')),
	CONSTRAINT "invoices_number_check" CHECK ("invoices"."number" ~ '^[A-Za-z0-9/-]{1,16}$'),
	CONSTRAINT "invoices_amounts_check" CHECK ("invoices"."taxable" > 0 and "invoices"."gst" >= 0 and "invoices"."total" = "invoices"."taxable" + "invoices"."gst"),
	CONSTRAINT "invoices_cancel_check" CHECK (("invoices"."status" = 'cancelled') = ("invoices"."cancel_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "job_wcrs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"file_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"sign_box" jsonb,
	"issued_by_user_id" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signed_via" text,
	"signed_at" timestamp with time zone,
	"signature_id" uuid,
	"paper_file_id" uuid,
	"paper_signed_by_name" text,
	"paper_signed_on" date,
	"void_reason" text,
	"voided_at" timestamp with time zone,
	CONSTRAINT "job_wcrs_status_check" CHECK ("job_wcrs"."status" in ('issued', 'signed', 'void')),
	CONSTRAINT "job_wcrs_signed_check" CHECK (("job_wcrs"."status" = 'signed') = ("job_wcrs"."signed_at" is not null) and ("job_wcrs"."signed_at" is null) = ("job_wcrs"."signed_via" is null) and ("job_wcrs"."signed_via" is null or "job_wcrs"."signed_via" in ('app', 'paper'))),
	CONSTRAINT "job_wcrs_paper_check" CHECK ("job_wcrs"."signed_via" is distinct from 'paper' or ("job_wcrs"."paper_file_id" is not null and "job_wcrs"."paper_signed_by_name" is not null and "job_wcrs"."paper_signed_on" is not null))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"paid_on" date NOT NULL,
	"received" numeric(12, 2) DEFAULT '0' NOT NULL,
	"tds" numeric(12, 2) DEFAULT '0' NOT NULL,
	"written_off" numeric(12, 2) DEFAULT '0' NOT NULL,
	"mode" text NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"reverses_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_mode_check" CHECK ("payments"."mode" in ('neft', 'rtgs', 'imps', 'upi', 'cheque', 'cash', 'other')),
	CONSTRAINT "payments_amounts_check" CHECK ("payments"."reverses_id" is not null or ("payments"."received" >= 0 and "payments"."tds" >= 0 and "payments"."written_off" >= 0 and "payments"."received" + "payments"."tds" + "payments"."written_off" > 0)),
	CONSTRAINT "payments_writeoff_check" CHECK ("payments"."written_off" = 0 or length(trim("payments"."note")) > 0)
);
--> statement-breakpoint
ALTER TABLE "client_companies" ADD COLUMN "payment_terms_days" integer DEFAULT 45 NOT NULL;--> statement-breakpoint
ALTER TABLE "organisation_settings" ADD COLUMN "udyam_number" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_job_fk" FOREIGN KEY ("job_id","organisation_id") REFERENCES "public"."jobs"("id","organisation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_wcrs" ADD CONSTRAINT "job_wcrs_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_wcrs" ADD CONSTRAINT "job_wcrs_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_wcrs" ADD CONSTRAINT "job_wcrs_signature_id_signatures_id_fk" FOREIGN KEY ("signature_id") REFERENCES "public"."signatures"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_wcrs" ADD CONSTRAINT "job_wcrs_paper_file_id_stored_files_id_fk" FOREIGN KEY ("paper_file_id") REFERENCES "public"."stored_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_wcrs" ADD CONSTRAINT "job_wcrs_job_fk" FOREIGN KEY ("job_id","organisation_id") REFERENCES "public"."jobs"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reverses_id_payments_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_fy_number_key" ON "invoices" USING btree ("organisation_id","financial_year",upper("number")) WHERE "invoices"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "invoices_job_idx" ON "invoices" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "invoices_org_status_idx" ON "invoices" USING btree ("organisation_id","status","invoice_date");--> statement-breakpoint
CREATE UNIQUE INDEX "job_wcrs_live_key" ON "job_wcrs" USING btree ("job_id") WHERE "job_wcrs"."status" <> 'void';--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_reverses_key" ON "payments" USING btree ("reverses_id") WHERE "payments"."reverses_id" is not null;--> statement-breakpoint
ALTER TABLE "client_companies" ADD CONSTRAINT "client_companies_terms_check" CHECK ("client_companies"."payment_terms_days" between 0 and 365);