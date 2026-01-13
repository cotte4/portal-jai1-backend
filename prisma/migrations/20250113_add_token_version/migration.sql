-- Add tokenVersion column to users table for token invalidation on logout
-- Run this in Supabase SQL Editor

ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "token_version" INTEGER NOT NULL DEFAULT 1;
