-- Status history table improvements from audit SH-P1-04
-- Run this in Supabase SQL Editor

-- =============================================
-- INDEX ON CHANGED_BY_ID
-- =============================================
-- Speeds up queries filtering by who made the change
-- Partial index: only indexes non-null (excludes system changes)

CREATE INDEX IF NOT EXISTS "status_history_changed_by_id_idx"
ON "status_history"("changed_by_id")
WHERE "changed_by_id" IS NOT NULL;

-- =============================================
-- VERIFICATION QUERY
-- =============================================
-- SELECT indexname FROM pg_indexes
-- WHERE tablename = 'status_history';
