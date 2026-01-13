-- ============================================================
-- Pre-Migration Validation: Check for Invalid UUIDs
-- ============================================================
--
-- PURPOSE:
-- Run BEFORE the TEXT-to-UUID migration to verify all ID columns
-- contain valid UUID strings. Any invalid values will cause the
-- migration to fail.
--
-- HOW TO RUN:
-- 1. Go to Supabase Dashboard > SQL Editor
-- 2. Paste this entire script
-- 3. Click "Run"
-- 4. Check results: ALL counts should be 0
--
-- ============================================================

-- UUID regex pattern (case-insensitive)
-- Format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

-- ============================================================
-- STEP 1: Validate Primary Key columns (12 tables)
-- ============================================================

SELECT 'VALIDATING PRIMARY KEYS...' as status;

SELECT
    'users' as table_name,
    'id' as column_name,
    COUNT(*) as invalid_count
FROM users
WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'client_profiles', 'id', COUNT(*)
FROM client_profiles
WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'tax_cases', 'id', COUNT(*)
FROM tax_cases
WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'documents', 'id', COUNT(*)
FROM documents
WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'tickets', 'id', COUNT(*)
FROM tickets
WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'ticket_messages', 'id', COUNT(*)
FROM ticket_messages
WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'status_history', 'id', COUNT(*)
FROM status_history
WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'notifications', 'id', COUNT(*)
FROM notifications
WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'w2_estimates', 'id', COUNT(*)
FROM w2_estimates
WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'referrals', 'id', COUNT(*)
FROM referrals
WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'discount_applications', 'id', COUNT(*)
FROM discount_applications
WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'audit_logs', 'id', COUNT(*)
FROM audit_logs
WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

ORDER BY table_name;

-- ============================================================
-- STEP 2: Validate Foreign Key columns (16 columns)
-- ============================================================

SELECT 'VALIDATING FOREIGN KEYS...' as status;

SELECT
    'client_profiles' as table_name,
    'user_id' as column_name,
    COUNT(*) as invalid_count
FROM client_profiles
WHERE user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'tax_cases', 'client_profile_id', COUNT(*)
FROM tax_cases
WHERE client_profile_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'documents', 'tax_case_id', COUNT(*)
FROM documents
WHERE tax_case_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'tickets', 'user_id', COUNT(*)
FROM tickets
WHERE user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'ticket_messages', 'ticket_id', COUNT(*)
FROM ticket_messages
WHERE ticket_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'ticket_messages', 'sender_id', COUNT(*)
FROM ticket_messages
WHERE sender_id IS NOT NULL
  AND sender_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'status_history', 'tax_case_id', COUNT(*)
FROM status_history
WHERE tax_case_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'status_history', 'changed_by_id', COUNT(*)
FROM status_history
WHERE changed_by_id IS NOT NULL
  AND changed_by_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'notifications', 'user_id', COUNT(*)
FROM notifications
WHERE user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'w2_estimates', 'user_id', COUNT(*)
FROM w2_estimates
WHERE user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'w2_estimates', 'tax_case_id', COUNT(*)
FROM w2_estimates
WHERE tax_case_id IS NOT NULL
  AND tax_case_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'referrals', 'referrer_id', COUNT(*)
FROM referrals
WHERE referrer_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'referrals', 'referred_user_id', COUNT(*)
FROM referrals
WHERE referred_user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'referrals', 'tax_case_id', COUNT(*)
FROM referrals
WHERE tax_case_id IS NOT NULL
  AND tax_case_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'discount_applications', 'user_id', COUNT(*)
FROM discount_applications
WHERE user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'discount_applications', 'tax_case_id', COUNT(*)
FROM discount_applications
WHERE tax_case_id IS NOT NULL
  AND tax_case_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'discount_applications', 'referral_id', COUNT(*)
FROM discount_applications
WHERE referral_id IS NOT NULL
  AND referral_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'discount_applications', 'applied_by_admin_id', COUNT(*)
FROM discount_applications
WHERE applied_by_admin_id IS NOT NULL
  AND applied_by_admin_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'audit_logs', 'user_id', COUNT(*)
FROM audit_logs
WHERE user_id IS NOT NULL
  AND user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

UNION ALL

SELECT 'audit_logs', 'target_user_id', COUNT(*)
FROM audit_logs
WHERE target_user_id IS NOT NULL
  AND target_user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

ORDER BY table_name, column_name;

-- ============================================================
-- STEP 3: Record row counts (for post-migration verification)
-- ============================================================

SELECT 'RECORDING ROW COUNTS...' as status;

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
-- RESULT INTERPRETATION
-- ============================================================
--
-- IF all invalid_count values are 0:
--   Migration is SAFE to proceed
--
-- IF any invalid_count > 0:
--   DO NOT run the migration!
--   Investigate the invalid values with:
--   SELECT * FROM <table> WHERE <column> !~ '^[0-9a-f]{8}-...'
--
-- ============================================================
