# Bot API (v1)

A small, read-only HTTP API so bots (starting with Porter's Help Desk triage bot) can use Help Desk data **without a Supabase key**. Each bot gets its own API key with explicit scopes; every call is logged.

- **Base URL:** `https://www.prstech.app/api/bot/v1` — use the `www` host (the apex 307-redirects, and many HTTP clients drop the `Authorization` header on redirect).
- **Auth:** `Authorization: Bearer <api key>`
- **Format:** JSON in, JSON out. All endpoints are `GET`.
- **Code:** `src/lib/botAuth.js` (auth, rate limit, logging), `src/lib/botHelpdesk.js` (column lists + response shaping), routes under `src/app/api/bot/v1/`.

## Keys & scopes

Keys are created on **/admin → Bot API clients** (admins only). The plain key (`prs_…`, 47 chars) is shown **once** on create or rotate — store it in the bot's secret store. The database holds only its SHA-256 hash plus a 12-char display prefix (`api_clients`, migration `21`).

| Scope | Grants |
|---|---|
| `helpdesk:read` | All four Help Desk endpoints below |

- **Rotate** issues a new key; the old one stops working immediately.
- **Deactivate** rejects the key (401) until reactivated.

## Errors

Every error uses the same shape:

```json
{ "error": { "code": "forbidden", "message": "API key lacks the 'helpdesk:read' scope." } }
```

| Status | `code` | When |
|---|---|---|
| 400 | `invalid_param` | Bad `status` value, malformed id |
| 401 | `unauthorized` | Missing, unknown, or **inactive** key |
| 403 | `forbidden` | Key valid but lacks the endpoint's scope |
| 404 | `not_found` | Ticket/article doesn't exist (or KB article isn't published) |
| 429 | `rate_limited` | Over 60 requests/minute for this key (`Retry-After: 60`) |
| 500 | `internal_error` | Database error |

**Rate limit caveat:** the 60/min counter is held in memory **per server instance**. Vercel may run several instances concurrently and cold starts reset the counter, so the real ceiling is 60 × live instances. Fine for a well-behaved internal bot; move to a shared store (e.g. a Postgres counter) if it ever needs to be strict.

## Logging

Every authenticated call (including 403/429/4xx) writes a row to `api_client_calls`: client, method, route, query/route params, status, result count, timestamp. Bot traffic does **not** go to `audit_log`. Unknown/missing keys (401) aren't logged (there's no client to attribute them to). Key create/rotate/activate/deactivate are logged to `audit_log` (`entity_type = 'api_client'`), like user changes.

Both tables are service-role only (RLS on, no policies) — query them from the Supabase SQL Editor:

```sql
select created_at, client_name, route, params, status, result_count
from api_client_calls order by created_at desc limit 50;
```

## Visibility rules

The API reads through the service role, so these are enforced in code:

- **Internal notes:** ticket detail splits comments into `public_comments` and `internal_comments`. Internal comments are staff-only — **a bot must never show them (or `visibility: "internal"` attachments) to the requester.**
- **KB:** only `published` articles are ever returned (drafts/archived → 404 / omitted).
- No storage paths, key hashes, or `select('*')` — each route names its columns.

---

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

A key deactivated on /admin returns 401; a key without `helpdesk:read` returns 403 (only possible once more scopes exist, or by editing `api_clients.scopes` in SQL).

## Out of scope for v1

Write endpoints (creating/replying to/resolving tickets), sending email, Assets and Daily Ops endpoints. New scopes get added to `BOT_SCOPES` in `src/lib/botAuth.js` (the admin create route validates against it).
