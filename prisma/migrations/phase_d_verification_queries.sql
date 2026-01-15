-- =============================================
-- PHASE D VERIFICATION QUERIES
-- =============================================
-- Run these queries BEFORE executing Phase D migration
-- to ensure data consistency and safe removal of deprecated fields.
--
-- ALL queries should return 0 or expected values before proceeding.
-- =============================================

-- =============================================
-- 1. DATA CONSISTENCY CHECKS
-- =============================================

-- 1.1 Check all tax_cases have valid taxesFiled values
-- Expected: 0 (no NULL values)
SELECT COUNT(*) as null_taxes_filed_count
FROM tax_cases
WHERE taxes_filed IS NULL;

-- 1.2 Check all pre-filing cases have valid preFilingStatus
-- Expected: 0 (no NULL for non-filed cases)
SELECT COUNT(*) as missing_prefiling_status
FROM tax_cases
WHERE taxes_filed = false AND pre_filing_status IS NULL;

-- 1.3 Check all filed cases have federal/state status
-- Expected: 0 (all filed cases should have both statuses)
SELECT COUNT(*) as missing_filed_status
FROM tax_cases
WHERE taxes_filed = true
  AND (federal_status IS NULL OR state_status IS NULL);

-- 1.4 Verify taxesFiled matches internalStatus logic
-- This shows any mismatches between old and new status
-- Expected: 0 mismatches
SELECT
  tc.id,
  tc.internal_status,
  tc.taxes_filed,
  CASE
    WHEN tc.internal_status IN ('en_proceso', 'en_verificacion', 'resolviendo_verificacion',
                                 'inconvenientes', 'cheque_en_camino', 'esperando_pago_comision',
                                 'proceso_finalizado') THEN true
    ELSE false
  END as expected_taxes_filed
FROM tax_cases tc
WHERE tc.taxes_filed != (
  CASE
    WHEN tc.internal_status IN ('en_proceso', 'en_verificacion', 'resolviendo_verificacion',
                                 'inconvenientes', 'cheque_en_camino', 'esperando_pago_comision',
                                 'proceso_finalizado') THEN true
    ELSE false
  END
);

-- =============================================
-- 2. STATUS DISTRIBUTION ANALYSIS
-- =============================================

-- 2.1 Count by taxesFiled
SELECT
  taxes_filed,
  COUNT(*) as count
FROM tax_cases
GROUP BY taxes_filed;

-- 2.2 Count by preFilingStatus (for non-filed cases)
SELECT
  pre_filing_status,
  COUNT(*) as count
FROM tax_cases
WHERE taxes_filed = false
GROUP BY pre_filing_status;

-- 2.3 Count by federalStatus (for filed cases)
SELECT
  federal_status,
  COUNT(*) as count
FROM tax_cases
WHERE taxes_filed = true
GROUP BY federal_status;

-- 2.4 Count by stateStatus (for filed cases)
SELECT
  state_status,
  COUNT(*) as count
FROM tax_cases
WHERE taxes_filed = true
GROUP BY state_status;

-- 2.5 Compare old vs new status distribution
-- This shows the mapping from old to new status
SELECT
  internal_status as old_status,
  taxes_filed,
  pre_filing_status,
  federal_status,
  state_status,
  COUNT(*) as count
FROM tax_cases
GROUP BY internal_status, taxes_filed, pre_filing_status, federal_status, state_status
ORDER BY internal_status;

-- =============================================
-- 3. REFERENTIAL INTEGRITY CHECKS
-- =============================================

-- 3.1 Check StatusHistory still references valid data
-- Expected: All entries readable
SELECT COUNT(*) as status_history_count
FROM status_history;

-- 3.2 Verify no orphan tax_cases
SELECT COUNT(*) as orphan_tax_cases
FROM tax_cases tc
LEFT JOIN client_profiles cp ON tc.client_profile_id = cp.id
WHERE cp.id IS NULL;

-- =============================================
-- 4. SYSTEM HEALTH CHECKS
-- =============================================

-- 4.1 Count recent status updates using new fields
-- Expected: > 0 if system is actively using new fields
SELECT COUNT(*) as recent_new_field_updates
FROM tax_cases
WHERE federal_status_changed_at > NOW() - INTERVAL '7 days'
   OR state_status_changed_at > NOW() - INTERVAL '7 days';

-- 4.2 Count cases where new fields differ from old mapping
-- This helps identify if dual-write is working correctly
SELECT COUNT(*) as potential_sync_issues
FROM tax_cases
WHERE taxes_filed = true
  AND (
    (internal_status = 'proceso_finalizado' AND federal_status != 'deposited')
    OR (internal_status = 'cheque_en_camino' AND federal_status NOT IN ('approved', 'deposited'))
  );

-- =============================================
-- 5. FINAL CHECKLIST QUERIES
-- =============================================

-- 5.1 Summary: Is it safe to proceed with Phase D?
-- Run this query and review results
SELECT
  'Total tax_cases' as metric, COUNT(*)::text as value FROM tax_cases
UNION ALL
SELECT
  'Cases with taxes_filed=true', COUNT(*)::text FROM tax_cases WHERE taxes_filed = true
UNION ALL
SELECT
  'Cases with taxes_filed=false', COUNT(*)::text FROM tax_cases WHERE taxes_filed = false
UNION ALL
SELECT
  'Missing federal_status (filed)', COUNT(*)::text FROM tax_cases WHERE taxes_filed = true AND federal_status IS NULL
UNION ALL
SELECT
  'Missing state_status (filed)', COUNT(*)::text FROM tax_cases WHERE taxes_filed = true AND state_status IS NULL
UNION ALL
SELECT
  'Missing pre_filing_status (not filed)', COUNT(*)::text FROM tax_cases WHERE taxes_filed = false AND pre_filing_status IS NULL;

-- =============================================
-- DECISION CRITERIA FOR PHASE D
-- =============================================
--
-- SAFE TO PROCEED if ALL of these are true:
-- 1. Query 1.1 returns 0 (no NULL taxes_filed)
-- 2. Query 1.2 returns 0 (no missing pre-filing status)
-- 3. Query 1.3 returns 0 (no missing federal/state status)
-- 4. Query 1.4 returns 0 rows (no mismatches)
-- 5. Query 4.1 returns > 0 (system is using new fields)
-- 6. Query 4.2 returns 0 (no sync issues)
-- 7. Production has been stable for 2+ weeks
--
-- IF ANY query returns unexpected values, DO NOT proceed.
-- Investigate and fix data issues first.
-- =============================================
