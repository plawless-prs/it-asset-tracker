# Inbound + outbound email via Microsoft Graph (no Power Automate)

This replaces the Power Automate approach entirely. One Entra app registration handles **both** directions:
- **Inbound:** Graph push notifications create a ticket the moment an email lands in `it@` or `priceupdate@`. Nothing runs between emails.
- **Outbound:** the app sends replies/assignment emails as `it@` via Graph.

You do this once. It's fiddly the first time; follow the steps in order. Your EMS E5 (Entra ID P2) already gives you everything needed.

---

## Part 1 — Register the Entra app

1. Go to **entra.microsoft.com** → **Applications** → **App registrations** → **New registration**.
2. Name: `PRS Help Desk`. Leave "Supported account types" on **single tenant**. Skip redirect URI. **Register**.
3. On the app's **Overview** page, copy two values:
   - **Application (client) ID** → this is `AZURE_CLIENT_ID`
   - **Directory (tenant) ID** → this is `AZURE_TENANT_ID`

## Part 2 — Client secret

1. In the app → **Certificates & secrets** → **Client secrets** → **New client secret**.
2. Description `prs-helpdesk`, expiry 24 months → **Add**.
3. **Copy the secret's "Value" immediately** (not the "Secret ID") → this is `AZURE_CLIENT_SECRET`. You can't see it again after leaving the page.

## Part 3 — Graph permissions

1. In the app → **API permissions** → **Add a permission** → **Microsoft Graph** → **Application permissions**.
2. Add these two:
   - `Mail.Read` (read the mailboxes to build tickets)
   - `Mail.Send` (send outbound as it@)
3. Click **Grant admin consent for [your tenant]** and confirm. Both should show a green check.

> `Mail.Read`/`Mail.Send` as *application* permissions are tenant-wide by default (all mailboxes). Part 4 locks the app down to just your two mailboxes — do it.

## Part 4 — Restrict the app to only it@ and priceupdate@ (least privilege)

This uses Exchange Online PowerShell. On a Windows machine:

```powershell
Install-Module ExchangeOnlineManagement -Scope CurrentUser   # first time only
Connect-ExchangeOnline

# A mail-enabled security group listing the mailboxes the app may touch:
New-DistributionGroup -Name "PRS Helpdesk Mailboxes" -Type Security `
  -Members it@powerandrubber.com, priceupdate@powerandrubber.com `
  -PrimarySmtpAddress prs-helpdesk-mailboxes@powerandrubber.com

# Scope the app (use your AZURE_CLIENT_ID) to only that group:
New-ApplicationAccessPolicy -AppId <AZURE_CLIENT_ID> `
  -PolicyScopeGroupId prs-helpdesk-mailboxes@powerandrubber.com `
  -AccessRight RestrictAccess `
  -Description "PRS Help Desk app limited to it@ and priceupdate@"
```

Now the app can only read/send for those two mailboxes, nothing else.

## Part 5 — Environment variables (Vercel → Settings → Environment Variables)

| Variable | Value |
|---|---|
| `AZURE_TENANT_ID` | Directory (tenant) ID from Part 1 |
| `AZURE_CLIENT_ID` | Application (client) ID from Part 1 |
| `AZURE_CLIENT_SECRET` | secret **Value** from Part 2 |
| `GRAPH_CLIENT_STATE` | any long random string (validates notifications) |
| `IT_MAILBOX` | `it@powerandrubber.com` |
| `PRICEUPDATE_MAILBOX` | `priceupdate@powerandrubber.com` |
| `HELPDESK_INBOUND_TOKEN` | any long random string (used to trigger subscription setup) |
| `CRON_SECRET` | any long random string (Vercel sends this on cron runs) |
| `APP_BASE_URL` | `https://prstech.app` (optional; defaults to this) |

`SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_URL` should already be set. **Redeploy** after adding these.

## Part 6 — Database + deploy

1. Run `supabase-graph-inbound.sql` in the Supabase SQL Editor (adds the dedupe column) and, if you haven't yet, `supabase-email-attachments.sql` (adds `requester_email`, makes `requester_id` nullable, storage bucket).
2. Deploy the app (push to `main`) so `/api/helpdesk/graph-notify` is live — Graph must be able to reach it in the next step.

## Part 7 — Create the subscriptions (one-time)

Trigger the subscribe endpoint once. From any terminal (replace the token):

```bash
curl -X POST https://prstech.app/api/helpdesk/graph-subscribe \
  -H "x-helpdesk-token: <your HELPDESK_INBOUND_TOKEN>"
```

You should get back JSON like `{"ok":true,"results":[{"mailbox":"it@...","action":"created",...},{...}]}`. If you see an error mentioning validation, the app isn't deployed/reachable yet — finish Part 6 first.

The **Vercel Cron** in `vercel.json` re-runs this every day at 06:00 UTC to renew the subscriptions before their ~2-day expiry. You don't need to touch it again.

## Part 8 — Test

- Send an email to `it@powerandrubber.com` → within a few seconds a ticket appears in the queue (category blank/general).
- Send one to `priceupdate@powerandrubber.com` → a ticket appears with category `price_update`.
- Reply to a ticket in the app → the requester gets an email from `it@` (outbound via Graph).

## Notes & limits

- **Subscriptions expire** (~2 days); the daily cron renews them. If email ever stops creating tickets, re-run the Part 7 curl to recreate them.
- **Email attachments aren't imported yet** — inbound captures subject + body; files on the email aren't stored. In-app uploads work fully. (Follow-up: make `ticket_attachments.uploaded_by` nullable + save the message's attachments.)
- **No auto-acknowledgement** to inbound senders, to avoid mail loops.
- **De-duplication:** each ticket records the email's message id; a repeated Graph notification won't create a second ticket.
- **Power Automate is no longer needed** for anything. The `/api/helpdesk/notify` route still supports a Power Automate fallback if `AZURE_*` isn't set, but with Graph configured it sends directly.
