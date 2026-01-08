-- Manual migration for referral system
-- Run this in Supabase SQL editor

-- Create enums if they don't exist
DO $$ BEGIN
    CREATE TYPE "ReferralStatus" AS ENUM ('pending', 'tax_form_submitted', 'awaiting_refund', 'successful', 'expired');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "DiscountType" AS ENUM ('referral_bonus', 'referrer_reward');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "DiscountStatus" AS ENUM ('pending', 'applied', 'expired');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add referral columns to users table
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referral_code" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referred_by_code" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referral_code_created_at" TIMESTAMP(3);

-- Create unique index on referral_code
CREATE UNIQUE INDEX IF NOT EXISTS "users_referral_code_key" ON "users"("referral_code");

-- Create referrals table
-- Note: Using TEXT for user foreign keys to match existing users.id column type
CREATE TABLE IF NOT EXISTS "referrals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "referrer_id" TEXT NOT NULL,
    "referred_user_id" TEXT NOT NULL,
    "referral_code" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'pending',
    "tax_case_id" UUID,
    "completed_at" TIMESTAMP(3),
    "referred_discount" DECIMAL(10,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- Create unique index on referred_user_id
CREATE UNIQUE INDEX IF NOT EXISTS "referrals_referred_user_id_key" ON "referrals"("referred_user_id");

-- Create discount_applications table
-- Note: Using TEXT for user foreign keys to match existing users.id column type
CREATE TABLE IF NOT EXISTS "discount_applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "tax_case_id" UUID,
    "discountType" "DiscountType" NOT NULL,
    "discount_amount" DECIMAL(10,2) NOT NULL,
    "discount_percent" DECIMAL(5,2),
    "referral_id" UUID,
    "applied_by_admin_id" TEXT,
    "season_year" INTEGER NOT NULL,
    "status" "DiscountStatus" NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_applications_pkey" PRIMARY KEY ("id")
);

-- Add foreign keys for referrals
DO $$ BEGIN
    ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_fkey"
        FOREIGN KEY ("referrer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_user_id_fkey"
        FOREIGN KEY ("referred_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
