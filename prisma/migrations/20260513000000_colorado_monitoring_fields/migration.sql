-- Colorado per-client monitoring toggle and interval (mirrors IRS monitor fields)
ALTER TABLE tax_cases ADD COLUMN IF NOT EXISTS colorado_monitoring_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tax_cases ADD COLUMN IF NOT EXISTS colorado_monitoring_interval_hours INTEGER NOT NULL DEFAULT 24;
