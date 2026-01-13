-- Documents table improvements from audit DOC-P1/P2
-- Run this in Supabase SQL Editor

-- =============================================
-- 1. FILE SIZE CHECK CONSTRAINT
-- =============================================
-- Ensures file_size is positive and <= 50MB (52428800 bytes)
-- Prevents invalid file sizes in database

ALTER TABLE "documents"
DROP CONSTRAINT IF EXISTS "documents_file_size_check";

ALTER TABLE "documents"
ADD CONSTRAINT "documents_file_size_check"
CHECK (file_size > 0 AND file_size <= 52428800);

-- =============================================
-- 2. STORAGE PATH UNIQUE CONSTRAINT
-- =============================================
-- Prevents two document records pointing to the same file
-- Ensures data integrity between DB and Storage

ALTER TABLE "documents"
DROP CONSTRAINT IF EXISTS "documents_storage_path_key";

ALTER TABLE "documents"
ADD CONSTRAINT "documents_storage_path_key" UNIQUE ("storage_path");

-- =============================================
-- 3. ADD UPLOADED_BY_ID FIELD
-- =============================================
-- Tracks who uploaded the document (client or admin)
-- Nullable for existing records, FK to users

ALTER TABLE "documents"
ADD COLUMN IF NOT EXISTS "uploaded_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL;

-- Index for querying documents by uploader
CREATE INDEX IF NOT EXISTS "documents_uploaded_by_id_idx"
ON "documents"("uploaded_by_id")
WHERE "uploaded_by_id" IS NOT NULL;

-- =============================================
-- VERIFICATION QUERIES
-- =============================================
-- Check constraints:
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'documents'::regclass;

-- Check new column:
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'documents'
-- AND column_name = 'uploaded_by_id';
