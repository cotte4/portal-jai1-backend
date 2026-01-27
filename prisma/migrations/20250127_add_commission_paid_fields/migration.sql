-- Migration: Add separate commission paid fields per refund type
-- Description: Adds fields for admin to track commission payment separately for federal/state
-- Safe: Only adds new columns, no data loss

-- Add federal commission paid flag (defaults to false for existing records)
ALTER TABLE "tax_cases" ADD COLUMN IF NOT EXISTS "federal_commission_paid" BOOLEAN NOT NULL DEFAULT false;

-- Add state commission paid flag (defaults to false for existing records)
ALTER TABLE "tax_cases" ADD COLUMN IF NOT EXISTS "state_commission_paid" BOOLEAN NOT NULL DEFAULT false;

-- Add federal commission paid timestamp (nullable)
ALTER TABLE "tax_cases" ADD COLUMN IF NOT EXISTS "federal_commission_paid_at" TIMESTAMPTZ;

-- Add state commission paid timestamp (nullable)
ALTER TABLE "tax_cases" ADD COLUMN IF NOT EXISTS "state_commission_paid_at" TIMESTAMPTZ;
