# Data Model — Help Desk & Daily Ops

_Supabase / Postgres. Reuses existing `profiles` table and the `app_access JSONB` permission model. SQL is written as a forward migration._

## Conventions

- All tables use `uuid` primary keys (`gen_random_uuid()`), `created_at`/`updated_at` timestamptz.
- User references are FKs to `profiles(id)`.
- RLS is **on** for every table. Two broad roles assumed from your existing `useRole` hook: regular **user** and **admin/agent**. Adjust the `is_agent` check to however you currently mark IT staff (e.g. a `role` column on `profiles` or an `app_access` flag).
- App IDs for `hasAccess()`: **`helpdesk`** (tickets + KB) and **`dailyops`** (checklists + tasks).

```sql
-- updated_at trigger helper (create once, reuse everywhere)
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
```

---

## Part A — Help Desk: Tickets

### Freshservice patterns adopted

Two ideas borrowed from Freshservice shape the schema:

- **State vs. Status are different things.** *Status* is the workflow stage the agent drives (`open → in_progress → waiting → resolved → closed`). *State* is the **SLA health** of the ticket (`on_time / due_today / overdue`) and is **derived** from the SLA timestamps below — not stored, not hand-set. The queue shows both: a soft "Overdue" pill (state) next to "Open" (status).
- **SLA timers.** Each ticket carries a `first_response_due` and `resolution_due` timestamp, computed from `priority` via an SLA policy — set on insert, and **recalculated whenever the priority changes** (measured from `created_at`, so escalating an old ticket judges it against the original report time). The detail panel counts down against them and turns red when breached.

```sql
-- Status & priority as enums for integrity
create type ticket_status   as enum ('open','in_progress','waiting','resolved','closed');
create type ticket_priority as enum ('low','medium','high','urgent');
create type ticket_source   as enum ('portal','email','phone','chat','manual');

create table tickets (
  id            uuid primary key default gen_random_uuid(),
  number        bigint generated always as identity, -- human-friendly #1024
  title         text not null,
  description   text not null,
  status        ticket_status   not null default 'open',
  priority      ticket_priority not null default 'medium',
  source        ticket_source   not null default 'portal',
  category      text,                       -- e.g. 'hardware','access','software','billing','other'
  requester_id  uuid not null references profiles(id),
  assignee_id   uuid references profiles(id),
  -- SLA targets, set from priority on insert (see sla_policies + trigger below)
  first_response_due timestamptz,
  resolution_due     timestamptz,
  first_responded_at timestamptz,           -- stamped on first agent reply
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  closed_at     timestamptz
);
create index on tickets (status);
create index on tickets (assignee_id);
create index on tickets (requester_id);
create index on tickets (resolution_due);
create trigger tickets_updated before update on tickets
  for each row execute function set_updated_at();

-- SLA policy: response/resolution windows per priority (in minutes)
create table sla_policies (
  priority           ticket_priority primary key,
  first_response_min int not null,
  resolution_min     int not null
);
insert into sla_policies values
  ('urgent', 30,   240),    -- respond 30m, resolve 4h
  ('high',   60,   480),    -- respond 1h,  resolve 8h
  ('medium', 240,  1440),   -- respond 4h,  resolve 24h
  ('low',    480,  2880);   -- respond 8h,  resolve 48h

-- Stamp SLA due times from the policy when a ticket is created
create or replace function apply_sla() returns trigger language plpgsql as $$
declare p sla_policies%rowtype;
begin
  select * into p from sla_policies where priority = new.priority;
  new.first_response_due := new.created_at + (p.first_response_min || ' minutes')::interval;
  new.resolution_due     := new.created_at + (p.resolution_min     || ' minutes')::interval;
  return new;
end; $$;
create trigger tickets_apply_sla before insert on tickets
  for each row execute function apply_sla();

-- Derived SLA "state" for the queue pill — compute in a view or in the app, not stored
create or replace view ticket_list_view as
select t.*,
  case
    when t.status in ('resolved','closed')      then 'resolved'
    when t.resolution_due < now()               then 'overdue'
    when t.resolution_due::date = current_date  then 'due_today'
    else 'on_time'
  end as sla_state
from tickets t;

-- Threaded comments / replies. is_internal = agent-only note.
create table ticket_comments (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references tickets(id) on delete cascade,
  author_id   uuid not null references profiles(id),
  body        text not null,
  is_internal boolean not null default false,
  created_at  timestamptz not null default now()
);
create index on ticket_comments (ticket_id);

-- Attachments (store files in a Supabase Storage bucket, keep path here)
create table ticket_attachments (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references tickets(id) on delete cascade,
  comment_id  uuid references ticket_comments(id) on delete cascade,
  storage_path text not null,
  file_name   text not null,
  file_size   bigint,
  uploaded_by uuid not null references profiles(id),
  created_at  timestamptz not null default now()
);

-- Audit trail for status/assignee/priority changes
create table ticket_activity (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references tickets(id) on delete cascade,
  actor_id   uuid not null references profiles(id),
  action     text not null,        -- 'status_changed','assigned','priority_changed','commented'
  from_value text,
  to_value   text,
  created_at timestamptz not null default now()
);
create index on ticket_activity (ticket_id);
```

