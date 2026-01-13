-- Schema improvements: missing indexes and fields
-- Run this in Supabase SQL Editor

-- =============================================
-- 1. ADD MISSING COLUMNS
-- =============================================

-- Document: add reviewedAt timestamp (tracks WHEN document was reviewed, not just IF)
ALTER TABLE "documents"
ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMPTZ;

-- Notification: add deletedAt for soft-delete consistency
ALTER TABLE "notifications"
ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ;

-- =============================================
-- 2. ADD MISSING INDEXES
-- =============================================

-- TaxCase: compound index for admin filtering (status + date range)
CREATE INDEX IF NOT EXISTS "tax_cases_internal_status_created_at_idx"
ON "tax_cases"("internal_status", "created_at");

-- Notification: compound index for client feed pagination
CREATE INDEX IF NOT EXISTS "notifications_user_id_created_at_idx"
ON "notifications"("user_id", "created_at");

-- Notification: index for soft-delete queries
CREATE INDEX IF NOT EXISTS "notifications_deleted_at_idx"
ON "notifications"("deleted_at");

-- Document: index for review status filtering
CREATE INDEX IF NOT EXISTS "documents_is_reviewed_idx"
ON "documents"("is_reviewed");

-- =============================================
-- 3. ADD CHECK CONSTRAINTS
-- =============================================

-- TaxCase: ensure problem fields are NULL when hasProblem is false
-- This prevents orphaned problem data and enforces data consistency
ALTER TABLE "tax_cases"
DROP CONSTRAINT IF EXISTS "tax_cases_problem_consistency_check";

ALTER TABLE "tax_cases"
ADD CONSTRAINT "tax_cases_problem_consistency_check"
CHECK (
  has_problem = true
  OR (
    problem_step IS NULL
    AND problem_type IS NULL
    AND problem_description IS NULL
    AND problem_resolved_at IS NULL
  )
);
