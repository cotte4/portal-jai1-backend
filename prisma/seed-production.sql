-- =============================================
-- PRODUCTION SEED DATA FOR PORTAL JAI1
-- Run this in Supabase SQL Editor
-- =============================================

-- Password for all test clients: Client123!
-- Password hash: $2b$10$Ook.8z4Y2rFxdqLghTXjsegmOqGWg37FcnW.jyeWENpOqCI33eeLK

-- =============================================
-- 1. CREATE TEST CLIENTS (5 users)
-- =============================================

INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active, phone, created_at, updated_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'maria.garcia@test.com', '$2b$10$Ook.8z4Y2rFxdqLghTXjsegmOqGWg37FcnW.jyeWENpOqCI33eeLK', 'Maria', 'Garcia', 'client', true, '+1234567001', NOW() - INTERVAL '30 days', NOW()),
  ('22222222-2222-2222-2222-222222222222', 'juan.rodriguez@test.com', '$2b$10$Ook.8z4Y2rFxdqLghTXjsegmOqGWg37FcnW.jyeWENpOqCI33eeLK', 'Juan', 'Rodriguez', 'client', true, '+1234567002', NOW() - INTERVAL '25 days', NOW()),
  ('33333333-3333-3333-3333-333333333333', 'ana.martinez@test.com', '$2b$10$Ook.8z4Y2rFxdqLghTXjsegmOqGWg37FcnW.jyeWENpOqCI33eeLK', 'Ana', 'Martinez', 'client', true, '+1234567003', NOW() - INTERVAL '20 days', NOW()),
  ('44444444-4444-4444-4444-444444444444', 'carlos.lopez@test.com', '$2b$10$Ook.8z4Y2rFxdqLghTXjsegmOqGWg37FcnW.jyeWENpOqCI33eeLK', 'Carlos', 'Lopez', 'client', true, '+1234567004', NOW() - INTERVAL '15 days', NOW()),
  ('55555555-5555-5555-5555-555555555555', 'laura.sanchez@test.com', '$2b$10$Ook.8z4Y2rFxdqLghTXjsegmOqGWg37FcnW.jyeWENpOqCI33eeLK', 'Laura', 'Sanchez', 'client', true, '+1234567005', NOW() - INTERVAL '10 days', NOW());

-- =============================================
-- 2. CREATE CLIENT PROFILES
-- =============================================

INSERT INTO client_profiles (id, user_id, profile_complete, ssn_encrypted, address_encrypted, bank_info_encrypted, created_at, updated_at) VALUES
  ('aaaa1111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', true, 'encrypted_ssn_1', '{"street": "123 Main St", "city": "Miami", "state": "FL", "zip": "33101"}', '{"routing": "****1234", "account": "****5678"}', NOW() - INTERVAL '30 days', NOW()),
  ('aaaa2222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', true, 'encrypted_ssn_2', '{"street": "456 Oak Ave", "city": "Houston", "state": "TX", "zip": "77001"}', '{"routing": "****2345", "account": "****6789"}', NOW() - INTERVAL '25 days', NOW()),
  ('aaaa3333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', true, 'encrypted_ssn_3', '{"street": "789 Pine Rd", "city": "Chicago", "state": "IL", "zip": "60601"}', '{"routing": "****3456", "account": "****7890"}', NOW() - INTERVAL '20 days', NOW()),
  ('aaaa4444-4444-4444-4444-444444444444', '44444444-4444-4444-4444-444444444444', false, NULL, NULL, NULL, NOW() - INTERVAL '15 days', NOW()),
  ('aaaa5555-5555-5555-5555-555555555555', '55555555-5555-5555-5555-555555555555', false, NULL, NULL, NULL, NOW() - INTERVAL '10 days', NOW());

-- =============================================
-- 3. CREATE TAX CASES
-- =============================================

