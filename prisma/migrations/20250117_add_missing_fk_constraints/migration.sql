-- =====================================================
-- Migration: Add Missing FK Constraints
-- Date: 2025-01-17
-- Purpose: Add FOREIGN KEY constraints for UUID columns that reference
--          other tables but were missing FK declarations
-- =====================================================

-- =====================================================
-- PHASE 1: PRE-CHECK FOR ORPHAN DATA
-- Run these queries to identify any orphan records before adding constraints
-- These are SELECT queries only - they don't modify data
-- =====================================================

-- 1.1 Check for orphan refresh_tokens.replaced_by_token_id
-- (tokens referencing non-existent replacement tokens)
DO $$
DECLARE
    orphan_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO orphan_count
    FROM refresh_tokens rt
    WHERE rt.replaced_by_token_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM refresh_tokens rt2 WHERE rt2.id = rt.replaced_by_token_id);

    IF orphan_count > 0 THEN
        RAISE NOTICE 'Found % orphan replaced_by_token_id references in refresh_tokens', orphan_count;
        -- Clean up orphans by setting to NULL (these are just audit trails)
        UPDATE refresh_tokens
        SET replaced_by_token_id = NULL
        WHERE replaced_by_token_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM refresh_tokens rt2 WHERE rt2.id = refresh_tokens.replaced_by_token_id);
        RAISE NOTICE 'Cleaned up orphan replaced_by_token_id references';
    ELSE
        RAISE NOTICE 'No orphan replaced_by_token_id references found';
    END IF;
END $$;

-- 1.2 Check for orphan alarm_thresholds.created_by_id
DO $$
DECLARE
    orphan_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO orphan_count
    FROM alarm_thresholds at
    WHERE at.created_by_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = at.created_by_id);

    IF orphan_count > 0 THEN
        RAISE NOTICE 'Found % orphan created_by_id references in alarm_thresholds', orphan_count;
        -- Clean up by setting to NULL
        UPDATE alarm_thresholds
        SET created_by_id = NULL
        WHERE created_by_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = alarm_thresholds.created_by_id);
        RAISE NOTICE 'Cleaned up orphan created_by_id references in alarm_thresholds';
    ELSE
        RAISE NOTICE 'No orphan created_by_id references found in alarm_thresholds';
    END IF;
END $$;

-- 1.3 Check for orphan alarm_history.resolved_by_id
DO $$
DECLARE
    orphan_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO orphan_count
    FROM alarm_history ah
    WHERE ah.resolved_by_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = ah.resolved_by_id);

    IF orphan_count > 0 THEN
        RAISE NOTICE 'Found % orphan resolved_by_id references in alarm_history', orphan_count;
        -- Clean up by setting to NULL
        UPDATE alarm_history
        SET resolved_by_id = NULL
        WHERE resolved_by_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = alarm_history.resolved_by_id);
        RAISE NOTICE 'Cleaned up orphan resolved_by_id references in alarm_history';
    ELSE
        RAISE NOTICE 'No orphan resolved_by_id references found in alarm_history';
    END IF;
END $$;

-- 1.4 Check for orphan system_settings.updated_by
DO $$
DECLARE
    orphan_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO orphan_count
    FROM system_settings ss
    WHERE ss.updated_by IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = ss.updated_by);

    IF orphan_count > 0 THEN
        RAISE NOTICE 'Found % orphan updated_by references in system_settings', orphan_count;
        -- Clean up by setting to NULL
        UPDATE system_settings
        SET updated_by = NULL
        WHERE updated_by IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = system_settings.updated_by);
        RAISE NOTICE 'Cleaned up orphan updated_by references in system_settings';
    ELSE
        RAISE NOTICE 'No orphan updated_by references found in system_settings';
    END IF;
END $$;

-- 1.5 Check for orphan audit_logs.user_id
DO $$
DECLARE
    orphan_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO orphan_count
    FROM audit_logs al
    WHERE al.user_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = al.user_id);

    IF orphan_count > 0 THEN
        RAISE NOTICE 'Found % orphan user_id references in audit_logs', orphan_count;
        -- Clean up by setting to NULL (audit logs preserve history even if user deleted)
        UPDATE audit_logs
        SET user_id = NULL
        WHERE user_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = audit_logs.user_id);
        RAISE NOTICE 'Cleaned up orphan user_id references in audit_logs';
    ELSE
        RAISE NOTICE 'No orphan user_id references found in audit_logs';
    END IF;
END $$;

-- 1.6 Check for orphan audit_logs.target_user_id
DO $$
DECLARE
    orphan_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO orphan_count
    FROM audit_logs al
    WHERE al.target_user_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = al.target_user_id);

    IF orphan_count > 0 THEN
        RAISE NOTICE 'Found % orphan target_user_id references in audit_logs', orphan_count;
        -- Clean up by setting to NULL
        UPDATE audit_logs
        SET target_user_id = NULL
        WHERE target_user_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = audit_logs.target_user_id);
        RAISE NOTICE 'Cleaned up orphan target_user_id references in audit_logs';
    ELSE
        RAISE NOTICE 'No orphan target_user_id references found in audit_logs';
    END IF;
END $$;

-- =====================================================
-- PHASE 2: ADD MISSING FOREIGN KEY CONSTRAINTS
-- =====================================================

