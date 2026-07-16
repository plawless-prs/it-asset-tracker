# Claude Code Build Spec — PRS Help Desk (+ KB) and Daily Ops

_Hand this file to Claude Code from the root of the PRS Apps repo. It's written as a working brief: context, constraints, then a phased task list Claude Code can execute. Build **Help Desk first**; Daily Ops is a separate later phase._

---

## How to use this with Claude Code

1. Open the PRS Apps repo in your terminal and run `claude`.
2. Start with: _"Read `ticketing-transition/03-claude-code-build-spec.md` and `02-data-model.md`. Confirm the plan, then start Phase 1. Don't touch the Invoice Processor yet."_
3. Have Claude Code work phase by phase and run/lint after each. Review diffs before committing.

---

## Project context (give this to Claude Code verbatim)

- **App:** PRS Apps — internal tool hub for Power & Rubber Supply, deployed at prstech.app.
- **Stack:** Next.js, Supabase (Postgres + Auth + Storage), Vercel. GitHub Actions for CI/maintenance.
- **Existing patterns to follow — match these, don't reinvent:**
  - Per-user app permissions via an `app_access JSONB` column on `profiles`.
  - A `useRole` custom hook (**named export** — `import { useRole }`) exposing `hasAccess(appId)`.
  - Each app page guards access with `hasAccess(...)`; `Navigation.js` filters menu entries by `hasAccess`.
  - Dark theme design system already used by the Material Calculator — reuse its components/styles.
  - Supabase client usage as already wired in the repo (find existing examples before adding new ones).
- **New app IDs:** `helpdesk` and `dailyops`.
- **Do not** modify or "fix" the Invoice Processor in this work. It will be retired separately (`04-deprecation-checklist.md`). In particular, do **not** build the Supabase session-storage rebuild for `global.invoiceSessions` — that feature is being removed.

## Scope note — IT team only

The Help Desk is **internal to the IT team**. There is **no end-user / employee self-service portal** — employees do not log in. IT agents log tickets on behalf of requesters (from email, phone, or walk-up), so every authenticated user is an agent. `requester_id` records the employee who reported the issue for tracking/reporting only. Do **not** build a public portal, end-user ticket submission, or customer-facing KB. The KB is an **internal reference** for the IT team.

## UI styling — match Freshservice

The target look is **Freshservice's agent workspace** (Porter reviewed it as the reference). Apply these across all Help Desk and Daily Ops screens, adapted to the existing PRS dark-theme design system:

- **App shell:** a slim vertical **icon rail** on the left (dashboard, tickets, KB, daily ops, reports) + a top bar with breadcrumb, global search, and avatar. The rail is the primary nav for these apps.
- **Dense list/table** for the ticket queue — compact rows, checkboxes, sortable columns, a right-hand collapsible **filter panel**.
- **Soft rounded status pills** and **colored priority dots** (urgent = red, high = amber, medium = neutral, low = muted). Show **SLA state** ("Overdue" / "Due today" / "On time") as a separate pill from workflow **Status** (see `02-data-model.md`).
- **Ticket detail = two panes:** main thread (description, tabs: Details / Tasks / Related / Activities, conversation with Reply / Forward / Add note) on the left, a **properties sidebar** on the right (status, priority, SLA countdowns that turn red when breached, requester, group, assignee, and a primary Update button).
- **Color:** clean light surfaces, **blue** as the link/accent color, **green** for the primary save/update action, **red** for overdue/SLA breach. Keep it flat and uncluttered.

## Global constraints

