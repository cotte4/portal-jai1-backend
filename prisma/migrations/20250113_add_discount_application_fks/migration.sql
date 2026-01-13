-- Add Foreign Key constraints to DiscountApplication
-- Run this in Supabase SQL Editor

-- =============================================
-- 1. ADD FOREIGN KEY CONSTRAINTS
-- =============================================

-- FK: userId -> users.id (required, cascade delete)
ALTER TABLE "discount_applications"
ADD CONSTRAINT "discount_applications_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: taxCaseId -> tax_cases.id (optional, set null on delete)
ALTER TABLE "discount_applications"
ADD CONSTRAINT "discount_applications_tax_case_id_fkey"
FOREIGN KEY ("tax_case_id") REFERENCES "tax_cases"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- FK: referralId -> referrals.id (optional, set null on delete)
ALTER TABLE "discount_applications"
ADD CONSTRAINT "discount_applications_referral_id_fkey"
FOREIGN KEY ("referral_id") REFERENCES "referrals"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- FK: appliedByAdminId -> users.id (optional, set null on delete)
ALTER TABLE "discount_applications"
ADD CONSTRAINT "discount_applications_applied_by_admin_id_fkey"
FOREIGN KEY ("applied_by_admin_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================
-- 2. ADD INDEXES FOR FK COLUMNS
-- =============================================

-- Index on taxCaseId for join performance
CREATE INDEX IF NOT EXISTS "discount_applications_tax_case_id_idx"
ON "discount_applications"("tax_case_id");

-- Index on referralId for join performance
CREATE INDEX IF NOT EXISTS "discount_applications_referral_id_idx"
ON "discount_applications"("referral_id");

-- Index on appliedByAdminId for admin filtering
CREATE INDEX IF NOT EXISTS "discount_applications_applied_by_admin_id_idx"
ON "discount_applications"("applied_by_admin_id");
