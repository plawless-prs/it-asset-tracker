# PRS Apps — agent guide

Internal tool hub for **Power & Rubber Supply**, deployed at **prstech.app**. Despite the repo name (`it-asset-tracker`, its original single purpose), it's now a multi-app hub. Read this before making changes.

## Keep this guide current

When a change alters something this file describes — architecture, a convention, the app list, environment variables, commands, or a new gotcha — update this file **as part of the same change**, and mention that you did. Don't log routine changes here: this is a durable map loaded every session, not a changelog. Keep it lean and high-signal.

## Changelog

Record **notable** changes (new features, schema/infra changes, behavior changes, new gotchas) in `CHANGELOG.md`, newest first. Every entry requires a **date heading** (`## YYYY-MM-DD`) and a **one-to-two-line bullet** describing the change. Add to the existing date section if it's the same day, otherwise start a new one. Keep entries terse — git history holds the fine detail; skip trivial/routine changes.

## Stack & deploy

- **Next.js (App Router)** + **React**, all UI in plain inline styles (no Tailwind/CSS modules in app code).
- **Supabase** — Postgres + Auth + Storage. Client via `src/lib/supabase.js` (`createClient()`), server/service-role via `src/lib/supabaseAdmin.js` (`createAdminClient()` — never import into a client component).
- **Vercel** — pushing to `main` auto-deploys to production. `vercel.json` defines a daily cron.
- **Canonical domain is `https://www.prstech.app`.** The apex `prstech.app` 307-redirects to `www`. Anything that must not be redirected (Graph webhooks, external callers) must use the `www` host.

## The apps

Each app is gated per-user. Current apps: **IT Tracker** (`tracker`), **Material Calculator** (`calculator`), **Help Desk** (`helpdesk`), **Daily Ops** (`dailyops`, planned). The **Invoice Processor** (`invoices`) is being retired (see `docs/deprecation-checklist.md`).

## Auth, roles & per-app access (important, easy to get wrong)

- `src/lib/useRole.js` — the `useRole()` hook exposes `role`, `isAdmin`, `user`, `loading`, and **`hasAccess(appId)`** = `isAdmin || appAccess.includes(appId)`. `app_access` is a **JSONB array of app-id strings** on `profiles` (not an object of booleans). **Admins always see every app.**
- **Registering a new app touches THREE files** — keep them in sync:
  1. `src/components/navigation.js` — the `tools` array (top-nav dropdowns).
  2. `src/app/page.js` — the home-page tile grid.
  3. `src/app/admin/page.js` — the `allApps` array (admin access checkboxes).
- Every app page guards itself: `if (!loading && !hasAccess('<appId>')) router.push('/')`. For multi-page apps, do it once in the app's `layout.js` (see `src/app/helpdesk/layout.js`).
- `src/middleware.js` redirects logged-out users to `/login` for everything **except** the public webhook API routes listed in its `matcher` (Graph notify/subscribe, inbound email). If you add a public/externally-called API route, add it to that exclusion or it will 307-redirect and break.

## Data access & RLS

- Row-Level Security is **on** for every table; policies target the `authenticated` role. `is_agent()` = `profiles.role = 'admin'`.
- Client components read/write through the anon client and are constrained by RLS.
- **Server API routes that act without a user session** (inbound email, notifications) use the **service-role** client, which bypasses RLS by design. Guard them yourself (shared token / bearer / Graph `clientState`).

## Help Desk (main recent build)