- Reuse existing UI primitives, Supabase client, and auth helpers — search the repo first; only add new dependencies if nothing exists.
- All new tables get RLS policies (see `02-data-model.md`). Never ship a table with RLS off.
- Keep each app page behind its `hasAccess(appId)` guard and add the entry to `Navigation.js`.
- Mobile-friendly: the Daily Ops checklist (and ticket views) should be usable on phones.
- Write the SQL as migration files in the repo's existing migrations location (match the current convention).
- Compute **SLA due times** from `priority` on insert and derive **SLA state** in a view/query (don't hand-set it) — see `02-data-model.md`.

---

## PHASE 1 — App shell + dashboard (landing view)

**Goal:** the Help Desk opens to a Freshservice-style dashboard with the icon rail and top bar.

Tasks:
1. Create migration with the **Part A** tables, `sla_policies`, the SLA trigger, and `ticket_list_view` from `02-data-model.md` (`tickets`, `ticket_comments`, `ticket_attachments`, `ticket_activity`, enums, `is_agent()`, `set_updated_at()`). Seed a few sample tickets so the dashboard isn't empty.
2. Register app ID `helpdesk`; default off except the owner's profile. Add the guard + `Navigation.js` entry.
3. Build the **app shell**: left icon rail (dashboard, tickets, KB, daily ops, reports) + top bar (breadcrumb, search, avatar).
4. `/helpdesk` (dashboard) — these widgets only (omit source breakdown, leaderboard, and resolution-time per Porter):
   - **Metric cards** (counts, computed from `ticket_list_view`): Overdue, Due today, Open, On hold/Waiting, Unassigned, Watching.
   - **Unresolved tickets by priority** — donut chart.
   - **Unresolved tickets by status** — donut chart.
   - **New & my open tickets by priority** — horizontal bars (Low/Medium/High/Urgent).
5. Use the repo's existing chart approach if any; otherwise a lightweight chart lib (e.g. Recharts/Chart.js) consistent with the Material Calculator styling.
6. Lint/typecheck.

**Acceptance:** opening `/helpdesk` shows the dashboard with live counts and the two donuts + priority bars.

## PHASE 2 — Help Desk: ticket queue & detail

**Goal:** IT agents work the queue and drive tickets to resolution. (No end-user submission — IT logs tickets; see scope note.)

Tasks:
1. `/helpdesk/tickets` — dense **queue table**: checkbox, subject + `#number` + requester, **SLA state** pill (from `ticket_list_view.sla_state`), **Status**, **Priority** dot, assignee. Right-hand **filter panel** (status, priority, assignee, due-by, source). Sort + pagination.
2. `/helpdesk/tickets/new` — agent logs a ticket on a requester's behalf: title, description, requester (lookup), category, priority, **source** (email/phone/manual). SLA due times set automatically by the trigger.
3. `/helpdesk/tickets/[id]` — **two-pane detail**: left thread (Details / Tasks / Related / Activities tabs, conversation with Reply / Forward / Add note, `is_internal` notes); right **properties sidebar** (status, priority, SLA countdowns turning red when breached, requester, group, assignee, **Update** button).
4. First agent reply stamps `first_responded_at`. Status/assignee/priority changes write to `ticket_activity`.
5. Lint/typecheck; verify SLA state flips to "Overdue" once `resolution_due` passes.

**Acceptance:** agent can log a ticket, see it in the queue with correct SLA pill, open it, reply, reassign, and resolve.

## PHASE 3 — Help Desk: comments, attachments, notifications

1. Threaded comments on the detail page; `is_internal` toggle visible only to agents.
2. Attachments via a Supabase Storage bucket (e.g. `helpdesk-attachments`); store path/name/size in `ticket_attachments`. Enforce a size limit and allowed types.
3. Email notification on new ticket and on reply. Prefer an existing email path in the repo; otherwise a Supabase Edge Function or a simple transactional email provider. Keep it minimal — assignee gets notified on new ticket, requester on agent reply.
4. Lint/typecheck; manual test of upload + notification.

## PHASE 4 — Knowledge Base (internal IT reference, module of Help Desk)

1. Migration with **Part B** tables (`kb_categories`, `kb_articles`) + RLS.
2. Routes:
   - `/helpdesk/kb` — searchable list of **published** articles (full-text search on title+body).
   - `/helpdesk/kb/[slug]` — article view (render markdown); "Was this helpful?" buttons increment `helpful_count`/`not_helpful`.
   - `/helpdesk/kb/manage` — CRUD (draft/publish/archive).
3. On the ticket detail/new screen, show suggested KB articles matching the title text so the agent can quickly find a known fix or link it in a reply.
4. Seed 5–10 starter articles for common IT issues (placeholder content is fine).
5. Lint/typecheck.

## PHASE 5 — Daily Ops (separate app `dailyops`)

**Goal:** recurring SOP checklists (esp. daily) plus one-off tasks.

1. Migration with **Part C** tables + RLS.
2. Register app ID `dailyops`; default off except owner.
3. Routes:
   - `/dailyops` — today's view: each active template renders as a checklist card; checking an item upserts `sop_item_status`. Use the **lazy instance creation** approach from `02-data-model.md` (upsert today's `sop_instances` + item rows on page load).
   - `/dailyops/templates` — agent-only CRUD for `sop_templates` + `sop_template_items` (reorder via `sort_order`).
   - `/dailyops/tasks` — list/create one-off `tasks`; assign, set due date/priority, mark done.
4. Guard with `hasAccess('dailyops')`; add to `Navigation.js`.
5. (Optional) GitHub Action mirroring your existing keep-alive workflow to pre-create daily instances at midnight if you want due-tracking without a page open.
6. Lint/typecheck.

## PHASE 6 — Polish & pilot readiness

1. Empty states, loading states, and error toasts consistent with the Material Calculator's styling.
2. Admin: confirm the `app_access` checkboxes correctly toggle `helpdesk`/`dailyops` per user.
3. Seed the KB; create a couple of SOP templates.
4. Smoke-test the dashboard, queue, detail, KB, and Daily Ops with an IT-team test profile.

---

## Out of scope (explicitly)

- Any change to the Invoice Processor (handled in `04-deprecation-checklist.md`).
- **End-user / employee self-service portal and public-facing KB** — the tool is IT-team only.
- CSAT surveys, multi-tenant orgs — defer unless requested.
- Real-time websockets — polling/refresh is fine for v1.

## Commit & review guidance for Claude Code

- One migration per phase; one logical PR per phase.
- After each phase: run lint + typecheck, summarize the diff, and stop for Porter's review before moving on.
- Never commit secrets; use the repo's existing env var pattern for Supabase keys.
