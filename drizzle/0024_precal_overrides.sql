CREATE TABLE "precal_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"study_id" uuid NOT NULL,
	"precal_id" uuid NOT NULL,
	"from_result" text NOT NULL,
	"to_result" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"signature_id" uuid,
	"decision_note" text DEFAULT '' NOT NULL,
	CONSTRAINT "precal_overrides_status_check" CHECK ("precal_overrides"."status" in ('requested', 'approved', 'rejected')),
	CONSTRAINT "precal_overrides_results_check" CHECK ("precal_overrides"."from_result" in ('pass', 'fail') and "precal_overrides"."to_result" in ('pass', 'fail') and "precal_overrides"."from_result" <> "precal_overrides"."to_result"),
	CONSTRAINT "precal_overrides_decision_check" CHECK (("precal_overrides"."status" = 'requested') = ("precal_overrides"."decided_at" is null) and ("precal_overrides"."status" <> 'approved' or "precal_overrides"."signature_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";--> statement-breakpoint
ALTER TABLE "precal_overrides" ADD CONSTRAINT "precal_overrides_precal_id_study_precal_id_fk" FOREIGN KEY ("precal_id") REFERENCES "public"."study_precal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precal_overrides" ADD CONSTRAINT "precal_overrides_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precal_overrides" ADD CONSTRAINT "precal_overrides_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precal_overrides" ADD CONSTRAINT "precal_overrides_signature_id_signatures_id_fk" FOREIGN KEY ("signature_id") REFERENCES "public"."signatures"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precal_overrides" ADD CONSTRAINT "precal_overrides_study_fk" FOREIGN KEY ("study_id","organisation_id") REFERENCES "public"."studies"("id","organisation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "precal_overrides_study_idx" ON "precal_overrides" USING btree ("study_id");--> statement-breakpoint
CREATE UNIQUE INDEX "precal_overrides_live_key" ON "precal_overrides" USING btree ("precal_id") WHERE "precal_overrides"."status" in ('requested', 'approved');--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check" CHECK ("notifications"."kind" in ('report_to_check', 'report_returned', 'report_checked', 'report_released', 'report_client_returned', 'report_client_signed', 'wcr_to_accept', 'wcr_accepted', 'deviation_to_decide', 'deviation_decided', 'capa_assigned', 'order_pending', 'invoice_pending', 'contract_expiring', 'override_to_approve'));