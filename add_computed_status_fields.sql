-- Add computed status fields to client_profiles table
-- These fields eliminate the need for post-query filtering in clients.service.ts

-- Add the new columns
ALTER TABLE client_profiles
ADD COLUMN is_ready_to_present BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN is_incomplete BOOLEAN NOT NULL DEFAULT true;

-- Create indexes for efficient querying
CREATE INDEX idx_client_profiles_is_ready_to_present ON client_profiles(is_ready_to_present);
CREATE INDEX idx_client_profiles_is_incomplete ON client_profiles(is_incomplete);

-- Update existing records: A client is ready_to_present if:
-- 1. profileComplete = true
-- 2. isDraft = false
-- 3. Has at least one W2 document in their most recent tax case

UPDATE client_profiles cp
SET
  is_ready_to_present = (
    cp.profile_complete = true
    AND cp.is_draft = false
    AND EXISTS (
      SELECT 1
      FROM tax_cases tc
      JOIN documents d ON d.tax_case_id = tc.id
      WHERE tc.client_profile_id = cp.id
        AND d.type = 'w2'
      ORDER BY tc.tax_year DESC
      LIMIT 1
    )
  ),
  is_incomplete = NOT (
    cp.profile_complete = true
    AND cp.is_draft = false
    AND EXISTS (
      SELECT 1
      FROM tax_cases tc
      JOIN documents d ON d.tax_case_id = tc.id
      WHERE tc.client_profile_id = cp.id
        AND d.type = 'w2'
      ORDER BY tc.tax_year DESC
      LIMIT 1
    )
  );

-- Add comment explaining the fields
COMMENT ON COLUMN client_profiles.is_ready_to_present IS 'Computed field: true if profileComplete=true, isDraft=false, and has W2 document';
COMMENT ON COLUMN client_profiles.is_incomplete IS 'Computed field: inverse of is_ready_to_present';
