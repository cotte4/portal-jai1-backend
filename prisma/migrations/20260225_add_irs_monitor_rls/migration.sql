-- Enable RLS on irs_checks (consistent with all other tables in the app)
-- Prisma connects as the postgres superuser which bypasses RLS,
-- so backend operations are unaffected. This blocks direct Supabase API access.
ALTER TABLE "irs_checks" ENABLE ROW LEVEL SECURITY;

-- Block all access via Supabase API (anon / authenticated roles)
-- Only the postgres/service_role used by Prisma can read/write this table
CREATE POLICY "irs_checks_service_only"
  ON "irs_checks"
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);
