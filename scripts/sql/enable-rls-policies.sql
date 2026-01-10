-- ============================================================
-- Enable Row Level Security (RLS) - Block Direct Access
-- ============================================================
--
-- PURPOSE:
-- Since this project uses NestJS JWT auth (not Supabase Auth),
-- we simply BLOCK ALL direct access via Supabase API.
-- All data access must go through the NestJS backend.
--
-- HOW TO RUN:
-- 1. Go to Supabase Dashboard → SQL Editor
-- 2. Paste this entire script
-- 3. Click "Run"
--
-- NOTE:
-- Prisma uses direct PostgreSQL connection with service role,
-- which BYPASSES RLS. The backend will continue to work normally.
-- ============================================================

-- ============================================================
-- STEP 1: Enable RLS on all tables
-- ============================================================
-- When RLS is enabled with NO policies, all access is DENIED.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE w2_estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE discount_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- STEP 2: Force RLS for table owners (extra security)
-- ============================================================
-- By default, table owners bypass RLS. This forces RLS even
-- for the table owner (except service_role which always bypasses).

ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE client_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE tax_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
ALTER TABLE tickets FORCE ROW LEVEL SECURITY;
ALTER TABLE ticket_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE status_history FORCE ROW LEVEL SECURITY;
ALTER TABLE w2_estimates FORCE ROW LEVEL SECURITY;
ALTER TABLE referrals FORCE ROW LEVEL SECURITY;
ALTER TABLE discount_applications FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

-- ============================================================
-- STEP 3: Verify RLS is enabled
-- ============================================================

SELECT
    c.relname AS tablename,
    c.relrowsecurity AS rls_enabled,
    c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
AND c.relname IN (
    'users',
    'client_profiles',
    'tax_cases',
    'documents',
    'tickets',
    'ticket_messages',
    'notifications',
    'status_history',
    'w2_estimates',
    'referrals',
    'discount_applications',
    'audit_logs'
)
ORDER BY c.relname;

-- Expected: all rows show rls_enabled=true, rls_forced=true

-- ============================================================
-- WHAT THIS DOES
-- ============================================================
--
-- BLOCKED (Supabase Client with anon/authenticated key):
--   ❌ supabase.from('users').select('*')
--   ❌ supabase.from('client_profiles').select('*')
--   ❌ Any direct table query via Supabase REST API
--   ❌ Any direct table query via Supabase JS client
--
-- ALLOWED (Your NestJS backend via Prisma):
--   ✅ All Prisma queries work normally
--   ✅ prisma.user.findMany()
--   ✅ prisma.clientProfile.create()
--   ✅ All CRUD operations via backend
--
-- WHY:
--   Prisma connects with DATABASE_URL which uses the postgres
--   user or service_role, which ALWAYS bypasses RLS.
--
-- ============================================================
-- ROLLBACK (if needed)
-- ============================================================
-- To disable RLS and restore direct access:
--
-- ALTER TABLE users DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE client_profiles DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE tax_cases DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE documents DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE tickets DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE ticket_messages DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE status_history DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE w2_estimates DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE referrals DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE discount_applications DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY;
--
