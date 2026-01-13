-- Discount applications table improvements from audit DA-P1/P2
-- Run this in Supabase SQL Editor

-- =============================================
-- 1. INDEX ON SEASON_YEAR
-- =============================================
-- Speeds up queries filtering by tax season

CREATE INDEX IF NOT EXISTS "discount_applications_season_year_idx"
ON "discount_applications"("season_year");

-- =============================================
-- 2. CHECK CONSTRAINT ON DISCOUNT_AMOUNT
-- =============================================
-- Ensures discount amount is non-negative

ALTER TABLE "discount_applications"
DROP CONSTRAINT IF EXISTS "discount_applications_discount_amount_check";

ALTER TABLE "discount_applications"
ADD CONSTRAINT "discount_applications_discount_amount_check"
CHECK (discount_amount >= 0);

-- =============================================
-- 3. CHECK CONSTRAINT ON DISCOUNT_PERCENT
-- =============================================
-- Ensures discount percent is between 0 and 100

ALTER TABLE "discount_applications"
DROP CONSTRAINT IF EXISTS "discount_applications_discount_percent_check";

ALTER TABLE "discount_applications"
ADD CONSTRAINT "discount_applications_discount_percent_check"
CHECK (discount_percent IS NULL OR (discount_percent >= 0 AND discount_percent <= 100));

-- =============================================
-- 4. CHECK CONSTRAINT ON SEASON_YEAR
-- =============================================
-- Ensures season year is within valid range (2020-2100)

ALTER TABLE "discount_applications"
DROP CONSTRAINT IF EXISTS "discount_applications_season_year_check";

ALTER TABLE "discount_applications"
ADD CONSTRAINT "discount_applications_season_year_check"
CHECK (season_year >= 2020 AND season_year <= 2100);

-- =============================================
-- VERIFICATION QUERIES
-- =============================================
-- Check constraints:
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'discount_applications'::regclass;

-- Check indexes:
-- SELECT indexname FROM pg_indexes
-- WHERE tablename = 'discount_applications';
