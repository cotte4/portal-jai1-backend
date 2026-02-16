-- ============================================================
-- Input Data 1: Update existing clients' TaxCase data
-- Updates: caseStatus, federalStatusNew, stateStatusNew,
--          federalActualRefund, stateActualRefund,
--          taxesFiled, taxesFiledAt, estimatedRefund
-- Matches by: User firstName + lastName (case-insensitive)
-- ============================================================
-- Run with: psql $DATABASE_URL -f scripts/sql/update-client-data-input1.sql
-- Or paste into Supabase SQL Editor
-- ============================================================

BEGIN;

-- Helper: Update tax case for a client matched by name
-- Each block: find user by name -> find client_profile -> find latest tax_case -> update

-- 1. Maria Constanza Farre Abelenda — filed 2026-01-27, fed $1215, state $738
UPDATE tax_cases SET
  case_status = 'taxes_filed',
  case_status_changed_at = '2026-01-27'::timestamptz,
  taxes_filed = true,
  taxes_filed_at = '2026-01-27'::timestamptz,
  federal_status_new = 'taxes_en_proceso',
  federal_status_new_changed_at = '2026-01-27'::timestamptz,
  state_status_new = 'taxes_en_proceso',
  state_status_new_changed_at = '2026-01-27'::timestamptz,
  federal_actual_refund = 1215,
  state_actual_refund = 738,
  estimated_refund = 1953,
  status_updated_at = NOW()
WHERE client_profile_id = (
  SELECT cp.id FROM client_profiles cp
  JOIN users u ON u.id = cp.user_id
  WHERE LOWER(TRIM(u.first_name)) = 'maria constanza' AND LOWER(TRIM(u.last_name)) = 'farre abelenda'
  LIMIT 1
) AND tax_year = 2026;

-- 2. Ariana Sangiuliano — filed 2026-01-27, fed $1060, state $750
UPDATE tax_cases SET
  case_status = 'taxes_filed',
  case_status_changed_at = '2026-01-27'::timestamptz,
  taxes_filed = true,
  taxes_filed_at = '2026-01-27'::timestamptz,
  federal_status_new = 'taxes_en_proceso',
  federal_status_new_changed_at = '2026-01-27'::timestamptz,
  state_status_new = 'taxes_en_proceso',
  state_status_new_changed_at = '2026-01-27'::timestamptz,
  federal_actual_refund = 1060,
  state_actual_refund = 750,
  estimated_refund = 1810,
  status_updated_at = NOW()
WHERE client_profile_id = (
  SELECT cp.id FROM client_profiles cp
  JOIN users u ON u.id = cp.user_id
  WHERE LOWER(TRIM(u.first_name)) = 'ariana' AND LOWER(TRIM(u.last_name)) = 'sangiuliano'
  LIMIT 1
) AND tax_year = 2026;

-- 3. Luis Guerrero — filed 2026-01-27, fed $1210, state $606
UPDATE tax_cases SET
  case_status = 'taxes_filed',
  case_status_changed_at = '2026-01-27'::timestamptz,
  taxes_filed = true,
  taxes_filed_at = '2026-01-27'::timestamptz,
  federal_status_new = 'taxes_en_proceso',
  federal_status_new_changed_at = '2026-01-27'::timestamptz,
  state_status_new = 'taxes_en_proceso',
  state_status_new_changed_at = '2026-01-27'::timestamptz,
  federal_actual_refund = 1210,
  state_actual_refund = 606,
  estimated_refund = 1816,
  status_updated_at = NOW()
WHERE client_profile_id = (
  SELECT cp.id FROM client_profiles cp
  JOIN users u ON u.id = cp.user_id
  WHERE LOWER(TRIM(u.first_name)) = 'luis' AND LOWER(TRIM(u.last_name)) = 'guerrero'
  LIMIT 1
) AND tax_year = 2026;

-- 4. Bruno Héctor Alejandro Vergara Vidal — filed 2026-01-28, fed $1903, state $538
UPDATE tax_cases SET
  case_status = 'taxes_filed',
  case_status_changed_at = '2026-01-28'::timestamptz,
  taxes_filed = true,
  taxes_filed_at = '2026-01-28'::timestamptz,
  federal_status_new = 'taxes_en_proceso',
  federal_status_new_changed_at = '2026-01-28'::timestamptz,
  state_status_new = 'taxes_en_proceso',
  state_status_new_changed_at = '2026-01-28'::timestamptz,
  federal_actual_refund = 1903,
  state_actual_refund = 538,
  estimated_refund = 2441,
  status_updated_at = NOW()
