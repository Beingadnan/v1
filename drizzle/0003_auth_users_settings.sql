CREATE TABLE "number_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"site_code" text DEFAULT '' NOT NULL,
	"year" integer NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "number_series_kind_check" CHECK ("number_series"."kind" in ('job', 'certificate')),
	CONSTRAINT "number_series_value_check" CHECK ("number_series"."last_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "organisation_settings" (
	"organisation_id" uuid PRIMARY KEY NOT NULL,
	"legal_name" text NOT NULL,
	"short_name" text NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"gstin" text DEFAULT '' NOT NULL,
	"letterhead_file_id" uuid,
	"job_number_format" text DEFAULT 'QT/J/{YYYY}/{SEQ:4}' NOT NULL,
	"certificate_number_format" text DEFAULT 'CERT-{SITE}-{YYYY}-{SEQ:4}' NOT NULL,
	"mkt_activation_energy_kj_mol" numeric(8, 3) DEFAULT '83.144' NOT NULL,
	"f0_reference_temp_c" numeric(6, 2) DEFAULT '121.10' NOT NULL,
	"f0_z_value_c" numeric(6, 2) DEFAULT '10.00' NOT NULL,
	"session_idle_minutes" integer DEFAULT 30 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" uuid,
	CONSTRAINT "org_settings_idle_check" CHECK ("organisation_settings"."session_idle_minutes" between 5 and 240),
	CONSTRAINT "org_settings_mkt_check" CHECK ("organisation_settings"."mkt_activation_energy_kj_mol" > 0),
	CONSTRAINT "org_settings_z_check" CHECK ("organisation_settings"."f0_z_value_c" > 0)
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sites_code_format_check" CHECK ("sites"."code" ~ '^[A-Z]{2,5}$')
);
--> statement-breakpoint
CREATE TABLE "signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"signer_name" text NOT NULL,
	"signer_role" text NOT NULL,
	"meaning" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"record_hash" text NOT NULL,
	"reason" text,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" "inet",
	"user_agent" text,
	CONSTRAINT "signatures_record_hash_check" CHECK ("signatures"."record_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "signatures_meaning_check" CHECK ("signatures"."meaning" ~ '^[a-z_]+$')
);
--> statement-breakpoint
CREATE TABLE "account_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	CONSTRAINT "account_tokens_purpose_check" CHECK ("account_tokens"."purpose" in ('setup', 'reset'))
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email_lower" text NOT NULL,
	"ip_address" "inet",
	"outcome" text NOT NULL,
	CONSTRAINT "login_attempts_outcome_check" CHECK ("login_attempts"."outcome" in ('success', 'bad_credentials', 'locked', 'inactive', 'throttled'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip_address" "inet",
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"client_company_id" uuid,
	"password_hash" text,
	"status" text DEFAULT 'invited' NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	CONSTRAINT "users_role_check" CHECK ("users"."role" in ('admin', 'manager', 'team_leader', 'report_preparer', 'field_engineer', 'lab', 'accounts', 'client_qa', 'client_qa_head')),
	CONSTRAINT "users_status_check" CHECK ("users"."status" in ('invited', 'active', 'deactivated')),
	CONSTRAINT "users_active_has_password_check" CHECK ("users"."status" <> 'active' or "users"."password_hash" is not null),
	CONSTRAINT "users_email_format_check" CHECK ("users"."email" ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);
--> statement-breakpoint
ALTER TABLE "number_series" ADD CONSTRAINT "number_series_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_settings" ADD CONSTRAINT "organisation_settings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_settings" ADD CONSTRAINT "organisation_settings_letterhead_file_id_stored_files_id_fk" FOREIGN KEY ("letterhead_file_id") REFERENCES "public"."stored_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_settings" ADD CONSTRAINT "organisation_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_tokens" ADD CONSTRAINT "account_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_tokens" ADD CONSTRAINT "account_tokens_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "number_series_key" ON "number_series" USING btree ("organisation_id","kind","site_code","year");--> statement-breakpoint
CREATE UNIQUE INDEX "sites_org_code_key" ON "sites" USING btree ("organisation_id","code");--> statement-breakpoint
CREATE INDEX "signatures_entity_idx" ON "signatures" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_tokens_token_hash_key" ON "account_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "account_tokens_user_idx" ON "account_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "login_attempts_ip_time_idx" ON "login_attempts" USING btree ("ip_address","attempted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_org_idx" ON "users" USING btree ("organisation_id");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;