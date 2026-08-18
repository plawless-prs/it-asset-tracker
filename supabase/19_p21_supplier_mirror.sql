-- =============================================================================
-- PRS Apps — Price Update Processor  [P21 supplier directory mirror]
-- Run once in the Supabase SQL Editor. Idempotent / additive. Safe to re-run.
--
-- Read-only directory of P21 suppliers (id + name), synced from the replica's
-- p21_view_supplier by the on-prem worker on every full sync (nightly --once
-- and Settings "Sync now"). Powers the vendor modal's "find in P21" lookup so
-- a vendor's p21_supplier_id no longer has to be looked up inside P21 itself.
-- Same access model as p21_item_mirror: app users read, service role writes.
-- =============================================================================

create table if not exists p21_supplier_mirror (
  supplier_id    text primary key,
  supplier_name  text,
  last_synced_at timestamptz not null default now()
);

alter table p21_supplier_mirror enable row level security;

drop policy if exists p21_supplier_mirror_read on p21_supplier_mirror;
create policy p21_supplier_mirror_read on p21_supplier_mirror for select to authenticated
  using ((select has_app_access('priceupdates')));

-- =============================================================================
-- Done. Verify: `select count(*) from p21_supplier_mirror` (0 until the worker
-- runs its next full sync).
-- =============================================================================
