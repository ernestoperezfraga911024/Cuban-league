-- Isolated physical availability; never changes forecasts, news or the catalog.
create schema forecast_health;
revoke all on schema forecast_health from public,anon,authenticated,service_role;
create table forecast_health.drafts(
 team text not null references forecast_league.teams(team),
 player_id text not null references forecast_league.roster(id),
 payload jsonb not null check(octet_length(payload::text)<=4096),
 checked_at timestamptz not null,
 outcome text not null check(outcome in('saved','ready','published')),
 primary key(team,player_id)
);
create table public.forecast_health_public(
 team text not null references forecast_league.teams(team),
 player_id text not null references forecast_league.roster(id),
 payload jsonb not null,
 published_at timestamptz not null,
 primary key(team,player_id)
);
alter table forecast_health.drafts enable row level security;
alter table public.forecast_health_public enable row level security;
revoke all on forecast_health.drafts,public.forecast_health_public from public,anon,authenticated,service_role;
grant select on public.forecast_health_public to anon,authenticated;
create policy health_visible on public.forecast_health_public for select to anon,authenticated
 using(exists(select 1 from public.forecast_season_public s where s.team=forecast_health_public.team and s.status<>'withdrawn'));

create function forecast_health.save_batch(p jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $health$
declare t text:=p->>'team'; s jsonb:=p->'source'; item jsonb; clean jsonb;
 f timestamptz; old forecast_health.drafts%rowtype; n integer:=0; known_url text;
begin
 perform 1 from forecast_season.control for update;
 select 'https://www.futbolfantasy.com/equipos/'||case team when 'fc-barcelona' then 'barcelona' when 'athletic-club' then 'athletic' when 'atletico-madrid' then 'atletico' when 'celta-vigo' then 'celta' when 'deportivo-la-coruna' then 'deportivo' when 'racing-santander' then 'racing' when 'real-betis' then 'betis' else team end into known_url from forecast_league.teams where team=t;
 if p is null or octet_length(p::text)>65536 or p->>'season' is distinct from '2026-27'
 or known_url is null or coalesce((p->>'matchday')::integer,0) not between 13 and 38
 or now()>=timestamptz '2027-07-01 04:00Z' then raise exception 'Invalid health scope' using errcode='22023';end if;
 if jsonb_typeof(p->'players') is distinct from 'array' then raise exception 'Players required' using errcode='22023';end if;
 if jsonb_array_length(p->'players') not between 1 and 50
 or (select count(distinct x->>'id') from jsonb_array_elements(p->'players') x)<>jsonb_array_length(p->'players')
 then raise exception 'Invalid health players' using errcode='22023';end if;
 if s->>'id' is distinct from 'futbolfantasy'
 or coalesce(s->>'url','')!~'^https://www\.futbolfantasy\.com/(laliga/)?equipos/[a-z0-9-]+/?$'
 or regexp_replace(s->>'url','/laliga/','/') is distinct from regexp_replace(known_url,'/laliga/','/')
 then raise exception 'Unregistered team source' using errcode='22023';end if;
 f:=(s->>'fetched_at')::timestamptz;
 if f is null or f<now()-interval '2 hours' or f>now()+interval '5 minutes' then raise exception 'Stale health reading' using errcode='22023';end if;
 if s->>'source_updated_at' is not null and (s->>'source_updated_at')::timestamptz>f+interval '5 minutes' then raise exception 'Invalid source date' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p->'players') loop
  if not exists(select 1 from forecast_league.roster where team=t and id=item->>'id' and name=item->>'name')
  then raise exception 'Player identity not in team roster' using errcode='22023';end if;
  if coalesce(item->>'status','') not in('doubt','injured','available')
   or coalesce(length(item->>'detail'),0) not between 10 and 500
   or coalesce(length(item->>'source_label'),0) not between 3 and 160
   or not ((item->>'status'='doubt' and item->>'source_label' in('Duda','Duda por lesión'))
    or (item->>'status'='injured' and item->>'source_label' in('Lesionado','Baja por lesión'))
    or (item->>'status'='available' and item->>'source_label' in('Disponible','Tocado o sale de lesión, pero disponible')))
  then raise exception 'Explicit matching physical state required' using errcode='22023';end if;
  if item->>'event_date' is not null and ((item->>'event_date')!~'^\d{4}-\d{2}-\d{2}$' or (item->>'event_date')::date>f::date) then raise exception 'Invalid original event date' using errcode='22023';end if;
  clean:=jsonb_build_object('season','2026-27','team',t,'matchday',(p->>'matchday')::integer,'id',item->>'id','name',item->>'name','status',item->>'status','source_label',item->>'source_label','detail',item->>'detail','event_date',item->'event_date',
   'source',jsonb_build_object('id','futbolfantasy','url',s->>'url','fetched_at',s->>'fetched_at','source_updated_at',s->'source_updated_at'));
  select * into old from forecast_health.drafts where team=t and player_id=item->>'id';
  if found then
   if old.checked_at>f then raise exception 'Older health evidence' using errcode='22023';end if;
   if old.checked_at=f and old.payload is distinct from clean then raise exception 'Conflicting health reading' using errcode='23505';end if;
   if old.payload=clean then continue;end if;
  end if;
  insert into forecast_health.drafts(team,player_id,payload,checked_at,outcome) values(t,item->>'id',clean,f,'saved')
  on conflict(team,player_id) do update set payload=excluded.payload,checked_at=excluded.checked_at,outcome='saved';
  n:=n+1;
 end loop;
 if n>0 then update forecast_season.control set version=version+1;end if;
 return jsonb_build_object('team',t,'outcome',case when n=0 then 'unchanged' else 'saved' end,'players',n);
