-- Move the daily general review from 09:00 to 06:00 America/New_York.
-- Apply once after predicted11-v3.sql. No tasks, lineups or control rows are written.
-- Tests use a temporary read-only copy, never the production clock or run functions.
DO $schedule_migration$
declare before_state jsonb; test_case record; actual jsonb;
begin
 if pg_get_functiondef('forecast_season.plan()'::regprocedure) is distinct from $expected_plan$CREATE OR REPLACE FUNCTION forecast_season.plan()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare slot timestamptz; hour_local integer; team_rows jsonb; cfg forecast_season.control%rowtype;
begin
 select * into cfg from forecast_season.control;
 if now()<timestamptz '2026-11-12 14:00Z' or now()>=timestamptz '2027-07-01 04:00Z' then return jsonb_build_object('observed_at',now(),'slot',null,'teams','[]'::jsonb,'mode',cfg.mode); end if;
 select max((d::date+h) at time zone 'America/New_York') into slot
 from (values ((now() at time zone 'America/New_York')::date),((now() at time zone 'America/New_York')::date-1)) days(d)
 cross join (values(time '06:00'),(time '09:00'),(time '13:00'),(time '18:00')) hours(h)
 where (d::date+h) at time zone 'America/New_York'<=now();
 if slot<now()-interval '2 hours' or slot<timestamptz '2026-11-12 14:00Z' then slot:=null; end if;
 hour_local:=extract(hour from slot at time zone 'America/New_York');
 select coalesce(jsonb_agg(jsonb_build_object('team',t.team,'fixture',to_jsonb(f)-'checks','comuniate_team_url',t.source_urls->>'comuniate','needs_fixture',f.key is null,'paused',d.paused) order by t.team),'[]'::jsonb) into team_rows
 from forecast_league.teams t join forecast_season.drafts d using(team)
 left join lateral (select * from forecast_season.fixtures f where t.team in(f.home,f.away) and f.kickoff_at>now() order by f.kickoff_at,f.key limit 1) f on true
 where slot is not null and (hour_local=9
  or (hour_local=6 and (f.kickoff_at at time zone 'America/New_York')::date=(slot at time zone 'America/New_York')::date and extract(hour from f.kickoff_at at time zone 'America/New_York')<12)
  or (hour_local=13 and (f.kickoff_at at time zone 'America/New_York')::date=(slot at time zone 'America/New_York')::date)
  or (hour_local=18 and f.kickoff_at<=slot+interval '48 hours'));
 return jsonb_build_object('observed_at',now(),'slot',slot,'run_key',case when slot is not null then 'season-'||to_char(slot at time zone 'America/New_York','YYYYMMDD-HH24MI') end,'mode',cfg.mode,'version',cfg.version,'teams',team_rows);
end;
$function$
$expected_plan$ then
  raise exception 'Planner changed since review; inspect before applying';
 end if;
 before_state:=jsonb_build_object(
 'public',(select md5(string_agg(to_jsonb(t)::text,',' order by team)) from public.forecast_season_public t),
 'runs',(select md5(string_agg(to_jsonb(t)::text,',' order by key)) from forecast_season.runs t),
 'drafts',(select md5(string_agg(to_jsonb(t)::text,',' order by team)) from forecast_season.drafts t),
 'attempts',(select md5(string_agg(to_jsonb(t)::text,',' order by key)) from forecast_season.attempts t),
 'control',(select to_jsonb(t) from forecast_season.control t),
 'permissions',(select jsonb_build_object('owner',proowner,'acl',proacl,'definer',prosecdef,'config',proconfig) from pg_proc where oid='forecast_season.plan()'::regprocedure)
);
 execute $new_plan$CREATE OR REPLACE FUNCTION forecast_season.plan()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare slot timestamptz; hour_local integer; team_rows jsonb; cfg forecast_season.control%rowtype;
begin
 select * into cfg from forecast_season.control;
 if now()<timestamptz '2026-11-12 14:00Z' or now()>=timestamptz '2027-07-01 04:00Z' then return jsonb_build_object('observed_at',now(),'slot',null,'teams','[]'::jsonb,'mode',cfg.mode); end if;
 select max((d::date+h) at time zone 'America/New_York') into slot
 from (values ((now() at time zone 'America/New_York')::date),((now() at time zone 'America/New_York')::date-1)) days(d)
 cross join (values(time '06:00'),(time '13:00'),(time '18:00')) hours(h)
 where (d::date+h) at time zone 'America/New_York'<=now();
 if slot<now()-interval '2 hours' or slot<timestamptz '2026-11-12 14:00Z' then slot:=null; end if;
 hour_local:=extract(hour from slot at time zone 'America/New_York');
 select coalesce(jsonb_agg(jsonb_build_object('team',t.team,'fixture',to_jsonb(f)-'checks','comuniate_team_url',t.source_urls->>'comuniate','needs_fixture',f.key is null,'paused',d.paused) order by t.team),'[]'::jsonb) into team_rows
 from forecast_league.teams t join forecast_season.drafts d using(team)
 left join lateral (select * from forecast_season.fixtures f where t.team in(f.home,f.away) and f.kickoff_at>now() order by f.kickoff_at,f.key limit 1) f on true
 where slot is not null and (hour_local=6
  or (hour_local=13 and (f.kickoff_at at time zone 'America/New_York')::date=(slot at time zone 'America/New_York')::date)
  or (hour_local=18 and f.kickoff_at<=slot+interval '48 hours'));
 return jsonb_build_object('observed_at',now(),'slot',slot,'run_key',case when slot is not null then 'season-'||to_char(slot at time zone 'America/New_York','YYYYMMDD-HH24MI') end,'mode',cfg.mode,'version',cfg.version,'teams',team_rows);