INSERT INTO tax_cases (id, client_profile_id, tax_year, pre_filing_status, internal_status, payment_received, status_updated_at, created_at, updated_at) VALUES
  ('bbbb1111-1111-1111-1111-111111111111', 'aaaa1111-1111-1111-1111-111111111111', 2024, 'documentation_complete', 'in_review', true, NOW() - INTERVAL '5 days', NOW() - INTERVAL '30 days', NOW()),
  ('bbbb2222-2222-2222-2222-222222222222', 'aaaa2222-2222-2222-2222-222222222222', 2024, 'documentation_complete', 'preparing_return', true, NOW() - INTERVAL '3 days', NOW() - INTERVAL '25 days', NOW()),
  ('bbbb3333-3333-3333-3333-333333333333', 'aaaa3333-3333-3333-3333-333333333333', 2024, 'awaiting_documents', 'new', false, NOW() - INTERVAL '2 days', NOW() - INTERVAL '20 days', NOW()),
  ('bbbb4444-4444-4444-4444-444444444444', 'aaaa4444-4444-4444-4444-444444444444', 2024, 'awaiting_registration', 'new', false, NOW() - INTERVAL '1 day', NOW() - INTERVAL '15 days', NOW()),
  ('bbbb5555-5555-5555-5555-555555555555', 'aaaa5555-5555-5555-5555-555555555555', 2024, 'awaiting_registration', 'new', false, NOW(), NOW() - INTERVAL '10 days', NOW());

-- =============================================
-- 4. CREATE SAMPLE DOCUMENTS
-- =============================================

INSERT INTO documents (id, tax_case_id, type, file_name, storage_path, mime_type, file_size, tax_year, is_reviewed, uploaded_at) VALUES
  ('cccc1111-1111-1111-1111-111111111111', 'bbbb1111-1111-1111-1111-111111111111', 'w2', 'w2-2024-maria.pdf', 'users/11111111/documents/2024/w2/w2-2024.pdf', 'application/pdf', 102400, 2024, true, NOW() - INTERVAL '28 days'),
  ('cccc1112-1111-1111-1111-111111111111', 'bbbb1111-1111-1111-1111-111111111111', 'id', 'id-maria.pdf', 'users/11111111/documents/2024/id/id.pdf', 'application/pdf', 51200, 2024, true, NOW() - INTERVAL '27 days'),
  ('cccc1113-1111-1111-1111-111111111111', 'bbbb1111-1111-1111-1111-111111111111', 'payment_proof', 'payment-maria.pdf', 'users/11111111/documents/2024/payment/payment.pdf', 'application/pdf', 25600, 2024, true, NOW() - INTERVAL '26 days'),
  ('cccc2221-2222-2222-2222-222222222222', 'bbbb2222-2222-2222-2222-222222222222', 'w2', 'w2-2024-juan.pdf', 'users/22222222/documents/2024/w2/w2-2024.pdf', 'application/pdf', 98304, 2024, true, NOW() - INTERVAL '23 days'),
  ('cccc2222-2222-2222-2222-222222222222', 'bbbb2222-2222-2222-2222-222222222222', 'id', 'id-juan.jpg', 'users/22222222/documents/2024/id/id.jpg', 'image/jpeg', 204800, 2024, true, NOW() - INTERVAL '22 days'),
  ('cccc2223-2222-2222-2222-222222222222', 'bbbb2222-2222-2222-2222-222222222222', 'payment_proof', 'payment-juan.pdf', 'users/22222222/documents/2024/payment/payment.pdf', 'application/pdf', 30720, 2024, false, NOW() - INTERVAL '21 days'),
  ('cccc3331-3333-3333-3333-333333333333', 'bbbb3333-3333-3333-3333-333333333333', 'w2', 'w2-2024-ana.pdf', 'users/33333333/documents/2024/w2/w2-2024.pdf', 'application/pdf', 112640, 2024, false, NOW() - INTERVAL '18 days');

-- =============================================
-- 5. CREATE SAMPLE TICKETS
-- =============================================

