-- =============================================================================
-- PRS Apps — Help Desk + Daily Ops schema
-- Run this entire file once in the Supabase SQL Editor (Dashboard > SQL Editor).
-- It is safe to re-run: it uses IF NOT EXISTS / OR REPLACE / DROP-then-CREATE
-- guards throughout, so running it twice will not error or duplicate data.
--
-- Assumes an existing `profiles` table with an `id` (uuid, = auth.users.id)
-- and a `role` text column (where role = 'admin' marks IT staff).
-- =============================================================================


-- =============================================================================
-- 0. HELPER FUNCTIONS
-- =============================================================================

-- Bump updated_at on any row update
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

-- Is the current user an IT agent/admin?
-- (Matches useRole.js, which treats role = 'admin' as full access.)
create or replace function is_agent()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'admin' from profiles where id = auth.uid()), false);
$$;


-- =============================================================================
-- 1. ENUM TYPES  (wrapped so re-running won't error)
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'ticket_status') then
    create type ticket_status as enum ('open','in_progress','waiting','resolved','closed');
  end if;
  if not exists (select 1 from pg_type where typname = 'ticket_priority') then
    create type ticket_priority as enum ('low','medium','high','urgent');
  end if;
  if not exists (select 1 from pg_type where typname = 'ticket_source') then
    create type ticket_source as enum ('portal','email','phone','chat','manual');
  end if;
  if not exists (select 1 from pg_type where typname = 'kb_status') then
    create type kb_status as enum ('draft','published','archived');
  end if;
  if not exists (select 1 from pg_type where typname = 'sop_frequency') then
    create type sop_frequency as enum ('daily','weekly','monthly','adhoc');
  end if;
  if not exists (select 1 from pg_type where typname = 'task_status') then
    create type task_status as enum ('todo','in_progress','done','skipped');
  end if;
end $$;


-- =============================================================================
-- 2. PART A — TICKETS + SLA
-- =============================================================================

create table if not exists tickets (
  id            uuid primary key default gen_random_uuid(),
  number        bigint generated always as identity,
  title         text not null,
  description   text not null,
  status        ticket_status   not null default 'open',
  priority      ticket_priority not null default 'medium',
  source        ticket_source   not null default 'manual',
  category      text,
  requester_id  uuid not null references profiles(id),
  assignee_id   uuid references profiles(id),
  first_response_due timestamptz,
  resolution_due     timestamptz,
  first_responded_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  closed_at     timestamptz
);
create index if not exists idx_tickets_status      on tickets (status);
create index if not exists idx_tickets_assignee    on tickets (assignee_id);
create index if not exists idx_tickets_requester   on tickets (requester_id);
create index if not exists idx_tickets_resolution  on tickets (resolution_due);

drop trigger if exists tickets_updated on tickets;
create trigger tickets_updated before update on tickets
  for each row execute function set_updated_at();

