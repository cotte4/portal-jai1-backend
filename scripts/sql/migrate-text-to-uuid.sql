-- ============================================================
-- Migration: Convert ID columns from TEXT to UUID
-- ============================================================
--
-- PURPOSE:
-- Convert all ID columns from text to native PostgreSQL uuid type
-- for better storage efficiency and validation.
--
-- BEFORE RUNNING:
-- 1. BACKUP YOUR DATABASE!
-- 2. Stop the NestJS backend
-- 3. Run in Supabase SQL Editor
--
-- AFTER RUNNING:
-- 1. Update Prisma schema (add @db.Uuid annotations)
-- 2. Run: npx prisma generate
-- 3. Restart the backend
-- ============================================================

-- ============================================================
-- STEP 1: Drop all foreign key constraints
-- ============================================================

-- client_profiles -> users
ALTER TABLE client_profiles DROP CONSTRAINT IF EXISTS client_profiles_user_id_fkey;

-- tax_cases -> client_profiles
ALTER TABLE tax_cases DROP CONSTRAINT IF EXISTS tax_cases_client_profile_id_fkey;

-- documents -> tax_cases
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_tax_case_id_fkey;

-- tickets -> users
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_user_id_fkey;

-- ticket_messages -> tickets
ALTER TABLE ticket_messages DROP CONSTRAINT IF EXISTS ticket_messages_ticket_id_fkey;
-- ticket_messages -> users (sender)
ALTER TABLE ticket_messages DROP CONSTRAINT IF EXISTS ticket_messages_sender_id_fkey;

-- status_history -> tax_cases
ALTER TABLE status_history DROP CONSTRAINT IF EXISTS status_history_tax_case_id_fkey;
-- status_history -> users (changed_by)
ALTER TABLE status_history DROP CONSTRAINT IF EXISTS status_history_changed_by_id_fkey;

-- notifications -> users
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_user_id_fkey;

-- w2_estimates -> users
ALTER TABLE w2_estimates DROP CONSTRAINT IF EXISTS w2_estimates_user_id_fkey;
-- w2_estimates -> tax_cases (optional FK)
ALTER TABLE w2_estimates DROP CONSTRAINT IF EXISTS w2_estimates_tax_case_id_fkey;

-- ============================================================
-- STEP 2: Convert primary key columns to UUID
-- ============================================================

-- users
ALTER TABLE users
  ALTER COLUMN id TYPE uuid USING id::uuid;

-- client_profiles
ALTER TABLE client_profiles
  ALTER COLUMN id TYPE uuid USING id::uuid;

-- tax_cases
ALTER TABLE tax_cases
  ALTER COLUMN id TYPE uuid USING id::uuid;

-- documents
ALTER TABLE documents
  ALTER COLUMN id TYPE uuid USING id::uuid;

-- tickets
ALTER TABLE tickets
  ALTER COLUMN id TYPE uuid USING id::uuid;

-- ticket_messages
ALTER TABLE ticket_messages
  ALTER COLUMN id TYPE uuid USING id::uuid;

-- status_history
ALTER TABLE status_history
  ALTER COLUMN id TYPE uuid USING id::uuid;

-- notifications
ALTER TABLE notifications
  ALTER COLUMN id TYPE uuid USING id::uuid;

-- w2_estimates
ALTER TABLE w2_estimates
  ALTER COLUMN id TYPE uuid USING id::uuid;

-- ============================================================
-- STEP 3: Convert foreign key columns to UUID
-- ============================================================

-- client_profiles.user_id
ALTER TABLE client_profiles
  ALTER COLUMN user_id TYPE uuid USING user_id::uuid;

-- tax_cases.client_profile_id
ALTER TABLE tax_cases
  ALTER COLUMN client_profile_id TYPE uuid USING client_profile_id::uuid;

-- documents.tax_case_id
ALTER TABLE documents
  ALTER COLUMN tax_case_id TYPE uuid USING tax_case_id::uuid;

-- tickets.user_id
ALTER TABLE tickets
  ALTER COLUMN user_id TYPE uuid USING user_id::uuid;

-- ticket_messages.ticket_id and sender_id
ALTER TABLE ticket_messages
  ALTER COLUMN ticket_id TYPE uuid USING ticket_id::uuid;
