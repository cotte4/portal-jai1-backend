-- Backfill migration: Copy deprecated actualRefund to federal/state refund fields
-- Run this in Supabase SQL Editor
-- IMPORTANT: Run this BEFORE dropping the deprecated columns

-- =============================================
-- STEP 1: BACKFILL federal_actual_refund FROM actual_refund
-- =============================================
-- If federal_actual_refund is NULL but actual_refund has a value,
-- copy the value to federal_actual_refund (assuming it was primarily federal)

UPDATE "tax_cases"
SET "federal_actual_refund" = "actual_refund"
WHERE "actual_refund" IS NOT NULL
  AND "federal_actual_refund" IS NULL;

-- =============================================
-- STEP 2: BACKFILL federal_deposit_date FROM refund_deposit_date
-- =============================================
-- Copy the deposit date to federal if not already set

UPDATE "tax_cases"
SET "federal_deposit_date" = "refund_deposit_date"
WHERE "refund_deposit_date" IS NOT NULL
  AND "federal_deposit_date" IS NULL;

-- =============================================
-- STEP 3: VERIFY MIGRATION (Run after Steps 1-2)
-- =============================================
-- Check that no data is orphaned

-- SELECT
--   COUNT(*) as total_with_actual_refund,
--   COUNT(CASE WHEN federal_actual_refund IS NOT NULL THEN 1 END) as migrated_to_federal,
--   COUNT(CASE WHEN federal_actual_refund IS NULL AND actual_refund IS NOT NULL THEN 1 END) as not_migrated
-- FROM tax_cases
-- WHERE actual_refund IS NOT NULL;

-- Expected: not_migrated = 0

-- =============================================
-- STEP 4 (OPTIONAL): DROP DEPRECATED COLUMNS
-- =============================================
-- Only run this after verifying Step 3 shows 0 not_migrated
-- WARNING: This is irreversible!

-- ALTER TABLE "tax_cases" DROP COLUMN IF EXISTS "actual_refund";
-- ALTER TABLE "tax_cases" DROP COLUMN IF EXISTS "refund_deposit_date";