### RLS — tickets

> **Scope note:** the Help Desk is **IT-team-only** — there is no end-user/self-service portal. Everyone who can open the app is an IT agent, so `is_agent()` effectively returns true for all users with `helpdesk` access; the requester/agent split below mainly future-proofs the schema. `requester_id` still records *the employee who reported the issue* (logged by IT from email/phone/walk-up) for tracking and reporting — that person does not log in. `source` captures how the request arrived (`email`/`phone`/`manual`), not a portal submission.

```sql
alter table tickets            enable row level security;
alter table ticket_comments    enable row level security;
alter table ticket_attachments enable row level security;
alter table ticket_activity    enable row level security;

-- helper: is the current user an IT agent/admin?
-- Replace this with your real check (profiles.role = 'admin', etc.)
create or replace function is_agent()
returns boolean language sql stable as $$
  select coalesce((select role = 'admin' from profiles where id = auth.uid()), false);
$$;

-- Requesters see their own tickets; agents see all
create policy ticket_select on tickets for select
  using (requester_id = auth.uid() or assignee_id = auth.uid() or is_agent());

create policy ticket_insert on tickets for insert
  with check (requester_id = auth.uid());

-- Only agents (or the assignee) can update status/assignment
create policy ticket_update on tickets for update
  using (is_agent() or assignee_id = auth.uid());

-- Comments: visible if you can see the ticket and (not internal OR you're an agent)
create policy comment_select on ticket_comments for select
  using (
    exists (select 1 from tickets t where t.id = ticket_id
            and (t.requester_id = auth.uid() or t.assignee_id = auth.uid() or is_agent()))
    and (is_internal = false or is_agent())
  );
create policy comment_insert on ticket_comments for insert
  with check (author_id = auth.uid());
```
_(Mirror analogous select/insert policies on `ticket_attachments` and `ticket_activity`.)_

---

## Part B — Help Desk: Knowledge Base (module of the same app)

```sql
create type kb_status as enum ('draft','published','archived');

create table kb_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  sort_order int  not null default 0
);

create table kb_articles (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  title         text not null,
  body          text not null,            -- markdown
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
create index on kb_articles (status);
create index on kb_articles using gin (tags);
-- Optional full-text search
create index on kb_articles using gin (to_tsvector('english', title || ' ' || body));
create trigger kb_updated before update on kb_articles
  for each row execute function set_updated_at();
```

### RLS — KB
```sql
alter table kb_articles enable row level security;
-- Everyone with helpdesk access reads published articles; agents manage all
create policy kb_select on kb_articles for select
  using (status = 'published' or is_agent());
create policy kb_write on kb_articles for all
  using (is_agent()) with check (is_agent());
```

---

