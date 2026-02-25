-- Add FilingStatus enum and filing_status column to tax_cases
-- Default is 'single' since the vast majority of J-1 clients file as Single

CREATE TYPE "FilingStatus" AS ENUM ('single', 'married_joint', 'married_separate', 'head_of_household');

ALTER TABLE "tax_cases"
  ADD COLUMN "filing_status" "FilingStatus" NOT NULL DEFAULT 'single';
