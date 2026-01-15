-- Fix Referral.referralCode Unique Constraint
-- Problem: The @unique constraint on referral_code prevented the same referral code
-- from being used more than once. When a referrer invites multiple people, each new
-- referral would fail because the code is already used.
--
-- Solution: Remove the unique constraint from referral_code. The uniqueness should be
-- on referred_user_id (already in place) to prevent duplicate referral relationships,
-- NOT on the code itself.

-- Drop the unique constraint on referral_code
-- In PostgreSQL, UNIQUE constraints create both a constraint and an index
ALTER TABLE "referrals" DROP CONSTRAINT IF EXISTS "referrals_referral_code_key";

-- Note: The regular index on referral_code (referrals_referral_code_idx) for query
-- performance should remain - it does not enforce uniqueness.

-- =============================================
-- VERIFICATION QUERY
-- =============================================
-- Verify the unique constraint was removed:
-- SELECT conname FROM pg_constraint WHERE conrelid = 'referrals'::regclass AND contype = 'u';
-- Should NOT show "referrals_referral_code_key"
--
-- Verify regular index still exists:
-- SELECT indexname FROM pg_indexes WHERE tablename = 'referrals';
-- Should still show "referrals_referral_code_idx"
