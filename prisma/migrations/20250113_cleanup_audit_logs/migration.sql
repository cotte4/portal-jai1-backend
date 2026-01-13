-- Audit Log Cleanup: Remove low-value logs and simplify enum
-- Run in Supabase SQL Editor

-- =============================================
-- STEP 1: DELETE LOW-VALUE AUDIT LOGS
-- =============================================

-- Delete LOGIN_SUCCESS (redundant with users.last_login_at)
DELETE FROM audit_logs WHERE action = 'LOGIN_SUCCESS';

-- Delete LOGOUT (zero business value)
DELETE FROM audit_logs WHERE action = 'LOGOUT';

-- =============================================
-- STEP 2: SET UP 30-DAY RETENTION FOR LOGIN_FAILED
-- =============================================
-- Delete LOGIN_FAILED older than 30 days
DELETE FROM audit_logs
WHERE action = 'LOGIN_FAILED'
  AND created_at < NOW() - INTERVAL '30 days';

-- =============================================
-- STEP 3: REMOVE UNUSED ENUM VALUES FROM POSTGRESQL
-- =============================================
-- PostgreSQL doesn't allow direct removal of enum values
-- We need to recreate the enum type

-- Create new enum with only needed values
CREATE TYPE "AuditAction_new" AS ENUM (
  'LOGIN_FAILED',
  'PASSWORD_CHANGE',
  'PASSWORD_RESET',
  'DOCUMENT_DELETE',
  'REFUND_UPDATE',
  'DISCOUNT_APPLIED'
);

-- Update the column to use the new enum
ALTER TABLE audit_logs
  ALTER COLUMN action TYPE "AuditAction_new"
  USING action::text::"AuditAction_new";

-- Drop old enum and rename new one
DROP TYPE "AuditAction";
ALTER TYPE "AuditAction_new" RENAME TO "AuditAction";

-- =============================================
-- VERIFICATION
-- =============================================
-- SELECT action, COUNT(*) FROM audit_logs GROUP BY action;
-- SELECT enumlabel FROM pg_enum WHERE enumtypid = 'AuditAction'::regtype;
