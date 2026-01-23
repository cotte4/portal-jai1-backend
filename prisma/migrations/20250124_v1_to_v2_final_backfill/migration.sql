-- V1 to V2 Status System Final Backfill Migration
-- This migration ensures all tax cases have v2 status fields populated before removing v1

-- ============= VERIFICATION QUERIES (Run these first to check current state) =============
-- Uncomment to verify before running:
-- SELECT
--   COUNT(*) as total_cases,
--   COUNT(*) FILTER (WHERE federal_status IS NOT NULL AND federal_status_new IS NULL) as federal_unmigrated,
--   COUNT(*) FILTER (WHERE state_status IS NOT NULL AND state_status_new IS NULL) as state_unmigrated,
--   COUNT(*) FILTER (WHERE case_status IS NULL) as case_unmigrated,
--   COUNT(*) FILTER (WHERE taxes_filed = true) as filed_cases
-- FROM tax_cases;

-- ============= BACKFILL CASE STATUS =============
-- For cases without caseStatus, derive from preFilingStatus/taxesFiled/hasProblem

-- 1. Cases with hasProblem = true -> case_issues
UPDATE tax_cases
SET
  case_status = 'case_issues',
  case_status_changed_at = COALESCE(status_updated_at, updated_at)
WHERE case_status IS NULL AND has_problem = true;

-- 2. Cases with taxesFiled = true -> taxes_filed
UPDATE tax_cases
SET
  case_status = 'taxes_filed',
  case_status_changed_at = COALESCE(taxes_filed_at, status_updated_at, updated_at)
WHERE case_status IS NULL AND taxes_filed = true;

-- 3. Cases with preFilingStatus = 'documentation_complete' -> preparing
UPDATE tax_cases
SET
  case_status = 'preparing',
  case_status_changed_at = COALESCE(status_updated_at, updated_at)
WHERE case_status IS NULL AND pre_filing_status = 'documentation_complete';

-- 4. Cases with preFilingStatus = 'awaiting_documents' -> awaiting_docs
UPDATE tax_cases
SET
  case_status = 'awaiting_docs',
  case_status_changed_at = COALESCE(status_updated_at, updated_at)
WHERE case_status IS NULL AND pre_filing_status = 'awaiting_documents';

-- 5. Cases with preFilingStatus = 'awaiting_registration' -> awaiting_form
UPDATE tax_cases
SET
  case_status = 'awaiting_form',
  case_status_changed_at = COALESCE(status_updated_at, updated_at)
WHERE case_status IS NULL AND pre_filing_status = 'awaiting_registration';

-- 6. Remaining cases without preFilingStatus -> awaiting_form (default)
UPDATE tax_cases
SET
  case_status = 'awaiting_form',
  case_status_changed_at = COALESCE(status_updated_at, updated_at)
WHERE case_status IS NULL;

-- ============= BACKFILL FEDERAL STATUS NEW =============
-- Map old TaxStatus values to new FederalStatusNew

-- filed/pending/processing -> in_process
UPDATE tax_cases
SET
  federal_status_new = 'in_process',
  federal_status_new_changed_at = COALESCE(federal_status_changed_at, status_updated_at, updated_at)
WHERE taxes_filed = true
  AND federal_status IS NOT NULL
  AND federal_status_new IS NULL
  AND federal_status IN ('filed', 'pending', 'processing');

-- approved with bank_deposit payment -> deposit_pending
UPDATE tax_cases
SET
  federal_status_new = 'deposit_pending',
  federal_status_new_changed_at = COALESCE(federal_status_changed_at, status_updated_at, updated_at)
WHERE taxes_filed = true
  AND federal_status IS NOT NULL
  AND federal_status_new IS NULL
  AND federal_status = 'approved'
  AND payment_method = 'bank_deposit';

-- approved with check payment -> check_in_transit
UPDATE tax_cases
SET
  federal_status_new = 'check_in_transit',
  federal_status_new_changed_at = COALESCE(federal_status_changed_at, status_updated_at, updated_at)
WHERE taxes_filed = true
  AND federal_status IS NOT NULL
  AND federal_status_new IS NULL
  AND federal_status = 'approved'
  AND payment_method = 'check';

-- rejected -> issues
UPDATE tax_cases
SET
  federal_status_new = 'issues',
  federal_status_new_changed_at = COALESCE(federal_status_changed_at, status_updated_at, updated_at)
WHERE taxes_filed = true
  AND federal_status IS NOT NULL
  AND federal_status_new IS NULL
  AND federal_status = 'rejected';

-- deposited -> taxes_completed
UPDATE tax_cases
SET
  federal_status_new = 'taxes_completed',
  federal_status_new_changed_at = COALESCE(federal_status_changed_at, status_updated_at, updated_at)
WHERE taxes_filed = true
  AND federal_status IS NOT NULL
  AND federal_status_new IS NULL
  AND federal_status = 'deposited';

-- ============= BACKFILL STATE STATUS NEW =============
-- Map old TaxStatus values to new StateStatusNew (same logic as federal)

-- filed/pending/processing -> in_process
UPDATE tax_cases
SET
  state_status_new = 'in_process',
  state_status_new_changed_at = COALESCE(state_status_changed_at, status_updated_at, updated_at)
WHERE taxes_filed = true
  AND state_status IS NOT NULL
  AND state_status_new IS NULL
  AND state_status IN ('filed', 'pending', 'processing');

-- approved with bank_deposit payment -> deposit_pending
UPDATE tax_cases
SET
  state_status_new = 'deposit_pending',
  state_status_new_changed_at = COALESCE(state_status_changed_at, status_updated_at, updated_at)
WHERE taxes_filed = true
  AND state_status IS NOT NULL
  AND state_status_new IS NULL
  AND state_status = 'approved'
  AND payment_method = 'bank_deposit';

-- approved with check payment -> check_in_transit
UPDATE tax_cases
SET
  state_status_new = 'check_in_transit',
  state_status_new_changed_at = COALESCE(state_status_changed_at, status_updated_at, updated_at)
WHERE taxes_filed = true
  AND state_status IS NOT NULL
  AND state_status_new IS NULL
  AND state_status = 'approved'
  AND payment_method = 'check';

-- rejected -> issues
UPDATE tax_cases
SET
  state_status_new = 'issues',
  state_status_new_changed_at = COALESCE(state_status_changed_at, status_updated_at, updated_at)
WHERE taxes_filed = true
  AND state_status IS NOT NULL
  AND state_status_new IS NULL
  AND state_status = 'rejected';

-- deposited -> taxes_completed
UPDATE tax_cases
SET
  state_status_new = 'taxes_completed',
  state_status_new_changed_at = COALESCE(state_status_changed_at, status_updated_at, updated_at)
WHERE taxes_filed = true
  AND state_status IS NOT NULL
  AND state_status_new IS NULL
  AND state_status = 'deposited';

-- ============= VERIFICATION AFTER BACKFILL =============
-- Run this after the migration to verify:
-- SELECT
--   COUNT(*) as total_cases,
--   COUNT(*) FILTER (WHERE case_status IS NOT NULL) as cases_with_case_status,
--   COUNT(*) FILTER (WHERE taxes_filed = true AND federal_status_new IS NULL AND federal_status IS NOT NULL) as federal_still_unmigrated,
--   COUNT(*) FILTER (WHERE taxes_filed = true AND state_status_new IS NULL AND state_status IS NOT NULL) as state_still_unmigrated
-- FROM tax_cases;
