-- Add deposit_pending status to FederalStatusNew and StateStatusNew enums
-- This status represents when a bank deposit has been approved but not yet received

-- Add to FederalStatusNew enum (after verification_letter_sent)
ALTER TYPE "FederalStatusNew" ADD VALUE IF NOT EXISTS 'deposit_pending' AFTER 'verification_letter_sent';

-- Add to StateStatusNew enum (after verification_letter_sent)
ALTER TYPE "StateStatusNew" ADD VALUE IF NOT EXISTS 'deposit_pending' AFTER 'verification_letter_sent';
