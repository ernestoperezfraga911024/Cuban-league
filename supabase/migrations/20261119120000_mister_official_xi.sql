-- Optional metadata for Primera. Existing points, drafts and publications are untouched.
alter table private.matchday_milestone_drafts add column if not exists official_xi jsonb;

create or replace function public.save_matchday_draft_with_official_xi(
  p_season text, p_matchday integer, p_rows jsonb, p_include_milestone boolean,
  p_matchday_date date, p_is_month_end boolean, p_is_year_end boolean,
  p_restore_generation uuid, p_expected_write_revision uuid, p_official_xi jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  saved jsonb;
  players jsonb := p_official_xi->'players';
begin
  if not private.is_league_admin() then raise exception 'Not authorized'; end if;
  if p_include_milestone is not true or p_season !~ '^[0-9]{4}/[0-9]{2}$'
    or p_matchday not between 1 and 38
    or p_official_xi->>'leagueId' is distinct from '649733'
    or p_official_xi->>'season' is distinct from p_season
    or p_official_xi->>'matchday' is distinct from p_matchday::text
    or coalesce(p_official_xi->>'gameweekId','') !~ '^[1-9][0-9]{0,9}$'
    or jsonb_typeof(players) is distinct from 'array'
    or octet_length(p_official_xi::text) > 16000 then
    raise exception 'Invalid official XI context';
  end if;
  if jsonb_array_length(players) <> 11 or (
    select count(distinct p->>'misterPlayerId') <> 11
      or count(distinct p->>'position') <> 4 or count(*) filter (where p->>'position' = 'PT') <> 1
      or bool_or(coalesce(p->>'misterPlayerId','') !~ '^[1-9][0-9]{0,19}$'
        or coalesce(p->>'position','') not in ('PT','DF','MC','DL')
        or length(btrim(coalesce(p->>'playerName',''))) not between 1 and 120
        or jsonb_typeof(p->'points') is distinct from 'number')
    from jsonb_array_elements(players) p
  ) then raise exception 'Invalid official XI players'; end if;

  -- Delegate all existing checks, locking, draft updates and revision rotation.
  saved := public.save_matchday_draft_v124(p_season,p_matchday,p_rows,p_include_milestone,
    p_matchday_date,p_is_month_end,p_is_year_end,p_restore_generation,p_expected_write_revision);
  update private.matchday_milestone_drafts set official_xi = p_official_xi
    where season = p_season and matchday = p_matchday;
  if not found then raise exception 'Official XI draft not saved'; end if;
  return saved;
end;
$$;
revoke all on function public.save_matchday_draft_with_official_xi(text,integer,jsonb,boolean,date,boolean,boolean,uuid,uuid,jsonb) from public, anon;
grant execute on function public.save_matchday_draft_with_official_xi(text,integer,jsonb,boolean,date,boolean,boolean,uuid,uuid,jsonb) to authenticated;

-- V124 writes after_milestone on the newly published revision before clearing its draft.
-- Old clients share this path. Undo already marks that revision undone. Backups preserve its JSON.
create or replace function private.attach_published_official_xi()
returns trigger language plpgsql set search_path = '' as $$
declare xi jsonb;
begin
  select official_xi into xi from private.matchday_milestone_drafts
    where season = new.season and matchday = new.matchday;
  if xi is not null then new.after_milestone := new.after_milestone || jsonb_build_object('officialXi', xi); end if;
  return new;
end;
$$;
revoke all on function private.attach_published_official_xi() from public, anon, authenticated;
create trigger attach_published_official_xi before update of after_milestone on public.matchday_change_log
  for each row when (new.milestone_tracked and new.after_milestone is not null and not new.undone)
  execute function private.attach_published_official_xi();

-- V124 backs up complete draft records, but restores an explicit list of legacy columns.
-- Rehydrate the optional column in the same restore transaction; older backups simply omit it.
create or replace function private.restore_official_xi_drafts()
returns trigger language plpgsql set search_path = '' as $$
begin
  update private.matchday_milestone_drafts d set official_xi = r.official_xi
  from private.league_backups b
  cross join lateral jsonb_to_recordset(b.snapshot #> '{tables,matchday_milestone_drafts}')
    as r(season text, matchday integer, official_xi jsonb)
  where b.id = new.last_restore_backup_id and r.official_xi is not null
    and d.season = r.season and d.matchday = r.matchday;
  return new;
end;
$$;
revoke all on function private.restore_official_xi_drafts() from public, anon, authenticated;
create trigger restore_official_xi_drafts after update of restore_generation on private.league_backup_state
  for each row when (new.restore_generation is distinct from old.restore_generation and new.last_restore_backup_id is not null)
  execute function private.restore_official_xi_drafts();

-- Return only the published football data. Never expose the change log, admin metadata or drafts.
create or replace function public.get_published_official_xi(p_season text, p_matchday integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  with published as (
    select participant_name, lineup from public.matchday_stats
    where season = p_season and matchday = p_matchday and published
  ), latest as (
    select after_milestone->'officialXi' as xi from public.matchday_change_log
    where season = p_season and matchday = p_matchday and not undone
      and after_milestone ? 'officialXi' and exists (select from published)
    order by created_at desc, id desc limit 1
  ), aligned as (
    select distinct s.participant_name, slot->>'player_id' as player_id
    from published s cross join lateral jsonb_array_elements(s.lineup) slot
  )
  select jsonb_agg(jsonb_build_object(
    'playerName', p->>'playerName', 'position', p->>'position', 'points', p->'points',
    'participants', coalesce((select jsonb_agg(a.participant_name order by a.participant_name)
      from aligned a where a.player_id = p->>'playerId'), '[]'::jsonb)
  ) order by ord)
  from latest cross join lateral jsonb_array_elements(xi->'players') with ordinality as players(p, ord);
$$;
revoke all on function public.get_published_official_xi(text,integer) from public;
grant execute on function public.get_published_official_xi(text,integer) to anon, authenticated;
