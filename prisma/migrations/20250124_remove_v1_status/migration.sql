-- V1 Status System Cleanup Migration
-- IMPORTANT: Run this AFTER deploying the v2-only code and verifying all data is migrated

-- ============= BACKUP TABLE =============
-- Drop old backup if it exists (may have wrong schema from failed migration)
DROP TABLE IF EXISTS _backup_v1_status_20250124;

-- Create backup of v1 status fields before dropping them
-- Cast enums to TEXT so backup doesn't depend on enum types
CREATE TABLE _backup_v1_status_20250124 AS
SELECT
  id,
  pre_filing_status::TEXT as pre_filing_status,
  federal_status::TEXT as federal_status,
  state_status::TEXT as state_status,
  federal_status_changed_at,
  state_status_changed_at,
  taxes_filed,
  taxes_filed_at,
  case_status::TEXT as case_status,
  federal_status_new::TEXT as federal_status_new,
  state_status_new::TEXT as state_status_new,
  updated_at
FROM tax_cases;

-- ============= DROP V1 INDEXES =============
-- Drop indexes that reference v1 columns
DROP INDEX IF EXISTS "tax_cases_pre_filing_status_idx";
DROP INDEX IF EXISTS "tax_cases_taxes_filed_pre_filing_status_idx";
DROP INDEX IF EXISTS "tax_cases_taxes_filed_federal_status_state_status_idx";
DROP INDEX IF EXISTS "tax_cases_federal_status_state_status_idx";
DROP INDEX IF EXISTS "tax_cases_has_problem_federal_status_state_status_idx";

-- ============= DROP V1 COLUMNS =============
-- Drop pre-filing status column
ALTER TABLE tax_cases DROP COLUMN IF EXISTS pre_filing_status;

-- Drop federal/state v1 status columns
ALTER TABLE tax_cases DROP COLUMN IF EXISTS federal_status;
ALTER TABLE tax_cases DROP COLUMN IF EXISTS state_status;

-- NOTE: Keep taxes_filed and taxes_filed_at columns for referral code generation logic
-- These are still used but could be removed in a future migration if desired

-- ============= DROP V1 ENUMS =============
-- Drop the old enums (must be done after columns are dropped)
DROP TYPE IF EXISTS "PreFilingStatus";
DROP TYPE IF EXISTS "TaxStatus";

-- ============= VERIFICATION =============
-- Run these queries after migration to verify:
-- SELECT COUNT(*) FROM tax_cases WHERE case_status IS NULL; -- Should be 0
-- SELECT COUNT(*) FROM _backup_v1_status_20250124; -- Should match total tax_cases

-- ============= ROLLBACK INSTRUCTIONS =============
-- To rollback (if needed):
-- 1. Recreate enums:
--    CREATE TYPE "TaxStatus" AS ENUM ('filed', 'pending', 'processing', 'approved', 'rejected', 'deposited');
--    CREATE TYPE "PreFilingStatus" AS ENUM ('awaiting_registration', 'awaiting_documents', 'documentation_complete');
-- 2. Add columns back:
--    ALTER TABLE tax_cases ADD COLUMN pre_filing_status "PreFilingStatus";
--    ALTER TABLE tax_cases ADD COLUMN federal_status "TaxStatus";
--    ALTER TABLE tax_cases ADD COLUMN state_status "TaxStatus";
-- 3. Restore data from backup:
--    UPDATE tax_cases t SET
--      pre_filing_status = b.pre_filing_status::\"PreFilingStatus\",
--      federal_status = b.federal_status::\"TaxStatus\",
--      state_status = b.state_status::\"TaxStatus\"
--    FROM _backup_v1_status_20250124 b WHERE t.id = b.id;
-- 4. Recreate indexes
