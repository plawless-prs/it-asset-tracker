-- =============================================================================
-- PRS Apps — Bot API v2 foundation  [write support: acting profile, write log,
-- idempotency, bot markers]
-- Run once in the Supabase SQL Editor. Idempotent / additive. Safe to re-run.
--
-- api_clients.acting_profile_id: the profile a bot's writes are attributed to
-- (ticket comments, activity, KB authors, …). Write routes refuse (409
-- not_configured) until an admin sets "Acts as" on /admin. Deliberately no
-- hard-coded profile here — pick it in the UI.
--
-- api_client_calls: write columns (is_write, target_type, target_ids,
-- request_summary, idempotency_key). Write calls are logged synchronously
-- BEFORE the write and counted for the DB-backed write rate limit (20/min,
-- 500/day per client) — hence the partial index.
--
-- api_idempotency: stored responses for `Idempotency-Key` replays, keyed per
-- client. SERVICE-ROLE ONLY, same pattern as 21: RLS on, no policies, no
-- table privileges for anon/authenticated.
--
-- tickets.created_via_client_id / ticket_comments.via_client_id /
-- kb_articles.via_client_id: explicit "written by bot X" markers. These tables'
-- RLS is unchanged.
-- =============================================================================

-- Who the bot acts as
alter table api_clients add column if not exists acting_profile_id uuid references profiles(id) on delete set null;

-- Richer call log
alter table api_client_calls add column if not exists is_write        boolean not null default false;
alter table api_client_calls add column if not exists target_type     text;
alter table api_client_calls add column if not exists target_ids      text[];
alter table api_client_calls add column if not exists request_summary jsonb;
alter table api_client_calls add column if not exists idempotency_key text;
create index if not exists idx_api_client_calls_writes
  on api_client_calls (client_id, created_at desc) where is_write;

-- Idempotency store
create table if not exists api_idempotency (
  client_id    uuid not null references api_clients(id) on delete cascade,
  idem_key     text not null,
  route        text not null,
  request_hash text not null,
  status       int  not null,
  response     jsonb,
  created_at   timestamptz not null default now(),
  primary key (client_id, idem_key)
);
create index if not exists idx_api_idempotency_created on api_idempotency (created_at);

alter table api_idempotency enable row level security;

-- Defense in depth: no table privileges for the PostgREST roles at all.
revoke all on api_idempotency from anon, authenticated;

-- Explicit "created by bot" markers
alter table tickets         add column if not exists created_via_client_id uuid references api_clients(id) on delete set null;
alter table ticket_comments add column if not exists via_client_id         uuid references api_clients(id) on delete set null;
alter table kb_articles     add column if not exists via_client_id         uuid references api_clients(id) on delete set null;

-- =============================================================================
-- Done. Verify:
--   * api_idempotency shows "RLS enabled" with zero policies, and
--     `select * from api_idempotency` as an authenticated user returns
--     permission denied.
--   * api_clients has acting_profile_id; api_client_calls has is_write,
--     target_type, target_ids, request_summary, idempotency_key.
--   * tickets.created_via_client_id, ticket_comments.via_client_id,
--     kb_articles.via_client_id exist.
--
-- Optional: find a profile id by email (e.g. to check what "Acts as" should be):
-- select id, full_name, email, role from profiles where lower(email) = 'it@powerandrubber.com';
--
-- Optional cleanup: idempotency rows only matter for a few days of retries.
-- delete from api_idempotency where created_at < now() - interval '7 days';
-- =============================================================================