- Routes under `src/app/helpdesk/`: dashboard (`/helpdesk`), ticket queue (`/tickets`), new (`/tickets/new`, agent logs on behalf of a requester), detail (`/tickets/[id]`), KB (`/kb`, `/kb/[slug]`, `/kb/manage`).
- Shared helpers in `src/lib/helpdesk.js` (status/priority/SLA/category metadata + formatters) and `src/lib/kb.js` (slug + minimal markdown).
- **Status vs. State:** `status` is the workflow (`open→in_progress→waiting→resolved→closed`); SLA **state** (`overdue/due_today/on_time`) is *derived* (SQL `ticket_list_view` + JS `slaState()`), never stored.
- **SLA timers** come from the `sla_policies` table by priority, stamped on insert and recalculated on priority change (DB triggers). Change the windows by editing that table, not code.
- **Categories** are a `category` text field; the shared list + labels live in `CATEGORY_OPTIONS`/`categoryLabel` in `src/lib/helpdesk.js`.
- **Email (Microsoft Graph, not Power Automate):** inbound via Graph push subscriptions → `POST /api/helpdesk/graph-notify` creates a ticket; `POST /api/helpdesk/graph-subscribe` creates/renews subscriptions (daily Vercel cron). Outbound sends as `it@` via Graph (`/api/helpdesk/notify`, Power Automate fallback retained). The mailbox→category queue is carried in the subscription `clientState` (`<secret>|<queue>`), because Graph's notification `resource` uses an internal id, not the email. `it@` → general; `priceupdate@` → `price_update` category. Full setup: `docs/email-setup-graph.md`.

## IT Tracker (asset management)

Being fleshed out in stages (see `CHANGELOG.md`; **Stage 0 done**, employees/rack views to come).

- Routes under `src/app/tracker/`: dashboard (`/tracker`), assets list (`/tracker/assets`), licenses, budget, history. Guarded once in `src/app/tracker/layout.js` via `hasAccess('tracker')`.
- Shared helpers live in **`src/lib/tracker.js`** (statuses, categories, asset **types** with a `computer` flag, status colors, `formatCurrency`/`formatDate`, straight-line depreciation) — reuse these instead of re-declaring inline.
- **Schema:** tracker DDL is committed across numbered migrations starting at `supabase/05_tracker_schema.sql` (the tables predated it and were hand-made, so migrations are idempotent/additive). Tables: `assets`, `employees` (company directory, distinct from app-login `profiles`; `first_name`/`last_name` with `full_name` as the app-written combined value), `locations` → `rooms` (two-level hierarchy; employees/assets/racks carry `location_id` + optional `room_id`), `racks`, plus `licenses/budgets/purchases/subscriptions/audit_log`. Later migrations: `06` (employee name split), `07` (location→room hierarchy).
- **Asset IDs:** every asset gets an immutable `asset_tag` = `PRS-#####` (global `asset_tag_seq`, auto-assigned via column default). This ID is also the printed asset-tag label.
- **Rack membership:** a device with `rack_id` + `u_position` is mounted at that U; `rack_id` set with `u_position` NULL = "off-rack" (in the room, not physically racked). Rack total power is derived by summing device `watts`, not stored.
- `assigned_employee_id` (FK → `employees`) is the real assignment; the legacy free-text `assigned_to` is retained until Stage 1 migrates the UI.

## Environment variables

App: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
Email/Graph: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `GRAPH_CLIENT_STATE`, `IT_MAILBOX`, `PRICEUPDATE_MAILBOX`, `APP_BASE_URL` (= `https://www.prstech.app`), `HELPDESK_INBOUND_TOKEN`, `CRON_SECRET`. Optional Power Automate fallback: `POWER_AUTOMATE_NOTIFY_URL`.
**Never commit secrets.** Local secrets go in `.env.local` (gitignored); production in Vercel env vars.

## Commands

- `npm run dev` — local dev server.
- `npm run build` — production build.
- `npm run lint` — ESLint (Next flat config). Note: the codebase ships with some pre-existing lint warnings/errors; the build does not gate on them.

## Database

Migrations are plain SQL in `supabase/`, run manually in the Supabase SQL Editor **in numbered order** — see `supabase/README.md`. All are idempotent.

## Docs

`docs/` holds the transition plan, data model, build spec, deprecation checklist, and email-integration setup guides (`email-setup-graph.md` is current; `email-setup-power-automate.md` is the alternative).

## Conventions recap

- Match the existing dark-theme inline-style look (see any Help Desk page for the palette).
- Reuse `useRole`, `createClient`/`createAdminClient`, and the shared `lib/helpdesk.js` helpers rather than re-deriving.
- New tables ship with RLS on + policies. New public API routes get their own auth + a middleware exclusion.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
