-- ============================================================================
-- ALARM SYSTEM PERFORMANCE INDEXES
-- ============================================================================
-- Purpose: Optimize alarm dashboard queries for 100+ clients
-- Apply these indexes manually in Supabase SQL Editor
-- ============================================================================

-- Index for getDashboard WHERE clause
-- Speeds up filtering by federal/state status
CREATE INDEX IF NOT EXISTS idx_taxcase_alarm_statuses
ON "TaxCase" (
  "federalStatusNew",
  "stateStatusNew",
  "updatedAt" DESC
);

-- Index for alarm history queries (active/acknowledged alarms)
-- Speeds up finding active alarms for specific tax cases
CREATE INDEX IF NOT EXISTS idx_alarmhistory_active
ON "AlarmHistory" (
  "taxCaseId",
  "resolution",
  "triggeredAt" DESC
) WHERE "resolution" IN ('active', 'acknowledged');

-- Partial index for completed cases filter
-- Speeds up hideCompleted filter by excluding completed cases
CREATE INDEX IF NOT EXISTS idx_taxcase_completed
ON "TaxCase" (
  "id",
  "updatedAt" DESC
) WHERE "federalStatusNew" = 'taxes_completed'
     OR "stateStatusNew" = 'taxes_completed';

-- Index for alarm history by resolution type
-- Speeds up queries filtering by dismissed/resolved alarms
CREATE INDEX IF NOT EXISTS idx_alarmhistory_resolution_timestamp
ON "AlarmHistory" (
  "resolution",
  "triggeredAt" DESC,
  "taxCaseId"
);

-- Composite index for pagination cursor queries
-- Speeds up cursor-based pagination on tax cases
CREATE INDEX IF NOT EXISTS idx_taxcase_cursor_pagination
ON "TaxCase" (
  "updatedAt" DESC,
  "id"
) WHERE "federalStatusNew" IS NOT NULL
     OR "stateStatusNew" IS NOT NULL;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Run these to verify indexes were created successfully:

-- Check all alarm-related indexes
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename IN ('TaxCase', 'AlarmHistory')
  AND indexname LIKE 'idx_%alarm%'
ORDER BY tablename, indexname;

-- Check index usage (run after some queries)
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan as index_scans,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE tablename IN ('TaxCase', 'AlarmHistory')
ORDER BY idx_scan DESC;

-- ============================================================================
-- PERFORMANCE TESTING
-- ============================================================================
-- Test query performance with EXPLAIN ANALYZE

-- Test getDashboard query with active status filter
EXPLAIN ANALYZE
SELECT *
FROM "TaxCase"
WHERE (
  "federalStatusNew" IN ('in_process', 'in_verification', 'verification_in_progress', 'verification_letter_sent')
  OR "stateStatusNew" IN ('in_process', 'in_verification', 'verification_in_progress', 'verification_letter_sent')
)
ORDER BY "updatedAt" DESC
LIMIT 50;

-- Test hideCompleted filter
EXPLAIN ANALYZE
SELECT *
FROM "TaxCase"
WHERE (
  "federalStatusNew" IN ('in_process', 'in_verification', 'verification_in_progress', 'verification_letter_sent')
  OR "stateStatusNew" IN ('in_process', 'in_verification', 'verification_in_progress', 'verification_letter_sent')
)
AND (
  ("federalStatusNew" != 'taxes_completed' OR "federalStatusNew" IS NULL)
  AND ("stateStatusNew" != 'taxes_completed' OR "stateStatusNew" IS NULL)
)
ORDER BY "updatedAt" DESC
LIMIT 50;

-- Test alarm history query
EXPLAIN ANALYZE
SELECT *
FROM "AlarmHistory"
WHERE "taxCaseId" = 'some-uuid-here'
  AND "resolution" IN ('active', 'acknowledged')
ORDER BY "triggeredAt" DESC;

-- ============================================================================
-- NOTES
-- ============================================================================
-- Expected performance improvements:
-- - Before: 2-5 seconds for 100+ cases
-- - After: 500-800ms for 100+ cases (50-75% faster)
--
-- Index sizes (approximate):
-- - idx_taxcase_alarm_statuses: ~100KB per 1000 records
-- - idx_alarmhistory_active: ~50KB per 1000 records
-- - idx_taxcase_completed: ~30KB per 1000 records
--
-- Maintenance:
-- - PostgreSQL auto-maintains these indexes
-- - VACUUM ANALYZE recommended after bulk updates
-- - Monitor index bloat if high update frequency
-- ============================================================================