WHERE client_profile_id = (
  SELECT cp.id FROM client_profiles cp
  JOIN users u ON u.id = cp.user_id
  WHERE LOWER(TRIM(u.last_name)) LIKE '%vergara vidal%'
  LIMIT 1
) AND tax_year = 2026;

-- 5. Vanesa Enriqueta Rivera Peñaloza — filed 2026-01-27, fed $1346, state $693
UPDATE tax_cases SET
  case_status = 'taxes_filed',
  case_status_changed_at = '2026-01-27'::timestamptz,
  taxes_filed = true,
  taxes_filed_at = '2026-01-27'::timestamptz,
  federal_status_new = 'taxes_en_proceso',
  federal_status_new_changed_at = '2026-01-27'::timestamptz,
  state_status_new = 'taxes_en_proceso',
  state_status_new_changed_at = '2026-01-27'::timestamptz,
  federal_actual_refund = 1346,
  state_actual_refund = 693,
  estimated_refund = 2039,
  status_updated_at = NOW()
WHERE client_profile_id = (
  SELECT cp.id FROM client_profiles cp
  JOIN users u ON u.id = cp.user_id
  WHERE LOWER(TRIM(u.last_name)) LIKE '%rivera pe%aloza%'
  LIMIT 1
) AND tax_year = 2026;

-- 6. Juan Ignacio Alonso — filed 2026-01-27, fed $171, state $357
UPDATE tax_cases SET
  case_status = 'taxes_filed',
  case_status_changed_at = '2026-01-27'::timestamptz,
  taxes_filed = true,
  taxes_filed_at = '2026-01-27'::timestamptz,
  federal_status_new = 'taxes_en_proceso',
  federal_status_new_changed_at = '2026-01-27'::timestamptz,
  state_status_new = 'taxes_en_proceso',
  state_status_new_changed_at = '2026-01-27'::timestamptz,
  federal_actual_refund = 171,
  state_actual_refund = 357,
  estimated_refund = 528,
  status_updated_at = NOW()
WHERE client_profile_id = (
  SELECT cp.id FROM client_profiles cp
  JOIN users u ON u.id = cp.user_id
  WHERE LOWER(TRIM(u.first_name)) LIKE '%juan ignacio%' AND LOWER(TRIM(u.last_name)) = 'alonso'
  LIMIT 1
) AND tax_year = 2026;

-- 7. Belen Curutchet — filed 2026-02-03, fed $963, state $448
UPDATE tax_cases SET
  case_status = 'taxes_filed',
  case_status_changed_at = '2026-02-03'::timestamptz,
  taxes_filed = true,
  taxes_filed_at = '2026-02-03'::timestamptz,
  federal_status_new = 'taxes_en_proceso',
  federal_status_new_changed_at = '2026-02-03'::timestamptz,
  state_status_new = 'taxes_en_proceso',
  state_status_new_changed_at = '2026-02-03'::timestamptz,
  federal_actual_refund = 963,
  state_actual_refund = 448,
  estimated_refund = 1411,
  status_updated_at = NOW()
WHERE client_profile_id = (
  SELECT cp.id FROM client_profiles cp
  JOIN users u ON u.id = cp.user_id
  WHERE LOWER(TRIM(u.last_name)) = 'curutchet'
  LIMIT 1
) AND tax_year = 2026;

-- 8. Manuel Sascaro — filed 2026-02-03, fed $543, state $176
UPDATE tax_cases SET
  case_status = 'taxes_filed',
  case_status_changed_at = '2026-02-03'::timestamptz,
  taxes_filed = true,
  taxes_filed_at = '2026-02-03'::timestamptz,
  federal_status_new = 'taxes_en_proceso',
  federal_status_new_changed_at = '2026-02-03'::timestamptz,
  state_status_new = 'taxes_en_proceso',
  state_status_new_changed_at = '2026-02-03'::timestamptz,
  federal_actual_refund = 543,
  state_actual_refund = 176,
  estimated_refund = 719,
  status_updated_at = NOW()
WHERE client_profile_id = (
  SELECT cp.id FROM client_profiles cp
  JOIN users u ON u.id = cp.user_id
  WHERE LOWER(TRIM(u.last_name)) = 'sascaro'
  LIMIT 1
) AND tax_year = 2026;

