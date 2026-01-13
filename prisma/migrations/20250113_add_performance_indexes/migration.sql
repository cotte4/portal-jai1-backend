-- Performance indexes: Add missing indexes identified in deep-dive analysis
-- Run this in Supabase SQL Editor

-- =============================================
-- 1. REFERRAL CODE LOOKUP INDEX
-- =============================================
-- Used by: validateCode(), applyReferralCode()
-- Impact: O(n) → O(log n) for code validation

CREATE INDEX IF NOT EXISTS "referrals_referral_code_idx"
ON "referrals"("referral_code");

-- =============================================
-- 2. STATUS HISTORY BY TAX CASE INDEX
-- =============================================
-- Used by: getStatusHistory(), findOne() with history
-- Impact: Faster timeline queries for client detail view

CREATE INDEX IF NOT EXISTS "status_history_tax_case_id_idx"
ON "status_history"("tax_case_id");

-- =============================================
-- 3. PARTIAL INDEXES FOR SOFT-DELETE QUERIES
-- =============================================
-- These improve performance when filtering out deleted records
-- Prisma doesn't support partial indexes in schema, so raw SQL only

-- Tickets: Most queries filter WHERE deleted_at IS NULL
CREATE INDEX IF NOT EXISTS "tickets_active_idx"
ON "tickets"("user_id", "status")
WHERE "deleted_at" IS NULL;

-- Ticket Messages: Filter active messages in ticket view
CREATE INDEX IF NOT EXISTS "ticket_messages_active_idx"
ON "ticket_messages"("ticket_id", "created_at")
WHERE "deleted_at" IS NULL;

-- Notifications: Active notifications feed
CREATE INDEX IF NOT EXISTS "notifications_active_idx"
ON "notifications"("user_id", "is_read", "created_at")
WHERE "deleted_at" IS NULL;

-- =============================================
-- 4. AUDIT LOG COMPOUND INDEX
-- =============================================
-- Used by: Admin filtering by action + date range
-- Impact: Faster audit log dashboard queries

CREATE INDEX IF NOT EXISTS "audit_logs_action_created_at_idx"
ON "audit_logs"("action", "created_at");

-- =============================================
-- VERIFICATION QUERY
-- =============================================
-- Run this to verify indexes were created:
-- SELECT indexname, tablename FROM pg_indexes
-- WHERE schemaname = 'public'
-- AND indexname LIKE '%_idx'
-- ORDER BY tablename, indexname;
