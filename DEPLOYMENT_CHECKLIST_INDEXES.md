# Deployment Checklist: TaxCase Index Optimization

## Pre-Deployment

- [ ] Review `INDEX_OPTIMIZATION_SUMMARY.md` to understand the changes
- [ ] Review `add_taxcase_indexes.sql` (436 lines with detailed documentation)
- [ ] Verify current database size: `SELECT pg_size_pretty(pg_database_size('database_name'));`
- [ ] Backup production database (just in case, though CONCURRENTLY is safe)

## Step 1: Deploy Prisma Schema Changes

```bash
cd portal-jai1-backend

# Preview the migration
npx prisma migrate dev --name add_taxcase_composite_indexes --create-only

# Review the generated migration file
cat prisma/migrations/YYYYMMDD_add_taxcase_composite_indexes/migration.sql

# Apply to development database
npx prisma migrate dev

# Test queries in development
npm run test:e2e

# Deploy to production
npx prisma migrate deploy
```

**Expected**: 5 new composite indexes created automatically by Prisma.

## Step 2: Run Manual SQL Migration

```bash
# Connect to production database
psql $DATABASE_URL -f add_taxcase_indexes.sql

# OR for Railway:
railway connect
\i add_taxcase_indexes.sql
```

**Expected**: 11 partial indexes created with `CREATE INDEX CONCURRENTLY`.
**Duration**: 5-15 minutes depending on database size (no downtime).

## Step 3: Verify Index Creation

```sql
-- Should show 16+ indexes (existing + 5 Prisma + 11 manual)
SELECT COUNT(*) as index_count
FROM pg_indexes
WHERE tablename = 'tax_cases';

-- List all custom indexes
SELECT indexname, pg_size_pretty(pg_relation_size(indexrelid)) as size
FROM pg_stat_user_indexes
WHERE tablename = 'tax_cases'
  AND indexname LIKE 'idx_taxcase_%'
ORDER BY indexname;
```

**Expected indexes**:
- `idx_taxcase_filed_federal_status`
- `idx_taxcase_federal_status_deposited`
- `idx_taxcase_state_status_deposited`
- `idx_taxcase_federal_status_rejected`
- `idx_taxcase_state_status_rejected`
- `idx_taxcase_problem_status`
- `idx_taxcase_problem_federal_new`
- `idx_taxcase_problem_state_new`
- `idx_taxcase_v2_all_statuses`
- `idx_taxcase_filed_legacy_statuses`
- `idx_taxcase_profile_covering`

## Step 4: Update Statistics

```sql
-- Critical: Update PostgreSQL query planner statistics
ANALYZE tax_cases;

-- Verify statistics were updated
SELECT schemaname, tablename, last_analyze
FROM pg_stat_user_tables
WHERE tablename = 'tax_cases';
```

## Step 5: Verify Query Plans

Run these queries to confirm indexes are being used:

```sql
-- Test 1: group_in_review
EXPLAIN ANALYZE
SELECT cp.id, u.email, tc.id as tax_case_id
FROM client_profiles cp
JOIN users u ON u.id = cp.user_id
JOIN tax_cases tc ON tc.client_profile_id = cp.id
WHERE tc.taxes_filed = true
  AND tc.federal_status IN ('processing', 'pending', 'filed')
LIMIT 20;
-- Expected: "Index Scan using idx_taxcase_filed_federal_status"

-- Test 2: group_needs_attention
EXPLAIN ANALYZE
SELECT cp.id, u.email, tc.id as tax_case_id
FROM client_profiles cp
JOIN users u ON u.id = cp.user_id
JOIN tax_cases tc ON tc.client_profile_id = cp.id
WHERE tc.federal_status = 'rejected'
   OR tc.state_status = 'rejected'
   OR tc.has_problem = true
LIMIT 20;
-- Expected: "BitmapOr" with 3 partial indexes

-- Test 3: Client detail page
EXPLAIN ANALYZE
SELECT tax_year, taxes_filed, federal_status, state_status,
       has_problem, estimated_refund
FROM tax_cases
WHERE client_profile_id = (SELECT id FROM client_profiles LIMIT 1)
ORDER BY tax_year DESC;
-- Expected: "Index Only Scan using idx_taxcase_profile_covering"
```

## Step 6: Monitor Performance (24-48 hours)

