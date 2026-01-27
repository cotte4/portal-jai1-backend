-- Migration: Add refund confirmation fields
-- Description: Adds fields for clients to confirm receipt of federal/state refunds separately
-- Safe: Only adds new columns, no data loss

-- Add federal refund received flag (defaults to false for existing records)
ALTER TABLE "tax_cases" ADD COLUMN IF NOT EXISTS "federal_refund_received" BOOLEAN NOT NULL DEFAULT false;

-- Add state refund received flag (defaults to false for existing records)
ALTER TABLE "tax_cases" ADD COLUMN IF NOT EXISTS "state_refund_received" BOOLEAN NOT NULL DEFAULT false;

-- Add federal refund received timestamp (nullable)
ALTER TABLE "tax_cases" ADD COLUMN IF NOT EXISTS "federal_refund_received_at" TIMESTAMPTZ;

-- Add state refund received timestamp (nullable)
ALTER TABLE "tax_cases" ADD COLUMN IF NOT EXISTS "state_refund_received_at" TIMESTAMPTZ;
