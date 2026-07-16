# Invoice Processor — Deprecation Checklist

_Two stages: **soft-hide** (reversible, no code/data deleted) at cutover, then **hard removal** after the grace period. Check items off as you go._

## Stage 1 — Soft-hide via `app_access` (cutover, reversible)

Do this only once Help Desk is live for the company.

> **Important — verified against the codebase:** the app ID is **`invoices`** (plural), and `app_access` is a **JSONB array of app-id strings** (e.g. `["tracker","invoices","calculator"]`), *not* an object of booleans. Also, `hasAccess` in `useRole.js` is `isAdmin || appAccess.includes(appId)` — so **admins always see every app regardless of `app_access`.** Since the IT team are admins, removing `"invoices"` from arrays will *not* hide it from them. The reliable soft-hide is therefore a small, reversible **registry edit** (below), optionally combined with the array update for any non-admin profiles.

- [ ] **Announce first.** Send the user comms (template in `01-transition-plan.md`) before flipping anything.
- [ ] **Soft-hide via the registry (hides from everyone, incl. admins).** Remove or comment out the `invoices` entry in all three registries: the `tools` array in `src/components/navigation.js`, the `tools` array in `src/app/page.js` (home tiles), and `allApps` in `src/app/admin/page.js`. This is a one-commit, fully reversible change (git revert restores it).
- [ ] **(Optional) Also drop it from non-admin arrays** so the permission reflects reality:
  ```sql
  update profiles
  set app_access = (
    select coalesce(jsonb_agg(a), '[]'::jsonb)
    from jsonb_array_elements_text(app_access) a
    where a <> 'invoices'
  )
  where app_access ? 'invoices';
  ```
- [ ] **Verify it's hidden.** Log in (admin and, if any, non-admin): the Invoice Processor should be gone from the nav, the home tiles, and the admin checkboxes; visiting `/invoices` should redirect via the `hasAccess('invoices')` guard already in `src/app/invoices/page.js`.
- [ ] **(Optional) Add a retired notice/redirect** on the old invoice route → `/helpdesk` with a one-line "This tool has been retired — file a ticket for invoice needs."
- [ ] **Leave code and data in place.** No deletions in this stage.
- [ ] **Record the cutover date.** Grace period (suggest 60 days) starts now.

_Rollback if needed:_ flip the same flag back to `true` for affected users. Instant, no deploy.

## Stage 2 — Grace period monitoring (≈60 days)

- [ ] Watch for anyone asking where the invoice tool went; if a genuine need surfaces, re-enable for that user and reassess timing.
- [ ] Confirm no scheduled job, webhook, or other app calls the invoice API routes (grep + check Vercel logs).
- [ ] Note the planned hard-removal date on your calendar.

## Stage 3 — Hard removal (after grace period, no blockers)

> Do a backup/export **before** any destructive step.

- [ ] **Export/backup invoice data.** Dump any invoice-only Supabase tables to CSV/JSON and store off-platform. (If invoice sessions were only ever in `global.invoiceSessions` in memory, there's nothing persistent to back up — confirm before assuming.)
- [ ] **Remove the app ID from the registry** and from the admin checkbox UI.
- [ ] **Delete UI routes/pages** for the Invoice Processor.
- [ ] **Delete API route handlers** (PDF upload/parse/overlay/download endpoints).
- [ ] **Delete components and helpers**, including `pdfProcessor.js` / `parsePdf()` and any invoice-specific utilities.
- [ ] **Remove the in-memory session code** (`global.invoiceSessions`) — this also closes out the long-standing cold-start bug by deletion.
- [ ] **Drop now-unused dependencies.** Remove `pdf-parse` (the pinned v1.1.1) from `package.json` **only if** no other app imports it. Grep first.
- [ ] **Clean `app_access` arrays.** Remove the now-dead `"invoices"` string from any `profiles` rows that still carry it (skip if already done in Stage 1):
  ```sql
  update profiles
  set app_access = (
    select coalesce(jsonb_agg(a), '[]'::jsonb)
    from jsonb_array_elements_text(app_access) a
    where a <> 'invoices'
  )
  where app_access ? 'invoices';
  ```
- [ ] **Update the route guard / default arrays.** Drop `'invoices'` from the fallback defaults in `useRole.js` and `admin/page.js` (`['tracker', 'invoices', 'calculator']` → `['tracker', 'calculator', ...]`), and remove the `/invoices` page + its `hasAccess('invoices')` guard.
- [ ] **Drop invoice-only tables** (after the export above) if any exist.
- [ ] **Remove the redirect/notice** added in Stage 1 once users have adjusted, or keep it a while longer.
- [ ] **Update `Navigation.js`** if any hardcoded reference remains.
- [ ] **Search the repo** for lingering references: `grep -ri invoice` across the codebase; clean stragglers (imports, types, tests, env vars, README/docs).
- [ ] **Update project docs / memory** to reflect that the Invoice Processor is retired and Help Desk + Daily Ops are the current apps.
- [ ] **Lint, typecheck, build, and deploy.** Verify prstech.app loads with no invoice references and no broken links.

## Quick reference — what NOT to do

- Don't build the Supabase session-storage rebuild for `global.invoiceSessions`. The feature is being deleted; fixing it is wasted effort.
- Don't hard-delete during the grace period — soft-hide buys you a cheap, reversible safety net.
- Don't drop `pdf-parse` or any shared util without grepping for other consumers first.
