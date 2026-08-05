# Price Update Processor — status & new-device handoff

Snapshot so work can resume on another machine. Pairs with `build-spec.md` (the
plan), `../AGENTS.md` (architecture), and `../CHANGELOG.md` (what changed).

## Where things stand (2026-08-04)

- **Phases 1–5 are built, and the P21 data pull is WORKING** via the SQL
  replica (see below). Phase 4 (two-pane review/approve UI) and Phase 5
  (export + applied loop, commit `d43f473`) landed 2026-07-31. Phase 5 also
  brought **ambiguous auto-pick + per-vendor match memory** (`pu_item_aliases`,
  migration `13` — applied to Supabase): ambiguous lines get the closest P21
  candidate auto-assigned and don't block Approve; approving (or manually
  fixing a line) records the resolution, and the match route replays it on the
  vendor's next batch. Export: tab-delimited `.txt` (CRLF, header, fixed column
  order `Item ID⇥List Price⇥New Cost⇥Supplier ID` — P21 imports by position),
  named `<vendor prefix><effective year>.txt`; blank cell = "no change" in P21.
  **Not yet verified against a real P21 import load** — do that before trusting
  the loop end-to-end.
- **Merged to `main` and deployed to production 2026-07-31.** The
  `priceupdates-phase-3` branch history is in `main`; continue new work on
  fresh branches off `main`.
- **Mirror sync — RESOLVED (again), now via an on-prem worker (2026-08-04).**
  The nightly-cron question answered itself: **Epicor IP-allowlists the
  replica** (`p21us-read10.epicordistribution.com`, db `az_131184_live`) —
  reachable from the office network, **not from Vercel** (every production
  attempt 502'd in ~16s; the cron never once succeeded). Sync moved to
  `worker/sync-worker.mjs` (self-contained Node script, commit `22fadfa` +
  migration `14`) running on an office server at **`C:\p21-sync-worker`** with
  two Task Scheduler jobs: nightly 1:00 AM `--once` (full sync, the backstop),
  and an at-startup `--watch` loop that heartbeats to `pu_settings` and drains
  the **`pu_sync_requests` queue** (migration `15`, 2026-08-04): **creating a
  batch auto-queues a supplier-scoped sync for that vendor** (batch detail
  shows "P21 data synced Xm ago"), and Settings "Sync now" queues an
  all-suppliers request. Scoped-first design because the supplier list is
  headed for ~150+, where on-demand full syncs would be too heavy. Settings
  shows the worker Online/Offline from the heartbeat — **Offline is the
  early-warning sign the server task died.** Secrets live in `worker/.env` on
  that server (git-ignored). **Both sync paths verified in production
  2026-08-04:** full sync 71,505 rows in ~26s (ContiTech 10629: 38,229 ·
  Parker 10140: 4,809 · Gates 10638: 28,467), and the batch-created scoped
  path (Gates batch → `batch_created` request for supplier 10638 → worker
  synced only Gates → detail header showed the freshness line). Note the
  scoped trigger only fires if the vendor **already has a `p21_supplier_id`**
  when the batch is created — new-vendor onboarding is: create vendor → set
  its supplier id on the Vendors page → first batch's scoped sync populates
  the mirror for that supplier automatically. When `sync-worker.mjs` changes,
  copy it to the server and restart the watcher task (a request stranded
  `running` by a killed worker self-requeues after 10 min). `/api/p21/sync-items` (`src/lib/p21sql.js`) remains as the
  in-app fallback, exercised by Settings "Test connection" — expected to fail
  unless Epicor ever allowlists Vercel's IPs (worth an EpicCare ask someday;
  zero urgency).
- **OData path (fallback, still gateway-blocked):** token auth + catalog +
  $metadata all work, but **every OData data query returns 401** ("You are not
  authorized to access API") — for two different users and even with a
  registered consumer key (app `PRS-PriceUpdates`, scope `/odata`, type Service;
  token confirms `aud:/odata`). It's a user-level grant on Epicor's side
  (EpicCare ticket if we ever need OData); not a code issue. `P21_CONSUMER_KEY`
  is wired into `src/lib/p21.js` should it come through.

## New-device setup

1. `git clone https://github.com/plawless-prs/it-asset-tracker.git` (work on
   `main`; branch off it for new work)
2. `npm install`
3. **Recreate `.env.local`** — it is git-ignored and does **not** travel with the
   repo. Copy it securely from the old machine, or rebuild it from the key list
   below (values are secrets kept on the old device / in the respective consoles).
4. **(Optional, testing only)** copy the git-ignored real data files — they don't
   travel with the repo either: `price-update-processor/samples/GAT2026.txt`
   (real Gates import sample, used to shape the Phase 5 exporter).
5. **Supabase is cloud and shared** — migrations `01`–`15` are already applied to
   the project; nothing to re-run on a new device. (Only if pointing at a *fresh*
   Supabase project: run every `supabase/*.sql` in numbered order.)
6. `npm run dev`.

The **on-prem sync worker** is separate from dev machines — it lives on the
office server (`C:\p21-sync-worker`, see `worker/README.md`) and keeps running
regardless of which dev machine is in use. Nothing to set up per-device.

## `.env.local` keys (names only — bring the secret values from the old device)

- **Supabase:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`
- **P21 SQL replica:** `P21_SQL_HOST`, `P21_SQL_PORT`, `P21_SQL_DATABASE`,
  `P21_SQL_USERNAME`, `P21_SQL_PASSWORD` (Epicor-provisioned `readonly_*`
  account). The production copy of these lives in `worker/.env` on the office
  server — the dev-machine copy only matters for local testing (works from the
  office network only; Epicor IP-allowlists the replica).
- **P21 OData (fallback, currently gateway-blocked):** `P21_BASE_URL`
  (= `https://powerandrubber-play.epicordistribution.com`), `P21_USERNAME`,
  `P21_PASSWORD`, `P21_CONSUMER_KEY` (registered app `PRS-PriceUpdates`), plus
  the `P21_TOKEN_PATH` / `P21_ODATA_BASE` / `P21_*_VIEW` / `P21_F_*` overrides
  documented in `../AGENTS.md`.
- **Email/Graph + `CRON_SECRET`** etc. — only if exercising Help Desk locally; see
  `../AGENTS.md` "Environment variables".

Never commit `.env.local` or the real data files. Both are git-ignored — keep it
that way.

## To resume

- **Phase 5.5 (price-file library) — BUILT 2026-08-04 (migration `16`), one
  step outstanding: running the bulk import.** `/priceupdates/files` page
  (browse/filter/search, in-app upload, vendor/year metadata editing, batch
  linking — linked files show on batch detail); objects in `price-files` under
  `library/<vendor-slug>/<year>/`, metadata in `pu_library_files`.
  **Remaining: run `scripts/import-price-library.mjs` on the PC that holds the
  historical archive** (folder-per-vendor layout confirmed with Porter;
  dependency-free — copy the script + a `.env` with `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY`, then `node import-price-library.mjs
  "<archive path>" --dry` to preview, and again without `--dry` to import;
  idempotent, so partial runs can just be re-run). Vendor folders that don't
  match a `pu_vendors.name` import as Unassigned — fix on the Files page, or
  add the vendor and re-run.
- After 5.5, remaining build-spec phases: **6** email intake from
  `priceupdate@` · **7** polish. Porter explicitly wants 5.5 before Phase 6.
- Also outstanding: round-trip a generated export through P21's real import
  tool once (Phase 5 acceptance).
