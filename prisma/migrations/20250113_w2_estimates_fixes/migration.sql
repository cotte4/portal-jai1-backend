-- W2 Estimates table improvements from audit W2E-P0/P1/P2
-- Run this in Supabase SQL Editor

-- =============================================
-- 1. FK CONSTRAINT FOR TAX_CASE_ID
-- =============================================
-- Ensures tax_case_id points to a valid tax case
-- ON DELETE SET NULL: If tax case deleted, estimate remains but orphaned

ALTER TABLE "w2_estimates"
DROP CONSTRAINT IF EXISTS "w2_estimates_tax_case_id_fkey";

ALTER TABLE "w2_estimates"
ADD CONSTRAINT "w2_estimates_tax_case_id_fkey"
FOREIGN KEY ("tax_case_id")
REFERENCES "tax_cases"("id")
ON DELETE SET NULL;

-- =============================================
-- 2. INDEX ON TAX_CASE_ID
-- =============================================
-- Speeds up queries for estimates by tax case

CREATE INDEX IF NOT EXISTS "w2_estimates_tax_case_id_idx"
ON "w2_estimates"("tax_case_id")
WHERE "tax_case_id" IS NOT NULL;

-- =============================================
-- 3. CHECK CONSTRAINTS FOR MONETARY FIELDS
-- =============================================
-- Ensures all monetary values are non-negative

ALTER TABLE "w2_estimates"
DROP CONSTRAINT IF EXISTS "w2_estimates_box2_federal_check";

ALTER TABLE "w2_estimates"
ADD CONSTRAINT "w2_estimates_box2_federal_check"
CHECK (box_2_federal >= 0);

ALTER TABLE "w2_estimates"
DROP CONSTRAINT IF EXISTS "w2_estimates_box17_state_check";

ALTER TABLE "w2_estimates"
ADD CONSTRAINT "w2_estimates_box17_state_check"
CHECK (box_17_state >= 0);

ALTER TABLE "w2_estimates"
DROP CONSTRAINT IF EXISTS "w2_estimates_estimated_refund_check";

ALTER TABLE "w2_estimates"
ADD CONSTRAINT "w2_estimates_estimated_refund_check"
CHECK (estimated_refund >= 0);

-- =============================================
-- 4. UNIQUE CONSTRAINT ON W2_STORAGE_PATH
-- =============================================
-- Prevents multiple estimates pointing to same file
-- Only applies to non-null paths

CREATE UNIQUE INDEX IF NOT EXISTS "w2_estimates_w2_storage_path_key"
ON "w2_estimates"("w2_storage_path")
WHERE "w2_storage_path" IS NOT NULL;

-- =============================================
-- VERIFICATION QUERIES
-- =============================================
-- Check constraints:
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'w2_estimates'::regclass;

-- Check indexes:
-- SELECT indexname FROM pg_indexes
-- WHERE tablename = 'w2_estimates';
