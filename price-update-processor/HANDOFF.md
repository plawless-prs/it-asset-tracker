# Price Update Processor — status & new-device handoff

Snapshot so work can resume on another machine. Pairs with `build-spec.md` (the
plan), `../AGENTS.md` (architecture), and `../CHANGELOG.md` (what changed).

## Where things stand (2026-07-30)

- **Phases 1–3 are built and committed, and the P21 data pull is WORKING** via
  the SQL replica (see below). Phase 4+ (review/approve UI, `.txt` export, email
  intake, polish) not started.
- **All work is on branch `priceupdates-phase-3`** (stacked: phase-1 → phase-2 →
  phase-3; the phase-3 branch contains everything). **Not merged to `main`** on
  purpose — merge once production env vars are set. Check out
  `priceupdates-phase-3` to continue.
- **Mirror fill — RESOLVED: the read-only SQL replica.** Epicor provisioned a
  `readonly_*` SQL account; the replica (`p21us-read10.epicordistribution.com`,
  db `az_131184_live`) is **publicly reachable over TLS**, so the Vercel-cron
  architecture stands — no in-network runner needed. New client
  `src/lib/p21sql.js`; `/api/p21/sync-items` auto-prefers SQL over OData.
  **Verified live 2026-07-30: 71,503 rows upserted in ~27s** (Gates 10638:
  28,467 · ContiTech 10629: 38,227 · Parker 10140: 4,809 — real supplier ids,
  looked up in the replica, now set on `pu_vendors`). Production unknown:
  whether Epicor IP-restricts the replica (first deployed cron run will tell).
- **OData path (fallback, still gateway-blocked):** token auth + catalog +
  $metadata all work, but **every OData data query returns 401** ("You are not
  authorized to access API") — for two different users and even with a
  registered consumer key (app `PRS-PriceUpdates`, scope `/odata`, type Service;
  token confirms `aud:/odata`). It's a user-level grant on Epicor's side
  (EpicCare ticket if we ever need OData); not a code issue. `P21_CONSUMER_KEY`
  is wired into `src/lib/p21.js` should it come through.

## New-device setup

1. `git clone https://github.com/plawless-prs/it-asset-tracker.git`
2. `git checkout priceupdates-phase-3`
3. `npm install`
4. **Recreate `.env.local`** — it is git-ignored and does **not** travel with the
   repo. Copy it securely from the old machine, or rebuild it from the key list
   below (values are secrets kept on the old device / in the respective consoles).
5. **(Optional, testing only)** copy the git-ignored real data files — they don't
   travel with the repo either: `price-update-processor/samples/GAT2026.txt`
   (real Gates import sample, used to shape the Phase 5 exporter).
6. **Supabase is cloud and shared** — migrations `01`–`11` are already applied to
   the project; nothing to re-run on a new device. (Only if pointing at a *fresh*
   Supabase project: run every `supabase/*.sql` in numbered order.)
7. `npm run dev`.

## `.env.local` keys (names only — bring the secret values from the old device)

- **Supabase:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`
- **P21 SQL replica (the working sync source):** `P21_SQL_HOST`, `P21_SQL_PORT`,
  `P21_SQL_DATABASE`, `P21_SQL_USERNAME`, `P21_SQL_PASSWORD` (Epicor-provisioned
  `readonly_*` account).
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

- The mirror is synced (71.5k rows). Next verification step: open a Gates batch
  → **Re-run matching**; confirm old→new cost, Δ%, flags populate. Then start
  Phase 4.
- Remaining phases: **4** review/approve UI · **5** `.txt` export (tab-delimited:
  `Item ID⇥List Price⇥New Cost⇥Supplier ID`, see `samples/README.md`) · **6**
  email intake from `priceupdate@` · **7** polish.
