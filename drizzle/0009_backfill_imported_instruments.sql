-- Instruments imported before 29 Oct 2026 did not take the details their
-- model has (resolution, accuracy, name, range), and imported certificates
-- had no customer. Fill only what is empty; nothing typed by a person changes.
UPDATE "instruments" AS i
SET "resolution_text" = CASE WHEN i."resolution_text" = '' THEN m."resolution_text" ELSE i."resolution_text" END,
    "accuracy_text" = CASE WHEN i."accuracy_text" = '' THEN m."accuracy_text" ELSE i."accuracy_text" END,
    "equipment_name" = CASE WHEN i."equipment_name" = '' THEN m."equipment_name" ELSE i."equipment_name" END,
    "range_text" = CASE WHEN i."range_text" = '' THEN m."range_text" ELSE i."range_text" END
FROM "instrument_models" AS m
WHERE i."model_id" = m."id"
  AND i."organisation_id" = m."organisation_id"
  AND (i."resolution_text" = '' OR i."accuracy_text" = '' OR i."equipment_name" = '' OR i."range_text" = '');
--> statement-breakpoint
UPDATE "certificates" AS c
SET "customer_name" = s."legal_name",
    "customer_address" = s."address"
FROM "organisation_settings" AS s
WHERE c."organisation_id" = s."organisation_id"
  AND c."kind" = 'imported'
  AND c."customer_name" = '';
