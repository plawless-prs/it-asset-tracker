-- =============================================================================
-- PRS Apps — Bot API v1  [api clients + call log]
-- Run once in the Supabase SQL Editor. Idempotent / additive. Safe to re-run.
--
-- api_clients: one row per bot/integration. Only the SHA-256 hash of the key is
-- stored (plus a short display prefix); the plain key is shown once at
-- creation/rotation and never again. scopes gate which /api/bot routes a key
-- may call (v1: 'helpdesk:read').
--
-- api_client_calls: one row per bot request (kept out of audit_log so bot
-- traffic doesn't bury IT Tracker history).
--
-- Both tables are SERVICE-ROLE ONLY: RLS on, deliberately no policies for
-- anon/authenticated. The /api/bot routes and /api/admin/api-clients use the
-- service-role client after their own auth checks.
-- =============================================================================

create table if not exists api_clients (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  key_prefix   text not null,
  key_hash     text not null unique,
  scopes       text[] not null default '{}',
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create table if not exists api_client_calls (
  id           bigint generated always as identity primary key,
  client_id    uuid references api_clients(id) on delete set null,
  client_name  text,
  method       text not null default 'GET',
  route        text not null,
  params       jsonb not null default '{}',
  status       int not null,
  result_count int,
  created_at   timestamptz not null default now()
);
create index if not exists idx_api_client_calls_client  on api_client_calls (client_id, created_at desc);
create index if not exists idx_api_client_calls_created on api_client_calls (created_at desc);

alter table api_clients      enable row level security;
alter table api_client_calls enable row level security;

-- Defense in depth: no table privileges for the PostgREST roles at all.
revoke all on api_clients      from anon, authenticated;
revoke all on api_client_calls from anon, authenticated;

-- =============================================================================
-- Done. Verify: both tables show "RLS enabled" with zero policies, and
-- `select * from api_clients` as an authenticated user returns permission denied.
-- =============================================================================
