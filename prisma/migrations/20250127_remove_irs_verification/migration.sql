-- Remove IRS_VERIFICATION problem type
-- Per engineer spec: Verification is handled via status, not problem flags

-- Step 1: Convert any existing irs_verification problems to federal_issue
UPDATE tax_cases
SET problem_type = 'federal_issue'
WHERE problem_type = 'irs_verification';

-- Step 2: Remove the enum value from ProblemType
-- Note: In PostgreSQL, we need to recreate the enum without the value
-- First create a new enum type
CREATE TYPE "ProblemType_new" AS ENUM (
  'missing_documents',
  'incorrect_information',
  'bank_issue',
  'state_issue',
  'federal_issue',
  'client_unresponsive',
  'other'
);

-- Alter the column to use the new enum
ALTER TABLE tax_cases
  ALTER COLUMN problem_type TYPE "ProblemType_new"
  USING problem_type::text::"ProblemType_new";

-- Drop the old enum and rename the new one
DROP TYPE "ProblemType";
ALTER TYPE "ProblemType_new" RENAME TO "ProblemType";
