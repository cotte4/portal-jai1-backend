-- Phase A: Status System Refactor - Add New Fields
-- This migration adds new fields for the status system refactor without breaking existing functionality.
-- Run this in Supabase SQL Editor.
--
-- IMPORTANT: This is Phase A (non-breaking). Existing fields are preserved.
-- See FEATURE-9-STATUS-REFACTOR-PLAN.md for the full implementation plan.

-- =============================================
-- STEP 1: CREATE PreFilingStatus ENUM
-- =============================================
DO $$ BEGIN
    CREATE TYPE "PreFilingStatus" AS ENUM (
        'awaiting_registration',
        'awaiting_documents',
        'documentation_complete'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- =============================================
-- STEP 2: ADD 'filed' TO TaxStatus ENUM
-- =============================================
-- Note: In PostgreSQL, you cannot easily insert a value at a specific position.
-- The 'filed' value will be added at the end, but enum ordering doesn't affect functionality.
DO $$ BEGIN
    ALTER TYPE "TaxStatus" ADD VALUE IF NOT EXISTS 'filed';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- =============================================
-- STEP 3: ADD NEW COLUMNS TO tax_cases
-- =============================================

-- Phase indicator columns
ALTER TABLE "tax_cases"
    ADD COLUMN IF NOT EXISTS "taxes_filed" BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS "taxes_filed_at" TIMESTAMPTZ;

-- Pre-filing status column
ALTER TABLE "tax_cases"
    ADD COLUMN IF NOT EXISTS "pre_filing_status" "PreFilingStatus" DEFAULT 'awaiting_registration';

-- Federal status tracking columns
ALTER TABLE "tax_cases"
    ADD COLUMN IF NOT EXISTS "federal_last_comment" TEXT,
    ADD COLUMN IF NOT EXISTS "federal_status_changed_at" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "federal_last_reviewed_at" TIMESTAMPTZ;

-- State status tracking columns
ALTER TABLE "tax_cases"
    ADD COLUMN IF NOT EXISTS "state_last_comment" TEXT,
    ADD COLUMN IF NOT EXISTS "state_status_changed_at" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "state_last_reviewed_at" TIMESTAMPTZ;

-- =============================================
-- STEP 4: CREATE INDEXES FOR NEW COLUMNS
-- =============================================

CREATE INDEX IF NOT EXISTS "tax_cases_taxes_filed_idx" ON "tax_cases"("taxes_filed");
CREATE INDEX IF NOT EXISTS "tax_cases_pre_filing_status_idx" ON "tax_cases"("pre_filing_status");
CREATE INDEX IF NOT EXISTS "tax_cases_taxes_filed_pre_filing_status_idx" ON "tax_cases"("taxes_filed", "pre_filing_status");

-- =============================================
-- VERIFICATION QUERIES (Run after migration)
-- =============================================

-- Check that new columns exist:
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'tax_cases'
--   AND column_name IN ('taxes_filed', 'taxes_filed_at', 'pre_filing_status',
--                       'federal_last_comment', 'federal_status_changed_at', 'federal_last_reviewed_at',
--                       'state_last_comment', 'state_status_changed_at', 'state_last_reviewed_at');

-- Check that PreFilingStatus enum exists:
-- SELECT enumlabel FROM pg_enum WHERE enumtypid = 'PreFilingStatus'::regtype;

-- Check that 'filed' was added to TaxStatus:
-- SELECT enumlabel FROM pg_enum WHERE enumtypid = 'TaxStatus'::regtype;

-- =============================================
-- NEXT STEPS (Phase B)
-- =============================================
-- After running this migration:
-- 1. Run `npx prisma generate` to update the Prisma client
-- 2. Deploy backend (existing code will continue to work)
-- 3. Proceed to Phase B: Backfill migration + dual-write logic
