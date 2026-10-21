# Bot API (v1)

A small HTTP API so bots (starting with Porter's Help Desk triage bot) can use Help Desk data **without a Supabase key**. Each bot gets its own API key with explicit scopes; every call is logged.

- **Base URL:** `https://www.prstech.app/api/bot/v1` — use the `www` host (the apex 307-redirects, and many HTTP clients drop the `Authorization` header on redirect).
- **Auth:** `Authorization: Bearer <api key>`
- **Format:** JSON in, JSON out. Today every endpoint is `GET`; write endpoints arrive module by module (see [Writes](#writes-conventions)).
- **Code:** `src/lib/botAuth.js` (auth, rate limit, logging), `src/lib/botHelpdesk.js` (column lists + response shaping), routes under `src/app/api/bot/v1/`.

## Keys & scopes

Keys are created on **/admin → Bot API clients** (admins only). The plain key (`prs_…`, 47 chars) is shown **once** on create or rotate — store it in the bot's secret store. The database holds only its SHA-256 hash plus a 12-char display prefix (`api_clients`, migration `21`).

| Scope | Grants | Endpoints today |
|---|---|---|
| `helpdesk:read` | Read tickets (incl. internal notes) and published KB articles | ✅ the four Help Desk endpoints below |
| `helpdesk:write` | Create/update tickets, add internal notes, link KB articles | — (PR 2) |
| `kb:write` | Create and edit **draft** KB articles (never publish) | — (PR 2) |
| `assets:read` | Read assets, employees, locations | — (PR 3) |
| `assets:write` | Create/update assets, check out / check in | — (PR 3) |
| `dailyops:read` | Today's checklists, tasks | — (PR 4) |
| `dailyops:write` | Create/update tasks, check off checklist items | — (PR 4) |
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
| 401 | `unauthorized` | Missing, unknown, or **inactive** key |
| 403 | `forbidden` | Key valid but lacks the endpoint's scope |
| 404 | `not_found` | Ticket/article doesn't exist (or KB article isn't published) |
| 409 | `not_configured` | Write endpoint, but the key has no "Acts as" profile (or it no longer exists) |
| 422 | `idempotency_conflict` | `Idempotency-Key` reused with a different body or endpoint |
| 429 | `rate_limited` | Over 60 requests/minute (`Retry-After: 60`), or over the write limits — 20/min (`Retry-After: 60`) / 500 per 24h (`Retry-After: 3600`) |
| 500 | `internal_error` | Database error, or the write log couldn't be recorded (nothing was written) |

**Rate limit caveat:** the 60/min counter is held in memory **per server instance**. Vercel may run several instances concurrently and cold starts reset the counter, so the real ceiling is 60 × live instances. Fine for a well-behaved internal bot; move to a shared store (e.g. a Postgres counter) if it ever needs to be strict.

## Logging

Every authenticated call (including 403/429/4xx) writes a row to `api_client_calls`: client, method, route, query/route params, status, result count, timestamp. Write calls also set `is_write`, `target_type`, `target_ids`, `request_summary` (body field names + values cut to 200 chars, arrays to 20 items; key/token/password/secret fields dropped) and `idempotency_key` — see [Writes](#writes-conventions). Bot traffic does **not** go to `audit_log`. Unknown/missing keys (401) aren't logged (there's no client to attribute them to). Key create/rotate/activate/deactivate are logged to `audit_log` (`entity_type = 'api_client'`), like user changes.

Both tables are service-role only (RLS on, no policies) — query them from the Supabase SQL Editor:

```sql
select created_at, client_name, route, params, status, result_count
from api_client_calls order by created_at desc limit 50;
```

## Writes (conventions)

Foundation shipped in PR 1 (migration `22`, `requireBotWrite()` in `src/lib/botAuth.js`); the endpoints themselves arrive per module. Every write endpoint follows these rules:

- **Acts as:** requires the key's "Acts as" profile (409 `not_configured` otherwise).
- **Allow-listed fields:** unknown body fields → 400 `invalid_param`; the body is never passed straight to the database.
- **No deletes:** there are no DELETE endpoints; "removal" uses soft states (ticket `closed`, asset `Archived`, task `skipped`, line excluded).
- **`?dry_run=1`** (or `true`): validates and returns the would-be result without writing. Dry runs are logged (`request_summary.dry_run = true`) and count toward the write limits.
- **`Idempotency-Key` header** (1–200 chars of `A-Z a-z 0-9 . _ : -`): **required on creates**, optional on updates. Same key + same body → the stored response is replayed with header `Idempotent-Replay: true`; same key with a different body or endpoint → 422 `idempotency_conflict`. Keys are per client and stored after the write succeeds — don't fire retries in parallel. Stored responses can be purged after 7 days (`delete from api_idempotency where created_at < now() - interval '7 days';`).
- **Logged before writing, synchronously:** the call row is inserted (status `102` = in progress) *before* any data changes and updated with the final status + target ids afterwards. If that log row can't be inserted, the endpoint returns 500 and writes nothing — a write is never unlogged.
- **Write limits (DB-backed, shared across server instances):** 20 writes/minute and 500 per rolling 24 hours per key, counted from `api_client_calls`; 429 responses are logged but not counted. The in-memory 60 requests/min still applies to everything.
- **No email:** bot writes never trigger Help Desk notification email.

```sql
-- Recent bot writes
select created_at, client_name, method, route, status, target_type, target_ids, request_summary
from api_client_calls where is_write order by created_at desc limit 50;
```

## Visibility rules

The API reads through the service role, so these are enforced in code:

- **Internal notes:** ticket detail splits comments into `public_comments` and `internal_comments`. Internal comments are staff-only — **a bot must never show them (or `visibility: "internal"` attachments) to the requester.**
- **KB:** only `published` articles are ever returned (drafts/archived → 404 / omitted).
- No storage paths, key hashes, or `select('*')` — each route names its columns.

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

## Quick auth checks

```bash
B=https://www.prstech.app/api/bot/v1/helpdesk
curl -s -o /dev/null -w "%{http_code}\n" "$B/tickets"                                   # 401 (no key)
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer nope" "$B/tickets"   # 401 (unknown key)
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $PRS_BOT_KEY" "$B/tickets"  # 200
```

A key deactivated on /admin returns 401; a key without `helpdesk:read` returns 403.

## Not available yet

Data write endpoints (tickets, KB, assets, Daily Ops, pricing) ship in later PRs. Sending email is never exposed. New scopes go in `BOT_SCOPES` + `BOT_SCOPE_INFO` in `src/lib/botAuth.js` (the admin routes validate against it and the /admin checkboxes render from it).
