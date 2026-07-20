-- =============================================================================
-- PRS Apps — IT Tracker: explicit rack_mountable flag  [Stage 4 follow-up]
-- Run once in the Supabase SQL Editor. Idempotent.
--
-- Rack eligibility used to be inferred from `type` (Server/Switch/…). That made
-- it impossible to rack an "Other"-typed device. This makes rack-mountability a
-- per-asset choice (a checkbox in the asset form). `type` still drives which
-- detail fields the form shows (computer specs vs. management URL) — only the
-- rack/power fields are now gated on this flag.
--
-- Backfill: assets that were rack-eligible by type, and any asset already
-- assigned to a rack, are marked rack_mountable so nothing already placed is
-- orphaned.
-- =============================================================================

alter table assets add column if not exists rack_mountable boolean not null default false;

update assets
   set rack_mountable = true
 where rack_mountable = false
   and (
     type in ('Server', 'Switch', 'Router', 'Firewall', 'Storage / NAS', 'UPS')
     or rack_id is not null
   );
