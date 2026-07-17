# Changelog

Notable changes to PRS Apps, newest first. Each entry is a date heading (`## YYYY-MM-DD`) followed by 1–2 line bullets. Routine/trivial changes live in git history, not here.

## 2026-07-17

- **Dev onboarding:** added `.env.example` (env-var template, no secrets; `!.env.example` un-ignored) and a "Setting up on a new machine" section in `README.md` (prereqs → clone → `.env.local` → run).
- **Agent config:** committed `.claude/settings.json` — auto-approves routine tool use, keeps `git add/commit/push` behind an `ask` prompt, and denies destructive commands (recursive deletes, `git reset --hard`, force-push, etc.).

## 2026-07-16 — Help Desk launch (replaces Invoice Processor)

- **Help Desk app** (`helpdesk`): Freshservice-style dashboard, dense ticket queue (SLA state / status / priority / assignee, filters), two-pane ticket detail, and an agent-logs-on-behalf "New ticket" form. Registered in nav, home tiles, and admin access.
- **SLA:** priority-based `sla_policies` stamp first-response/resolution due times on insert and recalculate on priority change (DB triggers); queue/detail show derived state (overdue / due today / on time).
- **Knowledge Base:** browse + search, markdown article view with helpful votes, and agent CRUD. "Document this resolution" links a resolved ticket to a similar article (pg_trgm + full-text `search_kb`) or opens a prefilled new article; articles list their related tickets.
- **Categories:** editable Category dropdown on tickets (changes logged to Activity); shared category list including "Price update".
- **Attachments:** file upload to Supabase Storage on tickets, download via signed URLs.
- **Email via Microsoft Graph (no Power Automate):** inbound push webhooks turn emails to `it@` / `priceupdate@` into tickets (`priceupdate@` → `price_update` category), de-duplicated by message id; outbound replies and assignment notices sent as `it@`. Daily Vercel cron renews Graph subscriptions.
- **Invoice Processor:** slated for retirement via the `app_access`/registry soft-hide — see `docs/deprecation-checklist.md`.
- **Repo/portability:** added `AGENTS.md` project guide; moved SQL migrations into `supabase/` (numbered, idempotent) and planning/setup docs into `docs/`.
