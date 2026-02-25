-- Composite index on (status_changed, created_at) for the getStats() query
-- which counts rows WHERE status_changed = true AND created_at >= :since.
-- Without this, that query does a full table scan on every stats poll.
CREATE INDEX IF NOT EXISTS "irs_checks_status_changed_created_at_idx"
  ON "irs_checks" ("status_changed", "created_at");
