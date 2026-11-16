ALTER TABLE "studies" ADD COLUMN "room_shape" jsonb;--> statement-breakpoint
ALTER TABLE "studies" ADD COLUMN "layout_sketch_file_id" uuid;--> statement-breakpoint
ALTER TABLE "studies" ADD CONSTRAINT "studies_layout_sketch_file_id_stored_files_id_fk" FOREIGN KEY ("layout_sketch_file_id") REFERENCES "public"."stored_files"("id") ON DELETE restrict ON UPDATE no action;