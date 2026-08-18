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
| 12 | `12_priceupdates_rls_perf.sql` | Recreates the `pu_*` + `p21_item_mirror` RLS policies with `(select has_app_access(...))` so the check is an init-plan (once per query) instead of per-row — fixes intermittent 500s on large-batch count queries. |
| 13 | `13_priceupdates_match_memory.sql` | `pu_item_aliases` (per-vendor vendor-part → P21-item match memory, written on approve/manual fix, checked first by the match route). |
| 14 | `14_p21_sync_worker.sql` | `pu_settings` worker columns (`worker_heartbeat_at`/`worker_last_result` + the since-dropped `sync_requested_at`) for the on-prem sync worker. |
| 15 | `15_pu_sync_requests.sql` | `pu_sync_requests` queue (supplier-scoped syncs on batch creation; Settings "Sync now" goes through it too); drops migration-14's single-flag columns. |
| 16 | `16_pu_library_files.sql` | `pu_library_files` (file-library metadata; objects live under `library/<vendor>/<year>/…` in `price-files`). |
| 17 | `17_pu_library_facets.sql` | `pu_library_facets(vendor, year)` SQL function feeding the Files page's year/date dropdowns. |
| 18 | `18_pu_reminders.sql` | `pu_settings.reminder_emails` (daily batch-reminder digest recipients). |
| 19 | `19_p21_supplier_mirror.sql` | `p21_supplier_mirror` (read-only P21 supplier directory, synced by the worker on full syncs; powers the vendor modal's supplier lookup). |

## Notes

- These reflect the schema as of the Help Desk build. The app's runtime reads/writes are covered by the RLS policies here; the inbound-email API route uses the service-role key and bypasses RLS deliberately.
- `is_agent()` currently maps to `profiles.role = 'admin'` — the tool is IT-team-only, so every user is effectively an agent. Broaden that function if non-admin IT staff ever need ticket access.
- Setup guides that pair with these live in `../docs/` (email integration, data model, deprecation plan).
