-- ============================================================
-- Pre-Migration Validation: Check for Invalid UUIDs
-- ============================================================
--
-- PURPOSE:
-- Run this BEFORE the UUID migration to ensure all ID values
-- are valid UUIDs that can be safely converted.
--
-- EXPECTED RESULT:
-- All rows should show invalid_count = 0
--
-- IF ANY COUNT > 0:
-- DO NOT proceed with migration. Fix the invalid values first.
-- ============================================================

-- UUID regex pattern for PostgreSQL
-- Format: 8-4-4-4-12 hex characters (e.g., 550e8400-e29b-41d4-a716-446655440000)

SELECT 'PRIMARY KEY VALIDATION' as section;

SELECT 'users' as table_name, COUNT(*) as invalid_count FROM users
WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
SELECT 'client_profiles', COUNT(*) FROM client_profiles
WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
SELECT 'tax_cases', COUNT(*) FROM tax_cases
WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
SELECT 'documents', COUNT(*) FROM documents
WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
SELECT 'tickets', COUNT(*) FROM tickets
WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
SELECT 'ticket_messages', COUNT(*) FROM ticket_messages
WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
SELECT 'status_history', COUNT(*) FROM status_history
WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
SELECT 'notifications', COUNT(*) FROM notifications
WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
SELECT 'w2_estimates', COUNT(*) FROM w2_estimates
WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
SELECT 'referrals', COUNT(*) FROM referrals
WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
SELECT 'discount_applications', COUNT(*) FROM discount_applications
WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
SELECT 'audit_logs', COUNT(*) FROM audit_logs
WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- ============================================================
-- FOREIGN KEY VALIDATION
-- ============================================================

SELECT 'FOREIGN KEY VALIDATION' as section;

-- client_profiles.user_id
SELECT 'client_profiles.user_id' as column_name, COUNT(*) as invalid_count
FROM client_profiles WHERE user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
-- tax_cases.client_profile_id
SELECT 'tax_cases.client_profile_id', COUNT(*)
FROM tax_cases WHERE client_profile_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
-- documents.tax_case_id
SELECT 'documents.tax_case_id', COUNT(*)
FROM documents WHERE tax_case_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
-- tickets.user_id
SELECT 'tickets.user_id', COUNT(*)
FROM tickets WHERE user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
-- ticket_messages.ticket_id
SELECT 'ticket_messages.ticket_id', COUNT(*)
FROM ticket_messages WHERE ticket_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
-- ticket_messages.sender_id (nullable)
SELECT 'ticket_messages.sender_id', COUNT(*)
FROM ticket_messages WHERE sender_id IS NOT NULL AND sender_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
-- status_history.tax_case_id
SELECT 'status_history.tax_case_id', COUNT(*)
FROM status_history WHERE tax_case_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
-- status_history.changed_by_id (nullable)
SELECT 'status_history.changed_by_id', COUNT(*)
FROM status_history WHERE changed_by_id IS NOT NULL AND changed_by_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
-- notifications.user_id
SELECT 'notifications.user_id', COUNT(*)
FROM notifications WHERE user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
-- w2_estimates.user_id
SELECT 'w2_estimates.user_id', COUNT(*)
FROM w2_estimates WHERE user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
-- w2_estimates.tax_case_id (nullable)
SELECT 'w2_estimates.tax_case_id', COUNT(*)
FROM w2_estimates WHERE tax_case_id IS NOT NULL AND tax_case_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
-- referrals.referrer_id
SELECT 'referrals.referrer_id', COUNT(*)
FROM referrals WHERE referrer_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
-- referrals.referred_user_id
SELECT 'referrals.referred_user_id', COUNT(*)
FROM referrals WHERE referred_user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
-- referrals.tax_case_id (nullable)
SELECT 'referrals.tax_case_id', COUNT(*)
FROM referrals WHERE tax_case_id IS NOT NULL AND tax_case_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
-- discount_applications.user_id
SELECT 'discount_applications.user_id', COUNT(*)
FROM discount_applications WHERE user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
-- discount_applications.tax_case_id (nullable)
SELECT 'discount_applications.tax_case_id', COUNT(*)
FROM discount_applications WHERE tax_case_id IS NOT NULL AND tax_case_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
-- discount_applications.referral_id (nullable)
SELECT 'discount_applications.referral_id', COUNT(*)
FROM discount_applications WHERE referral_id IS NOT NULL AND referral_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
-- discount_applications.applied_by_admin_id (nullable)
SELECT 'discount_applications.applied_by_admin_id', COUNT(*)
FROM discount_applications WHERE applied_by_admin_id IS NOT NULL AND applied_by_admin_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
-- audit_logs.user_id (nullable)
SELECT 'audit_logs.user_id', COUNT(*)
FROM audit_logs WHERE user_id IS NOT NULL AND user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL
-- audit_logs.target_user_id (nullable)
SELECT 'audit_logs.target_user_id', COUNT(*)
FROM audit_logs WHERE target_user_id IS NOT NULL AND target_user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- ============================================================
-- ROW COUNTS (for verification after migration)
-- ============================================================

SELECT 'ROW COUNTS (record before migration)' as section;

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
