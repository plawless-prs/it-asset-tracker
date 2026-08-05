-- 17: Facets for the Files page dropdowns (Phase 5.5 follow-up).
--
-- The Files page filters vendor -> year -> "date" like the archive's folder
-- hierarchy. Year is a real column, but the date folder only exists as a
-- storage_path segment (library/<vendor>/<year>/<date>/<file>), so distinct
-- values need path-splitting in SQL — a client can't do it without paging
-- whole tables through PostgREST's row cap.
--
-- Returns { years: [...], dates: [...] }.
--   years: distinct years, newest first, scoped to p_vendor_id when given.
--   dates: distinct path segment immediately AFTER the year segment (only
--          when p_year is given) — i.e. the archive's date folder, or more
--          generally "subfolder of the year folder". Files directly in the
--          year folder contribute nothing (the next segment is the filename,
--          which is excluded by requiring a further segment after it).
--
-- SECURITY INVOKER (default): runs under the caller's RLS, so it exposes
-- nothing an app user couldn't already read. Idempotent.

create or replace function pu_library_facets(p_vendor_id uuid default null, p_year int default null)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'years',
    coalesce((
      select jsonb_agg(y order by y desc) from (
        select distinct year as y
        from pu_library_files
        where year is not null
          and (p_vendor_id is null or vendor_id = p_vendor_id)
      ) ys
    ), '[]'::jsonb),
    'dates',
    coalesce((
      select jsonb_agg(d order by d) from (
        select distinct segs[idx + 1] as d
        from (
          select segs, array_position(segs, p_year::text) as idx, arr_len
          from (
            select string_to_array(storage_path, '/') as segs,
                   array_length(string_to_array(storage_path, '/'), 1) as arr_len
            from pu_library_files
            where p_year is not null
              and year = p_year
              and (p_vendor_id is null or vendor_id = p_vendor_id)
          ) split
        ) pos
        where idx is not null
          and idx + 1 < arr_len   -- next segment must be a folder, not the file name
      ) ds
    ), '[]'::jsonb)
  );
$$;

grant execute on function pu_library_facets(uuid, int) to authenticated;
