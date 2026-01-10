-- ============================================================
-- Complete UUID Migration - All 12 Tables
-- ============================================================
-- This script converts all ID columns from TEXT to native UUID.
-- Run this in Supabase SQL Editor or via Prisma.
-- ============================================================

-- ============================================================
-- STEP 1: Drop ALL foreign key constraints
-- ============================================================

-- Original 9 tables
ALTER TABLE client_profiles DROP CONSTRAINT IF EXISTS client_profiles_user_id_fkey;
ALTER TABLE tax_cases DROP CONSTRAINT IF EXISTS tax_cases_client_profile_id_fkey;
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_tax_case_id_fkey;
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_user_id_fkey;
ALTER TABLE ticket_messages DROP CONSTRAINT IF EXISTS ticket_messages_ticket_id_fkey;
ALTER TABLE ticket_messages DROP CONSTRAINT IF EXISTS ticket_messages_sender_id_fkey;
ALTER TABLE status_history DROP CONSTRAINT IF EXISTS status_history_tax_case_id_fkey;
ALTER TABLE status_history DROP CONSTRAINT IF EXISTS status_history_changed_by_id_fkey;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_user_id_fkey;
ALTER TABLE w2_estimates DROP CONSTRAINT IF EXISTS w2_estimates_user_id_fkey;
ALTER TABLE w2_estimates DROP CONSTRAINT IF EXISTS w2_estimates_tax_case_id_fkey;

-- New 3 tables
ALTER TABLE referrals DROP CONSTRAINT IF EXISTS referrals_referrer_id_fkey;
ALTER TABLE referrals DROP CONSTRAINT IF EXISTS referrals_referred_user_id_fkey;
ALTER TABLE discount_applications DROP CONSTRAINT IF EXISTS discount_applications_user_id_fkey;
ALTER TABLE discount_applications DROP CONSTRAINT IF EXISTS discount_applications_applied_by_admin_id_fkey;
ALTER TABLE discount_applications DROP CONSTRAINT IF EXISTS discount_applications_referral_id_fkey;
-- audit_logs has NO FK constraints by design

-- ============================================================
-- STEP 2: Convert ALL primary key columns to UUID
-- ============================================================

ALTER TABLE users ALTER COLUMN id TYPE uuid USING id::uuid;
ALTER TABLE client_profiles ALTER COLUMN id TYPE uuid USING id::uuid;
ALTER TABLE tax_cases ALTER COLUMN id TYPE uuid USING id::uuid;
ALTER TABLE documents ALTER COLUMN id TYPE uuid USING id::uuid;
ALTER TABLE tickets ALTER COLUMN id TYPE uuid USING id::uuid;
ALTER TABLE ticket_messages ALTER COLUMN id TYPE uuid USING id::uuid;
ALTER TABLE status_history ALTER COLUMN id TYPE uuid USING id::uuid;
ALTER TABLE notifications ALTER COLUMN id TYPE uuid USING id::uuid;
ALTER TABLE w2_estimates ALTER COLUMN id TYPE uuid USING id::uuid;
ALTER TABLE referrals ALTER COLUMN id TYPE uuid USING id::uuid;
ALTER TABLE discount_applications ALTER COLUMN id TYPE uuid USING id::uuid;
ALTER TABLE audit_logs ALTER COLUMN id TYPE uuid USING id::uuid;

-- ============================================================
-- STEP 3: Convert ALL foreign key columns to UUID
-- ============================================================

-- client_profiles
ALTER TABLE client_profiles ALTER COLUMN user_id TYPE uuid USING user_id::uuid;

-- tax_cases
ALTER TABLE tax_cases ALTER COLUMN client_profile_id TYPE uuid USING client_profile_id::uuid;

-- documents
ALTER TABLE documents ALTER COLUMN tax_case_id TYPE uuid USING tax_case_id::uuid;

-- tickets
ALTER TABLE tickets ALTER COLUMN user_id TYPE uuid USING user_id::uuid;

-- ticket_messages
ALTER TABLE ticket_messages ALTER COLUMN ticket_id TYPE uuid USING ticket_id::uuid;
ALTER TABLE ticket_messages ALTER COLUMN sender_id TYPE uuid USING sender_id::uuid;

