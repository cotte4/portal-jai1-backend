-- ============================================================
-- Enable Row Level Security (RLS) for Storage Buckets
-- ============================================================
--
-- PURPOSE:
-- Since this project uses NestJS JWT auth (not Supabase Auth),
-- and the backend uses service key (which bypasses RLS), these
-- policies act as DEFENSE-IN-DEPTH to block direct API access.
--
-- HOW TO RUN:
-- 1. Go to Supabase Dashboard -> SQL Editor
-- 2. Paste this entire script
-- 3. Click "Run"
--
-- NOTE:
-- - Service key (used by NestJS backend) BYPASSES all RLS
-- - These policies block anon/authenticated key access via Supabase Client
-- - auth.uid() returns NULL since we don't use Supabase Auth
-- ============================================================

-- ============================================================
-- STEP 1: Verify buckets exist
-- ============================================================
-- Run this query first to confirm buckets are set up:
--
-- SELECT id, name, public FROM storage.buckets;
--
-- Expected: 'documents' and 'profile-pictures' buckets exist

-- ============================================================
-- STEP 2: Block all direct access to 'documents' bucket
-- ============================================================
-- Since we use NestJS backend for all operations, we block ALL
-- direct access via Supabase API. The service key bypasses this.

-- Block SELECT (reading/downloading files directly)
CREATE POLICY "block_direct_select_documents"
ON storage.objects FOR SELECT
TO public
USING (bucket_id != 'documents');

-- Block INSERT (uploading files directly)
CREATE POLICY "block_direct_insert_documents"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id != 'documents');

-- Block UPDATE (modifying files directly)
CREATE POLICY "block_direct_update_documents"
ON storage.objects FOR UPDATE
TO public
USING (bucket_id != 'documents');

-- Block DELETE (deleting files directly)
CREATE POLICY "block_direct_delete_documents"
ON storage.objects FOR DELETE
TO public
USING (bucket_id != 'documents');

-- ============================================================
-- STEP 3: Block all direct access to 'profile-pictures' bucket
-- ============================================================

-- Block SELECT
CREATE POLICY "block_direct_select_profile_pictures"
ON storage.objects FOR SELECT
TO public
USING (bucket_id != 'profile-pictures');

-- Block INSERT
CREATE POLICY "block_direct_insert_profile_pictures"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id != 'profile-pictures');

-- Block UPDATE
CREATE POLICY "block_direct_update_profile_pictures"
ON storage.objects FOR UPDATE
TO public
USING (bucket_id != 'profile-pictures');

-- Block DELETE
CREATE POLICY "block_direct_delete_profile_pictures"
ON storage.objects FOR DELETE
TO public
USING (bucket_id != 'profile-pictures');

-- ============================================================
-- STEP 4: Verify policies are created
-- ============================================================

SELECT
  policyname,
  tablename,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
ORDER BY policyname;

-- Expected: 8 policies (4 for documents, 4 for profile-pictures)

-- ============================================================
-- WHAT THIS DOES
-- ============================================================
--
-- BLOCKED (Supabase Client with anon/authenticated key):
--   ❌ supabase.storage.from('documents').list()
--   ❌ supabase.storage.from('documents').download('path')
--   ❌ supabase.storage.from('documents').upload('path', file)
--   ❌ supabase.storage.from('profile-pictures').download('path')
--   ❌ Any direct storage access via Supabase REST API
--
-- ALLOWED (NestJS backend with service key):
--   ✅ this.supabase.uploadFile('documents', path, buffer)
--   ✅ this.supabase.getSignedUrl('documents', path)
--   ✅ this.supabase.deleteFile('documents', path)
--   ✅ All storage operations via backend
--
-- WHY:
--   The NestJS backend uses SUPABASE_SERVICE_KEY which has
--   service_role privileges. Service role ALWAYS bypasses RLS.
--   Regular clients using anon or authenticated keys are blocked.
--
-- ============================================================
-- ROLLBACK (if needed)
-- ============================================================
-- To remove these policies and allow direct access:
--
-- DROP POLICY IF EXISTS "block_direct_select_documents" ON storage.objects;
-- DROP POLICY IF EXISTS "block_direct_insert_documents" ON storage.objects;
-- DROP POLICY IF EXISTS "block_direct_update_documents" ON storage.objects;
-- DROP POLICY IF EXISTS "block_direct_delete_documents" ON storage.objects;
-- DROP POLICY IF EXISTS "block_direct_select_profile_pictures" ON storage.objects;
-- DROP POLICY IF EXISTS "block_direct_insert_profile_pictures" ON storage.objects;
-- DROP POLICY IF EXISTS "block_direct_update_profile_pictures" ON storage.objects;
-- DROP POLICY IF EXISTS "block_direct_delete_profile_pictures" ON storage.objects;
--
