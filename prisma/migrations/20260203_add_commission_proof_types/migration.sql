-- Add commission proof document types
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'commission_proof_federal';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'commission_proof_state';
