# Claude Code Build Spec — Price Update Processor (app id `priceupdates`)

_Hand this file to Claude Code from the root of the PRS Apps repo (`plawless-prs/it-asset-tracker`). It's written as a working brief: context, constraints, data model, then a phased task list Claude Code can execute. This is the successor to the retired Invoice Processor's "price update" duty and the first app to integrate with Prophet 21._

---

## How to use this with Claude Code

1. Open the PRS Apps repo in your terminal and run `claude`.
2. Start with: _"Read `AGENTS.md`, then `price-update-processor/build-spec.md`. Confirm the plan, then start Phase 1."_
3. Work phase by phase; run lint/typecheck after each. Review diffs before committing.

---

## Project context (give this to Claude Code verbatim)

- **App:** PRS Apps — internal tool hub for Power & Rubber Supply, deployed at prstech.app.
- **Stack:** Next.js, Supabase (Postgres + Auth + Storage), Vercel. `AGENTS.md` at the repo root is the source of truth for architecture, conventions, env vars, and gotchas — read it before writing code.
- **Existing patterns to follow — match these, don't reinvent:**
  - Per-user app permissions via the `app_access JSONB` column on `profiles`; `useRole` hook (**named export**) exposing `hasAccess(appId)`; page guards + `Navigation.js` filtering.
  - The Freshservice-style shell built for Help Desk (slim left icon rail, top bar, dense tables, soft status pills, colored dots) — reuse those components and the same visual language.
  - Supabase client usage as already wired in the repo; SQL migrations live in `supabase/` (numbered, idempotent, run in the Supabase SQL Editor — see `supabase/README.md`).
  - Microsoft Graph is already wired: an Entra app with `Mail.Read`/`Mail.Send`, scoped by Application Access Policy to `it@` and `priceupdate@`. Inbound push webhooks hit `/api/helpdesk/graph-notify`; a daily Vercel cron renews subscriptions via `/api/helpdesk/graph-subscribe`. **Reuse this app registration and token plumbing — do not register anything new.**
- **New app ID:** `priceupdates`. Default off for everyone except the owner's profile.

## The problem this app solves

Vendors email price/cost updates to `priceupdate@powerandrubber.com` (today these just become Help Desk tickets with category `price_update` and pile up). Files arrive as **Excel/CSV**, **PDF price sheets**, and sometimes **prices in the email body or portal links**. Someone must massage them in Excel and load them through **P21's built-in import tool**. Stale costs mean quoting off wrong margins.

The app turns that into a pipeline: **intake → parse → match against P21 items → review/approve with guardrails → export a clean, ready-to-load P21 import file**. A human still loads the file into P21 and clicks "mark applied" — v1 does **not** write to P21.

## Prophet 21 integration facts

- P21 is **Epicor cloud-hosted**; PRS **has the API license**. There is no direct SQL access.
- **Reads:** P21 REST/OData API. Auth = POST credentials of a P21 API user to the token endpoint, get a bearer token, call OData views. Community docs: `github.com/mrwuss/p21-api-documentation`. Confirm exact view names for items and supplier/item cost data during the build (Porter can check field names in P21 or with Epicor support if a view guess 404s).
- Build the P21 client as a **shared lib** (e.g. `lib/p21.js`): token fetch + caching + refresh, paged OData GET helper, retry with backoff. Future apps (quote dashboard, dead-stock report) will reuse it — keep it app-agnostic.
- **Writes to P21 (Transaction API) are explicitly out of scope for v1.** The export file + P21's import tool is the write path.
- Env vars (Vercel): `P21_BASE_URL`, `P21_USERNAME`, `P21_PASSWORD` (API service account). Never hardcode; never commit.

## Batch lifecycle

`received → parsing → needs_review → approved → exported → applied` (plus `failed` and `archived`). Status is workflow, driven by the user/pipeline. The queue also shows a derived attention pill (e.g. "Unmatched lines", "Large changes") computed from line data — same status-vs-derived-state idea as Help Desk SLA pills.

---

## Data model (migration SQL — adapt to `supabase/` conventions)

Reuses `set_updated_at()` and the `profiles` FK conventions already in the repo. All tables get RLS; everyone with `priceupdates` access may read/write app data (IT-run internal tool — mirror the pragmatic RLS style used for Daily Ops, with `app_access`/`is_agent()` as the backstop).

