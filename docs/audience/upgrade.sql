-- Additive audience analytics. Stable participant IDs match data.json (1..20).
-- Existing anonymous totals and authentication remain unchanged. No historical backfill.
begin;
create table if not exists private.site_activity (
  session_id uuid not null,
  visitor_id uuid not null,
  visit_day date not null,
  profile_id integer not null check (profile_id between 0 and 20),
  section text not null check (section in ('home','current','matchdays','players','history','cup','champions','rules','cards','second-division','forecasts','news')),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (session_id,visit_day,profile_id,section)
);
create index if not exists site_activity_day_idx on private.site_activity(visit_day);
alter table private.site_activity enable row level security;
revoke all on private.site_activity from public,anon,authenticated;

-- Narrow, write-only anonymous endpoint, following the existing tracker contract.
-- No names, IPs, user agents, URLs, supplied dates, or auth claims are accepted.
create or replace function public.track_site_activity(
  p_visitor_id uuid,p_session_id uuid,p_section text,p_profile_id integer default 0
) returns boolean language plpgsql security definer set search_path='' as $$
declare
  today date := timezone('America/New_York',now())::date;
begin
  if p_visitor_id is null or p_session_id is null or p_profile_id is null
    or p_profile_id not between 0 and 20 or p_section is null
    or p_section not in ('home','current','matchdays','players','history','cup','champions','rules','cards','second-division','forecasts','news') then
    return false;
  end if;
  -- A session may never move between browser IDs. No identity lookup is returned.
  perform public.track_site_visit(p_visitor_id,p_session_id,'/');
  if not exists (select 1 from public.site_visits where session_id=p_session_id and visitor_id=p_visitor_id) then
    return false;
  end if;
  insert into private.site_activity(session_id,visitor_id,visit_day,profile_id,section)
  values(p_session_id,p_visitor_id,today,p_profile_id,p_section)
  on conflict(session_id,visit_day,profile_id,section) do update
    set last_seen=greatest(private.site_activity.last_seen,excluded.last_seen);
  -- Bounded housekeeping on real activity; no new scheduled job or infrastructure.
  delete from private.site_activity where ctid in
    (select ctid from private.site_activity where visit_day<today-89 order by visit_day limit 200);
  return true;
end; $$;
revoke all on function public.track_site_activity(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.track_site_activity(uuid,uuid,text,integer) to anon,authenticated;

create or replace function public.get_site_audience(p_days integer default 7)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  days integer := case when p_days in (1,7,30) then p_days else 7 end;
  today date := timezone('America/New_York',now())::date;
  result jsonb;
begin
  if private.is_league_admin() is not true then raise exception 'Not authorized'; end if;
  with activity as (
    select * from private.site_activity where visit_day between today-(days-1) and today
  ), profiles as (
    select profile_id,count(distinct session_id)::integer as visits,
      count(distinct visit_day)::integer as active_days,max(last_seen) as last_seen
    from activity where profile_id>0 group by profile_id
  ), sections as (
    select section,count(distinct session_id)::integer as visits,
      count(distinct visitor_id)::integer as browsers
    from activity group by section
  ), sessions as (
    select session_id,bool_or(profile_id>0) as identified from activity group by session_id
  )
  select jsonb_build_object(
    'days',days,'timezone','America/New_York','generatedAt',now(),
    'from',today-(days-1),'through',today,
    'trackingSince',(select min(first_seen) from private.site_activity),
    'identifiedProfiles',(select count(*) from profiles),
    'identifiedVisits',(select count(*) from sessions where identified),
    'unidentifiedVisits',(select count(*) from sessions where not identified),
    'profiles',coalesce((select jsonb_agg(jsonb_build_object(
      'id',profile_id,'visits',visits,'activeDays',active_days,'lastSeen',last_seen
    ) order by visits desc,last_seen desc,profile_id) from profiles),'[]'::jsonb),
    'sections',coalesce((select jsonb_agg(jsonb_build_object(
      'id',section,'visits',visits,'browsers',browsers
    ) order by visits desc,section) from sections),'[]'::jsonb)
  ) into result;
  return result;
end; $$;
revoke all on function public.get_site_audience(integer) from public,anon,authenticated;
grant execute on function public.get_site_audience(integer) to authenticated;
commit;
