# Bot API (v1)

A small HTTP API so bots (starting with Porter's Help Desk triage bot) can use Help Desk data **without a Supabase key**. Each bot gets its own API key with explicit scopes; every call is logged.

- **Base URL:** `https://www.prstech.app/api/bot/v1` — use the `www` host (the apex 307-redirects, and many HTTP clients drop the `Authorization` header on redirect).
- **Auth:** `Authorization: Bearer <api key>`
- **Format:** JSON in, JSON out. Help Desk + KB, IT Tracker and Daily Ops have read and write endpoints; other modules arrive PR by PR (see [Writes](#writes-conventions)).
- **Code:** `src/lib/botAuth.js` (auth, rate limit, logging, idempotency, `runWrite`), `src/lib/botHelpdesk.js` (column lists, lookups, response shaping), `src/lib/botWrite.js` (generic write-side validation), `src/lib/botHelpdeskWrite.js` (Help Desk/KB validation), `src/lib/botTracker.js` (IT Tracker columns, shaping, validation), `src/lib/botDailyOps.js` (Daily Ops columns, shaping, validation), `src/lib/helpdeskNotify.js` (the one email a bot write can cause), routes under `src/app/api/bot/v1/`.

## Keys & scopes

Keys are created on **/admin → Bot API clients** (admins only). The plain key (`prs_…`, 47 chars) is shown **once** on create or rotate — store it in the bot's secret store. The database holds only its SHA-256 hash plus a 12-char display prefix (`api_clients`, migration `21`).

| Scope | Grants | Endpoints today |
|---|---|---|
| `helpdesk:read` | Read tickets (incl. internal notes) and published KB articles | ✅ `GET` tickets, tickets/{id}, kb, kb/{id} |
| `helpdesk:write` | Create/update tickets, add internal notes, link KB articles | ✅ `POST` tickets, `PATCH` tickets/{id}, `POST` tickets/{id}/comments, `POST` tickets/{id}/kb-links |
| `kb:write` | Create and edit **draft** KB articles (never publish) | ✅ `GET` kb/drafts, kb/drafts/{id}, `POST` kb, `PATCH` kb/{id} |
| `assets:read` | Read assets, employees, locations | ✅ `GET` tracker/assets, tracker/assets/{id}, tracker/employees, tracker/employees/{id}, tracker/locations |
| `assets:write` | Create/update assets, check out / check in | ✅ `POST` tracker/assets, `PATCH` tracker/assets/{id}, `POST` tracker/assets/{id}/checkout, `POST` tracker/assets/{id}/checkin |
| `dailyops:read` | Today's checklists, tasks | ✅ `GET` dailyops/today, dailyops/tasks, dailyops/tasks/{id} |
| `dailyops:write` | Create/update tasks, check off checklist items | ✅ `POST` dailyops/tasks, `PATCH` dailyops/tasks/{id}, `PATCH` dailyops/checklist-items/{id} |
| `pricing:read` | Price batches, lines, vendors, worker status | — (PR 5) |
| `pricing:write` | **Stage only** (create batch, upload, re-match, include/exclude) — never approve/export/apply | — (PR 6) |

A scope without endpoints yet grants nothing until its PR ships. Write scopes don't imply read scopes — grant both. `GET /whoami` needs no scope.

- **Rotate** issues a new key; the old one stops working immediately.
- **Deactivate** rejects the key (401) until reactivated — the kill switch.

### Granting scopes

On **/admin → Bot API clients**, each client has scope checkboxes (grouped by module) and a **Save scopes** button. Scopes are read on every call, so the change takes effect immediately and the key doesn't change. At least one scope is required (deactivate instead of removing all). Changes are written to `audit_log` (`entity_type = 'api_client'`, old → new).

SQL fallback (Supabase SQL Editor):

```sql
update api_clients set scopes = array['helpdesk:read','helpdesk:write'] where name = 'helpdesk-triage';
```

### "Acts as" profile

Writes must fill author/actor columns with a real `profiles.id`, so every client has an **Acts as** profile (`api_clients.acting_profile_id`, migration `22`), picked on /admin next to the scopes. Everything the bot writes is attributed to that profile and shows by name on existing screens (ticket timeline, comments, IT Tracker History…); tickets/comments/KB articles also get an explicit `created_via_client_id` / `via_client_id` marker. Write endpoints return **409 `not_configured`** until it's set.

- Use a dedicated profile (e.g. "Helpdesk Triage (bot)", viewer role, no apps, banned in Supabase Auth). The profile can still log in to the app if it has a password and isn't banned — deactivating the key is what stops the bot.
- **The acting profile needs no app access.** Bot routes use the service role, so `profiles.role` / `profiles.app_access` don't gate them — the key's scopes do. `app_access` is a **jsonb array** of app ids (e.g. `["helpdesk"]`), so `role = 'viewer'` with `app_access = []` is fine (and safest).
- **Don't pick a profile whose email is a mailbox the app reads** (`IT_MAILBOX` / `PRICEUPDATE_MAILBOX`; /admin warns). Emails the app sends that user (e.g. "assigned to you") would come back in as new tickets.

SQL fallback: `update api_clients set acting_profile_id = '<profile uuid>' where name = 'helpdesk-triage';` (find the uuid with `select id, full_name, email from profiles order by full_name;`).

## Errors

Every error uses the same shape:

```json
{ "error": { "code": "forbidden", "message": "API key lacks the 'helpdesk:read' scope." } }
```

| Status | `code` | When |
|---|---|---|
| 400 | `invalid_param` | Bad `status` value, malformed id, unknown body field, malformed `Idempotency-Key` |
| 400 | `idempotency_key_required` | A create endpoint was called without an `Idempotency-Key` header (not required on `dry_run`) |
| 400 | `invalid_param` | Also: missing/blank/too-long body field, bad enum, a body reference that doesn't exist (`requester_id`, `category_id`, `article_id`, `ticket_id`, task `assigned_to`), or a refused field (`source`, `status`, `slug`…) |
| 401 | `unauthorized` | Missing, unknown, or **inactive** key |
| 403 | `forbidden` | Key valid but lacks the endpoint's scope |
| 404 | `not_found` | Ticket/article/asset/employee/task/checklist item doesn't exist (or KB article isn't published) |
| 409 | `not_configured` | Write endpoint, but the key has no "Acts as" profile (or it no longer exists) |
| 409 | `idempotency_in_progress` | Another request with the same `Idempotency-Key` is still running (`Retry-After: 5`) |
| 409 | `not_draft` | `PATCH /helpdesk/kb/{id}` on a published or archived article |
| 409 | `asset_locked` | Any asset write (PATCH / checkout / checkin) on a `Disposed` or `Lost/Stolen` asset |
| 409 | `not_checkoutable` | Checkout of a rack-mountable or already-`Deployed` asset |
| 409 | `not_checked_out` | Check-in of an asset that isn't `Deployed` |
| 409 | `duplicate_serial` | Asset `serial_number` already on another non-Disposed asset (case-insensitive) — resend with `allow_duplicate_serial: true` if intended |
| 409 | `conflict` | The asset/task/checklist item changed between validation and the write (e.g. someone disposed the asset, changed the task's status, or toggled the item); nothing was written — re-read and retry |
| 409 | `not_today` | Checklist item on a day other than today (Central) |
| 409 | `template_inactive` | Checklist item whose template has been deactivated |
| 422 | `idempotency_conflict` | `Idempotency-Key` reused with a different body or endpoint |
| 422 | `invalid_assignee` | `assignee_id` isn't an agent (`role = 'admin'`), doesn't exist, is the key's own acting profile, or is a mailbox profile (`IT_MAILBOX` / `PRICEUPDATE_MAILBOX`) |
| 422 | `public_comments_disabled` | A comment with `visibility: "public"` — bots post internal notes only |
| 422 | `status_not_allowed` | Asset `status` of `Disposed` or `Lost/Stolen` — those stay human decisions |
| 422 | `employee_inactive` | Checkout to an employee whose status isn't `active` |
| 429 | `rate_limited` | Over 60 requests/minute (`Retry-After: 60`), or over the write limits — 20/min (`Retry-After: 60`) / 500 per 24h (`Retry-After: 3600`) |
| 500 | `internal_error` | Database error, or the write log couldn't be recorded (nothing was written) |

**Rate limit caveat:** the 60/min counter is held in memory **per server instance**. Vercel may run several instances concurrently and cold starts reset the counter, so the real ceiling is 60 × live instances. Fine for a well-behaved internal bot; move to a shared store (e.g. a Postgres counter) if it ever needs to be strict.

## Logging

Every authenticated call (including 403/429/4xx) writes a row to `api_client_calls`: client, method, route, query/route params, status, result count, timestamp. Write calls also set `is_write`, `target_type`, `target_ids`, `request_summary` (body field names + values cut to 200 chars, arrays to 20 items; key/token/password/secret fields dropped) and `idempotency_key` — see [Writes](#writes-conventions). Bot traffic does **not** go to `audit_log` — except IT Tracker asset writes, which also write the same `audit_log` row the UI does so they show in IT Tracker History (see [IT Tracker](#it-tracker-assetsread--assetswrite)). Unknown/missing keys (401) aren't logged (there's no client to attribute them to). Key create/rotate/activate/deactivate are logged to `audit_log` (`entity_type = 'api_client'`), like user changes.

Both tables are service-role only (RLS on, no policies) — query them from the Supabase SQL Editor:

```sql
select created_at, client_name, route, params, status, result_count
from api_client_calls order by created_at desc limit 50;
```

## Writes (conventions)

Foundation shipped in PR 1 (migration `22`, `requireBotWrite()` + `runWrite()` in `src/lib/botAuth.js`); Help Desk + KB write endpoints in PR 2 ([below](#help-desk-writes-helpdeskwrite)), IT Tracker in PR 3 ([below](#it-tracker-assetsread--assetswrite)), Daily Ops in PR 4 ([below](#daily-ops-dailyopsread--dailyopswrite)), other modules per PR. Every write endpoint follows these rules:

- **Acts as:** requires the key's "Acts as" profile (409 `not_configured` otherwise).
- **Allow-listed fields:** unknown body fields → 400 `invalid_param`; the body is never passed straight to the database.
- **No deletes:** there are no DELETE endpoints; "removal" uses soft states (ticket `closed`, asset `Archived`, task `skipped`, line excluded).
- **`?dry_run=1`** (or `true`): validates and returns the would-be result without writing. Dry runs are logged (`request_summary.dry_run = true`) and count toward the write limits.
- **`Idempotency-Key` header** (1–200 chars of `A-Z a-z 0-9 . _ : -`): **required on creates**, optional on updates. Keys are per client. The key is **reserved before writing** (an `api_idempotency` row with `status = 0` = in progress), then filled with the final response:
  - same key + same body, finished → the stored response is replayed with header `Idempotent-Replay: true` (logged as a replay) — checked **before** any state-dependent validation, so a replay never fails on checks like `duplicate_serial`, `not_checkoutable` or `not_draft` that the first request itself changed;
  - same key + same body, still running → 409 `idempotency_in_progress` (`Retry-After: 5`) — retry later, it'll replay. A reservation older than 2 minutes (the original request died) is taken over by the retry;
  - same key with a different body or endpoint (PATCH endpoints include the target id) → 422 `idempotency_conflict`;
  - the write failed (any error response after the key was reserved) → the reservation is released, so retrying with the **same key** is safe.
  Stored responses can be purged after 7 days (`delete from api_idempotency where created_at < now() - interval '7 days';`).
- **Logged before writing, synchronously:** the call row is inserted (status `102` = in progress) *before* any data changes and updated with the final status + target ids afterwards. If that log row can't be inserted, the endpoint returns 500 and writes nothing — a write is never unlogged.
- **Write limits (DB-backed, shared across server instances):** 20 writes/minute and 500 per rolling 24 hours per key, counted from `api_client_calls`; 429 responses are logged but not counted. The in-memory 60 requests/min still applies to everything.
- **Email — only "assigned to you":** when a bot sets or changes a ticket's `assignee_id` to someone (create or PATCH), the assignee gets the normal "Ticket #N assigned to you" email, sent as `it@` after the response via `sendAssignedEmail()` (`src/lib/helpdeskNotify.js`), best-effort and never on a dry run. Nothing else emails anyone: no requester email ever, no reply email (bot comments are internal-only), nothing on status/resolve/close, nothing from KB, IT Tracker or Daily Ops writes. Assignees that would loop back into a mailbox the app reads, or onto the bot's own acting profile, are refused (422 `invalid_assignee`); `/api/helpdesk/notify` also skips an assignee whose email is `IT_MAILBOX`/`PRICEUPDATE_MAILBOX` for human assignments.
- **Dry runs validate fully**, including every lookup (ticket, assignee, requester, category, article), then return the would-be result: no DB writes, no email.

```sql
-- Recent bot writes
select created_at, client_name, method, route, status, target_type, target_ids, request_summary
from api_client_calls where is_write order by created_at desc limit 50;
```

## Visibility rules

The API reads through the service role, so these are enforced in code:

- **Internal notes:** ticket detail splits comments into `public_comments` and `internal_comments`. Internal comments are staff-only — **a bot must never show them (or `visibility: "internal"` attachments) to the requester.**
- **KB:** the `helpdesk:read` routes only ever return `published` articles (drafts/archived → 404 / omitted). Drafts are readable only through the `kb:write` draft routes.
- No storage paths, key hashes, or `select('*')` — each route names its columns.
- **IT Tracker:** asset cost/budget data is never returned or accepted (`purchase_cost`, `useful_life_months`, depreciation/book value, and nothing from purchases/budgets/licenses/subscriptions), nor `photo_url`. Employees expose only directory basics (no `notes`, `manager_id`, `profile_id`).

---

## GET `/whoami`

Any active key, no scope required. Smoke-test a key: who it is, its scopes, who its writes are attributed to, and the limits.

```bash
curl -s -H "Authorization: Bearer $PRS_BOT_KEY" "https://www.prstech.app/api/bot/v1/whoami"
```

```json
{
  "client": { "name": "helpdesk-triage", "scopes": ["helpdesk:read", "helpdesk:write"] },
  "acts_as": { "id": "9a3e…", "name": "Helpdesk Triage (bot)", "email": "helpdesk-bot@…" },
  "limits": { "per_minute": 60, "writes_per_minute": 20, "writes_per_day": 500 },
  "writes_today": 3
}
```

`acts_as` is `null` until an admin sets it. `writes_today` counts write calls in the last 24 hours (the window the daily limit uses; `null` if it can't be counted).

## GET `/helpdesk/tickets`

List tickets, newest first.

| Param | Default | Notes |
|---|---|---|
| `status` | `open,in_progress,waiting` | One or more of `open`, `in_progress`, `waiting`, `resolved`, `closed` (comma-separated), or `all` |
| `q` | — | Case-insensitive substring match on `title` and `description` (max 200 chars) |
| `limit` | 25 | 1–100 |
| `offset` | 0 | |

```bash
curl -s -H "Authorization: Bearer $PRS_BOT_KEY" \
  "https://www.prstech.app/api/bot/v1/helpdesk/tickets?q=printer&limit=2"
```

```json
{
  "data": [
    {
      "id": "6f1c2a9e-3b0d-4c55-9a1e-2d7f0b8c4e11",
      "number": 1042,
      "title": "Shipping printer jamming",
      "description": "The Zebra in shipping jams every few labels…",
      "status": "open",
      "sla_state": "due_today",
      "priority": "high",
      "category": "hardware",
      "source": "email",
      "requester": { "id": null, "name": null, "email": "jdoe@powerandrubber.com" },
      "assignee": { "id": "0b6d…", "name": "Porter Lawless", "email": "it@powerandrubber.com" },
      "first_response_due": "2026-10-14T16:00:00+00:00",
      "resolution_due": "2026-10-14T22:00:00+00:00",
      "first_responded_at": null,
      "created_at": "2026-10-14T14:02:11+00:00",
      "updated_at": "2026-10-14T14:02:11+00:00",
      "resolved_at": null,
      "closed_at": null,
      "url": "https://www.prstech.app/helpdesk/tickets/6f1c2a9e-3b0d-4c55-9a1e-2d7f0b8c4e11"
    }
  ],
  "pagination": { "limit": 2, "offset": 0, "total": 1 },
  "filters": { "status": ["open", "in_progress", "waiting"], "q": "printer" }
}
```

`sla_state` is derived (`overdue` / `due_today` / `on_time` / `resolved`) via `slaState()` — never stored. `requester` is the profile when there is one, otherwise just the inbound email address.

## GET `/helpdesk/tickets/{id}`

`{id}` = ticket uuid **or** ticket number (`1042`; `%231042` for `#1042`).

```bash
curl -s -H "Authorization: Bearer $PRS_BOT_KEY" \
  "https://www.prstech.app/api/bot/v1/helpdesk/tickets/1042"
```

```json
{
  "data": {
    "ticket": { "id": "6f1c…", "number": 1042, "title": "Shipping printer jamming", "status": "in_progress", "sla_state": "on_time", "…": "same shape as the list" },
    "public_comments": [
      { "id": "a1…", "visibility": "public", "author": { "id": "0b6d…", "name": "Porter Lawless", "email": "it@powerandrubber.com" }, "body": "Swapping the platen roller this afternoon.", "created_at": "2026-10-14T15:10:00+00:00" }
    ],
    "internal_comments": [
      { "id": "b2…", "visibility": "internal", "author": { "id": "0b6d…", "name": "Porter Lawless", "email": "it@powerandrubber.com" }, "body": "Third jam ticket this month — check warranty.", "created_at": "2026-10-14T15:05:00+00:00" }
    ],
    "activity": [
      { "id": "c3…", "action": "status_changed", "from_value": "open", "to_value": "in_progress", "actor": { "id": "0b6d…", "name": "Porter Lawless", "email": "it@powerandrubber.com" }, "created_at": "2026-10-14T15:04:00+00:00" }
    ],
    "attachments": [
      { "id": "d4…", "comment_id": null, "file_name": "jam.jpg", "file_size": 183402, "created_at": "2026-10-14T14:02:11+00:00", "visibility": "public" }
    ],
    "linked_kb": [
      { "id": "e5…", "slug": "zebra-printer-jams", "title": "Zebra printer jams", "url": "https://www.prstech.app/helpdesk/kb/zebra-printer-jams" }
    ]
  },
  "notice": "internal_comments are staff-only notes. Never show them to the requester."
}
```

Comments and activity are oldest-first. Attachments are metadata only (download links aren't exposed in v1).

## GET `/helpdesk/kb`

Published KB articles.

| Param | Default | Notes |
|---|---|---|
| `q` | — | Ranked full-text + fuzzy-title search via the `search_kb()` SQL function. **Returns at most 5 results** (the function's built-in limit) |
| `limit` | 25 (5 with `q`) | 1–100 without `q`; 1–5 with `q` |
| `offset` | 0 | Without `q` only |

```bash
curl -s -H "Authorization: Bearer $PRS_BOT_KEY" \
  "https://www.prstech.app/api/bot/v1/helpdesk/kb?q=vpn%20disconnects"
```

```json
{
  "data": [
    {
      "id": "e7…",
      "slug": "vpn-keeps-disconnecting",
      "title": "VPN keeps disconnecting",
      "snippet": "If FortiClient drops every few minutes, first check…",
      "tags": ["vpn", "remote"],
      "category": { "name": "Network", "slug": "network" },
      "updated_at": "2026-09-30T18:22:00+00:00",
      "published_at": "2026-05-02T13:00:00+00:00",
      "url": "https://www.prstech.app/helpdesk/kb/vpn-keeps-disconnecting",
      "score": 0.41
    }
  ],
  "search": { "q": "vpn disconnects", "max_results": 5 }
}
```

Without `q` the response has `pagination` instead of `search`, ordered by most recently updated, and no `score`.

## GET `/helpdesk/kb/{id}`

`{id}` = article uuid **or** slug. Returns the full markdown body.

```bash
curl -s -H "Authorization: Bearer $PRS_BOT_KEY" \
  "https://www.prstech.app/api/bot/v1/helpdesk/kb/vpn-keeps-disconnecting"
```

```json
{
  "data": {
    "id": "e7…",
    "slug": "vpn-keeps-disconnecting",
    "title": "VPN keeps disconnecting",
    "body": "## Symptoms\nFortiClient drops every few minutes…",
    "body_format": "markdown",
    "tags": ["vpn", "remote"],
    "category": { "name": "Network", "slug": "network" },
    "created_at": "2026-05-01T20:11:00+00:00",
    "updated_at": "2026-09-30T18:22:00+00:00",
    "published_at": "2026-05-02T13:00:00+00:00",
    "url": "https://www.prstech.app/helpdesk/kb/vpn-keeps-disconnecting"
  }
}
```

---

## Help Desk writes (`helpdesk:write`)

All four are attributed to the key's "Acts as" profile (`actor`), set `created_via_client_id` / `via_client_id`, are logged with `target_type` + `target_ids`, and accept `?dry_run=1`. Unknown body fields → 400 listing them. Limits: `title` ≤ 200 chars, `description` / comment `body` ≤ 10,000. Strings are trimmed; blank → 400.

### POST `/helpdesk/tickets`

Create a ticket. **`Idempotency-Key` required.** `source` is always `chat` (sending `source` → 400).

| Field | | Notes |
|---|---|---|
| `title` | required | ≤ 200 |
| `description` | required | ≤ 10,000 |
| `requester_email` / `requester_id` | one required (not both) | `requester_id` must be a profile. `requester_email` is lowercased and matched to a profile by email (like inbound email tickets); no match → stored as the raw address with no profile |
| `priority` | default `medium` | `low` / `medium` / `high` / `urgent` |
| `category` | default `other` | `hardware` / `software` / `access` / `network` / `billing` / `price_update` / `other` |
| `assignee_id` | optional | An agent's profile uuid (`role = 'admin'`); not the acting profile, not a mailbox profile → else 422 `invalid_assignee`. **Emails the assignee** "assigned to you" |

SLA due times are stamped by the DB on insert; a `created` timeline entry is written like the UI does.

```bash
curl -s -X POST "https://www.prstech.app/api/bot/v1/helpdesk/tickets?dry_run=1" \
  -H "Authorization: Bearer $PRS_BOT_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: chat-7f3a-create" \
  -d '{"title":"Outlook keeps asking for password","description":"Since this morning…","requester_email":"jdoe@powerandrubber.com","priority":"high","category":"software"}'
```

`201` (real run) → `{ "data": { …same ticket shape as GET… } }`. Dry run → `200` `{ "data": { "id": null, "number": null, "status": "open", "source": "chat", "requester": {…}, "assignee": null, "url": null, … }, "dry_run": true }` (no SLA fields).

### PATCH `/helpdesk/tickets/{id|number}`

Update fields — any of:

| Field | Notes |
|---|---|
| `status` | `open` / `in_progress` / `waiting` / `resolved` / `closed`. `resolved` stamps `resolved_at`, `closed` stamps `closed_at` (like the UI) |
| `priority` | SLA due times are recalculated by the DB |
| `category` | as above |
| `assignee_id` | agent uuid (same rules as create) or `null` to unassign. A change to someone **emails them** |
| `title` | ≤ 200 |
| `comment` | optional **internal** note added in the same call (e.g. a resolution note), ≤ 10,000 |

`Idempotency-Key` optional. Fields equal to the current value are skipped; each real change writes one `<field>_changed` timeline entry (from/to). Nothing changed and no `comment` → `200` with `"unchanged": true`. The response re-reads the ticket so DB-side changes (SLA) show; a dry run shows the current SLA times.

```bash
curl -s -X PATCH "https://www.prstech.app/api/bot/v1/helpdesk/tickets/1042" \
  -H "Authorization: Bearer $PRS_BOT_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: chat-7f3a-resolve" \
  -d '{"status":"resolved","comment":"Reset the Outlook profile; user confirmed working."}'
```

```json
{
  "data": { "id": "6f1c…", "number": 1042, "status": "resolved", "resolved_at": "2026-10-21T15:02:00+00:00", "…": "same ticket shape" },
  "changes": [ { "field": "status", "from": "in_progress", "to": "resolved" } ],
  "comment": { "id": "b9…", "visibility": "internal", "author": { "id": "…", "name": "AI", "email": "…" }, "body": "Reset the Outlook profile; user confirmed working.", "created_at": "…" }
}
```

If the fields update but the comment insert fails, you get a 500 saying so; retrying the same request (same key) adds the note — the already-applied fields are skipped as no-ops.

### POST `/helpdesk/tickets/{id|number}/comments`

Add an **internal note**. **`Idempotency-Key` required.** Body: `body` (required, ≤ 10,000), `visibility` (optional; only `"internal"`; `"public"` → 422 `public_comments_disabled`). Doesn't stamp first response; never emails.

```bash
curl -s -X POST "https://www.prstech.app/api/bot/v1/helpdesk/tickets/1042/comments" \
  -H "Authorization: Bearer $PRS_BOT_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: chat-7f3a-note-1" \
  -d '{"body":"User says it started after the Windows update."}'
```

`201` → `{ "data": { "id": "…", "visibility": "internal", "author": {…}, "body": "…", "created_at": "…" }, "ticket": { "id": "6f1c…", "number": 1042 } }`

### POST `/helpdesk/tickets/{id|number}/kb-links`

Link a KB article (any status, e.g. a draft the bot just wrote) to the ticket. Body: `article_id` (required uuid, must exist). `Idempotency-Key` optional. Already linked → `200` with `"already_linked": true`. (The ticket GET still lists only published linked articles.)

```bash
curl -s -X POST "https://www.prstech.app/api/bot/v1/helpdesk/tickets/1042/kb-links" \
  -H "Authorization: Bearer $PRS_BOT_KEY" -H "Content-Type: application/json" \
  -d '{"article_id":"e7a1…"}'
```

`201` → `{ "data": { "id": "…", "ticket": { "id": "6f1c…", "number": 1042 }, "article": { "id": "e7a1…", "slug": "…", "title": "…", "status": "draft" }, "linked_at": "…" }, "already_linked": false }`

---

## KB drafts (`kb:write`)

Bots write **drafts only** — publishing stays a human click on `/helpdesk/kb/manage`. Limits: `title` ≤ 200, `body` (markdown) ≤ 50,000, `tags` ≤ 20 strings of ≤ 50 chars (trimmed, blanks dropped, de-duplicated). `created_by_bot` = the article was written through the bot API (`via_client_id` set).

### GET `/helpdesk/kb/drafts`

Draft articles, newest-updated first. Params: `q` (case-insensitive title match), `limit` (default 25, max 50), `offset`. Same summary shape as `GET /helpdesk/kb` plus `status` and `created_by_bot`.

```bash
curl -s -H "Authorization: Bearer $PRS_BOT_KEY" "https://www.prstech.app/api/bot/v1/helpdesk/kb/drafts?q=outlook"
```

### GET `/helpdesk/kb/drafts/{id|slug}`

One draft with its full body (same shape as `GET /helpdesk/kb/{id}` plus `status`, `created_by_bot`). Published/archived → 404.

### POST `/helpdesk/kb`

Create a draft. **`Idempotency-Key` required.** Always `status = 'draft'`, `published_at = null`; sending `status`, `published_at` or `slug` → 400. The slug comes from the title (`slugify()`), with a `-xxxx` suffix if taken (same as `/helpdesk/kb/manage`).

| Field | | Notes |
|---|---|---|
| `title` | required | ≤ 200 |
| `body` | required | markdown, ≤ 50,000 |
| `tags` | optional | array of strings |
| `category_id` | optional | must exist in `kb_categories` |
| `ticket_id` | optional | ticket uuid or number — the draft is linked to it |

```bash
curl -s -X POST "https://www.prstech.app/api/bot/v1/helpdesk/kb?dry_run=1" \
  -H "Authorization: Bearer $PRS_BOT_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: chat-7f3a-kb" \
  -d '{"title":"Outlook keeps asking for a password","body":"## Fix\n- Reset the Outlook profile…","tags":["outlook","m365"],"ticket_id":1042}'
```

`201` → `{ "data": { …article shape…, "status": "draft", "created_by_bot": true }, "linked_ticket": { "id": "6f1c…", "number": 1042 } }`. If the draft was created but the ticket link failed, `linked_ticket` is `null` and a `warnings` array says so (link it with the kb-links endpoint). A dry run returns the would-be article with the base slug (the real create may add a suffix) and `url: null`.

### PATCH `/helpdesk/kb/{id|slug}`

Edit a **draft's** `title`, `body`, `tags` and/or `category_id` (`null` clears it). Published or archived → 409 `not_draft` (re-checked atomically in the update). Never changes `status`, `published_at`, `slug` or the author (sending them → 400). `Idempotency-Key` optional. Response: `{ "data": { …draft… }, "changed": ["title", "tags"] }`; nothing changed → `"unchanged": true`. (`GET` on this path stays `helpdesk:read` and published-only. A draft whose slug is literally `drafts` must be patched by uuid.)

```bash
curl -s -X PATCH "https://www.prstech.app/api/bot/v1/helpdesk/kb/outlook-keeps-asking-for-a-password" \
  -H "Authorization: Bearer $PRS_BOT_KEY" -H "Content-Type: application/json" \
  -d '{"tags":["outlook","m365","mfa"]}'
```

---

## IT Tracker (`assets:read` / `assets:write`)

Assets, the employee directory (read-only) and locations. Code: `src/lib/botTracker.js` (column lists, shaping, validation) + routes under `src/app/api/bot/v1/tracker/`.

- **Never exposed** (not returned, not accepted): `purchase_cost`, `useful_life_months`, depreciation/book value, anything from purchases/budgets/licenses/subscriptions, and `photo_url`. Employees: no `notes`, `manager_id` or `profile_id`; **no employee writes**.
- **History:** every asset write also inserts the same `audit_log` row the UI does (`entity_type = 'asset'`, `entity_id` = asset id, `user_id` = the "Acts as" profile) with the detail text ending in `by <acting profile name> (bot)` — so IT Tracker History and the asset's History panel show the bot by name.
- **No email** — tracker writes never send anything.
- **Statuses the bot may set:** `Ready to Deploy`, `Pending`, `In Repair`, `Archived` (plus `Deployed`, but only via `/checkout`). `Disposed` / `Lost/Stolen` → 422 `status_not_allowed`, and assets already in those states are read-only to the bot (409 `asset_locked`).

### Asset shape

```json
{
  "id": 142,
  "asset_tag": "PRS-00142",
  "name": "Shipping laptop 3",
  "category": "Hardware",
  "type": "Laptop",
  "status": "Deployed",
  "serial_number": "5CG1234XYZ",
  "make": "HP", "model": "ProBook 450 G9",
  "purchase_date": "2025-03-14", "warranty_expiry": "2028-03-14",
  "hostname": "PRS-SHIP-03", "ip_address": null, "os": "Windows 11 Pro",
  "assigned_employee": { "id": "3c1e…", "name": "Jane Doe" },
  "assigned_to": "Jane Doe",
  "assigned_date": "2026-10-21T15:02:00+00:00",
  "location": { "id": "a7d2…", "name": "Houston" },
  "room": { "id": "e19b…", "name": "Shipping" },
  "rack": null,
  "rack_mountable": false,
  "created_at": "…", "updated_at": "…"
}
```

The detail shape (`GET /tracker/assets/{id}` and every write response) adds `cpu`, `ram`, `storage`, `management_url`, `u_position`, `u_height`, `watts`, `notes`, `disposal_reason`, `disposal_date`. `assigned_to` is the cached name (rows from before the employee FK may hold a legacy free-text name with `assigned_employee: null`).

### GET `/tracker/assets`

| Param | Default | Notes |
|---|---|---|
| `q` | — | Case-insensitive substring on `name`, `serial_number`, `asset_tag`, `hostname`, `assigned_to` |
| `status` | everything except `Disposed` | One or more of `Ready to Deploy`, `Deployed`, `Pending`, `In Repair`, `Archived`, `Lost/Stolen`, `Disposed` (comma-separated, case-insensitive) |
| `type` | — | One or more of `Laptop`, `Desktop`, `Server`, `Switch`, `Router`, `Firewall`, `Storage / NAS`, `UPS`, `Monitor`, `Printer`, `Phone / Mobile`, `Other` |
| `employee_id` | — | Assigned employee uuid |
| `location_id` | — | Location uuid |
| `limit` / `offset` | 25 / 0 | limit 1–100. Ordered by `id` (stable paging) |

```bash
curl -s -H "Authorization: Bearer $PRS_BOT_KEY" \
  "https://www.prstech.app/api/bot/v1/tracker/assets?q=probook&status=Ready%20to%20Deploy"
```

→ `{ "data": [ …asset… ], "pagination": { "limit": 25, "offset": 0, "total": 3 }, "filters": { … } }`

### GET `/tracker/assets/{id}`

`{id}` = numeric asset id **or** asset tag (`PRS-00142`, case-insensitive). → `{ "data": { "asset": { …detail… }, "history": [ { "action": "checked_out", "detail": "\"Shipping laptop 3\" checked out to Jane Doe by AI (bot)", "created_at": "…" } ] } }` — the last 20 History entries, newest first.

### GET `/tracker/employees`

Params: `q` (full name / email / department), `status` (`active` default, `inactive`, or `all`), `limit` (25, max 100), `offset`. Ordered by name. Each: `{ id, full_name, first_name, last_name, email, department, title, status, location: { id, name } | null }`. `email` is the work email — match a ticket requester with `?q=jdoe@powerandrubber.com`.

### GET `/tracker/employees/{id}`

`{id}` = employee uuid. → `{ "data": { "employee": { … }, "assets": [ …asset (list shape)… ] } }` (every asset whose `assigned_employee_id` is this employee).

### GET `/tracker/locations`

→ `{ "data": [ { "id": "a7d2…", "name": "Houston", "address": "…", "rooms": [ { "id": "e19b…", "name": "Shipping" } ] } ] }`

### POST `/tracker/assets` (`assets:write`)

Create an asset. **`Idempotency-Key` required.** `asset_tag` is assigned by the database. Strings are trimmed; `null` or `""` clears an optional field. Unknown fields → 400.

| Field | | Notes |
|---|---|---|
| `name` | required | ≤ 200 |
| `category` | required | `Hardware` / `Software` / `Peripheral` / `Network` / `Mobile` / `Other` |
| `type` | optional | one of the types above |
| `status` | default `Pending` | `Ready to Deploy` / `Pending` / `In Repair` / `Archived` (`Deployed` → 400: create, then `/checkout`) |
| `serial_number`, `make`, `model` | optional | ≤ 200. A serial already on another non-Disposed asset → 409 `duplicate_serial` |
| `allow_duplicate_serial` | optional | `true` to accept a duplicate serial |
| `purchase_date`, `warranty_expiry` | optional | `YYYY-MM-DD` (a real date) |
| `location_id` | optional | must exist (`GET /tracker/locations`) |
| `room_id` | optional | must exist **and** belong to `location_id` (which is then required) |
| `notes` | optional | ≤ 2,000 |
| `hostname`, `ip_address`, `os`, `cpu`, `ram`, `storage` | optional | ≤ 200, **only when `type` is a computer type** (`Laptop`/`Desktop`/`Server`), else 400 — same rule as the Add Asset form |
| `management_url` | optional | ≤ 500, **only for a non-computer `type`** (a type must be set), else 400 |

Refused with a 400 explaining why: `asset_tag`, `id`, `purchase_cost`, `useful_life_months`, `photo_url`, any `rack_*` / `u_*` field and `watts` (rack placement stays on /tracker/racks; bot-created assets are `rack_mountable: false`), `assigned_*` (use `/checkout`), `disposal_*`.

```bash
curl -s -X POST "https://www.prstech.app/api/bot/v1/tracker/assets?dry_run=1" \
  -H "Authorization: Bearer $PRS_BOT_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: chat-91b2-asset" \
  -d '{"name":"Shipping laptop 4","category":"Hardware","type":"Laptop","status":"Ready to Deploy","serial_number":"5CG9876ABC","make":"HP","model":"ProBook 450 G9","hostname":"PRS-SHIP-04","location_id":"a7d2…"}'
```

`201` → `{ "data": { …detail… } }` + History entry `Asset "Shipping laptop 4" added by AI (bot)`. Dry run → `200` `{ "data": { "id": null, "asset_tag": null, … }, "dry_run": true }`.

### PATCH `/tracker/assets/{id}` (`assets:write`)

Edit any of the create fields (same validation; `name`/`category` can't be cleared). `Idempotency-Key` optional. Rules:

- `status: "Deployed"` → 400 (use `/checkout`). Moving a deployed asset to another status via PATCH doesn't clear its assignment (same as the edit form) — use `/checkin` to un-assign.
- Computer fields are checked against the asset's type after the patch. Changing `type` **doesn't wipe** existing computer fields / `management_url`; send them as `null` to clear.
- Changing `location_id` without sending `room_id` clears the room (rooms belong to a location), like the edit form.
- Only fields that actually change are written; nothing changed → `200` with `"unchanged": true`. Response: `{ "data": { …detail… }, "changed": ["status", "notes"] }`. History: `Asset "<name>" updated by AI (bot) (status, notes)` — field names only, no values.

```bash
curl -s -X PATCH "https://www.prstech.app/api/bot/v1/tracker/assets/PRS-00142" \
  -H "Authorization: Bearer $PRS_BOT_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: chat-91b2-repair" \
  -d '{"status":"In Repair","notes":"Hinge cracked — sent to HP depot, case 5012345."}'
```

### POST `/tracker/assets/{id}/checkout` (`assets:write`)

Assign to an employee. Body: `{ "employee_id": "<uuid>" }` — must be an **active** employee (inactive → 422 `employee_inactive`). Same change as the Check Out button: `status = 'Deployed'`, `assigned_employee_id`, `assigned_to` = the employee's name, `assigned_date` = now. Refused (409 `not_checkoutable`) for rack-mountable assets and assets already `Deployed` (check in first). `Idempotency-Key` optional; use one so a retry can't double-log. History: `"<name>" checked out to Jane Doe by AI (bot)`.

```bash
curl -s -X POST "https://www.prstech.app/api/bot/v1/tracker/assets/142/checkout?dry_run=1" \
  -H "Authorization: Bearer $PRS_BOT_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: chat-91b2-checkout" \
  -d '{"employee_id":"3c1e…"}'
```

### POST `/tracker/assets/{id}/checkin` (`assets:write`)

Return a deployed asset. Empty body (or `{}`); any field → 400. Same change as the Check In button: `status = 'Ready to Deploy'`, assignment cleared. Not `Deployed` → 409 `not_checked_out`. History: `"<name>" checked in by AI (bot)`.

```bash
curl -s -X POST "https://www.prstech.app/api/bot/v1/tracker/assets/PRS-00142/checkin" \
  -H "Authorization: Bearer $PRS_BOT_KEY" -H "Idempotency-Key: chat-91b2-checkin"
```

All four writes: `?dry_run=1` runs every check and lookup and returns the would-be asset (no DB write, no History entry); `target_type = 'asset'`, `target_ids = [asset id]` in the call log. If the History insert fails after the asset changed, the write still succeeds (the failure is logged server-side).

## Daily Ops (`dailyops:read` / `dailyops:write`)

Today's recurring SOP checklists and one-off tasks. Code: `src/lib/botDailyOps.js` (columns, shaping, validation), `ensureInstancesForDate()` / `instanceStatusFor()` in `src/lib/dailyops.js` (shared with the `/dailyops` page) + routes under `src/app/api/bot/v1/dailyops/`.

- **"Today" is Central time** (`todayCentral()`), like the app. Which templates are due: **daily** every day, **weekly** on Mondays, **monthly** on the 1st; **ad hoc** templates are never instantiated automatically.
- **No email, no reminders** — Daily Ops has none, for humans or bots.
- **Attribution:** tasks the bot creates get `created_by` = the "Acts as" profile (the Tasks page shows "· created by <name>"); checklist items it checks get `checked_by` = that profile (the Today page shows the name under the item). **Task edits and status changes are not attributed** — `tasks` has no "changed by" column, so the UI can't show who moved a task to done (the call log in `api_client_calls` still records it).
- **Templates are read-only** to the bot — no template/item writes.

### GET `/dailyops/today` (`dailyops:read`)

**Side effect:** exactly like a person opening `/dailyops`, this lazily creates today's checklist instances (`sop_instances`) and their per-item rows (`sop_item_status`) if they don't exist yet. It's idempotent (unique keys + `ignoreDuplicates`), so calling it repeatedly or concurrently with a human page load is safe. Instances of deactivated templates are hidden.

```json
{
  "date": "2026-10-21",
  "checklists": [
    {
      "instance_id": "9b0c…",
      "due_date": "2026-10-21",
      "status": "todo",
      "completed_at": null,
      "template": { "id": "51aa…", "title": "Morning server check", "description": "…", "frequency": "daily" },
      "items": [
        {
          "id": "c4e2…",
          "template_item_id": "77f1…",
          "label": "Backups completed overnight",
          "instructions": "Check the Veeam report email",
          "required": true,
          "checked": true,
          "checked_by": { "id": "0d3f…", "name": "Helpdesk Triage (bot)", "email": "…" },
          "checked_at": "2026-10-21T13:05:00+00:00"
        }
      ]
    }
  ]
}
```

Cards are in template order, items in item order. An item's `id` is the `sop_item_status` id — the `{id}` for `PATCH /dailyops/checklist-items/{id}`. Instance `status` is `done` once every **required** item is checked (a checklist with no required items counts as done), else `todo`.

### GET `/dailyops/tasks` (`dailyops:read`)

| Param | Default | Notes |
|---|---|---|
| `status` | `todo,in_progress` | One or more of `todo`, `in_progress`, `done`, `skipped` (comma-separated), or `all` |
| `assigned_to` | — | Assignee profile uuid |
| `due_before` | — | `YYYY-MM-DD`, **exclusive** (`due_date < due_before`); tasks with no due date are left out |
| `q` | — | Case-insensitive substring of `title` |
| `limit` / `offset` | 25 / 0 | limit 1–100. Ordered newest first (`created_at` desc, then `id`) |

→ `{ "data": [ …task… ], "pagination": { "limit": 25, "offset": 0, "total": 4 }, "filters": { … } }`. Task shape:

```json
{
  "id": "e0a1…", "title": "Replace UPS battery in rack 2", "description": null,
  "status": "todo", "priority": "high",
  "assignee": { "id": "0d3f…", "name": "Jane Doe", "email": "…" },
  "creator": { "id": "8a2b…", "name": "Helpdesk Triage (bot)", "email": "…" },
  "due_date": "2026-10-24", "overdue": false,
  "created_at": "…", "completed_at": null
}
```

`overdue` is derived (due date before today, Central, and status `todo`/`in_progress`) — never stored.

### GET `/dailyops/tasks/{id}` (`dailyops:read`)

`{id}` = task uuid. → `{ "data": { …task… } }`.

### POST `/dailyops/tasks` (`dailyops:write`)

Create a task. **`Idempotency-Key` required.** Status is always `todo`; `created_by` is the "Acts as" profile.

| Field | | Notes |
|---|---|---|
| `title` | required | ≤ 200 |
| `description` | optional | ≤ 5,000; `null`/`""` = none |
| `priority` | default `medium` | `low` / `medium` / `high` / `urgent` |
| `assigned_to` | optional | an existing profile uuid (else 400), or `null` |
| `due_date` | optional | `YYYY-MM-DD` (a real date), or `null` |

`status`, `created_by`, `completed_at` → 400. Unknown fields → 400.

```bash
curl -s -X POST "https://www.prstech.app/api/bot/v1/dailyops/tasks?dry_run=1" \
  -H "Authorization: Bearer $PRS_BOT_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: chat-7c41-task" \
  -d '{"title":"Replace UPS battery in rack 2","priority":"high","assigned_to":"0d3f…","due_date":"2026-10-24"}'
```

`201` → `{ "data": { …task… } }`. Dry run → `200` `{ "data": { "id": null, … }, "dry_run": true }`.

### PATCH `/dailyops/tasks/{id}` (`dailyops:write`)

Edit any of `status` (`todo`/`in_progress`/`done`/`skipped`), `title`, `description`, `priority`, `assigned_to`, `due_date` (same validation as create; `title` can't be cleared). `Idempotency-Key` optional.

- `status: "done"` stamps `completed_at` = now; any other status clears it (same as the Tasks page's Start / Done / Reopen buttons). Use `skipped` instead of deleting.
- Only fields that actually change are written; nothing changed → `200` with `"unchanged": true`. Response: `{ "data": { …task… }, "changed": ["status"] }`.
- The write is guarded on the status that was read: if someone changes the task's status in between → 409 `conflict`, nothing written — re-read and retry.

```bash
curl -s -X PATCH "https://www.prstech.app/api/bot/v1/dailyops/tasks/e0a1…" \
  -H "Authorization: Bearer $PRS_BOT_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: chat-7c41-done" \
  -d '{"status":"done"}'
```

### PATCH `/dailyops/checklist-items/{id}` (`dailyops:write`)

Check or uncheck one item on **today's** checklist. `{id}` = the item's `id` from `GET /dailyops/today` (a `sop_item_status` id). Body: `{ "checked": true }` or `{ "checked": false }` — nothing else (`note` → 400). `Idempotency-Key` optional.

- Same write as ticking the box on `/dailyops`: `checked`, `checked_by` = the "Acts as" profile (null when unchecking), `checked_at` = now (null when unchecking). Then the checklist's status is recomputed from **all** its items — every required item checked → `done` (with `completed_at`), else `todo` (clears `completed_at`).
- **409 `not_today`** — the item belongs to another day's checklist (only today's, Central, can change). **409 `template_inactive`** — the checklist's template was deactivated.
- Already in the requested state → `200` with `"unchanged": true`, nothing written.
- Guarded on the checked state that was read: a concurrent toggle by someone else → 409 `conflict`, nothing written. If the item saves but the checklist status update then fails (or races), the item change stands; the failure is logged server-side and the response carries the checklist's current status.

```bash
curl -s -X PATCH "https://www.prstech.app/api/bot/v1/dailyops/checklist-items/c4e2…?dry_run=1" \
  -H "Authorization: Bearer $PRS_BOT_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: chat-7c41-check-backups" \
  -d '{"checked":true}'
```

→ `{ "data": { "item": { …item, as in /today… }, "instance": { "id": "9b0c…", "status": "done", "completed_at": "…" } } }`. Call log: `target_type = 'checklist_item'`, `target_ids = [item id, instance id]`.

All three writes: `?dry_run=1` runs every check (incl. `not_today`, `template_inactive`, the assignee lookup) and returns the would-be result with `"dry_run": true`; nothing is written. Task writes log `target_type = 'task'`.

## Quick auth checks

```bash
B=https://www.prstech.app/api/bot/v1/helpdesk
curl -s -o /dev/null -w "%{http_code}\n" "$B/tickets"                                   # 401 (no key)
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer nope" "$B/tickets"   # 401 (unknown key)
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $PRS_BOT_KEY" "$B/tickets"  # 200
```

A key deactivated on /admin returns 401; a key without `helpdesk:read` returns 403.

## Not available yet

Pricing endpoints ship in later PRs. Daily Ops templates (`sop_templates` / `sop_template_items`) have no bot write access. Sending arbitrary email is never exposed (the only email a bot write can cause is the "assigned to you" mail above). New scopes go in `BOT_SCOPES` + `BOT_SCOPE_INFO` in `src/lib/botAuth.js` (the admin routes validate against it and the /admin checkboxes render from it).