```sql
create type price_batch_status as enum
  ('received','parsing','needs_review','approved','exported','applied','failed','archived');
create type price_batch_source as enum ('email','upload');
create type parse_status  as enum ('pending','parsed','failed','manual');
create type match_status  as enum ('matched','unmatched','ambiguous','new_item');
create type line_flag     as enum ('ok','large_increase','decrease','cost_over_list','new','review');

-- Vendors we receive price files from
create table pu_vendors (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  p21_supplier_id  text,             -- P21 supplier identifier, for matching
  email_domains    text[] default '{}',  -- e.g. {'gates.com'} to auto-identify inbound mail
  notes            text,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Saved parsing recipe per vendor + file shape (how to read their spreadsheet)
create table pu_parse_profiles (
  id           uuid primary key default gen_random_uuid(),
  vendor_id    uuid not null references pu_vendors(id) on delete cascade,
  label        text not null,                -- e.g. "2026 net price file"
  config       jsonb not null,               -- {sheet, header_row, skip_rows, columns:{vendor_item_no,description,uom,cost,list,effective_date}, transforms:{multiplier, discount_pct, strip_prefix}}
  created_by   uuid not null references profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- One inbound price update event (an email or a manual upload)
create table pu_batches (
  id             uuid primary key default gen_random_uuid(),
  number         bigint generated always as identity,
  vendor_id      uuid references pu_vendors(id),      -- nullable until identified
  source         price_batch_source not null,
  status         price_batch_status not null default 'received',
  email_message_id text unique,                       -- Graph message id (dedupe)
  email_from     text,
  email_subject  text,
  email_body     text,                                -- for body-price / portal-link cases
  received_at    timestamptz not null default now(),
  effective_date date,
  line_count     int not null default 0,
  matched_count  int not null default 0,
  flagged_count  int not null default 0,
  reviewed_by    uuid references profiles(id),
  approved_by    uuid references profiles(id),
  approved_at    timestamptz,
  exported_at    timestamptz,
  applied_at     timestamptz,                         -- stamped when user confirms P21 load
  applied_by     uuid references profiles(id),
  error          text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on pu_batches (status);
create index on pu_batches (vendor_id);

-- Files attached to a batch (stored in Supabase Storage bucket `price-files`)
create table pu_batch_files (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid not null references pu_batches(id) on delete cascade,
  storage_path  text not null,
  file_name     text not null,
  mime_type     text,
  file_size     bigint,
  parse_status  parse_status not null default 'pending',
  parse_profile_id uuid references pu_parse_profiles(id),
  parsed_rows   int,
  error         text,
  created_at    timestamptz not null default now()
);

-- One row per price line extracted from a file (or keyed manually from a PDF)
create table pu_lines (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid not null references pu_batches(id) on delete cascade,
  file_id         uuid references pu_batch_files(id) on delete cascade,
  row_number      int,
  raw             jsonb,               -- original row as parsed, for audit
  vendor_item_no  text,
  description     text,
  uom             text,
  new_cost        numeric(14,4),
  new_list        numeric(14,4),
  effective_date  date,
  -- matching against the P21 mirror:
  p21_item_id     text,
  match_status    match_status not null default 'unmatched',
  old_cost        numeric(14,4),       -- snapshot from mirror at match time
  old_list        numeric(14,4),
  cost_change_pct numeric(8,2),
  flag            line_flag not null default 'review',
  include         boolean not null default true,   -- unchecked lines are left out of export
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on pu_lines (batch_id);
create index on pu_lines (match_status);

-- Read-only mirror of P21 item + supplier-cost data, refreshed by cron
create table p21_item_mirror (
  p21_item_id      text not null,
  supplier_id      text,
  supplier_part_no text,
  item_desc        text,
  uom              text,
  current_cost     numeric(14,4),
  current_list     numeric(14,4),
  last_synced_at   timestamptz not null default now(),
  primary key (p21_item_id, supplier_id)
);
create index on p21_item_mirror (supplier_part_no);

-- Generated export files
create table pu_exports (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid not null references pu_batches(id) on delete cascade,
  storage_path text not null,
  file_name    text not null,
  row_count    int not null,
  created_by   uuid not null references profiles(id),
  created_at   timestamptz not null default now()
);

-- Guardrail thresholds (single-row config)
create table pu_settings (
  id                     int primary key default 1,
  large_increase_pct     numeric(6,2) not null default 20,   -- flag if cost rises more than this
  flag_decreases         boolean not null default true,
  flag_cost_over_list    boolean not null default true
);
insert into pu_settings (id) values (1) on conflict do nothing;
```

