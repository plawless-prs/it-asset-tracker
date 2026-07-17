-- =============================================================================
-- PRS Apps — IT Tracker: location → room hierarchy  [Stage 1 rework]
-- Run once in the Supabase SQL Editor. Idempotent.
--
-- Reworks locations from a flat record into a two-level hierarchy:
--   locations (a branch/site) --< rooms (rooms within that branch)
-- Employees, assets and racks reference a room (which implies its location);
-- they also keep location_id so they can be "at a branch" without a specific
-- room. The old flat locations.site / locations.room text columns are retired.
-- =============================================================================

-- ---- rooms -----------------------------------------------------------------
create table if not exists rooms (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  name        text not null,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_rooms_location on rooms (location_id);

drop trigger if exists rooms_updated on rooms;
create trigger rooms_updated before update on rooms
  for each row execute function set_updated_at();

-- ---- room references on the things that live in a room ----------------------
-- on delete set null: deleting a room leaves its occupants location-only, not broken.
alter table employees add column if not exists room_id uuid references rooms(id) on delete set null;
alter table assets    add column if not exists room_id uuid references rooms(id) on delete set null;
alter table racks     add column if not exists room_id uuid references rooms(id) on delete set null;
create index if not exists idx_employees_room on employees (room_id);
create index if not exists idx_assets_room    on assets (room_id);
create index if not exists idx_racks_room     on racks (room_id);

-- ---- retire the flat text columns (now modeled by the rooms table) ----------
alter table locations drop column if exists room;
alter table locations drop column if exists site;

-- ---- RLS --------------------------------------------------------------------
alter table rooms enable row level security;
drop policy if exists rooms_authenticated_all on rooms;
create policy rooms_authenticated_all on rooms for all to authenticated
  using (true) with check (true);

-- =============================================================================
-- Done. Verify: locations no longer have site/room columns; `rooms` exists with
-- RLS; and employees/assets/racks each have a room_id column.
-- =============================================================================
