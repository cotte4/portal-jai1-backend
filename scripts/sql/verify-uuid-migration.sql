-- ============================================================
-- Post-Migration Verification: Confirm UUID Migration Success
-- ============================================================
--
-- PURPOSE:
-- Run AFTER the TEXT-to-UUID migration to verify all columns
-- have been converted to native UUID type.
--
-- HOW TO RUN:
-- 1. Go to Supabase Dashboard > SQL Editor
-- 2. Paste this entire script
-- 3. Click "Run"
-- 4. Check results: ALL data_type values should be 'uuid'
--
-- ============================================================

-- ============================================================
-- STEP 1: Check all ID and FK columns are UUID type
-- ============================================================

SELECT
    table_name,
    column_name,
    data_type,
    CASE
        WHEN data_type = 'uuid' THEN 'OK'
        ELSE 'FAILED - Still ' || data_type
    END as status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN (
    'id',
    'user_id',
    'client_profile_id',
    'tax_case_id',
    'ticket_id',
    'sender_id',
    'changed_by_id',
    'referrer_id',
    'referred_user_id',
    'applied_by_admin_id',
    'target_user_id',
    'referral_id'
  )
ORDER BY table_name, column_name;

-- ============================================================
-- STEP 2: Verify default values are set for primary keys
-- ============================================================

SELECT
    table_name,
    column_name,
    column_default,
    CASE
        WHEN column_default LIKE '%gen_random_uuid%' THEN 'OK'
        WHEN column_default LIKE '%uuid_generate%' THEN 'OK'
        ELSE 'CHECK - May need default'
    END as status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'id'
  AND table_name IN (
    'users',
    'client_profiles',
    'tax_cases',
    'documents',
    'tickets',
    'ticket_messages',
    'status_history',
    'notifications',
    'w2_estimates',
    'referrals',
    'discount_applications',
    'audit_logs'
  )
ORDER BY table_name;

-- ============================================================
-- STEP 3: Verify foreign key constraints exist
-- ============================================================

SELECT
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table,
    ccu.column_name AS foreign_column,
    rc.delete_rule
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
JOIN information_schema.referential_constraints AS rc
    ON tc.constraint_name = rc.constraint_name
    AND tc.table_schema = rc.constraint_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
ORDER BY tc.table_name, kcu.column_name;

-- ============================================================
-- STEP 4: Final row counts (compare with pre-migration)
-- ============================================================

SELECT 'users' as table_name, COUNT(*) as row_count FROM users
UNION ALL SELECT 'client_profiles', COUNT(*) FROM client_profiles
UNION ALL SELECT 'tax_cases', COUNT(*) FROM tax_cases
UNION ALL SELECT 'documents', COUNT(*) FROM documents
UNION ALL SELECT 'tickets', COUNT(*) FROM tickets
UNION ALL SELECT 'ticket_messages', COUNT(*) FROM ticket_messages
UNION ALL SELECT 'status_history', COUNT(*) FROM status_history
UNION ALL SELECT 'notifications', COUNT(*) FROM notifications
UNION ALL SELECT 'w2_estimates', COUNT(*) FROM w2_estimates
UNION ALL SELECT 'referrals', COUNT(*) FROM referrals
UNION ALL SELECT 'discount_applications', COUNT(*) FROM discount_applications
UNION ALL SELECT 'audit_logs', COUNT(*) FROM audit_logs
ORDER BY table_name;

-- ============================================================
-- SUCCESS CRITERIA
-- ============================================================
--
-- 1. All data_type = 'uuid' (Step 1)
-- 2. All primary keys have gen_random_uuid() default (Step 2)
-- 3. Foreign key constraints are recreated (Step 3)
-- 4. Row counts match pre-migration (Step 4)
--
-- ============================================================
