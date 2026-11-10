CREATE TABLE "client_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"number" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"value" numeric(12, 2),
	"file_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	CONSTRAINT "client_contracts_id_org_key" UNIQUE("id","organisation_id"),
	CONSTRAINT "client_contracts_kind_check" CHECK ("client_contracts"."kind" in ('arc', 'amc')),
	CONSTRAINT "client_contracts_dates_check" CHECK ("client_contracts"."valid_to" >= "client_contracts"."valid_from"),
	CONSTRAINT "client_contracts_value_check" CHECK ("client_contracts"."value" is null or "client_contracts"."value" >= 0)
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "order_type" text DEFAULT 'po' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "order_file_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "contract_id" uuid;--> statement-breakpoint
ALTER TABLE "client_contracts" ADD CONSTRAINT "client_contracts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contracts" ADD CONSTRAINT "client_contracts_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contracts" ADD CONSTRAINT "client_contracts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contracts" ADD CONSTRAINT "client_contracts_company_fk" FOREIGN KEY ("company_id","organisation_id") REFERENCES "public"."client_companies"("id","organisation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_contracts_company_number_key" ON "client_contracts" USING btree ("company_id","kind",lower("number"));--> statement-breakpoint
CREATE INDEX "client_contracts_company_idx" ON "client_contracts" USING btree ("company_id","valid_to");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_order_file_id_stored_files_id_fk" FOREIGN KEY ("order_file_id") REFERENCES "public"."stored_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_contract_fk" FOREIGN KEY ("contract_id","organisation_id") REFERENCES "public"."client_contracts"("id","organisation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_order_type_check" CHECK ("jobs"."order_type" in ('po', 'srf', 'arc', 'amc'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check" CHECK ("notifications"."kind" in ('report_to_check', 'report_returned', 'report_checked', 'report_released', 'report_client_returned', 'report_client_signed', 'wcr_to_accept', 'wcr_accepted', 'deviation_to_decide', 'deviation_decided', 'capa_assigned', 'order_pending', 'invoice_pending', 'contract_expiring'));