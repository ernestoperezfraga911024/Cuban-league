-- Stage footballer statistics with the matchday revision that an admin reviews.
alter table private.matchday_milestone_drafts add column if not exists player_goals jsonb;

create or replace function public.save_matchday_draft_with_player_goals(
  p_season text, p_matchday integer, p_rows jsonb, p_include_milestone boolean,
  p_matchday_date date, p_is_month_end boolean, p_is_year_end boolean,
  p_restore_generation uuid, p_expected_write_revision uuid,
  p_player_goals jsonb, p_official_xi jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  saved jsonb;
  incoming jsonb := p_player_goals->'players';
  previous jsonb;
begin
  if not private.is_league_admin() then raise exception 'Not authorized'; end if;
  if p_include_milestone is not true or p_matchday not between 1 and 38
    or p_player_goals->>'leagueId' is distinct from '649733'
    or p_player_goals->>'season' is distinct from p_season
    or p_player_goals->>'matchday' is distinct from p_matchday::text
    or coalesce(p_player_goals->>'gameweekId','') !~ '^[1-9][0-9]{0,9}$'
    or (p_official_xi is not null and p_official_xi->>'gameweekId' is distinct from p_player_goals->>'gameweekId')
    or jsonb_typeof(incoming) is distinct from 'object' or octet_length(incoming::text)>65536
  then raise exception 'Invalid player goals context'; end if;
  if exists (select from jsonb_each(incoming) e where length(e.key) not between 1 and 150
       or jsonb_typeof(e.value)<>'number' or e.value::text !~ '^(0|[1-9][0-9]{0,2})$')
  then raise exception 'Invalid player goals'; end if;

  if p_official_xi is null then
    saved := public.save_matchday_draft_v124(p_season,p_matchday,p_rows,p_include_milestone,
      p_matchday_date,p_is_month_end,p_is_year_end,p_restore_generation,p_expected_write_revision);
  else
    saved := public.save_matchday_draft_with_official_xi(p_season,p_matchday,p_rows,p_include_milestone,
      p_matchday_date,p_is_month_end,p_is_year_end,p_restore_generation,p_expected_write_revision,p_official_xi);
  end if;
  select after_milestone->'playerGoals' into previous from public.matchday_change_log
    where season=p_season and matchday=p_matchday and not undone and after_milestone ? 'playerGoals'
    order by created_at desc,id desc limit 1;
  -- Missing statistics retain their last observation. An explicit zero is a correction.
  update private.matchday_milestone_drafts
    set player_goals=coalesce(previous,'{}') || coalesce(player_goals,'{}') || incoming
    where season=p_season and matchday=p_matchday;
  if not found then raise exception 'Player goals draft not saved'; end if;
  return saved;
end;
$$;
revoke all on function public.save_matchday_draft_with_player_goals(text,integer,jsonb,boolean,date,boolean,boolean,uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.save_matchday_draft_with_player_goals(text,integer,jsonb,boolean,date,boolean,boolean,uuid,uuid,jsonb,jsonb) to authenticated;

create or replace function private.publish_player_goals() returns trigger
language plpgsql set search_path = '' as $$
declare goals jsonb;
begin
  select player_goals into goals from private.matchday_milestone_drafts where season=new.season and matchday=new.matchday;
  if goals is not null then new.after_milestone:=new.after_milestone || jsonb_build_object('playerGoals',goals); end if;
  return new;
end;
$$;
revoke all on function private.publish_player_goals() from public,anon,authenticated;
create trigger publish_player_goals before update of after_milestone on public.matchday_change_log
  for each row when (new.milestone_tracked and new.after_milestone is not null and not new.undone)
  execute function private.publish_player_goals();

create or replace function private.restore_player_goals_drafts() returns trigger
language plpgsql set search_path = '' as $$
begin
  update private.matchday_milestone_drafts d set player_goals=r.player_goals
    from private.league_backups b
    cross join lateral jsonb_to_recordset(b.snapshot #> '{tables,matchday_milestone_drafts}')
      as r(season text,matchday integer,player_goals jsonb)
    where b.id=new.last_restore_backup_id and r.player_goals is not null and d.season=r.season and d.matchday=r.matchday;
  return new;
end;
$$;
revoke all on function private.restore_player_goals_drafts() from public,anon,authenticated;
create trigger restore_player_goals_drafts after update of restore_generation on private.league_backup_state
  for each row when (new.restore_generation is distinct from old.restore_generation and new.last_restore_backup_id is not null)
  execute function private.restore_player_goals_drafts();

-- PostgREST computed field: opt in alongside lineup, in the same read. Re-read the actual
-- public XI so a caller supplying a fabricated composite cannot inspect hidden or draft slots.
create or replace function public.player_goals(s public.matchday_stats) returns jsonb
language sql stable security definer set search_path = '' as $$
  with latest as (
    select after_milestone->'playerGoals' as goals from public.matchday_change_log
    where season=s.season and matchday=s.matchday and not undone and after_milestone ? 'playerGoals'
    order by created_at desc,id desc limit 1
  )
  select jsonb_object_agg(slot->>'player_id',latest.goals->(slot->>'player_id')) from latest
    join public.matchday_stats p on p.season=s.season and p.matchday=s.matchday
      and p.participant_name=s.participant_name and p.published and not p.negative_balance_no_score
    cross join lateral jsonb_array_elements(p.lineup) slot where latest.goals ? (slot->>'player_id')
$$;
revoke all on function public.player_goals(public.matchday_stats) from public;
grant execute on function public.player_goals(public.matchday_stats) to anon,authenticated;
