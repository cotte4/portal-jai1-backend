-- =====================================================
-- CHECK CONSTRAINTS FOR PORTAL JAI1
-- Run this after `prisma db push` to add DB-level validations
-- =====================================================

-- TC-P1-10: tax_year must be between 2020 and 2100
ALTER TABLE tax_cases
DROP CONSTRAINT IF EXISTS chk_tax_year_valid;

ALTER TABLE tax_cases
ADD CONSTRAINT chk_tax_year_valid
CHECK (tax_year >= 2020 AND tax_year <= 2100);

-- TC-P2-03: If has_problem = false, active problem fields must be NULL
-- Note: problem_resolved_at is allowed when has_problem=false (records resolution time)
ALTER TABLE tax_cases
DROP CONSTRAINT IF EXISTS chk_problem_fields_consistency;

ALTER TABLE tax_cases
ADD CONSTRAINT chk_problem_fields_consistency
CHECK (
  has_problem = true
  OR (
    problem_step IS NULL
    AND problem_type IS NULL
    AND problem_description IS NULL
    -- problem_resolved_at can remain set (records when problem was resolved)
  )
);

-- admin_step must be between 1 and 5 (documented values)
ALTER TABLE tax_cases
DROP CONSTRAINT IF EXISTS chk_admin_step_valid;

ALTER TABLE tax_cases
ADD CONSTRAINT chk_admin_step_valid
CHECK (admin_step IS NULL OR (admin_step >= 1 AND admin_step <= 5));

-- problem_step must be between 1 and 5 (relates to admin_step)
ALTER TABLE tax_cases
DROP CONSTRAINT IF EXISTS chk_problem_step_valid;

ALTER TABLE tax_cases
ADD CONSTRAINT chk_problem_step_valid
CHECK (problem_step IS NULL OR (problem_step >= 1 AND problem_step <= 5));

-- U-P2-01: Basic email format validation
-- Note: Full email validation should still be done at application level
ALTER TABLE users
DROP CONSTRAINT IF EXISTS chk_email_format;

ALTER TABLE users
ADD CONSTRAINT chk_email_format
CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

-- season_year in discount_applications must be valid
ALTER TABLE discount_applications
DROP CONSTRAINT IF EXISTS chk_season_year_valid;

ALTER TABLE discount_applications
ADD CONSTRAINT chk_season_year_valid
CHECK (season_year >= 2020 AND season_year <= 2100);

-- =====================================================
-- VERIFICATION QUERIES
-- Run these after applying constraints to check existing data
-- =====================================================

-- Check for invalid tax years
-- SELECT id, tax_year FROM tax_cases WHERE tax_year < 2020 OR tax_year > 2100;

-- Check for inconsistent problem fields
-- SELECT id, has_problem, problem_step, problem_type
-- FROM tax_cases
-- WHERE has_problem = false AND (problem_step IS NOT NULL OR problem_type IS NOT NULL);

-- Check for invalid admin_step values
-- SELECT id, admin_step FROM tax_cases WHERE admin_step NOT BETWEEN 1 AND 5;