create table if not exists ticket_comments (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references tickets(id) on delete cascade,
  author_id   uuid not null references profiles(id),
  body        text not null,
  is_internal boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_comments_ticket on ticket_comments (ticket_id);

create table if not exists ticket_attachments (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references tickets(id) on delete cascade,
  comment_id  uuid references ticket_comments(id) on delete cascade,
  storage_path text not null,
  file_name   text not null,
  file_size   bigint,
  uploaded_by uuid not null references profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists idx_attachments_ticket on ticket_attachments (ticket_id);

create table if not exists ticket_activity (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references tickets(id) on delete cascade,
  actor_id   uuid not null references profiles(id),
  action     text not null,
  from_value text,
  to_value   text,
  created_at timestamptz not null default now()
);
create index if not exists idx_activity_ticket on ticket_activity (ticket_id);

-- SLA policy: response/resolution windows per priority (minutes)
create table if not exists sla_policies (
  priority           ticket_priority primary key,
  first_response_min int not null,
  resolution_min     int not null
);
insert into sla_policies (priority, first_response_min, resolution_min) values
  ('urgent', 30,  240),
  ('high',   60,  480),
  ('medium', 240, 1440),
  ('low',    480, 2880)
on conflict (priority) do nothing;

-- Stamp SLA due times from the policy when a ticket is created
create or replace function apply_sla()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare p sla_policies%rowtype;
begin
  select * into p from sla_policies where priority = new.priority;
  if found then
    new.first_response_due := new.created_at + (p.first_response_min || ' minutes')::interval;
    new.resolution_due     := new.created_at + (p.resolution_min     || ' minutes')::interval;
  end if;
  return new;
end; $$;

drop trigger if exists tickets_apply_sla on tickets;
create trigger tickets_apply_sla before insert on tickets
  for each row execute function apply_sla();

-- Recompute SLA due times when priority changes (measured from created_at,
-- so an escalated ticket is judged against the original report time — matching
-- Freshservice). Fires only when the priority value actually changes.
drop trigger if exists tickets_reapply_sla on tickets;
create trigger tickets_reapply_sla before update of priority on tickets
  for each row when (new.priority is distinct from old.priority)
  execute function apply_sla();

-- Derived SLA "state" for the queue pill. security_invoker so RLS still applies.
create or replace view ticket_list_view
with (security_invoker = true) as
select t.*,
  case
    when t.status in ('resolved','closed')      then 'resolved'
    when t.resolution_due < now()               then 'overdue'
    when t.resolution_due::date = current_date  then 'due_today'
    else 'on_time'
  end as sla_state
from tickets t;


-- =============================================================================
-- 3. PART B — KNOWLEDGE BASE (internal IT reference)
-- =============================================================================

create table if not exists kb_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  sort_order int  not null default 0
);

create table if not exists kb_articles (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  title         text not null,
  body          text not null,
  category_id   uuid references kb_categories(id),
  tags          text[] default '{}',
  status        kb_status not null default 'draft',
  author_id     uuid not null references profiles(id),
  view_count    int not null default 0,
  helpful_count int not null default 0,
  not_helpful   int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  published_at  timestamptz
);
create index if not exists idx_kb_status on kb_articles (status);
create index if not exists idx_kb_tags   on kb_articles using gin (tags);
create index if not exists idx_kb_search on kb_articles
  using gin (to_tsvector('english', title || ' ' || body));

drop trigger if exists kb_updated on kb_articles;
create trigger kb_updated before update on kb_articles
  for each row execute function set_updated_at();


-- =============================================================================
-- 4. PART C — DAILY OPS (SOP checklists + one-off tasks)
-- =============================================================================

create table if not exists sop_templates (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  frequency   sop_frequency not null default 'daily',
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_by  uuid not null references profiles(id),
  created_at  timestamptz not null default now()
);

create table if not exists sop_template_items (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references sop_templates(id) on delete cascade,
  label        text not null,
  instructions text,
  required     boolean not null default true,
  sort_order   int not null default 0
);

create table if not exists sop_instances (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references sop_templates(id),
  due_date     date not null,
  assigned_to  uuid references profiles(id),
  status       task_status not null default 'todo',
  created_at   timestamptz not null default now(),
  completed_at timestamptz,
  unique (template_id, due_date)
);
create index if not exists idx_sop_instances_due on sop_instances (due_date);

create table if not exists sop_item_status (
  id               uuid primary key default gen_random_uuid(),
  instance_id      uuid not null references sop_instances(id) on delete cascade,
  template_item_id uuid not null references sop_template_items(id),
  checked          boolean not null default false,
  checked_by       uuid references profiles(id),
  checked_at       timestamptz,
  note             text,
  unique (instance_id, template_item_id)
);

create table if not exists tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  status      task_status not null default 'todo',
  priority    ticket_priority not null default 'medium',
  assigned_to uuid references profiles(id),
  due_date    date,
  created_by  uuid not null references profiles(id),
  created_at  timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists idx_tasks_status   on tasks (status);
create index if not exists idx_tasks_assignee on tasks (assigned_to);


-- =============================================================================
-- 5. ROW LEVEL SECURITY
-- Enable RLS on every table, then add policies. All policies target the
-- `authenticated` role (logged-in users) — anon/public gets nothing.
-- Because is_agent() is true for admins and your IT team are admins, they can
-- see and manage everything; the finer-grained conditions future-proof the schema.
-- =============================================================================

alter table tickets             enable row level security;
alter table ticket_comments     enable row level security;
alter table ticket_attachments  enable row level security;
alter table ticket_activity     enable row level security;
alter table sla_policies        enable row level security;
alter table kb_categories       enable row level security;
alter table kb_articles         enable row level security;
alter table sop_templates       enable row level security;
alter table sop_template_items  enable row level security;
alter table sop_instances       enable row level security;
alter table sop_item_status     enable row level security;
alter table tasks               enable row level security;

-- ---- tickets ----------------------------------------------------------------
drop policy if exists ticket_select on tickets;
create policy ticket_select on tickets for select to authenticated
  using (requester_id = auth.uid() or assignee_id = auth.uid() or is_agent());

-- Agents may log a ticket on behalf of any requester; non-agents only for self.
drop policy if exists ticket_insert on tickets;
create policy ticket_insert on tickets for insert to authenticated
  with check (is_agent() or requester_id = auth.uid());

drop policy if exists ticket_update on tickets;
create policy ticket_update on tickets for update to authenticated
  using (is_agent() or assignee_id = auth.uid());

drop policy if exists ticket_delete on tickets;
create policy ticket_delete on tickets for delete to authenticated
  using (is_agent());

-- ---- ticket_comments --------------------------------------------------------
drop policy if exists comment_select on ticket_comments;
create policy comment_select on ticket_comments for select to authenticated
  using (
    exists (select 1 from tickets t where t.id = ticket_id
            and (t.requester_id = auth.uid() or t.assignee_id = auth.uid() or is_agent()))
    and (is_internal = false or is_agent())
  );

drop policy if exists comment_insert on ticket_comments;
create policy comment_insert on ticket_comments for insert to authenticated
  with check (author_id = auth.uid());

-- ---- ticket_attachments -----------------------------------------------------
drop policy if exists attachment_select on ticket_attachments;
create policy attachment_select on ticket_attachments for select to authenticated
  using (
    exists (select 1 from tickets t where t.id = ticket_id
            and (t.requester_id = auth.uid() or t.assignee_id = auth.uid() or is_agent()))
  );

drop policy if exists attachment_insert on ticket_attachments;
create policy attachment_insert on ticket_attachments for insert to authenticated
  with check (uploaded_by = auth.uid());

-- ---- ticket_activity (audit log: insert + read only) ------------------------
drop policy if exists activity_select on ticket_activity;
create policy activity_select on ticket_activity for select to authenticated
  using (
    exists (select 1 from tickets t where t.id = ticket_id
            and (t.requester_id = auth.uid() or t.assignee_id = auth.uid() or is_agent()))
  );

drop policy if exists activity_insert on ticket_activity;
create policy activity_insert on ticket_activity for insert to authenticated
  with check (actor_id = auth.uid());

-- ---- sla_policies (read-only lookup for everyone; managed in SQL) ------------
drop policy if exists sla_read on sla_policies;
create policy sla_read on sla_policies for select to authenticated using (true);

-- ---- knowledge base ---------------------------------------------------------
drop policy if exists kbcat_read on kb_categories;
create policy kbcat_read on kb_categories for select to authenticated using (true);

drop policy if exists kbcat_write on kb_categories;
create policy kbcat_write on kb_categories for all to authenticated
  using (is_agent()) with check (is_agent());

drop policy if exists kb_select on kb_articles;
create policy kb_select on kb_articles for select to authenticated
  using (status = 'published' or is_agent());

drop policy if exists kb_write on kb_articles;
create policy kb_write on kb_articles for all to authenticated
  using (is_agent()) with check (is_agent());

-- ---- daily ops --------------------------------------------------------------
drop policy if exists sop_tmpl_read on sop_templates;
create policy sop_tmpl_read on sop_templates for select to authenticated using (true);

drop policy if exists sop_tmpl_write on sop_templates;
create policy sop_tmpl_write on sop_templates for all to authenticated
  using (is_agent()) with check (is_agent());

drop policy if exists sop_item_read on sop_template_items;
create policy sop_item_read on sop_template_items for select to authenticated using (true);

drop policy if exists sop_item_write on sop_template_items;
create policy sop_item_write on sop_template_items for all to authenticated
  using (is_agent()) with check (is_agent());

drop policy if exists sop_inst_rw on sop_instances;
create policy sop_inst_rw on sop_instances for all to authenticated
  using (true) with check (true);

drop policy if exists sop_itemstatus_rw on sop_item_status;
create policy sop_itemstatus_rw on sop_item_status for all to authenticated
  using (true) with check (true);

drop policy if exists tasks_rw on tasks;
create policy tasks_rw on tasks for all to authenticated
  using (created_by = auth.uid() or assigned_to = auth.uid() or is_agent())
  with check (created_by = auth.uid() or is_agent());

-- =============================================================================
-- Done. Verify in Table Editor that the tables exist and show a green "RLS
-- enabled" badge. Optional smoke test:  insert into tickets (title, description,
-- requester_id) values ('Test', 'hello', auth.uid());  then select * from
-- ticket_list_view;  -- the sla_state column should read 'on_time'.
-- =============================================================================