INSERT INTO tickets (id, user_id, subject, status, priority, created_at, updated_at) VALUES
  ('dddd1111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Question about my refund status', 'open', 'medium', NOW() - INTERVAL '5 days', NOW() - INTERVAL '1 day'),
  ('dddd2222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'Need help uploading W2', 'resolved', 'low', NOW() - INTERVAL '20 days', NOW() - INTERVAL '18 days'),
  ('dddd3333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', 'Missing document notification', 'open', 'high', NOW() - INTERVAL '2 days', NOW());

-- =============================================
-- 6. CREATE TICKET MESSAGES
-- =============================================

INSERT INTO ticket_messages (id, ticket_id, user_id, content, is_internal, created_at) VALUES
  ('eeee1111-1111-1111-1111-111111111111', 'dddd1111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Hi, I wanted to know when I can expect my refund. My documents were submitted 3 weeks ago.', false, NOW() - INTERVAL '5 days'),
  ('eeee1112-1111-1111-1111-111111111111', 'dddd1111-1111-1111-1111-111111111111', NULL, 'Hello Maria, thank you for reaching out. Your return is currently being reviewed. We expect to have an update within 5-7 business days.', false, NOW() - INTERVAL '4 days'),
  ('eeee1113-1111-1111-1111-111111111111', 'dddd1111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Thank you for the update!', false, NOW() - INTERVAL '1 day'),
  ('eeee2221-2222-2222-2222-222222222222', 'dddd2222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'I am having trouble uploading my W2 form. The page shows an error.', false, NOW() - INTERVAL '20 days'),
  ('eeee2222-2222-2222-2222-222222222222', 'dddd2222-2222-2222-2222-222222222222', NULL, 'Hi Juan, please make sure your file is a PDF or image (JPG/PNG) and under 10MB. Try clearing your browser cache and uploading again.', false, NOW() - INTERVAL '19 days'),
  ('eeee2223-2222-2222-2222-222222222222', 'dddd2222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'That worked! Thank you so much.', false, NOW() - INTERVAL '18 days'),
  ('eeee3331-3333-3333-3333-333333333333', 'dddd3333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', 'I received a notification about missing documents but I already uploaded everything. Please check.', false, NOW() - INTERVAL '2 days');

-- =============================================
-- 7. CREATE NOTIFICATIONS
-- =============================================

INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at) VALUES
  ('ffff1111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'status_change', 'Status Update', 'Your tax case status has been updated to: In Review', true, NOW() - INTERVAL '5 days'),
  ('ffff1112-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'system', 'Document Reviewed', 'Your W2 document has been reviewed and approved.', true, NOW() - INTERVAL '10 days'),
  ('ffff2221-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'status_change', 'Status Update', 'Your tax case status has been updated to: Preparing Return', false, NOW() - INTERVAL '3 days'),
  ('ffff3331-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', 'docs_missing', 'Documentos pendientes', 'Hola Ana, para continuar con tu declaracion necesitas: subir comprobante de pago.', false, NOW() - INTERVAL '2 days'),
  ('ffff4441-4444-4444-4444-444444444444', '44444444-4444-4444-4444-444444444444', 'docs_missing', 'Documentos pendientes', 'Hola Carlos, para continuar necesitas: completar tu perfil y subir tu documento W2.', false, NOW() - INTERVAL '1 day'),
  ('ffff5551-5555-5555-5555-555555555555', '55555555-5555-5555-5555-555555555555', 'system', 'Bienvenido', 'Bienvenido a JAI1! Completa tu perfil para comenzar.', false, NOW() - INTERVAL '10 days');

-- =============================================
-- 8. CREATE REFERRALS (optional)
-- =============================================

INSERT INTO referrals (id, referrer_id, referred_id, referral_code, status, created_at, updated_at) VALUES
  ('gggg1111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'MARIA2024', 'completed', NOW() - INTERVAL '20 days', NOW() - INTERVAL '20 days');

-- Update Maria's referral code
UPDATE users SET referral_code = 'MARIA2024', referral_code_created_at = NOW() - INTERVAL '30 days' WHERE id = '11111111-1111-1111-1111-111111111111';
UPDATE users SET referred_by_code = 'MARIA2024' WHERE id = '33333333-3333-3333-3333-333333333333';

-- =============================================
-- DONE! Test accounts created:
--
-- CLIENTS (password: Client123!)
-- - maria.garcia@test.com (complete profile, docs uploaded)
-- - juan.rodriguez@test.com (complete profile, in progress)
-- - ana.martinez@test.com (complete profile, awaiting docs)
-- - carlos.lopez@test.com (incomplete profile)
-- - laura.sanchez@test.com (incomplete profile)
-- =============================================
