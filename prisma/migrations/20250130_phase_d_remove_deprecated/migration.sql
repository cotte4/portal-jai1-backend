-- =============================================
-- PHASE D: Remove Deprecated Status Fields
-- =============================================
--
-- ⚠️ WARNING: THIS MIGRATION IS IRREVERSIBLE ⚠️
--
-- Prerequisites before running:
-- 1. Run phase_d_verification_queries.sql and verify ALL checks pass
-- 2. Ensure production has been stable for 2+ weeks with Phase C changes
-- 3. Create a full database backup
-- 4. Verify no code references internal_status or client_status
-- 5. Test in staging environment first
--
-- Run in Supabase SQL Editor after backup.
-- =============================================

-- =============================================
-- STEP 0: SAFETY BACKUP (Run first, keep results)
-- =============================================
-- Create a backup of the deprecated columns before dropping
-- Uncomment and run this section to create backup table

-- CREATE TABLE IF NOT EXISTS _backup_deprecated_status AS
-- SELECT
--   id,
--   internal_status,
--   client_status,
--   NOW() as backed_up_at
-- FROM tax_cases;

-- Verify backup
-- SELECT COUNT(*) FROM _backup_deprecated_status;

-- =============================================
-- STEP 1: DROP DEPRECATED COLUMNS
-- =============================================

-- Remove internal_status column
ALTER TABLE "tax_cases" DROP COLUMN IF EXISTS "internal_status";

-- Remove client_status column
ALTER TABLE "tax_cases" DROP COLUMN IF EXISTS "client_status";

-- =============================================
-- STEP 2: DROP DEPRECATED ENUMS
-- =============================================

-- Drop InternalStatus enum (after column is removed)
DROP TYPE IF EXISTS "InternalStatus";

-- Drop ClientStatus enum (after column is removed)
DROP TYPE IF EXISTS "ClientStatus";

-- =============================================
-- STEP 3: VERIFICATION
-- =============================================
-- Run these queries to verify migration success

-- Verify columns are removed
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'tax_cases'
-- ORDER BY ordinal_position;

-- Verify enums are removed
-- SELECT typname FROM pg_type WHERE typname IN ('InternalStatus', 'ClientStatus');
-- Expected: 0 rows

-- =============================================
-- STEP 4: UPDATE CONSTRAINTS (if any reference old columns)
-- =============================================
-- No action needed - old columns had no foreign key constraints

-- =============================================
-- ROLLBACK INSTRUCTIONS (if needed BEFORE step 1)
-- =============================================
-- If you need to rollback BEFORE running this migration:
-- 1. Restore from database backup
--
-- If you've already run this migration:
-- ⚠️ THERE IS NO AUTOMATED ROLLBACK ⚠️
-- You must restore from backup or recreate columns manually:
--
-- CREATE TYPE "InternalStatus" AS ENUM (...);
-- CREATE TYPE "ClientStatus" AS ENUM (...);
-- ALTER TABLE tax_cases ADD COLUMN internal_status "InternalStatus";
-- ALTER TABLE tax_cases ADD COLUMN client_status "ClientStatus";
-- -- Then restore data from _backup_deprecated_status table

-- =============================================
-- POST-MIGRATION CHECKLIST
-- =============================================
-- [ ] Verify application starts without errors
-- [ ] Test admin dashboard loads correctly
-- [ ] Test client detail page works
-- [ ] Test status updates work
-- [ ] Monitor error logs for 24 hours
-- [ ] Remove dual-write code from clients.service.ts
-- [ ] Remove deprecated enums from schema.prisma
-- [ ] Remove deprecated types from frontend models
