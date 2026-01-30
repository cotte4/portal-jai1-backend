-- Migration: Simplify Status Enums
-- Removes verification_letter_sent (merged into verification_in_progress)
-- Removes deposit_pending (commission tracked separately via refund confirmation flags)

-- Step 1: Migrate existing data
UPDATE "tax_cases"
SET "federal_status_new" = 'verification_in_progress'
WHERE "federal_status_new" = 'verification_letter_sent';

UPDATE "tax_cases"
SET "state_status_new" = 'verification_in_progress'
WHERE "state_status_new" = 'verification_letter_sent';

UPDATE "tax_cases"
SET "federal_status_new" = 'taxes_sent'
WHERE "federal_status_new" = 'deposit_pending';

UPDATE "tax_cases"
SET "state_status_new" = 'taxes_sent'
WHERE "state_status_new" = 'deposit_pending';

-- Step 2: Recreate FederalStatusNew enum without removed values
CREATE TYPE "FederalStatusNew_new" AS ENUM (
  'in_process',
  'in_verification',
  'verification_in_progress',
  'check_in_transit',
  'issues',
  'taxes_sent',
  'taxes_completed'
);

ALTER TABLE "tax_cases"
  ALTER COLUMN "federal_status_new" TYPE "FederalStatusNew_new"
  USING "federal_status_new"::text::"FederalStatusNew_new";

DROP TYPE "FederalStatusNew";
ALTER TYPE "FederalStatusNew_new" RENAME TO "FederalStatusNew";

-- Step 3: Recreate StateStatusNew enum without removed values
CREATE TYPE "StateStatusNew_new" AS ENUM (
  'in_process',
  'in_verification',
  'verification_in_progress',
  'check_in_transit',
  'issues',
  'taxes_sent',
  'taxes_completed'
);

ALTER TABLE "tax_cases"
  ALTER COLUMN "state_status_new" TYPE "StateStatusNew_new"
  USING "state_status_new"::text::"StateStatusNew_new";

DROP TYPE "StateStatusNew";
ALTER TYPE "StateStatusNew_new" RENAME TO "StateStatusNew";

-- Step 4: Update any status_history records that reference old values (TEXT column, safe)
UPDATE "status_history"
SET "new_value" = 'verification_in_progress'
WHERE "new_value" = 'verification_letter_sent';

UPDATE "status_history"
SET "old_value" = 'verification_in_progress'
WHERE "old_value" = 'verification_letter_sent';

UPDATE "status_history"
SET "new_value" = 'taxes_sent'
WHERE "new_value" = 'deposit_pending';

UPDATE "status_history"
SET "old_value" = 'taxes_sent'
WHERE "old_value" = 'deposit_pending';
