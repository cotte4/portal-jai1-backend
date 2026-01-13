-- Ticket messages table improvements from audit TM-P1-03
-- Run this in Supabase SQL Editor

-- =============================================
-- INDEX ON SENDER_ID
-- =============================================
-- Speeds up queries filtering by message sender
-- Partial index: only indexes non-null senders (excludes system messages)

CREATE INDEX IF NOT EXISTS "ticket_messages_sender_id_idx"
ON "ticket_messages"("sender_id")
WHERE "sender_id" IS NOT NULL;

-- =============================================
-- VERIFICATION QUERY
-- =============================================
-- SELECT indexname FROM pg_indexes
-- WHERE tablename = 'ticket_messages';
