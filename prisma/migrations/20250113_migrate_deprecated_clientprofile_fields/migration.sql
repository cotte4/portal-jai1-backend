-- Migration: Move deprecated fields from ClientProfile to TaxCase
-- Run each step separately in Supabase SQL Editor

-- =============================================
-- STEP 1: COPY DATA (Safe - no data loss)
-- =============================================
-- This copies ClientProfile banking/employment data to TaxCase
-- Only updates TaxCase fields that are NULL (won't overwrite existing data)

UPDATE tax_cases tc
SET
  bank_name = COALESCE(tc.bank_name, cp.bank_name),
  bank_routing_number = COALESCE(tc.bank_routing_number, cp.bank_routing_number),
  bank_account_number = COALESCE(tc.bank_account_number, cp.bank_account_number),
  work_state = COALESCE(tc.work_state, cp.work_state),
  employer_name = COALESCE(tc.employer_name, cp.employer_name)
FROM client_profiles cp
WHERE tc.client_profile_id = cp.id
  AND (
    -- Only update if ClientProfile has data and TaxCase is missing it
    (cp.bank_name IS NOT NULL AND tc.bank_name IS NULL)
    OR (cp.bank_routing_number IS NOT NULL AND tc.bank_routing_number IS NULL)
    OR (cp.bank_account_number IS NOT NULL AND tc.bank_account_number IS NULL)
    OR (cp.work_state IS NOT NULL AND tc.work_state IS NULL)
    OR (cp.employer_name IS NOT NULL AND tc.employer_name IS NULL)
  );

-- =============================================
-- STEP 2: VERIFY MIGRATION (Run after Step 1)
-- =============================================
-- Check that all data was copied successfully

SELECT
  'Data remaining in ClientProfile (should be copied to TaxCase)' as check_type,
  COUNT(*) as count
FROM client_profiles cp
WHERE EXISTS (
  SELECT 1 FROM tax_cases tc
  WHERE tc.client_profile_id = cp.id
    AND (
      (cp.bank_name IS NOT NULL AND tc.bank_name IS NULL)
      OR (cp.bank_routing_number IS NOT NULL AND tc.bank_routing_number IS NULL)
      OR (cp.bank_account_number IS NOT NULL AND tc.bank_account_number IS NULL)
      OR (cp.work_state IS NOT NULL AND tc.work_state IS NULL)
      OR (cp.employer_name IS NOT NULL AND tc.employer_name IS NULL)
    )
);
-- Expected result: 0 (all data migrated)

-- =============================================
-- STEP 3: DROP DEPRECATED COLUMNS (Run after verification)
-- =============================================
-- WARNING: This is irreversible! Only run after confirming Step 2 returns 0

ALTER TABLE client_profiles DROP COLUMN IF EXISTS bank_name;
ALTER TABLE client_profiles DROP COLUMN IF EXISTS bank_routing_number;
ALTER TABLE client_profiles DROP COLUMN IF EXISTS bank_account_number;
ALTER TABLE client_profiles DROP COLUMN IF EXISTS work_state;
ALTER TABLE client_profiles DROP COLUMN IF EXISTS employer_name;
