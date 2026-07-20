-- =============================================================================
-- PRS Apps — IT Tracker: rack audit workflow  [Stage 5]
-- Run once in the Supabase SQL Editor. Idempotent.
--
-- A rack audit is a point-in-time physical check of a rack. Starting an audit
-- snapshots the rack's currently-mounted devices into `rack_audit_items`
-- (expected state); the auditor then walks the rack marking each item
-- present / missing / moved (and can log an unexpected "extra" device), records
-- condition + notes, and completes the audit. History is preserved even if the
-- underlying asset is later edited, moved, or deleted (name/type/expected slot
-- are snapshotted onto the item, and asset_id is set null on delete).
-- =============================================================================

-- ---- rack_audits -----------------------------------------------------------
create table if not exists rack_audits (
  id           uuid primary key default gen_random_uuid(),
  rack_id      uuid not null references racks(id) on delete cascade,
  status       text not null default 'in_progress',   -- in_progress | completed
  started_at   timestamptz not null default now(),
  completed_at timestamptz,
  auditor_id   uuid references profiles(id),
  notes        text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_rack_audits_rack on rack_audits (rack_id);

-- ---- rack_audit_items ------------------------------------------------------
create table if not exists rack_audit_items (
  id                 uuid primary key default gen_random_uuid(),
  audit_id           uuid not null references rack_audits(id) on delete cascade,
  asset_id           bigint references assets(id) on delete set null,  -- assets.id is bigint (legacy hand-made table), not uuid
  device_name        text,   -- snapshot at audit time (survives asset edits/deletes)
  device_type        text,   -- snapshot type
  expected_u_position int,
  expected_u_height   int,
  result             text not null default 'pending', -- pending | present | missing | moved | extra
  actual_u_position  int,    -- where it was actually found (for "moved")
  condition          text,   -- ok | damaged | needs_attention (nullable)
  notes              text,
  created_at         timestamptz not null default now()
);
create index if not exists idx_rack_audit_items_audit on rack_audit_items (audit_id);

-- ---- RLS -------------------------------------------------------------------
alter table rack_audits      enable row level security;
alter table rack_audit_items enable row level security;

drop policy if exists rack_audits_authenticated_all on rack_audits;
create policy rack_audits_authenticated_all on rack_audits for all to authenticated
  using (true) with check (true);

drop policy if exists rack_audit_items_authenticated_all on rack_audit_items;
create policy rack_audit_items_authenticated_all on rack_audit_items for all to authenticated
  using (true) with check (true);

-- =============================================================================
-- Done. Verify: rack_audits + rack_audit_items exist with RLS enabled.
-- =============================================================================