Storage: one **private** bucket `price-files` for inbound files and generated exports.

---

## PHASE 1 — Migration, app shell, batch queue, manual upload

**Goal:** the app exists and is usable before any email or P21 wiring — drag in a file, see a batch.

1. Migration with all tables above + RLS + `price-files` bucket. Seed 2–3 vendors and a sample batch.
2. Register app ID `priceupdates` (default off except owner); guard + `Navigation.js` entry. Reuse the Help Desk shell (icon rail entries: Dashboard, Batches, Vendors, Settings).
3. `/priceupdates` — dashboard: metric cards (Awaiting review, Unmatched lines, Approved not exported, Exported not applied, Applied this month) + a recent-batches table.
4. `/priceupdates/batches` — dense queue table: `#number`, vendor, source, received date, line/matched/flagged counts, **status pill**, attention pill. Filters: status, vendor.
5. Manual intake: "New batch" → pick/create vendor, drag-drop file(s) → creates `pu_batches` + `pu_batch_files` in Storage, status `received`.
6. Lint/typecheck.

**Acceptance:** upload an Excel file → batch appears in the queue with its file attached.

## PHASE 2 — Parsing engine (Excel/CSV) + column-mapping UI

**Goal:** turn spreadsheets into `pu_lines` without hand-editing in Excel.

