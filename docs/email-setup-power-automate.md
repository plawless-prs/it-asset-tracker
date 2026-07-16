# Help Desk — email + attachments setup

What Claude built in the app, and the pieces **you** need to configure (Power Automate flows, environment variables, and the Supabase storage bucket). Nothing here requires an Azure app registration — it's all Microsoft 365 + Power Automate.

## Overview

- **Inbound:** a Power Automate flow per mailbox posts each new email to `POST /api/helpdesk/inbound`, which creates a ticket. `it@` → general Help Desk; `priceupdate@` → tickets in the `price_update` category (Prophet 21 import is a later project).
- **Outbound:** the app posts to `POST /api/helpdesk/notify`, which forwards to one Power Automate flow that sends the email as `it@`. Fires on new-ticket assignment and on public replies (internal notes never email).
- **Attachments:** stored in the Supabase Storage bucket `helpdesk-attachments`, downloaded via short-lived signed URLs.

## Step 1 — Run the SQL

In the Supabase SQL Editor, run `supabase-email-attachments.sql`. It makes `requester_id` nullable, adds `requester_email` (for senders with no profile), creates the `helpdesk-attachments` bucket, and adds its storage policies.

## Step 2 — Environment variables (Vercel → Project → Settings → Environment Variables)

| Variable | Value | Where it comes from |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | the **service_role** secret | Supabase → Project Settings → API. **Server-only** — never expose to the browser. |
| `HELPDESK_INBOUND_TOKEN` | a long random string you generate | Make one up (e.g. a password-generator value). The inbound flows send it in a header. |
| `POWER_AUTOMATE_NOTIFY_URL` | the outbound flow's HTTP POST URL | Created in Step 4 below. Keep secret. |

`NEXT_PUBLIC_SUPABASE_URL` is already set. **Redeploy** after adding variables.

## Step 3 — Inbound flows (one per mailbox)

Create these in Power Automate (make.powerautomate.com).

### Flow A — `it@` general Help Desk
1. **Trigger:** *Office 365 Outlook → When a new email arrives (V3)*, signed in as `it@powerandrubber.com`. (Optional: filter to Inbox only.)
2. **Action:** *HTTP* (or *HTTP with Microsoft Entra ID* is not needed — a plain HTTP action is fine).
   - **Method:** POST
   - **URI:** `https://prstech.app/api/helpdesk/inbound`
   - **Headers:**
     - `Content-Type: application/json`
     - `x-helpdesk-token: <your HELPDESK_INBOUND_TOKEN>`
   - **Body:**
     ```json
     {
       "from": "@{triggerOutputs()?['body/from']}",
       "subject": "@{triggerOutputs()?['body/subject']}",
       "text": "@{triggerOutputs()?['body/bodyPreview']}",
       "queue": "it"
     }
     ```
   Use `bodyPreview` for plain text. If you want the full body, use `body/body` and note it may be HTML.

### Flow B — `priceupdate@` shared inbox
Same as Flow A with two changes:
- **Trigger:** *Office 365 Outlook → When a new email arrives in a shared mailbox (V2)*, with **Mailbox Address** = `priceupdate@powerandrubber.com`. (Shared mailboxes don't need their own license; you connect with an account that has access to it.)
- In the HTTP **Body**, set `"queue": "priceupdate"`.

Send a test email to each address and confirm a ticket appears in the queue (with category `price_update` for the price mailbox).

## Step 4 — Outbound flow (send email as it@)

1. **Trigger:** *When an HTTP request is received*.
   - Set the **Request Body JSON Schema** to:
     ```json
     { "type": "object", "properties": {
       "to": { "type": "string" },
       "subject": { "type": "string" },
       "body": { "type": "string" } } }
     ```
   - Save once to generate the **HTTP POST URL** — copy it into `POWER_AUTOMATE_NOTIFY_URL`.
2. **Action:** *Office 365 Outlook → Send an email (V2)*, connected as `it@powerandrubber.com`:
   - **To:** `@{triggerBody()?['to']}`
   - **Subject:** `@{triggerBody()?['subject']}`
   - **Body:** `@{triggerBody()?['body']}`
3. Save, then **redeploy** the app so it picks up `POWER_AUTOMATE_NOTIFY_URL`.

The HTTP-trigger URL contains a secret signature — treat it like a password (it lives only in the Vercel env var, never in the repo).

## How the app behaves

- **New ticket assigned** → the assignee gets an email.
- **Public reply** on a ticket → the requester gets an email (internal notes do not).
- If `POWER_AUTOMATE_NOTIFY_URL` isn't set, notifications are silently skipped — the app still works.

## Notes & limits (v1)

- **Email attachments aren't imported yet.** Inbound tickets capture the subject + body; files attached to the email aren't stored (the `ticket_attachments.uploaded_by` column is required, and inbound has no user). Uploading files works fully inside the app. Importing email attachments is a small follow-up (make `uploaded_by` nullable + decode the flow's attachment bytes).
- **No auto-acknowledgement** is sent to the person who emailed in, to avoid mail loops. Add one later if wanted.
- **Prophet 21 import** for `priceupdate@` is intentionally out of scope — those tickets are captured and categorized so nothing is lost until that integration is built.
