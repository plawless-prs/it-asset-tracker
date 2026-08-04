-- 15: Supplier-scoped sync request queue.
--
-- Replaces the single-row sync_requested_at flag on pu_settings (migration 14)
-- with a proper queue, so requests can't clobber each other and can be scoped
-- to one supplier. Motivation: the tracked-supplier list will grow to ~150+,
-- making on-demand full syncs too heavy — per-supplier syncs stay fast forever.
--
--   supplier_id NULL  = sync all tracked suppliers (Settings "Sync now")
--   supplier_id set   = sync just that supplier (enqueued on batch creation)
--
-- Lifecycle: pending -> running -> done | failed. The app inserts and reads;
-- the on-prem worker (service role, bypasses RLS) claims pending rows on its
-- poll, runs the sync, and writes status + result. The worker still stamps
-- pu_settings.worker_heartbeat_at / worker_last_result for the Settings pill.
-- Idempotent.

create table if not exists pu_sync_requests (
  id           uuid primary key default gen_random_uuid(),
  supplier_id  text,                                -- null = all tracked suppliers
  reason       text not null default 'manual',      -- 'manual' | 'batch_created'
  requested_by uuid references profiles(id),
  requested_at timestamptz not null default now(),
  status       text not null default 'pending',     -- pending -> running -> done | failed
  started_at   timestamptz,
  finished_at  timestamptz,
  result       jsonb
);
create index if not exists idx_pu_sync_requests_pending
  on pu_sync_requests (requested_at) where status = 'pending';

alter table pu_sync_requests enable row level security;
drop policy if exists pu_sync_requests_select on pu_sync_requests;
create policy pu_sync_requests_select on pu_sync_requests for select to authenticated
  using ((select has_app_access('priceupdates')));
drop policy if exists pu_sync_requests_insert on pu_sync_requests;
create policy pu_sync_requests_insert on pu_sync_requests for insert to authenticated
  with check ((select has_app_access('priceupdates')));

-- The migration-14 flag columns are superseded by the queue (heartbeat/result
-- columns stay — the Settings worker pill reads them).
alter table pu_settings drop column if exists sync_requested_at;
alter table pu_settings drop column if exists sync_requested_by;
