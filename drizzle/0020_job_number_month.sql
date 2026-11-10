ALTER TABLE "organisation_settings" ALTER COLUMN "job_number_format" SET DEFAULT 'QT/{MM}/{YYYY}/{SEQ:4}';--> statement-breakpoint
-- QA Tech asked for QT/month/year/0001 (Nov 2026). Organisations still on the old default move to the
-- new one; one that chose its own format keeps it. Existing jobs keep their numbers.
UPDATE "organisation_settings" SET "job_number_format" = 'QT/{MM}/{YYYY}/{SEQ:4}' WHERE "job_number_format" = 'QT/J/{YYYY}/{SEQ:4}';
