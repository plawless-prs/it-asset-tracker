-- 14: On-prem P21 sync worker support.
--
-- The Epicor SQL replica is unreachable from Vercel's egress IPs (only the
-- office network is on Epicor's allowlist), so the nightly mirror sync moved
-- from a Vercel cron to an on-prem worker (worker/sync-worker.mjs). The app
-- and the worker coordinate through the single pu_settings row:
--
--   sync_requested_at   set by Settings "Sync now"; the worker polls for it,
--                       clears it, and runs a sync
--   sync_requested_by   who clicked (informational)
--   worker_heartbeat_at stamped by the worker on every poll; the UI treats a
--                       recent heartbeat as "worker online"
--   worker_last_result  jsonb summary of the worker's last sync
--                       ({ ok, via, upserted, suppliers, started_at,
--                          finished_at, error })
--
-- Existing pu_settings RLS (has_app_access('priceupdates')) already covers the
-- app side; the worker writes via the service role, which bypasses RLS.
-- Idempotent.

alter table pu_settings add column if not exists sync_requested_at   timestamptz;
alter table pu_settings add column if not exists sync_requested_by   uuid references profiles(id);
alter table pu_settings add column if not exists worker_heartbeat_at timestamptz;
alter table pu_settings add column if not exists worker_last_result  jsonb;
