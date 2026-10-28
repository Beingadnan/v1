-- Electronic signatures can never be changed or removed (same rule as audit_log).
-- Reuses audit_log_reject_change() from migration 0001; its message names the table via TG_TABLE_NAME.

CREATE OR REPLACE FUNCTION audit_log_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER signatures_no_update_delete
  BEFORE UPDATE OR DELETE ON "signatures"
  FOR EACH ROW EXECUTE FUNCTION audit_log_reject_change();
--> statement-breakpoint
CREATE TRIGGER signatures_no_truncate
  BEFORE TRUNCATE ON "signatures"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_reject_change();
