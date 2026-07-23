-- =============================================================================
-- PRS Apps — Price Update Processor (app id `priceupdates`)  [Phase 1]
-- Run this entire file once in the Supabase SQL Editor (Dashboard > SQL Editor).
--
-- Successor to the retired Invoice Processor's "price update" duty and the first
-- app to integrate with Prophet 21. Turns vendor price/cost emails into a
-- pipeline: intake -> parse -> match against a P21 item mirror -> review/approve
-- -> export a P21-ready import file. v1 does NOT write to P21.
--
-- Idempotent + additive (guarded DO-blocks / IF NOT EXISTS), same style as the
-- tracker migrations 05-09. Safe to re-run.
--
-- Assumes an existing `profiles` table (id uuid = auth.users.id, role text,
-- app_access jsonb) and the helpers from 01_helpdesk_schema.sql (`is_agent()`,
-- `set_updated_at()`), both re-declared below so this file is self-sufficient.
-- =============================================================================


-- =============================================================================
-- 0. HELPER FUNCTIONS  (re-declared; harmless if 01/05 already created them)
-- =============================================================================

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

-- Is the current user an IT agent/admin? (matches useRole.js: role = 'admin')
create or replace function is_agent()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from profiles where id = auth.uid()), false);
$$;

-- Does the current user have access to a given app? Mirrors useRole.hasAccess():
-- admins always pass; otherwise the app id must be present in the profile's
-- `app_access` JSONB array. Used as the RLS backstop for this internal tool.
create or replace function has_app_access(app text)
returns boolean language sql stable security definer set search_path = public as $$
  select is_agent()
      or coalesce((select app_access ? app from profiles where id = auth.uid()), false);
$$;


-- =============================================================================
-- 1. ENUM TYPES  (wrapped so re-running won't error)
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'price_batch_status') then
    create type price_batch_status as enum
      ('received','parsing','needs_review','approved','exported','applied','failed','archived');
  end if;
  if not exists (select 1 from pg_type where typname = 'price_batch_source') then
    create type price_batch_source as enum ('email','upload');
  end if;
  if not exists (select 1 from pg_type where typname = 'parse_status') then
    create type parse_status as enum ('pending','parsed','failed','manual');
  end if;
  if not exists (select 1 from pg_type where typname = 'match_status') then
    create type match_status as enum ('matched','unmatched','ambiguous','new_item');
  end if;
  if not exists (select 1 from pg_type where typname = 'line_flag') then
    create type line_flag as enum ('ok','large_increase','decrease','cost_over_list','new','review');
  end if;
end $$;


-- =============================================================================
-- 2. TABLES
-- =============================================================================

