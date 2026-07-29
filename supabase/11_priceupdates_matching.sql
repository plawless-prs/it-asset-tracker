-- =============================================================================
-- PRS Apps — Price Update Processor  [Phase 3: P21 matching support]
-- Run once in the Supabase SQL Editor. Idempotent / additive. Safe to re-run.
--
-- Adds the per-vendor P21 item-number prefix (P21 item IDs are
-- "<3-letter prefix><space><vendor part no>", e.g. "GAT QD12/8V71.00") and a
-- bulk line-update function used by the matching route.
-- =============================================================================

-- 1. Per-vendor P21 item-number prefix ---------------------------------------
alter table pu_vendors add column if not exists p21_item_prefix text;

comment on column pu_vendors.p21_item_prefix is
  'Literal prefix P21 prepends to this vendor''s part numbers to form the item id, '
  'e.g. "GAT " (note trailing space). Used by matching to bridge vendor part <-> P21 item id.';


-- 2. Bulk apply matching results to pu_lines ---------------------------------
-- Takes a JSON array of per-line results and updates them by id in one call
-- (the matching route can produce thousands of rows). SECURITY INVOKER (the
-- default): the UPDATE runs under the caller's rights + RLS, so this grants no
-- privilege beyond what the caller could already do — the service role (match
-- route) bypasses RLS; an authenticated priceupdates user is constrained by the
-- pu_lines policy. It deliberately does NOT touch `include` (the reviewer's
-- keep/drop choice) so re-running match is non-destructive.
create or replace function pu_apply_matches(_updates jsonb)
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  update pu_lines l set
    match_status    = coalesce((u->>'match_status')::match_status, l.match_status),
    p21_item_id     = u->>'p21_item_id',
    old_cost        = (u->>'old_cost')::numeric,
    old_list        = (u->>'old_list')::numeric,
    cost_change_pct = (u->>'cost_change_pct')::numeric,
    flag            = coalesce((u->>'flag')::line_flag, l.flag),
    updated_at      = now()
  from jsonb_array_elements(_updates) as u
  where l.id = (u->>'id')::uuid;
  get diagnostics n = row_count;
  return n;
end;
$$;


-- =============================================================================
-- Done. Verify: `\d pu_vendors` shows p21_item_prefix, and
-- `select pu_apply_matches('[]'::jsonb)` returns 0.
-- =============================================================================