-- 9. Valentino Garcia Crocitta — filed 2026-02-03, fed $1338, state $429
UPDATE tax_cases SET
  case_status = 'taxes_filed',
  case_status_changed_at = '2026-02-03'::timestamptz,
  taxes_filed = true,
  taxes_filed_at = '2026-02-03'::timestamptz,
  federal_status_new = 'taxes_en_proceso',
  federal_status_new_changed_at = '2026-02-03'::timestamptz,
  state_status_new = 'taxes_en_proceso',
  state_status_new_changed_at = '2026-02-03'::timestamptz,
  federal_actual_refund = 1338,
  state_actual_refund = 429,
  estimated_refund = 1767,
  status_updated_at = NOW()
WHERE client_profile_id = (
  SELECT cp.id FROM client_profiles cp
  JOIN users u ON u.id = cp.user_id
  WHERE LOWER(TRIM(u.last_name)) LIKE '%garcia crocitta%'
  LIMIT 1
) AND tax_year = 2026;

-- 10. Lautaro Ezequiel Perez — filed 2026-02-10, fed $1542, state $693
UPDATE tax_cases SET
  case_status = 'taxes_filed',
  case_status_changed_at = '2026-02-10'::timestamptz,
  taxes_filed = true,
  taxes_filed_at = '2026-02-10'::timestamptz,
  federal_status_new = 'taxes_en_proceso',
  federal_status_new_changed_at = '2026-02-10'::timestamptz,
  state_status_new = 'taxes_en_proceso',
  state_status_new_changed_at = '2026-02-10'::timestamptz,
  federal_actual_refund = 1542,
  state_actual_refund = 693,
  estimated_refund = 2235,
  status_updated_at = NOW()
WHERE client_profile_id = (
  SELECT cp.id FROM client_profiles cp
  JOIN users u ON u.id = cp.user_id
  WHERE LOWER(TRIM(u.last_name)) = 'perez' AND LOWER(TRIM(u.first_name)) LIKE '%lautaro%'
  LIMIT 1
) AND tax_year = 2026;

-- 11. Juan Cruz Ceballos — filed 2026-02-08, fed $1543, state $395
UPDATE tax_cases SET
  case_status = 'taxes_filed',
  case_status_changed_at = '2026-02-08'::timestamptz,
  taxes_filed = true,
  taxes_filed_at = '2026-02-08'::timestamptz,
  federal_status_new = 'taxes_en_proceso',
  federal_status_new_changed_at = '2026-02-08'::timestamptz,
  state_status_new = 'taxes_en_proceso',
  state_status_new_changed_at = '2026-02-08'::timestamptz,
  federal_actual_refund = 1543,
  state_actual_refund = 395,
  estimated_refund = 1938,
  status_updated_at = NOW()
WHERE client_profile_id = (
  SELECT cp.id FROM client_profiles cp
  JOIN users u ON u.id = cp.user_id
  WHERE LOWER(TRIM(u.last_name)) = 'ceballos'
  LIMIT 1
) AND tax_year = 2026;

-- 12. Lara Romero — filed 2026-02-15, fed $1226, state $597
UPDATE tax_cases SET
  case_status = 'taxes_filed',
  case_status_changed_at = '2026-02-15'::timestamptz,
  taxes_filed = true,
  taxes_filed_at = '2026-02-15'::timestamptz,
  federal_status_new = 'taxes_en_proceso',
  federal_status_new_changed_at = '2026-02-15'::timestamptz,
  state_status_new = 'taxes_en_proceso',
  state_status_new_changed_at = '2026-02-15'::timestamptz,
  federal_actual_refund = 1226,
  state_actual_refund = 597,
  estimated_refund = 1823,
  status_updated_at = NOW()
WHERE client_profile_id = (
  SELECT cp.id FROM client_profiles cp
  JOIN users u ON u.id = cp.user_id
  WHERE LOWER(TRIM(u.first_name)) = 'lara' AND LOWER(TRIM(u.last_name)) = 'romero'
  LIMIT 1
) AND tax_year = 2026;