end;$health$;

-- Internal publication path: automation uses deliver; only the existing admin
-- command invokes publish_ready with its own authentication and version checks.
create function forecast_health.publish_ready(p_team text,p_age interval default interval '2 hours') returns jsonb
language plpgsql security invoker set search_path='' as $health$
declare d record; n integer:=0;
begin
 for d in select h.* from forecast_health.drafts h join forecast_season.drafts s using(team)
 where (p_team is null or h.team=p_team) and not s.paused and h.outcome in('saved','ready')
 and h.checked_at>=now()-p_age loop
  insert into public.forecast_health_public(team,player_id,payload,published_at) values(d.team,d.player_id,d.payload,now())
  on conflict(team,player_id) do update set payload=excluded.payload,published_at=excluded.published_at
   where (forecast_health_public.payload->'source'->>'fetched_at')::timestamptz<=d.checked_at;
  update forecast_health.drafts set outcome='published' where team=d.team and player_id=d.player_id;
  n:=n+1;
 end loop;
 return jsonb_build_object('outcome',case when n>0 then 'published' else 'unchanged' end,'players',n);
end;$health$;

create function forecast_health.deliver(p_team text) returns jsonb
language plpgsql security invoker set search_path='' as $health$
declare mode_value text; paused_value boolean; result jsonb;
begin
 select mode into mode_value from forecast_season.control for update;
 select paused into paused_value from forecast_season.drafts where team=p_team;
 if paused_value is null then raise exception 'Unknown team' using errcode='22023';end if;
 if mode_value='manual' or paused_value then
  update forecast_health.drafts set outcome='ready' where team=p_team and outcome='saved';
  result:=jsonb_build_object('outcome','ready','team',p_team);
 else result:=forecast_health.publish_ready(p_team);end if;
 update forecast_season.control set version=version+1;
 return result;
end;$health$;
revoke all on all functions in schema forecast_health from public,anon,authenticated,service_role;

-- Guarded extensions of installed controls and schedule; retain their ACLs.
do $guard$
begin
 if pg_get_functiondef('forecast_season.plan()'::regprocedure) is distinct from $before$CREATE OR REPLACE FUNCTION forecast_season.plan()
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
$before$ then raise exception 'Unexpected plan definition; review before applying';end if;
 execute $after$CREATE OR REPLACE FUNCTION forecast_season.plan()
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
 cross join (values(time '06:00'),(time '13:00'),(time '14:00'),(time '18:00')) hours(h)
 where (d::date+h) at time zone 'America/New_York'<=now();
 if slot<now()-interval '2 hours' or slot<timestamptz '2026-11-12 14:00Z' then slot:=null; end if;
 hour_local:=extract(hour from slot at time zone 'America/New_York');
 select coalesce(jsonb_agg(jsonb_build_object('team',t.team,'fixture',to_jsonb(f)-'checks','comuniate_team_url',t.source_urls->>'comuniate','needs_fixture',f.key is null,'paused',d.paused) order by t.team),'[]'::jsonb) into team_rows
 from forecast_league.teams t join forecast_season.drafts d using(team)
 left join lateral (select * from forecast_season.fixtures f where t.team in(f.home,f.away) and f.kickoff_at>now() order by f.kickoff_at,f.key limit 1) f on true
 where slot is not null and (hour_local in(6,14)
  or (hour_local=13 and (f.kickoff_at at time zone 'America/New_York')::date=(slot at time zone 'America/New_York')::date)
  or (hour_local=18 and f.kickoff_at<=slot+interval '48 hours'));
 return jsonb_build_object('observed_at',now(),'slot',slot,'run_key',case when slot is not null then 'season-'||to_char(slot at time zone 'America/New_York','YYYYMMDD-HH24MI') end,'mode',cfg.mode,'version',cfg.version,'teams',team_rows);
