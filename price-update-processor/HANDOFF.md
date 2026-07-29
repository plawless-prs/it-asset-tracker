# Price Update Processor — status & new-device handoff

Snapshot so work can resume on another machine. Pairs with `build-spec.md` (the
plan), `../AGENTS.md` (architecture), and `../CHANGELOG.md` (what changed).

## Where things stand (2026-07-29)

- **Phases 1–3 are built and committed.** Phase 4+ (review/approve UI, `.txt`
  export, email intake, polish) not started.
- **All work is on branch `priceupdates-phase-3`** (stacked: phase-1 → phase-2 →
  phase-3; the phase-3 branch contains everything). **Not merged to `main`** on
  purpose — `main` auto-deploys to production and the app can't complete a P21
  sync yet. Check out `priceupdates-phase-3` to continue.
- **Current blocker — the P21 data pull:**
  - Token auth **works** against the play instance (`P21_BASE_URL=https://powerandrubber-play.epicordistribution.com`).
  - OData calls return **401 "You are not authorized to access API. Please
    contact administrator to get access."** → a **P21-side API-access grant** for
    the `PRICEUPDATE` user is pending (not a code issue).
- **Open decision — how to fill `p21_item_mirror`:** the Supabase mirror is the
  integration boundary; the app only reads it. Two ways to fill it:
  1. **OData API** (built) → Vercel cron. Blocked on the grant above; also needs
     Vercel egress IPs allowlisted at Epicor for production.
  2. **Read-only SQL replica** (under evaluation) → run Porter's join query
     directly. Simpler + always current + no API gate. If the DB is
     internal-only, run the sync from an **internal scheduled Node script**
     (`mssql`) that upserts into Supabase; Vercel never touches P21. Awaiting DB
     engine/location/reachability + connection details before building.

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
- **P21 (play):** `P21_BASE_URL` (= `https://powerandrubber-play.epicordistribution.com`),
  `P21_USERNAME`, `P21_PASSWORD`. Optional: `P21_CONSUMER_KEY` (if P21 admin issues
  a consumer key), plus the `P21_TOKEN_PATH` / `P21_ODATA_BASE` / `P21_*_VIEW` /
  `P21_F_*` overrides documented in `../AGENTS.md`.
- **Email/Graph + `CRON_SECRET`** etc. — only if exercising Help Desk locally; see
  `../AGENTS.md` "Environment variables".

Never commit `.env.local` or the real data files. Both are git-ignored — keep it
that way.

## To resume

- **If P21 API access gets granted:** Settings → **Test connection** → **Sync
  now**, then open a Gates batch → **Re-run matching**. Confirm old→new cost, Δ%,
  flags populate. Then start Phase 4.
- **If going the SQL route:** add `mssql`, write `scripts/sync-p21-sql.mjs` that
  runs the join query (`p21_view_inventory_supplier` × `p21_view_inv_mast` on
  `inv_mast_uid`, per supplier, `delete_flag='N'`) and upserts `p21_item_mirror`
  via the service role; schedule it on an in-network machine.
- Remaining phases: **4** review/approve UI · **5** `.txt` export (tab-delimited:
  `Item ID⇥List Price⇥New Cost⇥Supplier ID`, see `samples/README.md`) · **6**
  email intake from `priceupdate@` · **7** polish.