1. Server-side parse route: for `.xlsx`/`.xls` use SheetJS (`xlsx`), for `.csv` use PapaParse (or SheetJS too). Extract to raw rows.
2. **Mapping UI** (`/priceupdates/batches/[id]/map`): show the first ~30 rows as a grid; user picks header row and assigns columns (vendor item #, description, UOM, cost, list, effective date) plus optional transforms (multiplier / discount % off list, strip prefix). Apply → writes `pu_lines`, sets file `parse_status='parsed'`.
3. **Save as parse profile** for the vendor. When a new file arrives from a vendor with a profile, auto-apply it; only fall back to the mapping UI when the profile fails or none exists.
4. Store the untouched row in `raw` jsonb; numbers parsed defensively (strip `$`, commas; blank ≠ zero — skip lines with no usable price and count them).
5. Lint/typecheck. Test with a real vendor file.

**Acceptance:** a known vendor's file parses to lines automatically; an unknown file walks through mapping once and the profile sticks.

## PHASE 3 — P21 client, item mirror sync, matching

**Goal:** every line knows its P21 item and old cost.

1. `lib/p21.js`: token fetch against `P21_BASE_URL` token endpoint, cached until expiry; paged OData GET helper; retry/backoff. Keep it generic for future apps.
2. `/api/p21/sync-items` (protected by `CRON_SECRET`, same pattern as the Graph renewal cron): pull item + supplier cost data into `p21_item_mirror` (upsert). Add to `vercel.json` crons — nightly. Also a "Sync now" button on Settings.
   - Confirm the correct OData views/fields during build (item master + supplier/item cost). If the hosted instance's view names differ from the community docs, adjust — treat view names as config, not gospel.
3. Matching pass (runs after parse, re-runnable): match `vendor_item_no` → `p21_item_mirror.supplier_part_no` scoped to the batch vendor's `p21_supplier_id`; normalize (trim, case, strip dashes) before comparing. Exactly one hit = `matched` (fill `p21_item_id`, `old_cost`, `old_list`, compute `cost_change_pct`); multiple = `ambiguous`; none = `unmatched` (likely `new_item` — leave for the reviewer to decide).
4. Flag rules from `pu_settings`: `large_increase`, `decrease`, `cost_over_list`, else `ok`. Update batch counts; status → `needs_review`.
5. Lint/typecheck.

**Acceptance:** after parsing, most lines show old vs. new cost with a % change and sensible flags.

## PHASE 4 — Review & approval UI

**Goal:** a buyer can clear a batch in minutes, not an afternoon in Excel.

1. `/priceupdates/batches/[id]` — two-pane like a Help Desk ticket: left = the **line grid** (vendor item #, description, old cost → new cost, Δ%, flag dot, match pill, include checkbox); right = **properties sidebar** (vendor, status, effective date, counts, files, timeline, primary action button).
2. Grid filters/tabs: All / Flagged / Unmatched / Excluded. Inline edit on `new_cost`, `new_list`, `p21_item_id` (with a mirror-backed item search for fixing unmatched/ambiguous lines). Bulk include/exclude.
3. **Approve** (only when zero `ambiguous` lines remain among included ones): stamps `approved_by/at`, status → `approved`. Record activity (who approved, counts) in `notes` or a small activity table if trivial to add.
4. Mobile-usable is nice but this is a desktop-first screen — prioritize density.
5. Lint/typecheck.

**Acceptance:** open a parsed batch, fix an unmatched line, exclude a bad one, approve.

## PHASE 5 — Export file + applied loop-closing

**Goal:** produce the file that goes straight into P21's import tool, and track that it happened.

1. **Porter supplies a sample of the current P21 import template** (the exact columns/layout the import tool expects) — put it in `price-update-processor/samples/`. Build the exporter to emit that layout exactly (CSV or XLSX to match), from included+matched lines only.
2. "Generate export" on an approved batch → file written to Storage + `pu_exports` row + immediate download; status → `exported`.
3. "Mark applied" button after someone loads it into P21 → stamps `applied_at/by`, status → `applied`. Dashboard's "Exported not applied" card keeps unfinished loads visible.
4. Batch archive view for history/audit (what changed, when, who approved).
5. Lint/typecheck; round-trip test: file → parse → review → export → verify the export opens clean in Excel and matches the template.

**Acceptance:** an approved batch produces a P21-ready file with exactly the included lines, and the applied state closes the loop.

## PHASE 6 — Email intake from priceupdate@ (Graph)

**Goal:** vendor emails become batches automatically; nothing to forward or download by hand.

1. Extend the existing Graph inbound flow: when a notification is for the `PRICEUPDATE_MAILBOX`, create a **`pu_batches` row instead of a Help Desk ticket** — dedupe on `email_message_id` exactly like Help Desk does. (Remove the old `price_update` ticket category path; Help Desk keeps handling `it@` only.)
2. Fetch the message via Graph (`Mail.Read` is already granted), store subject/from/body on the batch, and download attachments into `price-files` → `pu_batch_files`.
3. Auto-identify the vendor by sender domain against `pu_vendors.email_domains`; if a parse profile exists, parse + match automatically so the batch lands in the queue already at `needs_review`.
4. **PDF files:** v1 does not auto-extract tables. Mark the file `parse_status='manual'` and build a split view — PDF rendered on the left (iframe/objecttag from a signed Storage URL), quick-entry line grid on the right (paste-friendly: accept rows pasted from the PDF as tab/space-separated text and parse them). Body-only emails and portal links: batch is created with the body preserved; user uploads the downloaded file to the same batch.
5. Lint/typecheck. Test: email a real vendor Excel file to priceupdate@ → batch appears parsed; email a PDF → batch appears with the manual-entry view ready.

**Acceptance:** the priceupdate@ inbox drains into the app with zero forwarding, and the Help Desk no longer collects price-update tickets.

## PHASE 7 — Polish

1. Empty/loading/error states consistent with Help Desk; toasts on approve/export.
2. `/priceupdates/vendors` — vendor CRUD incl. `p21_supplier_id`, email domains, and their saved parse profiles. `/priceupdates/settings` — guardrail thresholds + P21 sync status/"Sync now".
3. Confirm `app_access` checkbox toggles the app per user.
4. Smoke-test the full path both ways (manual upload and email intake).

---

## Out of scope (explicitly)

- **Writing to P21 via the Transaction API** — future phase, after the export flow has run reliably for a while.
- OCR of scanned/image PDFs (text-layer PDFs get the manual split view; scans are a later problem).
- Customer/contract pricing changes — this app handles **supplier cost / list** updates only.
- Auto-approve or auto-export without a human review step. Never.
- Any changes to Help Desk beyond removing the priceupdate@ → ticket path in Phase 6.

## Commit & review guidance for Claude Code

- One migration per phase (numbered, idempotent, in `supabase/`); one logical PR per phase.
- After each phase: lint + typecheck, summarize the diff, and stop for Porter's review before moving on.
- Never commit secrets; P21 and Graph credentials live in Vercel env vars per the existing pattern.
- Update `AGENTS.md` with the new app, its env vars, and the P21 client once Phase 3 lands.
