CREATE TABLE "certificate_scan_readings" (
	"file_id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"model" text NOT NULL,
	"reading" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "certificate_scan_readings" ADD CONSTRAINT "certificate_scan_readings_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_scan_readings" ADD CONSTRAINT "certificate_scan_readings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;