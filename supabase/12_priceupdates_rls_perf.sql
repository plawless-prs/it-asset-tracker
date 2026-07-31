-- =============================================================================
-- PRS Apps — Price Update Processor  [Phase 4 fix: RLS policy performance]
-- Run once in the Supabase SQL Editor. Idempotent. Safe to re-run.
--
-- The pu_* policies from migration 10 call has_app_access('priceupdates')
-- bare, which Postgres inlines and evaluates PER ROW — a count over an
-- 18k-line batch runs the profiles lookup 18k times, and several concurrent
-- counts (the review page's tab counts) blow the authenticated role's
-- statement timeout (intermittent 500/503 from PostgREST; symptom: tab counts
-- randomly showing 0). Wrapping the call in (select ...) makes it an
-- init-plan: evaluated ONCE per query. Standard Supabase RLS guidance.
-- Same policies, same semantics — only the evaluation strategy changes.
-- =============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'pu_vendors','pu_parse_profiles','pu_batches','pu_batch_files',
    'pu_lines','pu_exports','pu_settings'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_priceupdates_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using ((select has_app_access(''priceupdates''))) '
      || 'with check ((select has_app_access(''priceupdates'')))',
      t || '_priceupdates_all', t);
  end loop;
end $$;

-- P21 mirror read policy gets the same treatment (71k+ rows).
drop policy if exists p21_item_mirror_read on p21_item_mirror;
create policy p21_item_mirror_read on p21_item_mirror for select to authenticated
  using ((select has_app_access('priceupdates')));

-- =============================================================================
-- Done. Verify: reload a large batch's review page — all five tab counts
-- populate consistently (no more intermittent zeros).
-- =============================================================================
