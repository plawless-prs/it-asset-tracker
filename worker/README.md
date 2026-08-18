# P21 sync worker (on-prem)

Syncs the P21 item mirror (`p21_item_mirror` in Supabase) from Epicor's
read-only SQL replica. It runs **on-prem** because Epicor only accepts replica
connections from allowlisted IPs — the office network is allowlisted, Vercel's
egress is not (this is why the old Vercel cron for `/api/p21/sync-items`
always failed and was removed).

Everything here is **outbound-only**: the worker connects out to the replica
(TCP 1433) and out to Supabase (HTTPS). No inbound ports, no tunnels.

## Modes

- `node sync-worker.mjs --once` — one full sync (all tracked suppliers), then
  exit. Run nightly — this is the backstop that keeps everything current.
- `node sync-worker.mjs --watch` — long-running. Every `POLL_SECONDS` (default
  60) it stamps `pu_settings.worker_heartbeat_at` (the app's Settings page
  uses this to show the worker as online) and drains the `pu_sync_requests`
  queue: the app enqueues a **supplier-scoped** request when a batch is
  created (so matching sees fresh data for that vendor) and an
  **all-suppliers** request from Settings "Sync now". Pending requests are
  coalesced — one sync run covers however many requests are waiting — and each
  request row gets the result written back (`status`: `pending → running →
  done`/`failed`).

With a growing supplier list, scoped syncs stay seconds-fast while the nightly
full sync absorbs the bulk. Consider setting `POLL_SECONDS=20` in `.env` so
batch-created syncs land before the reviewer reaches the matching step.

## Setup (Windows server)

Requires migrations `14_p21_sync_worker.sql` and `15_pu_sync_requests.sql` to
have been run in Supabase.

1. Install Node.js 20+ (LTS installer from nodejs.org).
2. Copy this `worker/` folder to the server (e.g. `C:\p21-sync-worker\`) —
   or clone the whole repo; only this folder is needed.
3. `npm install` inside the folder.
4. Create `.env` in the folder (see keys below). Values live in Vercel's env
   vars / the Supabase dashboard — **never commit this file**.
5. Test by hand: `node sync-worker.mjs --once` should log per-supplier row
   counts, and the app's Settings page should show a fresh "Last synced".
6. Create two Scheduled Tasks (Task Scheduler → Create Task, run whether user
   is logged on or not):
   - **Nightly sync** — trigger: daily at 1:00 AM; action: start a program,
     program `node`, arguments `sync-worker.mjs --once`, start in the worker
     folder.
   - **Sync-now watcher** — trigger: at system startup; action: same program,
     arguments `sync-worker.mjs --watch`, start in the worker folder. On the
     Settings tab, enable "If the task fails, restart every 1 minute".
     Start it once manually (right-click → Run) so it's live before the next
     reboot.

On Linux the equivalent is a cron entry for `--once` and a systemd service
(`Restart=always`) for `--watch`.

## `.env` keys

```
# Epicor SQL replica (same values as Vercel's P21_SQL_*)
P21_SQL_HOST=
P21_SQL_PORT=1433
P21_SQL_DATABASE=
P21_SQL_USERNAME=
P21_SQL_PASSWORD=
# Epicor's replica presents a self-signed TLS certificate (since Aug 2026) —
# this accepts it without CA validation; traffic is still encrypted.
P21_SQL_TRUST_CERT=true

# Supabase (service role — worker writes bypass RLS)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Optional
POLL_SECONDS=60
```

The `P21_SUPPLIER_VIEW` / `P21_ITEM_VIEW` / `P21_F_*` overrides from
`AGENTS.md` are honored too, if ever needed.

## Updating the worker on the server

When `sync-worker.mjs` changes in the repo, copy the new file over the server's
copy, then restart the watcher task (Task Scheduler → right-click → End, then
Run). `npm install` only needs re-running if `package.json` changed.

## How it relates to the app

- Same query and upsert semantics as `src/app/api/p21/sync-items/route.js`
  (which remains in the app as a fallback, e.g. if Epicor ever allowlists
  Vercel). The script is intentionally self-contained — the app's `src/lib`
  modules are Next-flavored ESM that plain Node can't import.
- Coordination: the `pu_sync_requests` queue table (app inserts, worker claims
  and resolves), plus `worker_heartbeat_at` / `worker_last_result` on
  `pu_settings` (row `id=1`) for the Settings-page status pill.
