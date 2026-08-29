-- Custom migration: `events` and `audit_events` are append-only. A row-level
-- trigger rejects every UPDATE and DELETE; inserts are the only way in.
CREATE FUNCTION raise_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER events_append_only
BEFORE UPDATE OR DELETE ON "events"
FOR EACH ROW EXECUTE FUNCTION raise_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION raise_append_only();