-- 13. Segundo Soto Ansay — filed 2026-02-10, fed $1194, state $395
UPDATE tax_cases SET
  case_status = 'taxes_filed',
  case_status_changed_at = '2026-02-10'::timestamptz,
  taxes_filed = true,
  taxes_filed_at = '2026-02-10'::timestamptz,
  federal_status_new = 'taxes_en_proceso',
  federal_status_new_changed_at = '2026-02-10'::timestamptz,
  state_status_new = 'taxes_en_proceso',
  state_status_new_changed_at = '2026-02-10'::timestamptz,
  federal_actual_refund = 1194,
  state_actual_refund = 395,
  estimated_refund = 1589,
  status_updated_at = NOW()
WHERE client_profile_id = (
  SELECT cp.id FROM client_profiles cp
  JOIN users u ON u.id = cp.user_id
  WHERE LOWER(TRIM(u.last_name)) LIKE '%soto ansay%'
  LIMIT 1
) AND tax_year = 2026;

-- 14. Aisha Mariam Auday Cruz — filed 2026-02-12, fed $1035, state $703
UPDATE tax_cases SET
  case_status = 'taxes_filed',
  case_status_changed_at = '2026-02-12'::timestamptz,
  taxes_filed = true,
  taxes_filed_at = '2026-02-12'::timestamptz,
  federal_status_new = 'taxes_en_proceso',
  federal_status_new_changed_at = '2026-02-12'::timestamptz,
  state_status_new = 'taxes_en_proceso',
  state_status_new_changed_at = '2026-02-12'::timestamptz,
  federal_actual_refund = 1035,
  state_actual_refund = 703,
  estimated_refund = 1738,
  status_updated_at = NOW()
WHERE client_profile_id = (
  SELECT cp.id FROM client_profiles cp
  JOIN users u ON u.id = cp.user_id
  WHERE LOWER(TRIM(u.first_name)) LIKE '%aisha%' AND LOWER(TRIM(u.last_name)) LIKE '%auday%'
  LIMIT 1
) AND tax_year = 2026;

-- 15. Francisco Villamayor — filed 2026-02-12, fed $508, state $669
UPDATE tax_cases SET
  case_status = 'taxes_filed',
  case_status_changed_at = '2026-02-12'::timestamptz,
  taxes_filed = true,
  taxes_filed_at = '2026-02-12'::timestamptz,
  federal_status_new = 'taxes_en_proceso',
  federal_status_new_changed_at = '2026-02-12'::timestamptz,
  state_status_new = 'taxes_en_proceso',
  state_status_new_changed_at = '2026-02-12'::timestamptz,
  federal_actual_refund = 508,
  state_actual_refund = 669,
  estimated_refund = 1177,
  status_updated_at = NOW()
WHERE client_profile_id = (
  SELECT cp.id FROM client_profiles cp
  JOIN users u ON u.id = cp.user_id
  WHERE LOWER(TRIM(u.last_name)) = 'villamayor'
  LIMIT 1
) AND tax_year = 2026;

-- 16. Otto Kraus — en preparacion (no filing date, no refund amounts)
UPDATE tax_cases SET
  case_status = 'preparing',
  case_status_changed_at = NOW(),
  status_updated_at = NOW()
WHERE client_profile_id = (
  SELECT cp.id FROM client_profiles cp
  JOIN users u ON u.id = cp.user_id
  WHERE LOWER(TRIM(u.last_name)) = 'kraus'
  LIMIT 1
) AND tax_year = 2026;

-- 17. Lara Mariam Auday Cruz — filed 2026-02-13, fed $583, state $698
UPDATE tax_cases SET
  case_status = 'taxes_filed',
  case_status_changed_at = '2026-02-13'::timestamptz,
  taxes_filed = true,
  taxes_filed_at = '2026-02-13'::timestamptz,
  federal_status_new = 'taxes_en_proceso',
  federal_status_new_changed_at = '2026-02-13'::timestamptz,
  state_status_new = 'taxes_en_proceso',
  state_status_new_changed_at = '2026-02-13'::timestamptz,
  federal_actual_refund = 583,
  state_actual_refund = 698,
  estimated_refund = 1281,
  status_updated_at = NOW()
WHERE client_profile_id = (
  SELECT cp.id FROM client_profiles cp
  JOIN users u ON u.id = cp.user_id
  WHERE LOWER(TRIM(u.first_name)) LIKE '%lara%' AND LOWER(TRIM(u.last_name)) LIKE '%auday%'
  LIMIT 1
) AND tax_year = 2026;

