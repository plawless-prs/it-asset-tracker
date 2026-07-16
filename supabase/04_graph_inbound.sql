-- =============================================================================
-- PRS Help Desk — Graph webhook de-duplication
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- Microsoft Graph can deliver the same change notification more than once, so
-- we record the source message id and refuse to create a second ticket for it.
-- =============================================================================

alter table tickets add column if not exists source_message_id text;

-- Plain unique index: Postgres treats NULLs as distinct, so the many in-app
-- tickets (null message id) are fine, while two emails with the same id can't
-- both create a ticket. Non-partial so `on conflict (source_m