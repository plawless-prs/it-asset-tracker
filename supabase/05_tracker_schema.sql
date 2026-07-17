-- =============================================================================
-- PRS Apps — IT Tracker (asset management) schema  [Stage 0]
-- Run this entire file once in the Supabase SQL Editor (Dashboard > SQL Editor).
--
-- This is the FIRST committed DDL for the tracker. The `assets` (and licenses/
-- budgets/purchases/subscriptions/audit_log) tables were originally created by
-- hand in the SQL Editor, so this file is written to be IDEMPOTENT and additive:
-- it uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / guarded DO-blocks so it
-- matches the existing live schema instead of recreating (or clobbering) it.
-- Safe to re-run.
--
-- Assumes an existing `profiles` table (id uuid = auth.users.id, role text) and
-- an existing `assets` table. Depends on helpers from 01_helpdesk_schema.sql,
-- but re-declares them below so this file is self-sufficient.
-- =============================================================================


-- =============================================================================
-- 0. HELPER FUNCTIONS  (re-declared; harmless if 01 already created them)
-- =============================================================================

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;


-- =============================================================================
-- 1. LOCATIONS  (normalized; assets, employees and racks reference this)
-- =============================================================================

create table if not exists locations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,          -- grouping label, e.g. "HQ — Server Room"
  site       text,                   -- building / site
  room       text,                   -- room within the site
  address    text,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists locations_updated on locations;
create trigger locations_updated before update on locations
  for each row execute function set_updated_at();


-- =============================================================================
-- 2. EMPLOYEES  (the company directory; NOT the same as app-login `profiles`)
-- Assets are assigned to an employee via a FK (Stage 1 wires the UI).
-- `profile_id` optionally links an employee who is also an app user.
-- =============================================================================

create table if not exists employees (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  email       text,
  department  text,
  title       text,
  manager_id  uuid references employees(id),
  location_id uuid references locations(id),
  profile_id  uuid references profiles(id),   -- link if they also log in
  status      text not null default 'active', -- active / inactive
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_employees_location on employees (location_id);
create index if not exists idx_employees_status   on employees (status);

drop trigger if exists employees_updated on employees;
create trigger employees_updated before update on employees
  for each row execute function set_updated_at();


-- =============================================================================
-- 3. RACKS  (server racks; total power is DERIVED by summing device watts,
-- and "most recent audit" comes from the Stage 5 audit tables — neither is
-- stored here.)
-- =============================================================================

create table if not exists racks (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  location_id uuid references locations(id),
  u_height    int  not null default 42,   -- rack size in U
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_racks_location on racks (location_id);

drop trigger if exists racks_updated on racks;
create trigger racks_updated before update on racks
  for each row execute function set_updated_at();


-- =============================================================================
-- 4. ASSET ID SYSTEM  (PRS-00001, global sequential, immutable, auto-assigned)
-- The generated ID doubles as the printed "asset tag". Existing rows are
-- backfilled oldest-first; future inserts get the next id via a column default.
-- =============================================================================

create sequence if not exists asset_tag_seq;

alter table assets add column if not exists asset_tag text;

do $$
declare maxnum bigint;
begin
  -- highest PRS number already assigned (0 if none)
  select coalesce(max((substring(asset_tag from 'PRS-(\d+)'))::bigint), 0)
    into maxnum
  from assets
  where asset_tag ~ '^PRS-\d+$';

  -- assign an id to every asset that lacks one, oldest first
  with numbered as (
    select id, row_number() over (order by created_at nulls last, id) as rn
    from assets
    where asset_tag is null
  )
  update assets a
     set asset_tag = 'PRS-' || lpad((maxnum + n.rn)::text, 5, '0')
    from numbered n
   where a.id = n.id;

  -- advance the sequence past the new high-water mark
  select coalesce(max((substring(asset_tag from 'PRS-(\d+)'))::bigint), 0)
    into maxnum
  from assets
  where asset_tag ~ '^PRS-\d+$';

  if maxnum > 0 then
    perform setval('asset_tag_seq', maxnum, true);   -- next nextval = maxnum + 1
  else
    perform setval('asset_tag_seq', 1, false);       -- next nextval = 1
  end if;
end $$;

-- future inserts auto-assign the next PRS id
alter table assets
  alter column asset_tag set default 'PRS-' || lpad(nextval('asset_tag_seq')::text, 5, '0');

create unique index if not exists idx_assets_asset_tag on assets (asset_tag);


-- =============================================================================
-- 5. ASSET COLUMNS  (type + relational assignment/location + rack/device fields)
-- All nullable/additive. `make` is reused as "brand" and `purchase_date` as
-- "date bought" in the device views. Rack membership: rack_id set with a
-- u_position = mounted at that U; rack_id set with u_position NULL = "off-rack"
-- (in the room, associated with the rack, not physically mounted).
-- =============================================================================

alter table assets add column if not exists type                 text;
alter table assets add column if not exists watts                int;
alter table assets add column if not exists u_height             int default 1;
alter table assets add column if not exists u_position           int;
alter table assets add column if not exists hostname             text;
alter table assets add column if not exists ip_address           text;
alter table assets add column if not exists os                   text;
alter table assets add column if not exists cpu                  text;
alter table assets add column if not exists ram                  text;
alter table assets add column if not exists storage              text;
alter table assets add column if not exists management_url       text;
alter table assets add column if not exists assigned_employee_id uuid references employees(id);
alter table assets add column if not exists location_id          uuid references locations(id);
alter table assets add column if not exists rack_id              uuid references racks(id);

create index if not exists idx_assets_type         on assets (type);
create index if not exists idx_assets_status       on assets (status);
create index if not exists idx_assets_rack         on assets (rack_id);
create index if not exists idx_assets_assigned_emp on assets (assigned_employee_id);
create index if not exists idx_assets_location     on assets (location_id);


-- =============================================================================
-- 6. ROW LEVEL SECURITY
-- New tables get RLS + a permissive authenticated policy (any logged-in user
-- may read/write, matching the tracker's current app-layer trust model; finer
-- rules can come later). Pre-existing tracker tables are brought under the same
-- policy only if they exist, so this won't error on a fresh project.
-- =============================================================================

-- ---- new tables -------------------------------------------------------------
alter table locations enable row level security;
alter table employees enable row level security;
alter table racks     enable row level security;

drop policy if exists locations_authenticated_all on locations;
create policy locations_authenticated_all on locations for all to authenticated
  using (true) with check (true);

drop policy if exists employees_authenticated_all on employees;
create policy employees_authenticated_all on employees for all to authenticated
  using (true) with check (true);

drop policy if exists racks_authenticated_all on racks;
create policy racks_authenticated_all on racks for all to authenticated
  using (true) with check (true);

-- ---- pre-existing tracker tables (guarded so missing ones are skipped) -------
do $$
declare t text;
begin
  foreach t in array
    array['assets','audit_log','licenses','budgets','purchases','subscriptions']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists %I on public.%I', t || '_authenticated_all', t);
      execute format(
        'create policy %I on public.%I for all to authenticated using (true) with check (true)',
        t || '_authenticated_all', t);
    end if;
  end loop;
end $$;


-- =============================================================================
-- Done. Verify in Table Editor: locations / employees / racks exist with a
-- green "RLS enabled" badge, and `select asset_tag from assets order by asset_tag`
-- shows PRS-00001, PRS-00002, ... Then inserting a new asset should auto-fill
-- the next PRS id.
-- =============================================================================