-- status_history
ALTER TABLE status_history ALTER COLUMN tax_case_id TYPE uuid USING tax_case_id::uuid;
ALTER TABLE status_history ALTER COLUMN changed_by_id TYPE uuid USING changed_by_id::uuid;

-- notifications
ALTER TABLE notifications ALTER COLUMN user_id TYPE uuid USING user_id::uuid;

-- w2_estimates
ALTER TABLE w2_estimates ALTER COLUMN user_id TYPE uuid USING user_id::uuid;
ALTER TABLE w2_estimates ALTER COLUMN tax_case_id TYPE uuid USING tax_case_id::uuid;

-- referrals
ALTER TABLE referrals ALTER COLUMN referrer_id TYPE uuid USING referrer_id::uuid;
ALTER TABLE referrals ALTER COLUMN referred_user_id TYPE uuid USING referred_user_id::uuid;
ALTER TABLE referrals ALTER COLUMN tax_case_id TYPE uuid USING tax_case_id::uuid;

-- discount_applications
ALTER TABLE discount_applications ALTER COLUMN user_id TYPE uuid USING user_id::uuid;
ALTER TABLE discount_applications ALTER COLUMN tax_case_id TYPE uuid USING tax_case_id::uuid;
ALTER TABLE discount_applications ALTER COLUMN referral_id TYPE uuid USING referral_id::uuid;
ALTER TABLE discount_applications ALTER COLUMN applied_by_admin_id TYPE uuid USING applied_by_admin_id::uuid;

-- audit_logs
ALTER TABLE audit_logs ALTER COLUMN user_id TYPE uuid USING user_id::uuid;
ALTER TABLE audit_logs ALTER COLUMN target_user_id TYPE uuid USING target_user_id::uuid;

-- ============================================================
-- STEP 4: Set default value for ALL primary keys
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
ALTER TABLE referrals ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE discount_applications ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE audit_logs ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- ============================================================
-- STEP 5: Recreate ALL foreign key constraints
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

-- ticket_messages -> users (sender) - SET NULL to preserve messages
ALTER TABLE ticket_messages
  ADD CONSTRAINT ticket_messages_sender_id_fkey
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL;

-- status_history -> tax_cases
ALTER TABLE status_history
  ADD CONSTRAINT status_history_tax_case_id_fkey
  FOREIGN KEY (tax_case_id) REFERENCES tax_cases(id) ON DELETE CASCADE;

-- status_history -> users (changed_by) - SET NULL to preserve audit
ALTER TABLE status_history
  ADD CONSTRAINT status_history_changed_by_id_fkey
  FOREIGN KEY (changed_by_id) REFERENCES users(id) ON DELETE SET NULL;

-- notifications -> users
ALTER TABLE notifications
  ADD CONSTRAINT notifications_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- w2_estimates -> users
ALTER TABLE w2_estimates
  ADD CONSTRAINT w2_estimates_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- w2_estimates -> tax_cases (optional)
ALTER TABLE w2_estimates
  ADD CONSTRAINT w2_estimates_tax_case_id_fkey
  FOREIGN KEY (tax_case_id) REFERENCES tax_cases(id) ON DELETE SET NULL;

-- referrals -> users (referrer)
ALTER TABLE referrals
  ADD CONSTRAINT referrals_referrer_id_fkey
  FOREIGN KEY (referrer_id) REFERENCES users(id) ON DELETE CASCADE;

-- referrals -> users (referred)
ALTER TABLE referrals
  ADD CONSTRAINT referrals_referred_user_id_fkey
  FOREIGN KEY (referred_user_id) REFERENCES users(id) ON DELETE CASCADE;

-- discount_applications -> users
ALTER TABLE discount_applications
  ADD CONSTRAINT discount_applications_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- discount_applications -> users (applied_by_admin) - SET NULL
ALTER TABLE discount_applications
  ADD CONSTRAINT discount_applications_applied_by_admin_id_fkey
  FOREIGN KEY (applied_by_admin_id) REFERENCES users(id) ON DELETE SET NULL;

-- discount_applications -> referrals (referral_id) - SET NULL
ALTER TABLE discount_applications
  ADD CONSTRAINT discount_applications_referral_id_fkey
  FOREIGN KEY (referral_id) REFERENCES referrals(id) ON DELETE SET NULL;

-- audit_logs: NO FK constraints (by design - logs persist after user deletion)

-- ============================================================
-- DONE! Verify the changes below.
-- ============================================================
