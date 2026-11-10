ALTER TABLE "studies" ADD COLUMN "pre_cal_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Until now pre-calibration was shown whenever post-calibration was (or the study was thermal
-- validation). Keep that for existing studies.
UPDATE "studies" SET "pre_cal_required" = true WHERE "post_cal_required" OR "work_type" = 'thermal_validation';
