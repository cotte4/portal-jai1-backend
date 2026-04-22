-- Add per-client scheduling fields to tax_cases for the IRS auto-monitor feature.
-- Both columns use safe defaults so existing rows are covered with no table rewrite.
ALTER TABLE "tax_cases" ADD COLUMN IF NOT EXISTS "irs_monitor_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tax_cases" ADD COLUMN IF NOT EXISTS "irs_monitor_interval_hours" INTEGER NOT NULL DEFAULT 24;
