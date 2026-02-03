-- Status System v2: Replace 7 old statuses with 9 new ones
-- Uses enum recreation approach (not ADD VALUE) so everything runs in one transaction.

-- ============= STEP 1: Recreate FederalStatusNew enum =============
-- Create new enum with BOTH old and new values (so existing rows can cast)
CREATE TYPE "FederalStatusNew_new" AS ENUM (
  'in_process', 'in_verification', 'verification_in_progress',
  'check_in_transit', 'issues', 'taxes_sent', 'taxes_completed',
  'taxes_en_proceso', 'en_verificacion', 'verificacion_en_progreso',
  'problemas', 'verificacion_rechazada', 'deposito_directo',
  'cheque_en_camino', 'comision_pendiente', 'taxes_completados'
);

ALTER TABLE "tax_cases"
  ALTER COLUMN "federal_status_new" TYPE "FederalStatusNew_new"
  USING "federal_status_new"::text::"FederalStatusNew_new";

ALTER TABLE "tax_cases"
  ALTER COLUMN "federal_status_new" SET DEFAULT 'taxes_en_proceso'::"FederalStatusNew_new";

DROP TYPE "FederalStatusNew";
ALTER TYPE "FederalStatusNew_new" RENAME TO "FederalStatusNew";

-- ============= STEP 2: Recreate StateStatusNew enum =============
CREATE TYPE "StateStatusNew_new" AS ENUM (
  'in_process', 'in_verification', 'verification_in_progress',
  'check_in_transit', 'issues', 'taxes_sent', 'taxes_completed',
  'taxes_en_proceso', 'en_verificacion', 'verificacion_en_progreso',
  'problemas', 'verificacion_rechazada', 'deposito_directo',
  'cheque_en_camino', 'comision_pendiente', 'taxes_completados'
);

ALTER TABLE "tax_cases"
  ALTER COLUMN "state_status_new" TYPE "StateStatusNew_new"
  USING "state_status_new"::text::"StateStatusNew_new";

ALTER TABLE "tax_cases"
  ALTER COLUMN "state_status_new" SET DEFAULT 'taxes_en_proceso'::"StateStatusNew_new";

DROP TYPE "StateStatusNew";
ALTER TYPE "StateStatusNew_new" RENAME TO "StateStatusNew";

-- ============= STEP 3: Migrate existing data =============

-- Federal status migration
UPDATE "tax_cases" SET "federal_status_new" = 'taxes_en_proceso' WHERE "federal_status_new" = 'in_process';
UPDATE "tax_cases" SET "federal_status_new" = 'en_verificacion' WHERE "federal_status_new" = 'in_verification';
UPDATE "tax_cases" SET "federal_status_new" = 'verificacion_en_progreso' WHERE "federal_status_new" = 'verification_in_progress';
UPDATE "tax_cases" SET "federal_status_new" = 'cheque_en_camino' WHERE "federal_status_new" = 'check_in_transit';
UPDATE "tax_cases" SET "federal_status_new" = 'problemas' WHERE "federal_status_new" = 'issues';
UPDATE "tax_cases" SET "federal_status_new" = 'deposito_directo' WHERE "federal_status_new" = 'taxes_sent';
UPDATE "tax_cases" SET "federal_status_new" = 'taxes_completados' WHERE "federal_status_new" = 'taxes_completed';

-- State status migration
UPDATE "tax_cases" SET "state_status_new" = 'taxes_en_proceso' WHERE "state_status_new" = 'in_process';
UPDATE "tax_cases" SET "state_status_new" = 'en_verificacion' WHERE "state_status_new" = 'in_verification';
UPDATE "tax_cases" SET "state_status_new" = 'verificacion_en_progreso' WHERE "state_status_new" = 'verification_in_progress';
UPDATE "tax_cases" SET "state_status_new" = 'cheque_en_camino' WHERE "state_status_new" = 'check_in_transit';
UPDATE "tax_cases" SET "state_status_new" = 'problemas' WHERE "state_status_new" = 'issues';
UPDATE "tax_cases" SET "state_status_new" = 'deposito_directo' WHERE "state_status_new" = 'taxes_sent';
UPDATE "tax_cases" SET "state_status_new" = 'taxes_completados' WHERE "state_status_new" = 'taxes_completed';

-- ============= STEP 4: Migrate status history =============

UPDATE "status_history" SET "previous_status" = REPLACE("previous_status", 'in_process', 'taxes_en_proceso') WHERE "previous_status" LIKE '%in_process%';
UPDATE "status_history" SET "previous_status" = REPLACE("previous_status", 'verification_in_progress', 'verificacion_en_progreso') WHERE "previous_status" LIKE '%verification_in_progress%';
UPDATE "status_history" SET "previous_status" = REPLACE("previous_status", 'in_verification', 'en_verificacion') WHERE "previous_status" LIKE '%in_verification%';
UPDATE "status_history" SET "previous_status" = REPLACE("previous_status", 'check_in_transit', 'cheque_en_camino') WHERE "previous_status" LIKE '%check_in_transit%';
UPDATE "status_history" SET "previous_status" = REPLACE("previous_status", 'taxes_sent', 'deposito_directo') WHERE "previous_status" LIKE '%taxes_sent%';
UPDATE "status_history" SET "previous_status" = REPLACE("previous_status", 'taxes_completed', 'taxes_completados') WHERE "previous_status" LIKE '%taxes_completed%';
UPDATE "status_history" SET "previous_status" = REPLACE("previous_status", 'issues', 'problemas') WHERE "previous_status" LIKE '%issues%' AND "previous_status" NOT LIKE '%case_issues%';

UPDATE "status_history" SET "new_status" = REPLACE("new_status", 'in_process', 'taxes_en_proceso') WHERE "new_status" LIKE '%in_process%';
UPDATE "status_history" SET "new_status" = REPLACE("new_status", 'verification_in_progress', 'verificacion_en_progreso') WHERE "new_status" LIKE '%verification_in_progress%';
UPDATE "status_history" SET "new_status" = REPLACE("new_status", 'in_verification', 'en_verificacion') WHERE "new_status" LIKE '%in_verification%';
UPDATE "status_history" SET "new_status" = REPLACE("new_status", 'check_in_transit', 'cheque_en_camino') WHERE "new_status" LIKE '%check_in_transit%';
UPDATE "status_history" SET "new_status" = REPLACE("new_status", 'taxes_sent', 'deposito_directo') WHERE "new_status" LIKE '%taxes_sent%';
UPDATE "status_history" SET "new_status" = REPLACE("new_status", 'taxes_completed', 'taxes_completados') WHERE "new_status" LIKE '%taxes_completed%';
UPDATE "status_history" SET "new_status" = REPLACE("new_status", 'issues', 'problemas') WHERE "new_status" LIKE '%issues%' AND "new_status" NOT LIKE '%case_issues%';

-- ============= STEP 5: Add internal comment columns =============

ALTER TABLE "tax_cases" ADD COLUMN IF NOT EXISTS "federal_internal_comment" TEXT;
ALTER TABLE "tax_cases" ADD COLUMN IF NOT EXISTS "state_internal_comment" TEXT;

-- Note: Old enum values (in_process, etc.) remain in the recreated enum type
-- but are no longer used. The Prisma schema only lists new values, so the ORM
-- will not accept old values going forward.