-- 18. Martina Busco Saldias — filed 2026-02-12, fed $1038, state $341
UPDATE tax_cases SET
  case_status = 'taxes_filed',
  case_status_changed_at = '2026-02-12'::timestamptz,
  taxes_filed = true,
  taxes_filed_at = '2026-02-12'::timestamptz,
  federal_status_new = 'taxes_en_proceso',
  federal_status_new_changed_at = '2026-02-12'::timestamptz,
  state_status_new = 'taxes_en_proceso',
  state_status_new_changed_at = '2026-02-12'::timestamptz,
  federal_actual_refund = 1038,
  state_actual_refund = 341,
  estimated_refund = 1379,
  status_updated_at = NOW()
WHERE client_profile_id = (
  SELECT cp.id FROM client_profiles cp
  JOIN users u ON u.id = cp.user_id
  WHERE LOWER(TRIM(u.last_name)) LIKE '%busco saldias%'
  LIMIT 1
) AND tax_year = 2026;

-- 19. Tomas Martinez Aguero — filed 2026-02-10, fed $1387, state $741
UPDATE tax_cases SET
  case_status = 'taxes_filed',
  case_status_changed_at = '2026-02-10'::timestamptz,
  taxes_filed = true,
  taxes_filed_at = '2026-02-10'::timestamptz,
  federal_status_new = 'taxes_en_proceso',
  federal_status_new_changed_at = '2026-02-10'::timestamptz,
  state_status_new = 'taxes_en_proceso',
  state_status_new_changed_at = '2026-02-10'::timestamptz,
  federal_actual_refund = 1387,
  state_actual_refund = 741,
  estimated_refund = 2128,
  status_updated_at = NOW()
WHERE client_profile_id = (
  SELECT cp.id FROM client_profiles cp
  JOIN users u ON u.id = cp.user_id
  WHERE LOWER(TRIM(u.last_name)) LIKE '%martinez aguero%'
  LIMIT 1
) AND tax_year = 2026;

-- 20. Ana Sara Pasini Bistolfi — filed 2026-02-10, fed $1347, state $356
UPDATE tax_cases SET
  case_status = 'taxes_filed',
  case_status_changed_at = '2026-02-10'::timestamptz,
  taxes_filed = true,
  taxes_filed_at = '2026-02-10'::timestamptz,
  federal_status_new = 'taxes_en_proceso',
  federal_status_new_changed_at = '2026-02-10'::timestamptz,
  state_status_new = 'taxes_en_proceso',
  state_status_new_changed_at = '2026-02-10'::timestamptz,
  federal_actual_refund = 1347,
  state_actual_refund = 356,
  estimated_refund = 1703,
  status_updated_at = NOW()
WHERE client_profile_id = (
  SELECT cp.id FROM client_profiles cp
  JOIN users u ON u.id = cp.user_id
  WHERE LOWER(TRIM(u.last_name)) LIKE '%pasini%'
  LIMIT 1
) AND tax_year = 2026;

-- 21. Luisina Mileti — en preparacion, filed 2026-02-15, fed $589, state $407
-- Note: status is "en preparacion" but has refund amounts, so setting preparing + refunds
UPDATE tax_cases SET
  case_status = 'preparing',
  case_status_changed_at = NOW(),
  federal_actual_refund = 589,
  state_actual_refund = 407,
  estimated_refund = 996,
  status_updated_at = NOW()
WHERE client_profile_id = (
  SELECT cp.id FROM client_profiles cp
  JOIN users u ON u.id = cp.user_id
  WHERE LOWER(TRIM(u.last_name)) = 'mileti'
  LIMIT 1
) AND tax_year = 2026;


-- ============================================================
-- VERIFICATION: Check which rows were actually updated
-- Run this BEFORE committing to verify matches
-- ============================================================
SELECT
  u.first_name || ' ' || u.last_name AS name,
  tc.case_status,
  tc.federal_status_new,
  tc.state_status_new,
  tc.federal_actual_refund,
  tc.state_actual_refund,
  tc.estimated_refund,
  tc.taxes_filed,
  tc.taxes_filed_at
FROM tax_cases tc
JOIN client_profiles cp ON cp.id = tc.client_profile_id
JOIN users u ON u.id = cp.user_id
WHERE tc.tax_year = 2026
  AND tc.case_status IN ('taxes_filed', 'preparing')
  AND (tc.federal_actual_refund IS NOT NULL OR tc.case_status = 'preparing')
ORDER BY u.last_name;

-- If everything looks correct, commit:
COMMIT;
-- If something is wrong, rollback:
-- ROLLBACK;