-- 2.1 refresh_tokens.replaced_by_token_id -> refresh_tokens.id (self-reference)
-- ON DELETE SET NULL: If the replacement token is deleted, just clear the reference
-- This is an audit trail field, not critical for functionality
ALTER TABLE "refresh_tokens"
DROP CONSTRAINT IF EXISTS "refresh_tokens_replaced_by_token_id_fkey";

ALTER TABLE "refresh_tokens"
ADD CONSTRAINT "refresh_tokens_replaced_by_token_id_fkey"
FOREIGN KEY ("replaced_by_token_id")
REFERENCES "refresh_tokens"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

-- 2.2 alarm_thresholds.created_by_id -> users.id
-- ON DELETE SET NULL: If admin is deleted, preserve the threshold but clear creator
ALTER TABLE "alarm_thresholds"
DROP CONSTRAINT IF EXISTS "alarm_thresholds_created_by_id_fkey";

ALTER TABLE "alarm_thresholds"
ADD CONSTRAINT "alarm_thresholds_created_by_id_fkey"
FOREIGN KEY ("created_by_id")
REFERENCES "users"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

-- 2.3 alarm_history.resolved_by_id -> users.id
-- ON DELETE SET NULL: If admin is deleted, preserve alarm history but clear resolver
-- Note: This was defined in Prisma schema but missing from the actual DB migration
ALTER TABLE "alarm_history"
DROP CONSTRAINT IF EXISTS "alarm_history_resolved_by_id_fkey";

ALTER TABLE "alarm_history"
ADD CONSTRAINT "alarm_history_resolved_by_id_fkey"
FOREIGN KEY ("resolved_by_id")
REFERENCES "users"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

-- 2.4 system_settings.updated_by -> users.id
-- ON DELETE SET NULL: Settings persist even if admin who changed them is deleted
ALTER TABLE "system_settings"
DROP CONSTRAINT IF EXISTS "system_settings_updated_by_fkey";

ALTER TABLE "system_settings"
ADD CONSTRAINT "system_settings_updated_by_fkey"
FOREIGN KEY ("updated_by")
REFERENCES "users"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

-- 2.5 audit_logs.user_id -> users.id
-- ON DELETE SET NULL: Audit logs are critical for compliance, preserve even if user deleted
ALTER TABLE "audit_logs"
DROP CONSTRAINT IF EXISTS "audit_logs_user_id_fkey";

ALTER TABLE "audit_logs"
ADD CONSTRAINT "audit_logs_user_id_fkey"
FOREIGN KEY ("user_id")
REFERENCES "users"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

-- 2.6 audit_logs.target_user_id -> users.id
-- ON DELETE SET NULL: Preserve audit history even if target user is deleted
ALTER TABLE "audit_logs"
DROP CONSTRAINT IF EXISTS "audit_logs_target_user_id_fkey";

ALTER TABLE "audit_logs"
ADD CONSTRAINT "audit_logs_target_user_id_fkey"
FOREIGN KEY ("target_user_id")
REFERENCES "users"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

-- =====================================================
-- PHASE 3: CREATE INDEXES FOR NEW FK COLUMNS (if missing)
-- =====================================================

-- Index for replaced_by_token_id (for self-join performance)
CREATE INDEX IF NOT EXISTS "refresh_tokens_replaced_by_token_id_idx"
ON "refresh_tokens"("replaced_by_token_id")
WHERE replaced_by_token_id IS NOT NULL;

-- Index for created_by_id in alarm_thresholds
CREATE INDEX IF NOT EXISTS "alarm_thresholds_created_by_id_idx"
ON "alarm_thresholds"("created_by_id")
WHERE created_by_id IS NOT NULL;

-- Index for resolved_by_id in alarm_history
CREATE INDEX IF NOT EXISTS "alarm_history_resolved_by_id_idx"
ON "alarm_history"("resolved_by_id")
WHERE resolved_by_id IS NOT NULL;

-- Index for updated_by in system_settings
CREATE INDEX IF NOT EXISTS "system_settings_updated_by_idx"
ON "system_settings"("updated_by")
WHERE updated_by IS NOT NULL;

-- =====================================================
-- PHASE 4: VERIFICATION QUERIES
-- Run these after migration to confirm FK constraints are in place
-- =====================================================

-- List all foreign keys on our tables
-- SELECT
--     tc.table_name,
--     kcu.column_name,
--     ccu.table_name AS foreign_table_name,
--     ccu.column_name AS foreign_column_name,
--     rc.delete_rule,
--     rc.update_rule
-- FROM information_schema.table_constraints AS tc
-- JOIN information_schema.key_column_usage AS kcu
--     ON tc.constraint_name = kcu.constraint_name
-- JOIN information_schema.constraint_column_usage AS ccu
--     ON ccu.constraint_name = tc.constraint_name
-- JOIN information_schema.referential_constraints AS rc
--     ON tc.constraint_name = rc.constraint_name
-- WHERE tc.constraint_type = 'FOREIGN KEY'
--     AND tc.table_name IN (
--         'refresh_tokens', 'alarm_thresholds', 'alarm_history',
--         'system_settings', 'audit_logs'
--     )
-- ORDER BY tc.table_name, kcu.column_name;

RAISE NOTICE 'Migration complete: Added 6 missing FK constraints';