-- Vendors we receive price files from
create table if not exists pu_vendors (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  p21_supplier_id  text,                    -- P21 supplier identifier, for matching
  email_domains    text[] default '{}',     -- e.g. {'gates.com'} to auto-identify inbound mail
  notes            text,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Saved parsing recipe per vendor + file shape (how to read their spreadsheet)
create table if not exists pu_parse_profiles (
  id           uuid primary key default gen_random_uuid(),
  vendor_id    uuid not null references pu_vendors(id) on delete cascade,
  label        text not null,               -- e.g. "2026 net price file"
  config       jsonb not null,              -- {sheet, header_row, skip_rows, columns:{...}, transforms:{...}}
  created_by   uuid not null references profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_pu_parse_profiles_vendor on pu_parse_profiles (vendor_id);

-- One inbound price update event (an email or a manual upload)
create table if not exists pu_batches (
  id               uuid primary key default gen_random_uuid(),
  number           bigint generated always as identity,
  vendor_id        uuid references pu_vendors(id),        -- nullable until identified
  source           price_batch_source not null,
  status           price_batch_status not null default 'received',
  email_message_id text unique,                           -- Graph message id (dedupe)
  email_from       text,
  email_subject    text,
  email_body       text,                                  -- for body-price / portal-link cases
  received_at      timestamptz not null default now(),
  effective_date   date,
  line_count       int not null default 0,
  matched_count    int not null default 0,
  flagged_count    int not null default 0,
  reviewed_by      uuid references profiles(id),
  approved_by      uuid references profiles(id),
  approved_at      timestamptz,
  exported_at      timestamptz,
  applied_at       timestamptz,                           -- stamped when user confirms P21 load
  applied_by       uuid references profiles(id),
  error            text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_pu_batches_status on pu_batches (status);
create index if not exists idx_pu_batches_vendor on pu_batches (vendor_id);

-- Files attached to a batch (stored in Supabase Storage bucket `price-files`)
create table if not exists pu_batch_files (
  id               uuid primary key default gen_random_uuid(),
  batch_id         uuid not null references pu_batches(id) on delete cascade,
  storage_path     text not null,
  file_name        text not null,
  mime_type        text,
  file_size        bigint,
  parse_status     parse_status not null default 'pending',
  parse_profile_id uuid references pu_parse_profiles(id),
  parsed_rows      int,
  error            text,
  created_at       timestamptz not null default now()
);
create index if not exists idx_pu_batch_files_batch on pu_batch_files (batch_id);

-- One row per price line extracted from a file (or keyed manually from a PDF)
create table if not exists pu_lines (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid not null references pu_batches(id) on delete cascade,
  file_id         uuid references pu_batch_files(id) on delete cascade,
  row_number      int,
  raw             jsonb,                     -- original row as parsed, for audit
  vendor_item_no  text,
  description     text,
  uom             text,
  new_cost        numeric(14,4),
  new_list        numeric(14,4),
  effective_date  date,
  -- matching against the P21 mirror:
  p21_item_id     text,
  match_status    match_status not null default 'unmatched',
  old_cost        numeric(14,4),             -- snapshot from mirror at match time
  old_list        numeric(14,4),
  cost_change_pct numeric(8,2),
  flag            line_flag not null default 'review',
  include         boolean not null default true,   -- unchecked lines are left out of export
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_pu_lines_batch on pu_lines (batch_id);
create index if not exists idx_pu_lines_match on pu_lines (match_status);

-- Read-only mirror of P21 item + supplier-cost data, refreshed by cron (Phase 3)
create table if not exists p21_item_mirror (
  p21_item_id      text not null,
  supplier_id      text,
  supplier_part_no text,
  item_desc        text,
  uom              text,
  current_cost     numeric(14,4),
  current_list     numeric(14,4),
  last_synced_at   timestamptz not null default now(),
  primary key (p21_item_id, supplier_id)
);
create index if not exists idx_p21_item_mirror_partno on p21_item_mirror (supplier_part_no);

-- Generated export files
create table if not exists pu_exports (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid not null references pu_batches(id) on delete cascade,
  storage_path text not null,
  file_name    text not null,
  row_count    int not null,
  created_by   uuid not null references profiles(id),
  created_at   timestamptz not null default now()
);
create index if not exists idx_pu_exports_batch on pu_exports (batch_id);

-- Guardrail thresholds (single-row config)
create table if not exists pu_settings (
  id                     int primary key default 1,
  large_increase_pct     numeric(6,2) not null default 20,   -- flag if cost rises more than this
  flag_decreases         boolean not null default true,
  flag_cost_over_list    boolean not null default true
);
insert into pu_settings (id) values (1) on conflict do nothing;


-- =============================================================================
-- 3. updated_at TRIGGERS
-- =============================================================================

drop trigger if exists pu_vendors_updated on pu_vendors;
create trigger pu_vendors_updated before update on pu_vendors
  for each row execute function set_updated_at();

drop trigger if exists pu_parse_profiles_updated on pu_parse_profiles;
create trigger pu_parse_profiles_updated before update on pu_parse_profiles
  for each row execute function set_updated_at();

drop trigger if exists pu_batches_updated on pu_batches;
create trigger pu_batches_updated before update on pu_batches
  for each row execute function set_updated_at();

drop trigger if exists pu_lines_updated on pu_lines;
create trigger pu_lines_updated before update on pu_lines
  for each row execute function set_updated_at();


-- =============================================================================
-- 4. ROW LEVEL SECURITY
-- Internal IT-run tool: anyone with `priceupdates` app access (admins always)
-- may read/write all app data. `has_app_access('priceupdates')` is the backstop
-- on every table; the P21 mirror is read-only to users (written by the service
-- role in the Phase 3 sync cron, which bypasses RLS).
-- =============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'pu_vendors','pu_parse_profiles','pu_batches','pu_batch_files',
    'pu_lines','pu_exports','pu_settings'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_priceupdates_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using (has_app_access(''priceupdates'')) with check (has_app_access(''priceupdates''))',
      t || '_priceupdates_all', t);
  end loop;
end $$;

-- P21 mirror: readable by app users, writes reserved for the service role.
alter table p21_item_mirror enable row level security;
drop policy if exists p21_item_mirror_read on p21_item_mirror;
create policy p21_item_mirror_read on p21_item_mirror for select to authenticated
  using (has_app_access('priceupdates'));


-- =============================================================================
-- 5. STORAGE  (private bucket `price-files` for inbound files + generated exports)
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('price-files', 'price-files', false)
on conflict (id) do nothing;

drop policy if exists "pu_files_read"   on storage.objects;
create policy "pu_files_read" on storage.objects for select to authenticated
  using (bucket_id = 'price-files' and has_app_access('priceupdates'));

drop policy if exists "pu_files_insert" on storage.objects;
create policy "pu_files_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'price-files' and has_app_access('priceupdates'));

drop policy if exists "pu_files_delete" on storage.objects;
create policy "pu_files_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'price-files' and has_app_access('priceupdates'));


-- =============================================================================
-- 6. SEED DATA  (2-3 vendors + one sample batch, so the queue isn't empty)
-- =============================================================================

insert into pu_vendors (name, p21_supplier_id, email_domains, notes)
select v.name, v.sup, v.domains, v.notes
from (values
  ('Gates Corporation',   '1001', array['gates.com']::text[],       'Belts & hose — annual net price file'),
  ('Parker Hannifin',     '1002', array['parker.com']::text[],      'Fittings & seals'),
  ('Continental / ContiTech', '1003', array['continental.com','contitech.com']::text[], 'Industrial hose & sheet')
) as v(name, sup, domains, notes)
where not exists (select 1 from pu_vendors x where x.name = v.name);

-- Sample batch (manual upload, freshly received) attached to Gates, if none yet.
insert into pu_batches (vendor_id, source, status, email_subject, notes)
select v.id, 'upload', 'received', '2026 Gates net price file', 'Seed sample batch (Phase 1).'
from pu_vendors v
where v.name = 'Gates Corporation'
  and not exists (select 1 from pu_batches b);


-- =============================================================================
-- Done. Verify in Table Editor: pu_vendors / pu_batches / pu_lines etc. exist
-- with a green "RLS enabled" badge, the `price-files` bucket exists (private),
-- and `select number, status from pu_batches` shows the seeded sample batch.
-- =============================================================================
