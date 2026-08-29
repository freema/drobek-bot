-- Custom migration: the immutability guards.
--
-- `events` rows are immutable but deletable: a run, thread or bot that has
-- events must be hard-deletable through the FK cascades (deleting a bot is a
-- product requirement), so there is deliberately no DELETE trigger. UPDATE
-- and TRUNCATE are rejected.
--
-- `audit_events` are fully append-only: UPDATE, DELETE and TRUNCATE are
-- rejected. Inserts are the only way in.
CREATE FUNCTION raise_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on table % is not allowed', TG_OP, TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER events_immutable
BEFORE UPDATE ON "events"
FOR EACH ROW EXECUTE FUNCTION raise_immutable();
--> statement-breakpoint
CREATE TRIGGER events_no_truncate
BEFORE TRUNCATE ON "events"
FOR EACH STATEMENT EXECUTE FUNCTION raise_immutable();
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION raise_immutable();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate
BEFORE TRUNCATE ON "audit_events"
FOR EACH STATEMENT EXECUTE FUNCTION raise_immutable();
