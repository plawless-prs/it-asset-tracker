# Invoice Processor → Ticketing System: Transition Plan

_PRS Apps (prstech.app) · Next.js + Supabase + Vercel · Owner: Porter_

## Goal

Retire the **Invoice Processor** app and stand up a **Help Desk (ticketing) system** for internal IT/help requests, plus two adjacent capabilities: a **Knowledge Base / FAQ** and a **Daily Ops** module for recurring SOP checklists and one-off tasks. Retirement is a **soft-hide via the existing `app_access` permission system**, not an immediate code delete.

## Architecture decision (read this first)

You asked whether the extra functionality belongs inside the ticketing system. Recommendation:

| Capability | Where it lives | Why |
|---|---|---|
| **Tickets** (IT/help requests) | New **Help Desk** app | Core deliverable. |
| **Knowledge Base / FAQ** | **Inside** Help Desk, as a module | Classic ticket-deflection pairing — users search KB before filing; agents link articles in replies. Shares the same users, categories, and search surface. |
| **Daily SOP checklists + one-off tasks** | **Separate** app: **Daily Ops** | Different mental model. Tickets are *inbound requests routed to IT*; SOP checklists are *recurring templated work everyone performs on a schedule*. Different primary users, lifecycle, and UI. Forcing it into the ticket schema bloats the model and confuses both surfaces. It shares the Supabase backend and `app_access` plumbing, so it's cheap to keep separate. |

Net: build **two apps** in the hub (Help Desk, Daily Ops). KB is a module of Help Desk. All three reuse `profiles`, `app_access`, and `useRole`/`hasAccess` that already exist.

## Guiding principles for this transition

- **Don't fix what you're killing.** The most pressing open issue in the codebase is the in-memory `global.invoiceSessions` loss on Vercel cold starts. Since the Invoice Processor is being retired, **do not invest in the Supabase session-storage rebuild for it.** Redirect that effort into the ticketing build. (If invoice generation must keep working during the grace period, see Phase 1 note.)
- **Permission-gated, reversible cutover.** Soft-hide flips a flag in `app_access`; it's instantly reversible and touches no routes or data.
- **Ship the new app behind the same permission gate** so you can pilot with yourself / a small group before exposing it company-wide.
- **Preserve invoice data and code** through the grace period; delete only after a defined retention window with no complaints.

## Phases

### Phase 0 — Prep (before any user-visible change)
- Confirm who currently uses the Invoice Processor and how often (check Vercel/Supabase logs or just ask the team).
- Decide the retention window for invoice code/data (suggest **60 days** of soft-hide before hard removal).
- Create the new Supabase tables (see `02-data-model.md`) in a migration. No UI yet.
- Register the new app IDs (`helpdesk`, `dailyops`) in the app registry / `app_access` model, defaulted **off** for everyone except you.

### Phase 1 — Build Help Desk behind a permission gate
- Scaffold the Help Desk app from `03-claude-code-build-spec.md` (tickets + KB).
- Access limited to you (and 1–2 pilot users) via `app_access`.
- **Invoice Processor stays fully live and visible** during this phase — no user impact yet.
- _Note on the session bug:_ if cold-start invoice failures are actively hurting users right now, the cheapest stopgap is not the full Supabase rebuild but reducing reliance on it during the short remaining life (e.g., generate-and-download in a single request, or warn users to retry). Don't over-engineer a dying feature.

### Phase 2 — Pilot & feedback
- Pilot users file real tickets, seed 5–10 KB articles for the most common requests.
- Tune statuses, categories, and notifications based on actual use.
- Build **Daily Ops** in parallel (it's independent of the invoice retirement) once Help Desk is stable.

### Phase 3 — Cutover (soft-hide the Invoice Processor)
- Announce to users (see comms template below).
- Flip `app_access`: enable `helpdesk` (and `dailyops`) for the company; **disable `invoice` for everyone**.
- The Invoice Processor page guard + `Navigation.js` filter (already built into your `hasAccess(appId)` pattern) hides it automatically. Routes and code remain in place but unreachable from the UI.
- Optionally add a redirect on the old invoice route → Help Desk with a short "this tool has moved/retired" notice.

### Phase 4 — Grace period & monitoring (≈60 days)
- Keep invoice code deployed but hidden. If someone genuinely still needs it, re-enabling is a one-checkbox flip.
- Track ticket volume and KB deflection. Confirm no one is blocked by the invoice removal.

### Phase 5 — Hard removal
- After the grace period with no blockers, run `04-deprecation-checklist.md`: delete routes, components, API handlers, the `pdf-parse` dependency, and any invoice-only Supabase tables (after a final backup/export).
- Remove the `invoice` app ID from the registry and clean up `app_access` JSON.

## Timeline (suggested, adjust to your pace)

| Phase | Effort | Calendar |
|---|---|---|
| 0 Prep | 0.5 day | Day 1 |
| 1 Build Help Desk | 2–4 days | Week 1 |
| 2 Pilot + build Daily Ops | 1–2 weeks | Weeks 2–3 |
| 3 Cutover | 0.5 day | End of Week 3 |
| 4 Grace period | passive | Weeks 4–11 |
| 5 Hard removal | 0.5 day | Week 12 |

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Someone still depends on invoice processing after cutover | Soft-hide is instantly reversible; 60-day grace window before deletion. |
| New ticketing app not adopted; users email/Slack instead | Make it the *only* sanctioned channel; seed KB; keep the form fast (1 screen). |
| Data loss when finally deleting invoice tables | Export to CSV/JSON and store a backup before any `DROP`. |
| Scope creep from the "extra functionality" | KB ships with v1; Daily Ops is a separate, later app — don't block ticketing on it. |
| Permission misconfiguration exposes/hides wrong app | Test `hasAccess` for each app with a non-admin test profile before announcing. |

## User communication template

> **Subject: New PRS Help Desk — submit IT & support requests here**
>
> Team — we've launched a Help Desk in PRS Apps for IT and support requests. Going forward, please file issues there instead of [current channel]. It tracks your request to resolution and has a Knowledge Base with answers to common questions.
>
> The Invoice Processor tool has been retired and removed from the app menu. If you have a billing/invoice need, file a Help Desk ticket and we'll handle it.
>
> Questions? File a ticket (meta, but it works).

## Deliverables in this folder

1. `01-transition-plan.md` — this document.
2. `02-data-model.md` — Supabase schema for Help Desk (tickets + KB) and Daily Ops.
3. `03-claude-code-build-spec.md` — hand this to Claude Code in your repo to scaffold the apps.
4. `04-deprecation-checklist.md` — step-by-step Invoice Processor retirement.
