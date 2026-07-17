-- =============================================================================
-- PRS Apps — IT Tracker: split employee name into first/last  [Stage 1 follow-up]
-- Run once in the Supabase SQL Editor. Idempotent.
--
-- Adds first_name / last_name to employees and backfills them from the existing
-- full_name (split on the first space). `full_name` is KEPT as the combined
-- display value the app writes on save, so everything that reads it (assets
-- list, checkout, search, audit log) is unaffected.
-- =============================================================================

alter table employees add column if not exists first_name text;
alter table employees add column if not exists last_name  text;

-- Backfill from full_name: first token -> first_name, remainder -> last_name.
update employees
set
  first_name = split_part(full_name, ' ', 1),
  last_name  = nullif(regexp_replace(full_name, '^\S+\s*', ''), '')
where first_name is null
  and full_name is not null;

-- =============================================================================
-- Done. Verify: select first_name, last_name, full_name from employees;
-- =============================================================================
