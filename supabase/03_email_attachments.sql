-- =============================================================================
-- PRS Help Desk — attachments storage + inbound-email fields
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- =============================================================================

-- 1. Inbound email support ----------------------------------------------------
-- Emails can arrive from people without a profile (vendors on priceupdate@,
-- employees not yet provisioned). Store the raw sender and allow no profile.
alter table tickets alter column requester_id drop not null;
alter table tickets add column if not exists requester_email text;

-- 2. Attachments storage bucket ----------------------------------------------
insert into storage.buckets (id, name, public)
values ('helpdesk-attachments', 'helpdesk-attachments', false)
on conflict (id) do nothing;

-- Storage RLS: any authenticated IT user can read/write/delete files in this
-- bucket (the app is IT-team only; app-layer guards restrict who reaches it).
drop policy if exists "hd_attach_read"   on storage.objects;
create policy "hd_attach_read" on storage.objects for select to authenticated
  using (bucket_id = 'helpdesk-attachments');

drop policy if exists "hd_attach_insert" on storage.objects;
create policy "hd_attach_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'helpdesk-attachments');

drop policy if exists "hd_attach_delete" on storage.objects;
create policy "hd_attach_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'helpdesk-attachments');

-- Note: the ticket_attachments table + its RLS already exist from the base
-- schema (supabase-setup.sql). Inbound tickets are inserted by the API route
-- using the service-role key, which bypasses RLS.
