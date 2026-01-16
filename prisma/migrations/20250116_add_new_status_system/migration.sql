-- Migration: Add New Status System (v2)
-- This migration adds the new unified case status and enhanced federal/state status tracking

-- CreateEnum: CaseStatus (replaces preFilingStatus + taxesFiled combination)
DO $$ BEGIN
    CREATE TYPE "CaseStatus" AS ENUM ('awaiting_form', 'awaiting_docs', 'preparing', 'taxes_filed', 'case_issues');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum: FederalStatusNew (enhanced federal status tracking)
DO $$ BEGIN
    CREATE TYPE "FederalStatusNew" AS ENUM ('in_process', 'in_verification', 'verification_in_progress', 'verification_letter_sent', 'check_in_transit', 'issues', 'taxes_sent', 'taxes_completed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum: StateStatusNew (enhanced state status tracking)
DO $$ BEGIN
    CREATE TYPE "StateStatusNew" AS ENUM ('in_process', 'in_verification', 'verification_in_progress', 'verification_letter_sent', 'check_in_transit', 'issues', 'taxes_sent', 'taxes_completed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add new columns to tax_cases table
ALTER TABLE "tax_cases" ADD COLUMN IF NOT EXISTS "case_status" "CaseStatus";
ALTER TABLE "tax_cases" ADD COLUMN IF NOT EXISTS "case_status_changed_at" TIMESTAMPTZ;
ALTER TABLE "tax_cases" ADD COLUMN IF NOT EXISTS "federal_status_new" "FederalStatusNew";
ALTER TABLE "tax_cases" ADD COLUMN IF NOT EXISTS "federal_status_new_changed_at" TIMESTAMPTZ;
ALTER TABLE "tax_cases" ADD COLUMN IF NOT EXISTS "state_status_new" "StateStatusNew";
ALTER TABLE "tax_cases" ADD COLUMN IF NOT EXISTS "state_status_new_changed_at" TIMESTAMPTZ;

-- ============= DATA BACKFILL =============

-- Backfill caseStatus from old system
-- Priority: hasProblem > taxesFiled > preFilingStatus
UPDATE "tax_cases"
SET
    "case_status" = CASE
        -- If has problem, mark as case_issues
        WHEN "has_problem" = true THEN 'case_issues'::"CaseStatus"
        -- If taxes already filed, mark as taxes_filed
        WHEN "taxes_filed" = true THEN 'taxes_filed'::"CaseStatus"
        -- Map preFilingStatus to new caseStatus
        WHEN "pre_filing_status" = 'awaiting_registration' THEN 'awaiting_form'::"CaseStatus"
        WHEN "pre_filing_status" = 'awaiting_documents' THEN 'awaiting_docs'::"CaseStatus"
        WHEN "pre_filing_status" = 'documentation_complete' THEN 'preparing'::"CaseStatus"
        -- Default fallback
        ELSE 'awaiting_form'::"CaseStatus"
    END,
    "case_status_changed_at" = COALESCE("status_updated_at", "created_at")
WHERE "case_status" IS NULL;

-- Backfill federalStatusNew from old federalStatus
-- Only for records where taxes have been filed
UPDATE "tax_cases"
SET
    "federal_status_new" = CASE
        WHEN "federal_status" = 'filed' THEN 'in_process'::"FederalStatusNew"
        WHEN "federal_status" = 'pending' THEN 'in_process'::"FederalStatusNew"
        WHEN "federal_status" = 'processing' THEN 'in_process'::"FederalStatusNew"
        WHEN "federal_status" = 'approved' THEN 'check_in_transit'::"FederalStatusNew"
        WHEN "federal_status" = 'rejected' THEN 'issues'::"FederalStatusNew"
        WHEN "federal_status" = 'deposited' THEN 'taxes_completed'::"FederalStatusNew"
        ELSE NULL
    END,
    "federal_status_new_changed_at" = COALESCE("federal_status_changed_at", "status_updated_at", "created_at")
WHERE "taxes_filed" = true
  AND "federal_status" IS NOT NULL
  AND "federal_status_new" IS NULL;

-- Backfill stateStatusNew from old stateStatus
-- Only for records where taxes have been filed
UPDATE "tax_cases"
SET
    "state_status_new" = CASE
        WHEN "state_status" = 'filed' THEN 'in_process'::"StateStatusNew"
        WHEN "state_status" = 'pending' THEN 'in_process'::"StateStatusNew"
        WHEN "state_status" = 'processing' THEN 'in_process'::"StateStatusNew"
        WHEN "state_status" = 'approved' THEN 'check_in_transit'::"StateStatusNew"
        WHEN "state_status" = 'rejected' THEN 'issues'::"StateStatusNew"
        WHEN "state_status" = 'deposited' THEN 'taxes_completed'::"StateStatusNew"
        ELSE NULL
    END,
    "state_status_new_changed_at" = COALESCE("state_status_changed_at", "status_updated_at", "created_at")
WHERE "taxes_filed" = true
  AND "state_status" IS NOT NULL
  AND "state_status_new" IS NULL;

-- ============= CREATE INDEXES FOR ALARM QUERIES =============

-- Index for caseStatus filtering
CREATE INDEX IF NOT EXISTS "tax_cases_case_status_idx" ON "tax_cases"("case_status");

-- Index for federalStatusNew filtering
CREATE INDEX IF NOT EXISTS "tax_cases_federal_status_new_idx" ON "tax_cases"("federal_status_new");

-- Index for stateStatusNew filtering
CREATE INDEX IF NOT EXISTS "tax_cases_state_status_new_idx" ON "tax_cases"("state_status_new");

-- Composite indexes for alarm queries (status + timestamp)
CREATE INDEX IF NOT EXISTS "tax_cases_federal_status_new_changed_at_idx" ON "tax_cases"("federal_status_new", "federal_status_new_changed_at");
CREATE INDEX IF NOT EXISTS "tax_cases_state_status_new_changed_at_idx" ON "tax_cases"("state_status_new", "state_status_new_changed_at");
