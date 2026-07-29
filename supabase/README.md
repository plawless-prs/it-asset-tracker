# Supabase migrations

Plain `.sql` files run manually in the **Supabase SQL Editor** (this project doesn't use the Supabase CLI migration runner). Every file is idempotent — safe to run more than once.

Run them **in order** the first time:

| # | File | Adds |
|---|------|------|
| 1 | `01_helpdesk_schema.sql` | Core Help Desk + Daily Ops schema: tickets, comments, attachments, activity, SLA policies + triggers, `ticket_list_view`, KB tables, Daily Ops tables, and all RLS. |
| 2 | `02_kb_linking.sql` | `pg_trgm`, the `kb_article_tickets` link table, and the `search_kb()` fuzzy/full-text ranking function (for "document this resolution"). |
| 3 | `03_email_attachments.sql` | Makes `tickets.requester_id` nullable + adds `requester_email` (inbound senders with no profile); creates the `helpdesk-attachments` storage bucket + policies. |
| 4 | `04_graph_inbound.sql` | `tickets.source_message_id` (+ unique index) to de-duplicate Microsoft Graph email notifications. |
| 5 | `05_tracker_schema.sql` | IT Tracker Stage 0: `locations`/`employees`/`racks`, asset type + rack/device columns, the `PRS-#####` asset-tag sequence, and RLS. |
| 6 | `06_employee_names.sql` | Splits `employees.full_name` into `first_name`/`last_name` (backfilled). |
| 7 | `07_location_rooms.sql` | `rooms` table + `room_id` on employees/assets/racks (location→room hierarchy). |
| 8 | `08_asset_rack_mountable.sql` | `assets.rack_mountable` boolean flag. |
| 9 | `09_rack_audits.sql` | `rack_audits` + `rack_audit_items` (rack audit workflow). |
| 10 | `10_priceupdates_schema.sql` | Price Update Processor (`priceupdates`): `pu_vendors`/`pu_parse_profiles`/`pu_batches`/`pu_batch_files`/`pu_lines`/`p21_item_mirror`/`pu_exports`/`pu_settings`, the `has_app_access()` RLS helper, and the private `price-files` Storage bucket. |
| 11 | `11_priceupdates_matching.sql` | Price Update Processor Phase 3: `pu_vendors.p21_item_prefix` + the `pu_apply_matches(jsonb)` bulk line-update function used by the matching route. |

## Notes

- These reflect the schema as of the Help Desk build. The app's runtime reads/writes are covered by the RLS policies here; the inbound-email API route uses the service-role key and bypasses RLS deliberately.
- `is_agent()` currently maps to `profiles.role = 'admin'` — the tool is IT-team-only, so every user is effectively an agent. Broaden that function if non-admin IT staff ever need ticket access.
- Setup guides that pair with these live in `../docs/` (email integration, data model, deprecation plan).
