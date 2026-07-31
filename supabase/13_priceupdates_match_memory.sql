-- =============================================================================
-- PRS Apps — Price Update Processor  [Phase 5.1: match memory]
-- Run once in the Supabase SQL Editor. Idempotent / additive. Safe to re-run.
--
-- Remembers how an ambiguous/unmatched vendor part number was resolved to a P21
-- item, per vendor, so the next price update from the same vendor matches it
-- the same way automatically. Rows are written when a reviewer manually picks a
-- match (source 'manual') or approves a batch containing auto-picked ambiguous
-- lines (source 'review') — never from an unconfirmed auto-pick, so a bad guess
-- can't stick without a human having signed off on it.
-- =============================================================================

create table if not exists pu_item_aliases (
  id              uuid primary key default gen_random_uuid(),
  vendor_id       uuid not null references pu_vendors(id) on delete cascade,
  normalized_part text not null,          -- normalizePart(vendor_item_no)
  p21_item_id     text not null,
  source          text not null default 'review',   -- 'review' | 'manual'
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (vendor_id, normalized_part)
);
create index if not exists idx_pu_item_aliases_vendor on pu_item_aliases (vendor_id);

alter table pu_item_aliases enable row level security;

-- Same per-app gate as every pu_* table; wrapped in (select …) so it's an
-- init-plan, not per-row (see migration 12).
drop policy if exists "pu_item_aliases_all" on pu_item_aliases;
create policy "pu_item_aliases_all" on pu_item_aliases
  for all to authenticated
  using ((select has_app_access('priceupdates')))
  with check ((select has_app_access('priceupdates')));

-- =============================================================================
-- Done. Verify: `select count(*) from pu_item_aliases` returns 0 and the table
-- shows the green "RLS enabled" badge.
-- =============================================================================
