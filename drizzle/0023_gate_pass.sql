ALTER TABLE "jobs" ADD COLUMN "gate_pass_number" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "gate_pass_file_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "gate_pass_not_needed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_gate_pass_file_id_stored_files_id_fk" FOREIGN KEY ("gate_pass_file_id") REFERENCES "public"."stored_files"("id") ON DELETE restrict ON UPDATE no action;