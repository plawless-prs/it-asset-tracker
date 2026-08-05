-- 16: Price-file library (Phase 5.5).
--
-- Houses the historical vendor price-file archive (previously folders on an
-- office PC) plus new files uploaded from the app. Objects live in the
-- existing private `price-files` bucket under `library/<vendor>/<year>/...`
-- (batch uploads use `<batchId>/...`, exports `exports/<batchId>/...` — the
-- bucket-wide storage policies from migration 10 already cover all paths).
--
-- vendor_id / year are metadata (nullable — bulk imports that can't infer
-- them get assigned in the app); the storage key is NOT re-derived from them,
-- so editing metadata never moves the object. batch_id optionally links a
-- library file to the batch it fed. source: 'upload' (in-app) |
-- 'bulk_import' (scripts/import-price-library.mjs).
-- Idempotent.

create table if not exists pu_library_files (
  id           uuid primary key default gen_random_uuid(),
  vendor_id    uuid references pu_vendors(id) on delete set null,
  year         int,
  file_name    text not null,
  storage_path text not null unique,
  mime_type    text,
  file_size    bigint,
  batch_id     uuid references pu_batches(id) on delete set null,
  source       text not null default 'upload',
  uploaded_by  uuid references profiles(id),
  created_at   timestamptz not null default now()
);
create index if not exists idx_pu_library_files_vendor on pu_library_files (vendor_id);
create index if not exists idx_pu_library_files_year   on pu_library_files (year);
create index if not exists idx_pu_library_files_batch  on pu_library_files (batch_id);

alter table pu_library_files enable row level security;
drop policy if exists pu_library_files_priceupdates_all on pu_library_files;
create policy pu_library_files_priceupdates_all on pu_library_files
  for all to authenticated
  using ((select has_app_access('priceupdates')))
  with check ((select has_app_access('priceupdates')));
