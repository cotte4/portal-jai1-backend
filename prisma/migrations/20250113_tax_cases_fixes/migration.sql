-- Tax cases table improvements from audit TC-P1-10
-- Run this in Supabase SQL Editor

-- =============================================
-- 1. TAX YEAR RANGE CHECK CONSTRAINT
-- =============================================
-- Ensures tax_year is within valid range (2020-2100)
-- Prevents invalid years like 1900 or 2999

ALTER TABLE "tax_cases"
DROP CONSTRAINT IF EXISTS "tax_cases_tax_year_check";

ALTER TABLE "tax_cases"
ADD CONSTRAINT "tax_cases_tax_year_check"
CHECK (tax_year >= 2020 AND tax_year <= 2100);

-- =============================================
-- VERIFICATION QUERY
-- =============================================
-- Check constraint exists:
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'tax_cases'::regclass
-- AND conname LIKE '%tax_year%';