## Part C — Daily Ops: SOP checklists + one-off tasks (separate app `dailyops`)

```sql
create type sop_frequency as enum ('daily','weekly','monthly','adhoc');
create type task_status   as enum ('todo','in_progress','done','skipped');

-- A reusable checklist definition (e.g. "Morning opening SOP")
create table sop_templates (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  frequency   sop_frequency not null default 'daily',
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_by  uuid not null references profiles(id),
  created_at  timestamptz not null default now()
);

-- Steps within a template
create table sop_template_items (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references sop_templates(id) on delete cascade,
  label        text not null,
  instructions text,
  required     boolean not null default true,
  sort_order   int not null default 0
);

-- A generated run of a template for a given date (one per day per template)
create table sop_instances (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references sop_templates(id),
  due_date     date not null,
  assigned_to  uuid references profiles(id),   -- optional: who owns today's run
  status       task_status not null default 'todo',
  created_at   timestamptz not null default now(),
  completed_at timestamptz,
  unique (template_id, due_date)
);
create index on sop_instances (due_date);

-- Check-off state per item per instance
create table sop_item_status (
  id               uuid primary key default gen_random_uuid(),
  instance_id      uuid not null references sop_instances(id) on delete cascade,
  template_item_id uuid not null references sop_template_items(id),
  checked          boolean not null default false,
  checked_by       uuid references profiles(id),
  checked_at       timestamptz,
  note             text,
  unique (instance_id, template_item_id)
);

-- One-off ad-hoc tasks that "appear" (not part of a recurring SOP)
create table tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  status      task_status not null default 'todo',
  priority    ticket_priority not null default 'medium',  -- reuse the enum
  assigned_to uuid references profiles(id),
  due_date    date,
  created_by  uuid not null references profiles(id),
  created_at  timestamptz not null default now(),
  completed_at timestamptz
);
create index on tasks (status);
create index on tasks (assigned_to);
```

### How daily instances get created
Two options:
- **Lazy (recommended, simplest):** when a user opens Daily Ops, the app upserts today's `sop_instances` for every `active` template whose `frequency` matches (and seeds `sop_item_status` rows). No cron needed.
- **Scheduled:** a Supabase scheduled function / GitHub Action (you already run a twice-weekly keep-alive workflow — same pattern) inserts the day's instances at midnight. Use this if you want due-status reporting even when no one has opened the app.

### RLS — Daily Ops
```sql
alter table sop_templates      enable row level security;
alter table sop_template_items enable row level security;
alter table sop_instances      enable row level security;
alter table sop_item_status    enable row level security;
alter table tasks              enable row level security;
-- Anyone with dailyops access can read/check items; only agents edit templates.
-- (Gate dailyops access at the app layer via hasAccess('dailyops'); RLS below is the DB backstop.)
create policy sop_tmpl_read on sop_templates for select using (true);
create policy sop_tmpl_write on sop_templates for all using (is_agent()) with check (is_agent());
create policy sop_inst_rw on sop_instances for all using (true) with check (true);
create policy sop_itemstatus_rw on sop_item_status for all using (true) with check (true);
create policy tasks_rw on tasks for all
  using (created_by = auth.uid() or assigned_to = auth.uid() or is_agent())
  with check (created_by = auth.uid() or is_agent());
```

---

## App-access integration (existing pattern)

You already gate apps with an `app_access JSONB` column on `profiles`, admin checkboxes, and `hasAccess(appId)` in `useRole`, with guards on each page and `Navigation.js` filtering. To add the new apps:

1. Add `helpdesk` and `dailyops` to wherever your app registry / checkbox list is defined.
2. Default them **off** for everyone except your profile (pilot).
3. Each new app page calls the existing guard: `if (!hasAccess('helpdesk')) redirect/deny`.
4. `Navigation.js` already filters by `hasAccess` — the new entries appear only for permitted users.
5. **Soft-hiding the invoice processor = set its `app_access` flag false for all profiles.** No schema change, fully reversible. (See `04-deprecation-checklist.md`.)
