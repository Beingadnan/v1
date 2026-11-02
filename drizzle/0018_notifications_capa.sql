CREATE TABLE "capas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"deviation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"root_cause" text NOT NULL,
	"action" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"done_note" text,
	"done_at" timestamp with time zone,
	"effectiveness_note" text,
	"verified_by_user_id" uuid,
	"verified_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capas_kind_check" CHECK ("capas"."kind" in ('corrective', 'preventive')),
	CONSTRAINT "capas_status_check" CHECK ("capas"."status" in ('open', 'done', 'verified')),
	CONSTRAINT "capas_done_check" CHECK (("capas"."status" = 'open') = ("capas"."done_at" is null)),
	CONSTRAINT "capas_verified_check" CHECK (("capas"."status" = 'verified') = ("capas"."verified_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"href" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"email_status" text DEFAULT 'none' NOT NULL,
	"emailed_at" timestamp with time zone,
	CONSTRAINT "notifications_kind_check" CHECK ("notifications"."kind" in ('report_to_check', 'report_returned', 'report_checked', 'report_released', 'report_client_returned', 'report_client_signed', 'wcr_to_accept', 'wcr_accepted', 'deviation_to_decide', 'deviation_decided', 'capa_assigned')),
	CONSTRAINT "notifications_email_check" CHECK ("notifications"."email_status" in ('none', 'pending', 'sent', 'skipped', 'failed')),
	CONSTRAINT "notifications_href_check" CHECK ("notifications"."href" ~ '^/')
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_alerts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "digest_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "capas" ADD CONSTRAINT "capas_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capas" ADD CONSTRAINT "capas_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capas" ADD CONSTRAINT "capas_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capas" ADD CONSTRAINT "capas_deviation_fk" FOREIGN KEY ("deviation_id","organisation_id") REFERENCES "public"."deviations"("id","organisation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_fk" FOREIGN KEY ("user_id","organisation_id") REFERENCES "public"."users"("id","organisation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capas_deviation_idx" ON "capas" USING btree ("deviation_id");--> statement-breakpoint
CREATE INDEX "capas_org_status_idx" ON "capas" USING btree ("organisation_id","status","due_on");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("user_id") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_email_idx" ON "notifications" USING btree ("email_status") WHERE "notifications"."email_status" = 'pending';