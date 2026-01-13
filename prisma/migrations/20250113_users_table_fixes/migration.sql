-- Users table improvements from audit U-P1/U-P2
-- Run this in Supabase SQL Editor

-- =============================================
-- 1. COMPOUND INDEX FOR ADMIN QUERIES
-- =============================================
-- Replaces separate (role) and (is_active) indexes for combined queries
-- Used by: Admin dashboard filtering active clients vs admins
-- Impact: Single index scan instead of bitmap AND of two indexes

CREATE INDEX IF NOT EXISTS "users_role_is_active_idx"
ON "users"("role", "is_active");

-- =============================================
-- 2. RESET TOKEN INDEX
-- =============================================
-- Used by: Password reset token validation
-- Impact: O(n) → O(log n) for token lookup during password reset flow

CREATE INDEX IF NOT EXISTS "users_reset_token_idx"
ON "users"("reset_token")
WHERE "reset_token" IS NOT NULL;

-- =============================================
-- 3. FK FOR REFERRAL CODE INTEGRITY
-- =============================================
-- Ensures referred_by_code always points to a valid referral_code
-- ON DELETE SET NULL: If referrer deletes account, code becomes NULL
-- (safer than CASCADE which would delete the referred user!)

ALTER TABLE "users"
DROP CONSTRAINT IF EXISTS "users_referred_by_code_fkey";

ALTER TABLE "users"
ADD CONSTRAINT "users_referred_by_code_fkey"
FOREIGN KEY ("referred_by_code")
REFERENCES "users"("referral_code")
ON DELETE SET NULL;

-- =============================================
-- VERIFICATION QUERIES
-- =============================================
-- Verify indexes:
-- SELECT indexname, tablename FROM pg_indexes
-- WHERE schemaname = 'public'
-- AND tablename = 'users'
-- ORDER BY indexname;

-- Verify FK constraint:
-- SELECT conname, contype FROM pg_constraint
-- WHERE conrelid = 'users'::regclass
-- AND conname LIKE '%referred%';
