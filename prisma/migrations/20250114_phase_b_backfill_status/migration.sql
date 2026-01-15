-- Phase B: Backfill Status Refactor Data
-- This migration populates the new status fields based on existing internalStatus values.
-- Run this in Supabase SQL Editor AFTER Phase A migration.
--
-- IMPORTANT: This is a data migration. Review the mappings before running.

-- =============================================
-- STEP 1: BACKFILL taxesFiled FOR POST-FILING CASES
-- =============================================
-- Cases with these internalStatus values have already filed taxes

UPDATE "tax_cases"
SET
    "taxes_filed" = true,
    "taxes_filed_at" = "status_updated_at"
WHERE "internal_status" IN (
    'en_proceso',
    'en_verificacion',
    'resolviendo_verificacion',
    'inconvenientes',
    'cheque_en_camino',
    'esperando_pago_comision',
    'proceso_finalizado'
)
AND "taxes_filed" = false;

-- =============================================
-- STEP 2: BACKFILL preFilingStatus FOR PRE-FILING CASES
-- =============================================
-- Map old internalStatus to new preFilingStatus

-- Cases still in registration review
UPDATE "tax_cases"
SET "pre_filing_status" = 'awaiting_registration'
WHERE "internal_status" = 'revision_de_registro'
AND "taxes_filed" = false;

-- Cases awaiting documents
UPDATE "tax_cases"
SET "pre_filing_status" = 'awaiting_documents'
WHERE "internal_status" IN ('esperando_datos', 'falta_documentacion')
AND "taxes_filed" = false;

-- =============================================
-- STEP 3: BACKFILL preFilingStatus FOR FILED CASES (historical)
-- =============================================
-- Cases that have already filed should have documentation_complete as their pre-filing status

UPDATE "tax_cases"
SET "pre_filing_status" = 'documentation_complete'
WHERE "taxes_filed" = true
AND "pre_filing_status" = 'awaiting_registration';

-- =============================================
-- STEP 4: BACKFILL federalStatus FOR FILED CASES WITHOUT IT
-- =============================================

UPDATE "tax_cases"
SET "federal_status" = CASE
    WHEN "internal_status" = 'en_proceso' THEN 'processing'::"TaxStatus"
    WHEN "internal_status" IN ('en_verificacion', 'resolviendo_verificacion') THEN 'processing'::"TaxStatus"
    WHEN "internal_status" = 'inconvenientes' THEN 'processing'::"TaxStatus"
    WHEN "internal_status" = 'cheque_en_camino' THEN 'approved'::"TaxStatus"
    WHEN "internal_status" IN ('esperando_pago_comision', 'proceso_finalizado')
         AND "federal_deposit_date" IS NOT NULL THEN 'deposited'::"TaxStatus"
    WHEN "internal_status" IN ('esperando_pago_comision', 'proceso_finalizado') THEN 'approved'::"TaxStatus"
    ELSE 'filed'::"TaxStatus"
END
WHERE "taxes_filed" = true
AND "federal_status" IS NULL;

-- =============================================
-- STEP 5: BACKFILL stateStatus FOR FILED CASES WITHOUT IT
-- =============================================

UPDATE "tax_cases"
SET "state_status" = CASE
    WHEN "internal_status" = 'en_proceso' THEN 'processing'::"TaxStatus"
    WHEN "internal_status" IN ('en_verificacion', 'resolviendo_verificacion') THEN 'processing'::"TaxStatus"
    WHEN "internal_status" = 'inconvenientes' THEN 'processing'::"TaxStatus"
    WHEN "internal_status" = 'cheque_en_camino' THEN 'approved'::"TaxStatus"
    WHEN "internal_status" IN ('esperando_pago_comision', 'proceso_finalizado')
         AND "state_deposit_date" IS NOT NULL THEN 'deposited'::"TaxStatus"
    WHEN "internal_status" IN ('esperando_pago_comision', 'proceso_finalizado') THEN 'approved'::"TaxStatus"
    ELSE 'filed'::"TaxStatus"
END
WHERE "taxes_filed" = true
AND "state_status" IS NULL;

-- =============================================
-- STEP 6: BACKFILL STATUS CHANGE DATES
-- =============================================
-- Use status_updated_at as the initial status change date

UPDATE "tax_cases"
SET
    "federal_status_changed_at" = "status_updated_at",
    "state_status_changed_at" = "status_updated_at"
WHERE "taxes_filed" = true
AND "federal_status_changed_at" IS NULL;

-- =============================================
-- VERIFICATION QUERIES
-- =============================================

-- Check distribution of taxesFiled:
-- SELECT "taxes_filed", COUNT(*) FROM "tax_cases" GROUP BY "taxes_filed";

-- Check preFilingStatus distribution:
-- SELECT "pre_filing_status", COUNT(*) FROM "tax_cases" GROUP BY "pre_filing_status";

-- Check for any filed cases without federal/state status:
-- SELECT COUNT(*) FROM "tax_cases" WHERE "taxes_filed" = true AND ("federal_status" IS NULL OR "state_status" IS NULL);

-- Verify mapping worked correctly:
-- SELECT "internal_status", "taxes_filed", "pre_filing_status", "federal_status", "state_status", COUNT(*)
-- FROM "tax_cases"
-- GROUP BY "internal_status", "taxes_filed", "pre_filing_status", "federal_status", "state_status"
-- ORDER BY "internal_status";
