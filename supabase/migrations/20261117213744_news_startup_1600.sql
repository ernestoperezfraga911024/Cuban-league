-- Ernesto, 17/11/2026: move news 15:00 -> 16:00 Miami and initialize before checking teams.
begin;
select 1 from league_news.control for update;
create temporary table news_startup_snapshot on commit drop as
select jsonb_build_object(
 'control',(select to_jsonb(c) from league_news.control c),
 'items',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by key)::text,'[]')) from league_news.items x),
 'public',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by key)::text,'[]')) from public.news_public x),
 'runs',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by key)::text,'[]')) from league_news.runs x),
 'events',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by run_key,key)::text,'[]')) from league_news.run_events x),
 'teams',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by run_key,team)::text,'[]')) from league_news.run_teams x),
 'status',(select to_jsonb(x) from public.news_status x)
) as fingerprints;

do $guard$ begin
 if md5(pg_get_functiondef('league_news.slot_at(timestamptz)'::regprocedure))<>'e0a92e2b69c2249bc3a994f785dcdf0d'
 or md5(pg_get_functiondef('league_news.plan()'::regprocedure))<>'955eb952db0008bfd82c3d6edfe6af30'
 or md5(pg_get_functiondef('league_news.begin_run(text)'::regprocedure))<>'e9f2f2cf34f9754c2356ffe1e438fafb'
 then raise exception 'News functions changed; inspect before installing';end if;
end;$guard$;
-- Change the existing function in place, retaining owner, ACLs and its other windows.
do $slot$ declare s text:=pg_get_functiondef('league_news.slot_at(timestamptz)'::regprocedure);begin
 execute replace(s,'between 15 and 16 then 15','between 16 and 17 then 16');
end;$slot$;

-- One private entry point: never interpret a new run's empty teams as no work.
create function league_news.prepare_run() returns jsonb
language plpgsql volatile security invoker set search_path='' as $fn$
declare p jsonb;k text;expected integer;
begin
 perform 1 from league_news.control for update;
 p:=league_news.plan();k:=p->>'run_key';
 if k is null or (p->>'completed')::boolean then
  return (p-'recent')||jsonb_build_object('has_work',false,'action',case when k is null then 'not_due' else 'completed' end);
 end if;
 perform league_news.begin_run(k);
 p:=league_news.plan();
 select count(*) into expected from forecast_league.teams;
 if p->>'run_key' is distinct from k or expected<>20 or jsonb_array_length(p->'teams')<>expected
 or exists(select 1 from forecast_league.teams t where not exists(select 1 from jsonb_array_elements(p->'teams') x where x->>'team'=t.team))
 then raise exception 'News initialization did not produce the complete authorized club set';end if;
 return (p-'recent')||jsonb_build_object('has_work',true,'action','review');
end;$fn$;
revoke all on function league_news.prepare_run() from public,anon,authenticated,service_role;

do $verify$ declare actual jsonb;begin
select jsonb_build_object(
 'control',(select to_jsonb(c) from league_news.control c),
 'items',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by key)::text,'[]')) from league_news.items x),
 'public',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by key)::text,'[]')) from public.news_public x),
 'runs',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by key)::text,'[]')) from league_news.runs x),
 'events',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by run_key,key)::text,'[]')) from league_news.run_events x),
 'teams',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by run_key,team)::text,'[]')) from league_news.run_teams x),
 'status',(select to_jsonb(x) from public.news_status x)
) into actual;

 if actual is distinct from (select fingerprints from pg_temp.news_startup_snapshot)
 then raise exception 'News startup installation changed stored data';end if;
end;$verify$;
select jsonb_build_object('protected_state_unchanged',true,'schedule','08:00,11:00,16:00 America/New_York',
 'slot_md5',md5(pg_get_functiondef('league_news.slot_at(timestamptz)'::regprocedure)),
 'prepare_md5',md5(pg_get_functiondef('league_news.prepare_run()'::regprocedure))) as installation;
commit;