end;
$function$
$after$;
end;$guard$;
do $guard$
begin
 if pg_get_functiondef('private.get_forecast_season()'::regprocedure) is distinct from $before$CREATE OR REPLACE FUNCTION private.get_forecast_season()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if (select auth.uid()) is null or not coalesce(private.is_league_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 select jsonb_build_object('mode',mode,'version',version,'schedule_timezone','America/New_York','season','2026-27') into result from forecast_season.control;
 return result||jsonb_build_object('last_run',(select to_jsonb(r)||jsonb_build_object('results',coalesce((select jsonb_agg(jsonb_build_object('team',a.team,'outcome',a.outcome)) from forecast_season.attempts a where a.run_key=r.key),'[]'::jsonb)) from forecast_season.runs r order by slot_at desc limit 1),'teams',(select jsonb_agg(jsonb_build_object('team',d.team,'paused',d.paused,'outcome',d.outcome,'reason',d.reason,'checked_at',d.checked_at,'fixture_key',d.fixture_key,'preview',d.projection,'published_at',p.published_at,'public_status',p.status,'ready',d.outcome='ready' and d.projection is not null and (d.projection->>'evidence_at')::timestamptz>=now()-interval '24 hours' and (d.projection->>'kickoff_at')::timestamptz>now()) order by d.team) from forecast_season.drafts d join public.forecast_season_public p using(team)));
end;
$function$
$before$ then raise exception 'Unexpected get_forecast_season definition; review before applying';end if;
 execute $after$CREATE OR REPLACE FUNCTION private.get_forecast_season()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if (select auth.uid()) is null or not coalesce(private.is_league_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 select jsonb_build_object('mode',mode,'version',version,'schedule_timezone','America/New_York','season','2026-27') into result from forecast_season.control;
 return result||jsonb_build_object('health_ready',coalesce((select jsonb_agg(distinct h.team) from forecast_health.drafts h join forecast_season.drafts s using(team) where not s.paused and h.outcome in('saved','ready') and h.checked_at>=now()-interval '24 hours'),'[]'::jsonb),'last_run',(select to_jsonb(r)||jsonb_build_object('results',coalesce((select jsonb_agg(jsonb_build_object('team',a.team,'outcome',a.outcome)) from forecast_season.attempts a where a.run_key=r.key),'[]'::jsonb)) from forecast_season.runs r order by slot_at desc limit 1),'teams',(select jsonb_agg(jsonb_build_object('team',d.team,'paused',d.paused,'outcome',d.outcome,'reason',d.reason,'checked_at',d.checked_at,'fixture_key',d.fixture_key,'preview',d.projection,'published_at',p.published_at,'public_status',p.status,'ready',d.outcome='ready' and d.projection is not null and (d.projection->>'evidence_at')::timestamptz>=now()-interval '24 hours' and (d.projection->>'kickoff_at')::timestamptz>now()) order by d.team) from forecast_season.drafts d join public.forecast_season_public p using(team)));
end;
$function$
$after$;
end;$guard$;
do $guard$
begin
 if pg_get_functiondef('private.command_forecast_season(text,bigint,uuid,text)'::regprocedure) is distinct from $before$CREATE OR REPLACE FUNCTION private.command_forecast_season(p_action text, p_expected_version bigint, p_request_id uuid, p_team text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cfg forecast_season.control%rowtype; old forecast_season.commands%rowtype; req jsonb; result jsonb; d record; one jsonb; items jsonb:='[]';
begin
 if (select auth.uid()) is null or not coalesce(private.is_league_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 if not coalesce(p_action in ('manual','automatic','publish','withdraw'),false) or p_request_id is null or p_expected_version is null or (p_team is not null and not exists(select 1 from forecast_league.teams where team=p_team)) then raise exception 'Comando inválido' using errcode='22023'; end if;
 select * into cfg from forecast_season.control for update;
 req:=jsonb_build_object('action',p_action,'version',p_expected_version,'team',p_team,'actor',(select auth.uid()));
 select * into old from forecast_season.commands where request_id=p_request_id;
 if found then
  if old.request is distinct from req then raise exception 'UUID usado para otro comando' using errcode='23505'; end if;
  return old.result;
 end if;
 if cfg.version<>p_expected_version then raise exception 'El estado cambió. Actualiza antes de continuar.' using errcode='40001'; end if;
 if (select count(*) from forecast_season.commands)>=5000 then raise exception 'Límite de comandos' using errcode='54000'; end if;
 if p_action in ('manual','automatic') then
  update forecast_season.control set mode=p_action;
  result:=jsonb_build_object('outcome','mode_changed','mode',p_action);
 elsif p_action='withdraw' then
  if p_team is null then raise exception 'Selecciona un equipo para retirar' using errcode='22023'; end if;
  update forecast_season.drafts set paused=true where team=p_team;
  update public.forecast_season_public set payload=null,published_at=null,status='withdrawn' where team=p_team;
  result:=jsonb_build_object('outcome','withdrawn','team',p_team);
 else
  for d in select * from forecast_season.drafts where (p_team is null and outcome='ready' and not paused) or team=p_team loop
   begin one:=forecast_season.publish_team(d.team,interval '24 hours',true);
   exception when sqlstate '22023' then
    update forecast_season.drafts set outcome='blocked',reason=sqlerrm where team=d.team;
    update public.forecast_season_public set status=case when d.paused then 'withdrawn' else 'blocked' end where team=d.team;
    one:=jsonb_build_object('team',d.team,'outcome','blocked','reason',sqlerrm);
   end;
   items:=items||jsonb_build_array(one);
  end loop;
  result:=jsonb_build_object('outcome','processed','teams',items);
 end if;
 update forecast_season.control set version=version+1;
 insert into forecast_season.commands(request_id,request,result) values(p_request_id,req,result);
 return result;
end;
$function$
$before$ then raise exception 'Unexpected command_forecast_season definition; review before applying';end if;
 execute $after$CREATE OR REPLACE FUNCTION private.command_forecast_season(p_action text, p_expected_version bigint, p_request_id uuid, p_team text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cfg forecast_season.control%rowtype; old forecast_season.commands%rowtype; req jsonb; result jsonb; d record; one jsonb; items jsonb:='[]';
begin
 if (select auth.uid()) is null or not coalesce(private.is_league_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 if not coalesce(p_action in ('manual','automatic','publish','withdraw'),false) or p_request_id is null or p_expected_version is null or (p_team is not null and not exists(select 1 from forecast_league.teams where team=p_team)) then raise exception 'Comando inválido' using errcode='22023'; end if;
 select * into cfg from forecast_season.control for update;
 req:=jsonb_build_object('action',p_action,'version',p_expected_version,'team',p_team,'actor',(select auth.uid()));
 select * into old from forecast_season.commands where request_id=p_request_id;
 if found then
  if old.request is distinct from req then raise exception 'UUID usado para otro comando' using errcode='23505'; end if;
  return old.result;
 end if;
 if cfg.version<>p_expected_version then raise exception 'El estado cambió. Actualiza antes de continuar.' using errcode='40001'; end if;
 if (select count(*) from forecast_season.commands)>=5000 then raise exception 'Límite de comandos' using errcode='54000'; end if;
 if p_action in ('manual','automatic') then
  update forecast_season.control set mode=p_action;
  result:=jsonb_build_object('outcome','mode_changed','mode',p_action);
 elsif p_action='withdraw' then
  if p_team is null then raise exception 'Selecciona un equipo para retirar' using errcode='22023'; end if;
  update forecast_season.drafts set paused=true where team=p_team;
  update public.forecast_season_public set payload=null,published_at=null,status='withdrawn' where team=p_team;
  result:=jsonb_build_object('outcome','withdrawn','team',p_team);
 else
  for d in select * from forecast_season.drafts where (p_team is null and outcome='ready' and not paused) or (team=p_team and (outcome='ready' or paused)) loop
   begin one:=forecast_season.publish_team(d.team,interval '24 hours',true);
   exception when sqlstate '22023' then
    update forecast_season.drafts set outcome='blocked',reason=sqlerrm where team=d.team;
    update public.forecast_season_public set status=case when d.paused then 'withdrawn' else 'blocked' end where team=d.team;
    one:=jsonb_build_object('team',d.team,'outcome','blocked','reason',sqlerrm);
   end;
   items:=items||jsonb_build_array(one);
  end loop;
  result:=jsonb_build_object('outcome','processed','teams',items,'health',forecast_health.publish_ready(p_team,interval '24 hours'));
 end if;
 update forecast_season.control set version=version+1;
 insert into forecast_season.commands(request_id,request,result) values(p_request_id,req,result);
 return result;
end;
$function$
$after$;
end;$guard$;

notify pgrst,'reload schema';
