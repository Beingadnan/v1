ALTER TABLE "study_positions" ADD COLUMN "level" text;--> statement-breakpoint
ALTER TABLE "study_positions" ADD COLUMN "height_cm" numeric(7, 1);--> statement-breakpoint
ALTER TABLE "study_positions" ADD COLUMN "height_from" text;--> statement-breakpoint
ALTER TABLE "study_positions" ADD CONSTRAINT "study_positions_level_check" CHECK ("study_positions"."level" is null or "study_positions"."level" in ('bottom', 'middle', 'top', 'extreme_top'));--> statement-breakpoint
ALTER TABLE "study_positions" ADD CONSTRAINT "study_positions_height_check" CHECK (("study_positions"."height_cm" is null and "study_positions"."height_from" is null) or ("study_positions"."height_cm" >= 0 and "study_positions"."height_from" in ('bottom', 'top')));