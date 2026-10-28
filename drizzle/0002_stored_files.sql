CREATE TABLE "stored_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"file_type" text NOT NULL,
	"mime_type" text NOT NULL,
	"storage_key" text NOT NULL,
	"first_file_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	CONSTRAINT "stored_files_sha256_format_check" CHECK ("stored_files"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "stored_files_size_check" CHECK ("stored_files"."size_bytes" > 0),
	CONSTRAINT "stored_files_type_check" CHECK ("stored_files"."file_type" in ('pdf', 'xlsx', 'xls', 'csv', 'png', 'jpeg'))
);
--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stored_files_org_sha256_key" ON "stored_files" USING btree ("organisation_id","sha256");