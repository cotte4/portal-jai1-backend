-- Referrals table improvements from audit REF-P0/P1/P2
-- Run this in Supabase SQL Editor

-- =============================================
-- 1. FK CONSTRAINT FOR TAX_CASE_ID
-- =============================================
-- Ensures tax_case_id points to a valid tax case
-- ON DELETE SET NULL: If tax case deleted, referral remains but unlinked

ALTER TABLE "referrals"
DROP CONSTRAINT IF EXISTS "referrals_tax_case_id_fkey";

ALTER TABLE "referrals"
ADD CONSTRAINT "referrals_tax_case_id_fkey"
FOREIGN KEY ("tax_case_id")
REFERENCES "tax_cases"("id")
ON DELETE SET NULL;

-- =============================================
-- 2. UNIQUE CONSTRAINT ON REFERRAL_CODE
-- =============================================
-- Prevents duplicate referral codes in the referrals table
-- Note: User.referral_code already has UNIQUE, this ensures
-- the code stored in referral records is also unique

ALTER TABLE "referrals"
DROP CONSTRAINT IF EXISTS "referrals_referral_code_key";

ALTER TABLE "referrals"
ADD CONSTRAINT "referrals_referral_code_key" UNIQUE ("referral_code");

-- =============================================
-- 3. CHECK CONSTRAINT ON REFERRED_DISCOUNT
-- =============================================
-- Ensures discount amount is non-negative

ALTER TABLE "referrals"
DROP CONSTRAINT IF EXISTS "referrals_referred_discount_check";

ALTER TABLE "referrals"
ADD CONSTRAINT "referrals_referred_discount_check"
CHECK (referred_discount IS NULL OR referred_discount >= 0);

-- =============================================
-- VERIFICATION QUERIES
-- =============================================
-- Check constraints:
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'referrals'::regclass;
