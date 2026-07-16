-- =============================================================================
-- PRS Help Desk — KB ↔ ticket linking + fuzzy article search
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- Adds: pg_trgm, a link table between articles and tickets, a trigram index,
-- and a search_kb() function that ranks published articles by full-text
-- relevance + title similarity for the "document this resolution" flow.
--
-- On Supabase, pg_trgm installs into the `extensions` schema, so we set the
-- search_path explicitly (both for this script's index creation and inside the
-- function) so similarity()/gin_trgm_ops resolve regardless of default path.
-- =============================================================================

create extension if not exists pg_trgm;
set search_path = public, extensions;

-- Link table: an article aggregates the past tickets that fed it; a ticket
-- shows which article(s) document it.
create table if not exists kb_article_tickets (
  id         uuid primary key default gen_random_uuid(),
  article_id uuid not null references kb_articles(id) on delete cascade,
  ticket_id  uuid not null references tickets(id) on delete cascade,
  linked_by  uuid references profiles(id),
  linked_at  timestamptz not null default now(),
  unique (article_id, ticket_id)
);
create index if not exists idx_kbt_article on kb_article_tickets (article_id);
create index if not exists idx_kbt_ticket  on kb_article_tickets (ticket_id);

alter table kb_article_tickets enable row level security;

drop policy if exists kbt_read on kb_article_tickets;
create policy kbt_read on kb_article_tickets for select to authenticated using (true);

drop policy if exists kbt_write on kb_article_tickets;
create policy kbt_write on kb_article_tickets for all to authenticated
  using (is_agent()) with check (is_agent());

-- Trigram index on title for fuzzy (typo-tolerant) matching.
create index if not exists idx_kb_title_trgm on kb_articles using gin (title gin_trgm_ops);

-- Ranked search over PUBLISHED articles.
--   qtext  = ticket title + description  (drives full-text relevance)
--   qtitle = ticket title               (drives trigram similarity)
-- plpgsql + SET search_path so pg_trgm's similarity() resolves on Supabase.
-- NOTE: websearch_to_tsquery ANDs every term, which almost never matches a
-- short article against a long ticket. For "find similar" we want OR semantics
-- ranked by term overlap, so we convert the AND-query to an OR-query (& -> |)
-- and let ts_rank reward articles that share more terms.
create or replace function search_kb(qtext text, qtitle text)
returns table (id uuid, slug text, title text, snippet text, score real)
language plpgsql
stable
set search_path = public, extensions
as $$
declare q tsquery;
begin
  q := replace(
         websearch_to_tsquery('english', coalesce(nullif(qtext, ''), ' '))::text,
         '&', '|'
       )::tsquery;
  return query
  select
    a.id,
    a.slug,
    a.title,
    left(regexp_replace(coalesce(a.body, ''), '[#*`>_-]', '', 'g'), 150) as snippet,
    (
      ts_rank(to_tsvector('english', a.title || ' ' || coalesce(a.body, '')), q)
      + similarity(a.title, coalesce(qtitle, ''))
    )::real as score
  from kb_articles a
  where a.status = 'published'
    and (
      to_tsvector('english', a.title || ' ' || coalesce(a.body, '')) @@ q
      or similarity(a.title, coalesce(qtitle, '')) > 0.15
    )
  order by score desc
  limit 5;
end;
$$;

grant execute on function search_kb(text, text) to authenticated;