ALTER TABLE ticket_messages
  ALTER COLUMN sender_id TYPE uuid USING sender_id::uuid;

-- status_history.tax_case_id and changed_by_id
ALTER TABLE status_history
  ALTER COLUMN tax_case_id TYPE uuid USING tax_case_id::uuid;
ALTER TABLE status_history
  ALTER COLUMN changed_by_id TYPE uuid USING changed_by_id::uuid;

-- notifications.user_id
ALTER TABLE notifications
  ALTER COLUMN user_id TYPE uuid USING user_id::uuid;

-- w2_estimates.user_id and tax_case_id (nullable)
ALTER TABLE w2_estimates
  ALTER COLUMN user_id TYPE uuid USING user_id::uuid;
ALTER TABLE w2_estimates
  ALTER COLUMN tax_case_id TYPE uuid USING tax_case_id::uuid;

-- ============================================================
-- STEP 4: Set default value for primary keys
-- ============================================================

ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE client_profiles ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE tax_cases ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE documents ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE tickets ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE ticket_messages ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE status_history ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE notifications ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE w2_estimates ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- ============================================================
-- STEP 5: Re-create foreign key constraints with CASCADE
-- ============================================================

-- client_profiles -> users
ALTER TABLE client_profiles
  ADD CONSTRAINT client_profiles_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- tax_cases -> client_profiles
ALTER TABLE tax_cases
  ADD CONSTRAINT tax_cases_client_profile_id_fkey
  FOREIGN KEY (client_profile_id) REFERENCES client_profiles(id) ON DELETE CASCADE;

-- documents -> tax_cases
ALTER TABLE documents
  ADD CONSTRAINT documents_tax_case_id_fkey
  FOREIGN KEY (tax_case_id) REFERENCES tax_cases(id) ON DELETE CASCADE;

-- tickets -> users
ALTER TABLE tickets
  ADD CONSTRAINT tickets_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ticket_messages -> tickets
ALTER TABLE ticket_messages
  ADD CONSTRAINT ticket_messages_ticket_id_fkey
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;

-- ticket_messages -> users (sender) - NO CASCADE (preserve audit trail)
ALTER TABLE ticket_messages
  ADD CONSTRAINT ticket_messages_sender_id_fkey
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL;

-- Wait, sender_id is NOT NULL in schema, so we need to handle this differently
-- Let's use RESTRICT to prevent deleting users with messages
ALTER TABLE ticket_messages
  DROP CONSTRAINT IF EXISTS ticket_messages_sender_id_fkey;
ALTER TABLE ticket_messages
  ADD CONSTRAINT ticket_messages_sender_id_fkey
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE RESTRICT;

-- status_history -> tax_cases
ALTER TABLE status_history
  ADD CONSTRAINT status_history_tax_case_id_fkey
  FOREIGN KEY (tax_case_id) REFERENCES tax_cases(id) ON DELETE CASCADE;

-- status_history -> users (changed_by) - RESTRICT to preserve audit
ALTER TABLE status_history
  ADD CONSTRAINT status_history_changed_by_id_fkey
  FOREIGN KEY (changed_by_id) REFERENCES users(id) ON DELETE RESTRICT;

-- notifications -> users
ALTER TABLE notifications
  ADD CONSTRAINT notifications_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- w2_estimates -> users
ALTER TABLE w2_estimates
  ADD CONSTRAINT w2_estimates_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- w2_estimates -> tax_cases (optional, SET NULL on delete)
ALTER TABLE w2_estimates
  ADD CONSTRAINT w2_estimates_tax_case_id_fkey
  FOREIGN KEY (tax_case_id) REFERENCES tax_cases(id) ON DELETE SET NULL;

-- ============================================================
-- STEP 6: Verify the changes
-- ============================================================

SELECT
    table_name,
    column_name,
    data_type,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN ('id', 'user_id', 'client_profile_id', 'tax_case_id',
                       'ticket_id', 'sender_id', 'changed_by_id')
ORDER BY table_name, column_name;

-- Expected: all should show data_type = 'uuid'

-- ============================================================
-- DONE!
-- ============================================================
--
-- Next steps:
-- 1. Update Prisma schema (see instructions below)
-- 2. Run: npx prisma generate
-- 3. Restart the backend
--