```sql
-- Check index usage statistics
SELECT
    indexname,
    idx_scan as scans,
    idx_tup_read as rows_read,
    pg_size_pretty(pg_relation_size(indexrelid)) as size
FROM pg_stat_user_indexes
WHERE tablename = 'tax_cases'
  AND indexname LIKE 'idx_taxcase_%'
ORDER BY idx_scan DESC;

-- Identify slow queries (if slow query log is enabled)
SELECT
    query,
    mean_exec_time,
    calls
FROM pg_stat_statements
WHERE query LIKE '%tax_cases%'
ORDER BY mean_exec_time DESC
LIMIT 10;
```

## Step 7: Validate Application Performance

- [ ] Load admin client list: `/admin/clients` (should be 20-50x faster)
- [ ] Test each group filter (Pending, In Review, Completed, Needs Attention)
- [ ] Test advanced filters (hasProblem, federalStatus, stateStatus, caseStatus)
- [ ] Test search + filter combinations
- [ ] Load client detail page (should be 50x faster)
- [ ] Check server logs for any query errors

## Post-Deployment

- [ ] Monitor index scans for 1 week (see Step 6 query)
- [ ] Identify any unused indexes: `SELECT indexname FROM pg_stat_user_indexes WHERE tablename = 'tax_cases' AND idx_scan = 0;`
- [ ] Document any edge cases that still use sequential scans
- [ ] Update team documentation with new index strategy

## Rollback (if needed)

**NOTE**: Only rollback if there are critical issues. Indexes do not break functionality.

```sql
-- Drop all partial indexes
DROP INDEX CONCURRENTLY IF EXISTS idx_taxcase_filed_federal_status;
DROP INDEX CONCURRENTLY IF EXISTS idx_taxcase_federal_status_deposited;
DROP INDEX CONCURRENTLY IF EXISTS idx_taxcase_state_status_deposited;
DROP INDEX CONCURRENTLY IF EXISTS idx_taxcase_federal_status_rejected;
DROP INDEX CONCURRENTLY IF EXISTS idx_taxcase_state_status_rejected;
DROP INDEX CONCURRENTLY IF EXISTS idx_taxcase_problem_status;
DROP INDEX CONCURRENTLY IF EXISTS idx_taxcase_problem_federal_new;
DROP INDEX CONCURRENTLY IF EXISTS idx_taxcase_problem_state_new;
DROP INDEX CONCURRENTLY IF EXISTS idx_taxcase_v2_all_statuses;
DROP INDEX CONCURRENTLY IF EXISTS idx_taxcase_filed_legacy_statuses;
DROP INDEX CONCURRENTLY IF EXISTS idx_taxcase_profile_covering;

-- Rollback Prisma migration
npx prisma migrate resolve --rolled-back YYYYMMDD_add_taxcase_composite_indexes
```

## Success Criteria

✅ All 16+ indexes created successfully
✅ Query plans show index usage (no "Seq Scan" on tax_cases)
✅ Admin client list loads in <100ms (down from 1-2 seconds)
✅ Client detail pages load in <50ms (down from 500ms)
✅ No increase in error rates
✅ Index scans increase over first week of monitoring

## Troubleshooting

### Issue: Index creation fails with "already exists"
**Solution**: Some indexes may already exist. This is safe, continue with remaining indexes.

### Issue: Query still uses "Seq Scan"
**Solution**: Run `ANALYZE tax_cases;` and check query plan again. PostgreSQL may choose Seq Scan if table is small (<1000 rows).

### Issue: Slow query after indexes
**Solution**: Check `EXPLAIN (ANALYZE, BUFFERS)` to see if index is being used. May need to `REINDEX CONCURRENTLY`.

### Issue: High disk usage
**Solution**: Expected. Indexes add ~120MB (25% of table size). This is acceptable trade-off for 20-50x speedup.

## Documentation

- **Summary**: `INDEX_OPTIMIZATION_SUMMARY.md`
- **SQL Migration**: `add_taxcase_indexes.sql`
- **Schema Changes**: `prisma/schema.prisma` (lines 218-224)
- **Service Code**: `src/modules/clients/clients.service.ts` (lines 1042-1178)

---

**Deployment Lead**: _________________
**Date Deployed**: _________________
**Status**: ☐ Success  ☐ Rolled Back
