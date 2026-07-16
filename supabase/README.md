# Supabase migrations

Plain `.sql` files run manually in the **Supabase SQL Editor** (this project doesn't use the Supabase CLI migration runner). Every file is idempotent — safe to run more than once.

Run them **in order** the first time:

| # | File | Adds |
|---|------|------|
| 1 | `01_helpdesk_schema.sql` | Core Help Desk + Daily Ops schema: tickets, comments, attachments, activity, SLA policies + triggers, `ticket_list_view`, KB tables, Daily Ops tables, and all RLS. |
| 2 | `02_kb_linking.sql` | `pg_trgm`, the `kb_article_tickets` link table, and the `search_kb()` fuzzy/full-text ranking function (for "document this resolution"). |
| 3 | `03_email_attachments.sql` | Makes `tickets.requester_id` nullable + adds `requester_email` (inbound senders with no profile); creates the `helpdesk-attachments` storage bucket + policies. |
| 4 | `04_graph_inbound.sql` | `tickets.source_message_id` (+ unique index) to de-duplicate Microsoft Graph email notifications. |

## Notes

- These reflect the schema as of the Help Desk build. The app's runtime reads/writes are covered by the RLS policies here; the inbound-email API route uses the service-role key and bypasses RLS deliberately.
- `is_agent()` currently maps to `profiles.role = 'admin'` — the tool is IT-team-only, so every user is effectively an agent. Broaden that function if non-admin IT staff ever need ticket access.
- Setup guides that pair with these live in `../docs/` (email integration, data model, deprecation plan).