end;
$function$
$new_plan$;
 execute $test_plan$CREATE OR REPLACE FUNCTION pg_temp.cuban_schedule_plan_at(p_at timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare slot timestamptz; hour_local integer; team_rows jsonb; cfg forecast_season.control%rowtype;
begin
 select * into cfg from forecast_season.control;
 if p_at<timestamptz '2026-11-12 14:00Z' or p_at>=timestamptz '2027-07-01 04:00Z' then return jsonb_build_object('observed_at',p_at,'slot',null,'teams','[]'::jsonb,'mode',cfg.mode); end if;
 select max((d::date+h) at time zone 'America/New_York') into slot
 from (values ((p_at at time zone 'America/New_York')::date),((p_at at time zone 'America/New_York')::date-1)) days(d)
 cross join (values(time '06:00'),(time '13:00'),(time '18:00')) hours(h)
 where (d::date+h) at time zone 'America/New_York'<=p_at;
 if slot<p_at-interval '2 hours' or slot<timestamptz '2026-11-12 14:00Z' then slot:=null; end if;
 hour_local:=extract(hour from slot at time zone 'America/New_York');
 select coalesce(jsonb_agg(jsonb_build_object('team',t.team,'fixture',to_jsonb(f)-'checks','comuniate_team_url',t.source_urls->>'comuniate','needs_fixture',f.key is null,'paused',d.paused) order by t.team),'[]'::jsonb) into team_rows
 from forecast_league.teams t join forecast_season.drafts d using(team)
 left join lateral (select * from forecast_season.fixtures f where t.team in(f.home,f.away) and f.kickoff_at>p_at order by f.kickoff_at,f.key limit 1) f on true
 where slot is not null and (hour_local=6
  or (hour_local=13 and (f.kickoff_at at time zone 'America/New_York')::date=(slot at time zone 'America/New_York')::date)
  or (hour_local=18 and f.kickoff_at<=slot+interval '48 hours'));
 return jsonb_build_object('observed_at',p_at,'slot',slot,'run_key',case when slot is not null then 'season-'||to_char(slot at time zone 'America/New_York','YYYYMMDD-HH24MI') end,'mode',cfg.mode,'version',cfg.version,'teams',team_rows);
end;
$function$
$test_plan$;
 for test_case in select * from (values
  ('before morning',timestamptz '2026-11-13 10:59:59Z',null::text,0),
  ('general 06',timestamptz '2026-11-13 11:00:00Z','season-20261113-0600'::text,20),
  ('same slot retry',timestamptz '2026-11-13 11:45:00Z','season-20261113-0600'::text,20),
  ('two hour boundary',timestamptz '2026-11-13 13:00:00Z','season-20261113-0600'::text,20),
  ('expired morning',timestamptz '2026-11-13 13:00:01Z',null::text,0),
  ('removed 09',timestamptz '2026-11-13 14:00:00Z',null::text,0),
  ('before afternoon',timestamptz '2026-11-13 17:59:59Z',null::text,0),
  ('empty afternoon',timestamptz '2026-11-13 18:00:00Z','season-20261113-1300'::text,0),
  ('matchday afternoon',timestamptz '2026-11-20 18:00:00Z','season-20261120-1300'::text,2),
  ('evening 48h',timestamptz '2026-11-19 23:00:00Z','season-20261119-1800'::text,10),
  ('evening after kickoff',timestamptz '2026-11-20 23:00:00Z','season-20261120-1800'::text,16),
  ('winter 06',timestamptz '2027-03-13 11:00:00Z','season-20270313-0600'::text,20),
  ('summer 06',timestamptz '2027-03-14 10:00:00Z','season-20270314-0600'::text,20),
  ('summer removed 09',timestamptz '2027-03-14 13:00:00Z',null::text,0),
  ('last day',timestamptz '2027-06-30 10:00:00Z','season-20270630-0600'::text,20),
  ('after season',timestamptz '2027-07-01 04:00:00Z',null::text,0)
 ) cases(label,at_time,expected_key,expected_count) loop
  actual:=pg_temp.cuban_schedule_plan_at(test_case.at_time);
  if actual->>'run_key' is distinct from test_case.expected_key or jsonb_array_length(actual->'teams')<>test_case.expected_count then
   raise exception 'Schedule test % failed: %',test_case.label,actual;
  end if;
  if exists(select 1 from jsonb_array_elements(actual->'teams') x where (x->'fixture'->>'kickoff_at')::timestamptz<=test_case.at_time) then
   raise exception 'Started fixture returned in %',test_case.label;
  end if;
 end loop;
 execute 'drop function pg_temp.cuban_schedule_plan_at(timestamptz)';
 if before_state is distinct from jsonb_build_object(
 'public',(select md5(string_agg(to_jsonb(t)::text,',' order by team)) from public.forecast_season_public t),
 'runs',(select md5(string_agg(to_jsonb(t)::text,',' order by key)) from forecast_season.runs t),
 'drafts',(select md5(string_agg(to_jsonb(t)::text,',' order by team)) from forecast_season.drafts t),
 'attempts',(select md5(string_agg(to_jsonb(t)::text,',' order by key)) from forecast_season.attempts t),
 'control',(select to_jsonb(t) from forecast_season.control t),
 'permissions',(select jsonb_build_object('owner',proowner,'acl',proacl,'definer',prosecdef,'config',proconfig) from pg_proc where oid='forecast_season.plan()'::regprocedure)
) then
  raise exception 'Schedule update changed data, controls or permissions';
 end if;
end;
$schedule_migration$;
