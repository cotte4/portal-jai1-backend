-- Add unique constraint to prevent duplicate discount applications per referral
-- Run this in Supabase SQL Editor

-- First, check for any existing duplicates (should return 0 rows)
-- SELECT "referral_id", "discountType", COUNT(*)
-- FROM discount_applications
-- WHERE "referral_id" IS NOT NULL
-- GROUP BY "referral_id", "discountType"
-- HAVING COUNT(*) > 1;

-- Add unique constraint (only applies to non-null referral_id values)
CREATE UNIQUE INDEX IF NOT EXISTS "discount_applications_referral_id_discountType_key"
ON "discount_applications"("referral_id", "discountType")
WHERE "referral_id" IS NOT NULL;
