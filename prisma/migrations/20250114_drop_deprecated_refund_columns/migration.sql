-- Drop deprecated columns from tax_cases table
-- These columns were replaced by federal/state specific tracking fields:
--   - actual_refund → federalActualRefund + stateActualRefund (computed in API)
--   - refund_deposit_date → federalDepositDate || stateDepositDate (computed in API)
--
-- PREREQUISITE: Run 20250113_backfill_refund_fields migration first to ensure
-- all data has been migrated to the new federal/state columns.

-- Drop the deprecated columns
ALTER TABLE "tax_cases" DROP COLUMN IF EXISTS "actual_refund";
ALTER TABLE "tax_cases" DROP COLUMN IF EXISTS "refund_deposit_date";
