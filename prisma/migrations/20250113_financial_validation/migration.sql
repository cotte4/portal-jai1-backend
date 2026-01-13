-- Financial validation: CHECK constraints for non-negative refunds
-- Run this in Supabase SQL Editor

-- =============================================
-- 1. TAX CASES: Refund amounts must be non-negative
-- =============================================

-- Estimated refund must be >= 0
ALTER TABLE "tax_cases"
DROP CONSTRAINT IF EXISTS "tax_cases_estimated_refund_check";

ALTER TABLE "tax_cases"
ADD CONSTRAINT "tax_cases_estimated_refund_check"
CHECK ("estimated_refund" IS NULL OR "estimated_refund" >= 0);

-- Actual refund (deprecated) must be >= 0
ALTER TABLE "tax_cases"
DROP CONSTRAINT IF EXISTS "tax_cases_actual_refund_check";

ALTER TABLE "tax_cases"
ADD CONSTRAINT "tax_cases_actual_refund_check"
CHECK ("actual_refund" IS NULL OR "actual_refund" >= 0);

-- Federal actual refund must be >= 0
ALTER TABLE "tax_cases"
DROP CONSTRAINT IF EXISTS "tax_cases_federal_actual_refund_check";

ALTER TABLE "tax_cases"
ADD CONSTRAINT "tax_cases_federal_actual_refund_check"
CHECK ("federal_actual_refund" IS NULL OR "federal_actual_refund" >= 0);

-- State actual refund must be >= 0
ALTER TABLE "tax_cases"
DROP CONSTRAINT IF EXISTS "tax_cases_state_actual_refund_check";

ALTER TABLE "tax_cases"
ADD CONSTRAINT "tax_cases_state_actual_refund_check"
CHECK ("state_actual_refund" IS NULL OR "state_actual_refund" >= 0);

-- =============================================
-- 2. W2 ESTIMATES: Box values and refund must be non-negative
-- =============================================

ALTER TABLE "w2_estimates"
DROP CONSTRAINT IF EXISTS "w2_estimates_box_2_federal_check";

ALTER TABLE "w2_estimates"
ADD CONSTRAINT "w2_estimates_box_2_federal_check"
CHECK ("box_2_federal" >= 0);

ALTER TABLE "w2_estimates"
DROP CONSTRAINT IF EXISTS "w2_estimates_box_17_state_check";

ALTER TABLE "w2_estimates"
ADD CONSTRAINT "w2_estimates_box_17_state_check"
CHECK ("box_17_state" >= 0);

ALTER TABLE "w2_estimates"
DROP CONSTRAINT IF EXISTS "w2_estimates_estimated_refund_check";

ALTER TABLE "w2_estimates"
ADD CONSTRAINT "w2_estimates_estimated_refund_check"
CHECK ("estimated_refund" >= 0);

-- =============================================
-- 3. DISCOUNT APPLICATIONS: Amounts must be non-negative
-- =============================================

ALTER TABLE "discount_applications"
DROP CONSTRAINT IF EXISTS "discount_applications_amount_check";

ALTER TABLE "discount_applications"
ADD CONSTRAINT "discount_applications_amount_check"
CHECK ("discount_amount" >= 0);

ALTER TABLE "discount_applications"
DROP CONSTRAINT IF EXISTS "discount_applications_percent_check";

ALTER TABLE "discount_applications"
ADD CONSTRAINT "discount_applications_percent_check"
CHECK ("discount_percent" IS NULL OR ("discount_percent" >= 0 AND "discount_percent" <= 100));
