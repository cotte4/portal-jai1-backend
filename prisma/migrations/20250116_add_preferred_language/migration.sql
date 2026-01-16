-- Add preferred_language column to users table for i18n notification support
-- Default is 'es' (Spanish) as the primary language for the application

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "preferred_language" VARCHAR(5) NOT NULL DEFAULT 'es';

-- Add a comment for documentation
COMMENT ON COLUMN "users"."preferred_language" IS 'User preferred language for notifications (es, en, pt)';
