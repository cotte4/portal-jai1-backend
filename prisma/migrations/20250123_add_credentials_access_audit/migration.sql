-- Add CREDENTIALS_ACCESS to AuditAction enum for tracking admin credential access
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CREDENTIALS_ACCESS';
