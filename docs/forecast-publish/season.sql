-- Season delivery is separate from the immutable, bounded J13 pilot.
create schema forecast_season;
revoke all on schema forecast_season from public,anon,authenticated,service_role;
create table forecast_season.control(singleton boolean primary key default true check(singleton), mode text not null check(mode in ('manual','automatic')), version bigint not null default 1);
insert into forecast_season.control(singleton,mode) select true,mode from forecast_publish.delivery_config;
create table forecast_season.fixtures(key text primary key, season text not null check(season='2026-27'), matchday integer not null check(matchday between 13 and 38), home text not null references forecast_league.teams(team), away text not null references forecast_league.teams(team), kickoff_at timestamptz not null, source_urls jsonb not null, checks jsonb not null, verified_at timestamptz, check(home<>away), unique(season,home,away));
create table forecast_season.runs(key text primary key, slot_at timestamptz not null unique, started_at timestamptz not null default now(), finished_at timestamptz, expected jsonb not null);
create table forecast_season.drafts(team text primary key references forecast_league.teams(team), paused boolean not null default false, run_key text unique, fixture_key text references forecast_season.fixtures(key), payload jsonb, projection jsonb, checked_at timestamptz, outcome text not null default 'pending', reason text, check(payload is null or octet_length(payload::text)<=65536));
create table forecast_season.attempts(key text primary key, run_key text not null references forecast_season.runs(key), team text not null references forecast_league.teams(team), fixture_key text, checked_at timestamptz not null default now(), input_hash text not null, outcome text not null, reason text, published_at timestamptz, unique(run_key,team));
create table forecast_season.archive(fixture_key text not null references forecast_season.fixtures(key), team text not null references forecast_league.teams(team), horizon text not null check(horizon in ('distant','medium','near','matchday')), published_at timestamptz not null, projection jsonb not null, source_starters jsonb not null, primary key(fixture_key,team,horizon));
create table forecast_season.commands(request_id uuid primary key, request jsonb not null, result jsonb not null, created_at timestamptz not null default now());
create table public.forecast_season_public(team text primary key references forecast_league.teams(team), payload jsonb, published_at timestamptz, checked_at timestamptz, status text not null check(status in ('published','ready','blocked','withdrawn','pending')), attempted_fixture_key text);
alter table forecast_season.control enable row level security;
alter table forecast_season.fixtures enable row level security;
alter table forecast_season.runs enable row level security;
alter table forecast_season.drafts enable row level security;
alter table forecast_season.attempts enable row level security;
alter table forecast_season.archive enable row level security;
alter table forecast_season.commands enable row level security;
alter table public.forecast_season_public enable row level security;
revoke all on all tables in schema forecast_season from public,anon,authenticated,service_role;
revoke all on public.forecast_season_public from public,anon,authenticated,service_role;
grant select on public.forecast_season_public to anon,authenticated;
create policy published_season_read on public.forecast_season_public for select to anon,authenticated using(true);
insert into forecast_season.fixtures(key,season,matchday,home,away,kickoff_at,source_urls,checks)
 select distinct fixture->>'key','2026-27',13,fixture->>'home',fixture->>'away',(fixture->>'kickoff_at')::timestamptz,fixture->'sources','[]'::jsonb from forecast_league.teams;
insert into forecast_season.drafts(team) select team from forecast_league.teams;
-- Preserve actual publication and source times; seeding is not a new reading.
insert into public.forecast_season_public(team,payload,published_at,checked_at,status,attempted_fixture_key)
 select 'real-madrid',payload,published_at,(payload->>'evidence_at')::timestamptz,'published',payload->>'fixture_key' from public.forecast_public
 union all select team,payload,published_at,(payload->>'evidence_at')::timestamptz,'published',payload->>'fixture_key' from public.forecast_round_public;
insert into public.forecast_season_public(team,status) select team,'pending' from forecast_league.teams on conflict do nothing;

create function forecast_season.source_url(p_id text,p_url text) returns boolean
language sql immutable security invoker set search_path='' as $body$
 select coalesce(p_url ~ ('^https://www\.'||case p_id when 'futbolfantasy' then 'futbolfantasy' when 'jornadaperfecta' then 'jornadaperfecta' when 'comuniate' then 'comuniate' else 'INVALID' end||'\.com/(partidos?|equipos)/[a-zA-Z0-9/_-]+$'),false);
$body$;

create function forecast_season.plan() returns jsonb
language plpgsql stable security invoker set search_path='' as $body$
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
$body$;

create function forecast_season.begin_run() returns jsonb
language plpgsql security invoker set search_path='' as $body$
declare p jsonb; ids jsonb;
begin
 perform 1 from forecast_season.control for update;
 p:=forecast_season.plan();
 if p->>'slot' is null then return p; end if;
 select coalesce(jsonb_agg(x->>'team'),'[]'::jsonb) into ids from jsonb_array_elements(p->'teams') x;
 if (select count(*) from forecast_season.runs)>=1000 and not exists(select 1 from forecast_season.runs where key=p->>'run_key') then raise exception 'Límite de ejecuciones de temporada' using errcode='54000'; end if;
 insert into forecast_season.runs(key,slot_at,expected) values(p->>'run_key',(p->>'slot')::timestamptz,ids) on conflict do nothing;
 return p||jsonb_build_object('existing_attempts',coalesce((select jsonb_agg(to_jsonb(a)) from forecast_season.attempts a where a.run_key=p->>'run_key'),'[]'::jsonb));
end;
$body$;

create function forecast_season.register_fixture(p jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $body$
declare s jsonb; urls jsonb:='{}'; seen jsonb:='[]'; expected jsonb; old forecast_season.fixtures%rowtype; oldest timestamptz;
begin
 perform 1 from forecast_season.control for update;
 if forecast_season.plan()->>'run_key' is null or not exists(select 1 from forecast_season.runs where key=forecast_season.plan()->>'run_key') then raise exception 'Inicia un turno autorizado antes de registrar el calendario' using errcode='22023'; end if;
 if octet_length(p::text)>8192 or p->>'season' is distinct from '2026-27' or jsonb_typeof(p->'matchday') is distinct from 'number' or coalesce(p->>'matchday','') !~ '^(1[3-9]|2[0-9]|3[0-8])$'
  or not exists(select 1 from forecast_league.teams where team=p->>'home') or not exists(select 1 from forecast_league.teams where team=p->>'away') or p->>'home'=p->>'away'
  or p->>'key' is null or p->>'key' !~ '^laliga-2026-27-j(1[3-9]|2[0-9]|3[0-8])-[a-z0-9-]{3,100}$'
  or (p->>'kickoff_at')::timestamptz not between now()+interval '1 minute' and least(now()+interval '45 days',timestamptz '2027-07-01 04:00Z')
  or p->>'kickoff_at' is null or jsonb_typeof(p->'sources') is distinct from 'array' then raise exception 'Calendario inválido' using errcode='22023'; end if;
 if split_part(p->>'key','-j',2) not like (p->>'matchday')||'-%' or jsonb_array_length(p->'sources')<>3 then raise exception 'Jornada o fuentes inválidas' using errcode='22023'; end if;
 expected:=jsonb_build_object('key',p->>'key','home',p->>'home','away',p->>'away','matchday',p->'matchday','kickoff_at',p->>'kickoff_at');
 for s in select value from jsonb_array_elements(p->'sources') loop
  if seen ? (s->>'id') or not forecast_season.source_url(s->>'id',s->>'url') or s->>'id' not in ('futbolfantasy','jornadaperfecta','comuniate')
   or s->'fixture_verified' is distinct from 'true'::jsonb or s->'observed_fixture' is distinct from expected
   or s->>'fetched_at' is null or (s->>'fetched_at')::timestamptz not between now()-interval '2 hours' and now()+interval '5 minutes'
   or s->>'url' !~ '/partidos?/' then raise exception 'No coinciden las tres verificaciones del partido' using errcode='22023'; end if;
  seen:=seen||jsonb_build_array(s->>'id');urls:=urls||jsonb_build_object(s->>'id',s->>'url');oldest:=least(oldest,(s->>'fetched_at')::timestamptz);
 end loop;
 select * into old from forecast_season.fixtures where key=p->>'key';
 if found and (old.home<>p->>'home' or old.away<>p->>'away' or old.matchday<>(p->>'matchday')::integer) then raise exception 'No se puede cambiar la identidad del partido' using errcode='22023'; end if;
 if not found and (select count(*) from forecast_season.fixtures)>=260 then raise exception 'Límite de partidos J13-J38' using errcode='54000'; end if;
 if exists(select 1 from forecast_season.fixtures f where f.key<>p->>'key' and f.matchday=(p->>'matchday')::integer and (f.home in(p->>'home',p->>'away') or f.away in(p->>'home',p->>'away'))) then raise exception 'Equipo duplicado en la jornada' using errcode='22023'; end if;
 insert into forecast_season.fixtures(key,season,matchday,home,away,kickoff_at,source_urls,checks,verified_at)
 values(p->>'key','2026-27',(p->>'matchday')::integer,p->>'home',p->>'away',(p->>'kickoff_at')::timestamptz,urls,p->'sources',oldest)
 on conflict(key) do update set kickoff_at=excluded.kickoff_at,source_urls=excluded.source_urls,checks=excluded.checks,verified_at=excluded.verified_at;
 return jsonb_build_object('fixture_key',p->>'key','verified_at',oldest);
end;
$body$;

-- BEGIN GENERATED VALIDATOR
create function forecast_season.build_team(p jsonb,p_max_age interval default interval '2 hours') returns jsonb
language plpgsql stable security invoker set search_path='' as $body$
declare cfg record; s jsonb; x jsonb; o jsonb; obs jsonb; starters jsonb; ids text[];
 oldest timestamptz; source_result jsonb:='[]'; players jsonb:='[]'; person text; alt text; slot integer; shape integer[]; df integer; fw integer; pos text; horizon text; note text; invalid_source boolean:=false;
begin
 if p_max_age not in (interval '2 hours',interval '24 hours') then raise exception 'Vigencia inválida' using errcode='22023'; end if;
 select t.team,jsonb_build_object('key',f.key,'home',f.home,'away',f.away,'matchday',f.matchday,'kickoff_at',to_char(f.kickoff_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'sources',f.source_urls) as fixture,
 f.source_urls||jsonb_build_object('comuniate',t.source_urls->'comuniate') as source_urls into cfg
 from forecast_league.teams t join forecast_season.fixtures f on f.key=p->>'fixture_key' and t.team in(f.home,f.away) where t.team=p->>'team';
 if cfg.team is null or octet_length(p::text)>65536 or p->'schema_version' is distinct from '3'::jsonb or p->>'season' is distinct from '2026-27'
  or p->>'fixture_key' is distinct from cfg.fixture->>'key' or p->>'home' is distinct from cfg.fixture->>'home'
  or p->>'away' is distinct from cfg.fixture->>'away' or p->>'kickoff_at' is distinct from cfg.fixture->>'kickoff_at'
  or p->>'opponent' is distinct from (case when cfg.team=cfg.fixture->>'home' then cfg.fixture->>'away' else cfg.fixture->>'home' end)
  or p->'matchday' is distinct from cfg.fixture->'matchday' or p->>'probability_kind' is distinct from 'editorial_uncalibrated'
  or p->'publication_allowed' is distinct from 'false'::jsonb or p->>'method_version' is distinct from 'editorial-v2'
  or not coalesce(p->>'status' in ('draft','blocked'),false) then raise exception 'Partido o alcance inválido' using errcode='22023'; end if;
 if jsonb_typeof(p->'limitations') is distinct from 'array' then raise exception 'Faltan limitaciones' using errcode='22023'; end if;
 select string_agg(value,' ') into note from jsonb_array_elements_text(p->'limitations');
 if length(btrim(coalesce(note,''))) not between 10 and 1200 then raise exception 'Limitaciones inválidas' using errcode='22023'; end if;
 if jsonb_typeof(p->'sources') is distinct from 'array' then raise exception 'Faltan fuentes' using errcode='22023'; end if;
 if jsonb_array_length(p->'sources')<>3 or (select count(distinct value->>'id') from jsonb_array_elements(p->'sources'))<>3 then raise exception 'Se exigen tres fuentes' using errcode='22023'; end if;
 for s in select value from jsonb_array_elements(p->'sources') loop
  if not coalesce(s->>'id' in ('futbolfantasy','jornadaperfecta','comuniate'),false) or (s->>'url' is distinct from cfg.source_urls->>(s->>'id') and not(s->>'id'='comuniate' and s->>'url'=cfg.fixture->'sources'->>'comuniate'))
   or not coalesce(s->>'status' in ('read','unavailable','stale','mismatch'),false)
   or s->>'fetched_at' is null or (s->>'fetched_at')::timestamptz not between now()-p_max_age and now()+interval '5 minutes'
   or not (s?'source_updated_at') then raise exception 'Fuente o fecha inválida' using errcode='22023'; end if;
  if s->'source_updated_at'<>'null'::jsonb then perform (s->>'source_updated_at')::timestamptz; end if;
  if s->>'status'='read' then
   if s->'fixture_verified' is distinct from 'true'::jsonb or s->'observed_fixture' is distinct from jsonb_build_object('key',cfg.fixture->>'key','home',cfg.fixture->>'home','away',cfg.fixture->>'away','matchday',cfg.fixture->'matchday','kickoff_at',cfg.fixture->>'kickoff_at')
    or jsonb_typeof(s->'starters') is distinct from 'array' or jsonb_typeof(s->'starter_ids') is distinct from 'array' or jsonb_typeof(s->'player_observations') is distinct from 'array' then raise exception 'Once de fuente incompleto' using errcode='22023'; end if;
   if jsonb_array_length(s->'starters')<>11 or (select count(distinct lower(btrim(value))) from jsonb_array_elements_text(s->'starters'))<>11
    or exists(select 1 from jsonb_array_elements_text(s->'starters') where length(btrim(value)) not between 1 and 120)
    or jsonb_array_length(s->'starter_ids')<>11 or (select count(distinct value) from jsonb_array_elements_text(s->'starter_ids'))<>11
    or exists(select 1 from jsonb_array_elements_text(s->'starter_ids') i where not exists(select 1 from forecast_league.roster r where r.id=i.value and r.team=cfg.team))
    or (select count(*) from jsonb_array_elements(s->'player_observations'))<>(select count(distinct value->>'player_id') from jsonb_array_elements(s->'player_observations')) then raise exception 'Identidades de fuente inválidas' using errcode='22023'; end if;
   for obs in select value from jsonb_array_elements(s->'player_observations') loop
    if not coalesce(obs->>'prediction' in ('starter','alternative','not_listed'),false)
     or not exists(select 1 from forecast_league.roster r where r.id=obs->>'player_id' and r.team=cfg.team)
     or ((obs->>'prediction'='starter') is distinct from (s->'starter_ids' ? (obs->>'player_id')))
     or (obs->'probability' is distinct from 'null'::jsonb and (jsonb_typeof(obs->'probability') is distinct from 'number' or coalesce(obs->>'probability','') !~ '^(100|[1-9]?[0-9])$')) then raise exception 'Observación inválida' using errcode='22023'; end if;
   end loop;
   if (select count(*) from jsonb_array_elements(s->'player_observations') observed where observed->>'prediction'='starter')<>11 then raise exception 'Once observado incompleto' using errcode='22023'; end if;
  else invalid_source:=true; end if;
  oldest:=least(oldest,(s->>'fetched_at')::timestamptz);
  source_result:=source_result||jsonb_build_array(jsonb_build_object('id',s->>'id','url',s->>'url','fetched_at',s->'fetched_at','source_updated_at',s->'source_updated_at'));
 end loop;
 if invalid_source or p->>'status'='blocked' then
  if p->>'status'<>'blocked' or p->'proposal' is distinct from 'null'::jsonb then raise exception 'Fuente incompleta exige blocked y proposal null' using errcode='22023'; end if;
  return null;
 end if;
 if not coalesce(p->'proposal'->>'formation' in ('4-2-3-1','4-4-2','4-3-3','3-5-2','5-3-2','3-4-3','3-4-2-1'),false)
  or jsonb_typeof(p->'proposal'->'players') is distinct from 'array' then raise exception 'Sistema o jugadores inválidos' using errcode='22023'; end if;
 if jsonb_array_length(p->'proposal'->'players')<>11 or (select count(distinct value->>'id') from jsonb_array_elements(p->'proposal'->'players'))<>11 or (select count(distinct value->>'slot') from jsonb_array_elements(p->'proposal'->'players'))<>11 then raise exception 'Se necesitan once puestos distintos' using errcode='22023'; end if;
 shape:=string_to_array(p->'proposal'->>'formation','-')::integer[];df:=shape[1];fw:=shape[array_length(shape,1)];
 horizon:=case when (p->>'kickoff_at')::timestamptz-oldest<=interval '48 hours' then 'near' when (p->>'kickoff_at')::timestamptz-oldest<=interval '120 hours' then 'medium' else 'distant' end;
 for x in select value from jsonb_array_elements(p->'proposal'->'players') order by (value->>'slot')::integer loop
  if jsonb_typeof(x->'slot') is distinct from 'number' or coalesce(x->>'slot','') !~ '^(1[01]|[1-9])$'
   or jsonb_typeof(x->'probability') is distinct from 'number' or coalesce(x->>'probability','') !~ '^(100|[1-9]?[0-9])$'
   or jsonb_typeof(x->'reason') is distinct from 'string' or length(btrim(coalesce(x->>'reason',''))) not between 10 and 800 then raise exception 'Jugador o motivo inválido' using errcode='22023'; end if;
  select name into person from forecast_league.roster where id=x->>'id' and team=cfg.team;
  if person is null then raise exception 'Jugador ajeno al equipo' using errcode='22023'; end if;
  slot:=(x->>'slot')::integer;pos:=case when slot=1 then 'GK' when slot<=1+df then 'DF' when slot>11-fw then 'FW' else 'MF' end;
  if x->>'position' is distinct from pos or x->'assessment'->>'method' is distinct from 'editorial-v2'
   or x->'assessment'->'horizon'->>'value' is distinct from horizon or forecast_publish.assess(x->'assessment') is distinct from (x->>'probability')::integer then raise exception 'Evaluación o posición inconsistente' using errcode='22023'; end if;
  for o in select value from jsonb_array_elements(x->'assessment'->'sources') loop
   select z into obs from jsonb_array_elements(p->'sources') s0,jsonb_array_elements(s0->'player_observations') z where s0->>'id'=o->>'id' and z->>'player_id'=x->>'id';
   if obs is null or obs->'prediction' is distinct from o->'prediction' or obs->'probability' is distinct from o->'probability' then raise exception 'Evaluación no coincide con la fuente' using errcode='22023'; end if;
  end loop;
  alt:=null;
  if (x->>'probability')::integer<70 then
   select name into alt from forecast_league.roster where id=x->'alternative'->>'id' and team=cfg.team;
   if alt is null or exists(select 1 from jsonb_array_elements(p->'proposal'->'players') q where q->>'id'=x->'alternative'->>'id') then raise exception 'Falta alternativa fuera del once' using errcode='22023'; end if;
  elsif x->'alternative' is distinct from 'null'::jsonb then raise exception 'Alternativa debe ser null desde 70' using errcode='22023'; end if;
  players:=players||jsonb_build_array(jsonb_build_object('id',x->>'id','name',person,'slot',slot,'position',pos,'probability',x->'probability','reason',x->>'reason','method','editorial-v2','alternative',case when alt is null then 'null'::jsonb else jsonb_build_object('id',x->'alternative'->>'id','name',alt) end));
 end loop;
 return jsonb_build_object('schema_version',3,'season','2026-27','fixture_key',cfg.fixture->>'key','team',cfg.team,'home',cfg.fixture->>'home','away',cfg.fixture->>'away','opponent',p->>'opponent','matchday',cfg.fixture->'matchday','kickoff_at',cfg.fixture->>'kickoff_at','formation',p->'proposal'->>'formation','probability_kind','editorial_uncalibrated','note',note,'evidence_at',oldest,'sources',source_result,'players',players);
end;
$body$;
-- END GENERATED VALIDATOR

create function forecast_season.check_attempt(p_run text,p_team text) returns text
language plpgsql stable security invoker set search_path='' as $body$
declare r forecast_season.runs%rowtype; p jsonb;
begin
 select * into r from forecast_season.runs where key=p_run;
 p:=forecast_season.plan();
 if not found or p_run is distinct from p->>'run_key' or not(r.expected ? p_team) then raise exception 'Turno o equipo no autorizado' using errcode='22023'; end if;
 if (select count(*) from forecast_season.attempts)>=20000 then raise exception 'Límite de intentos de temporada' using errcode='54000'; end if;
 return p_run||'-'||p_team;
end;
$body$;

create function forecast_season.save_draft(p_run text,p jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $body$
declare k text; projection jsonb; a forecast_season.attempts%rowtype;
begin
 perform 1 from forecast_season.control for update;
 k:=p_run||'-'||(p->>'team');select * into a from forecast_season.attempts where key=k;
 if found then
  if a.input_hash<>md5(p::text) then raise exception 'Turno ya guardado con otro contenido' using errcode='23505'; end if;
  return to_jsonb(a)||jsonb_build_object('already_saved',true);
 end if;
 k:=forecast_season.check_attempt(p_run,p->>'team');
 if p->>'status' is distinct from 'draft' then raise exception 'Usa block_team para registrar una lectura incompleta' using errcode='22023'; end if;
 if not exists(select 1 from forecast_season.fixtures f where f.key=p->>'fixture_key' and f.verified_at>=now()-interval '2 hours' and f.kickoff_at>now()) then raise exception 'Partido sin verificación reciente o iniciado' using errcode='22023'; end if;
 if exists(select 1 from forecast_season.fixtures f where p->>'team' in(f.home,f.away) and f.kickoff_at>now() and f.kickoff_at<(p->>'kickoff_at')::timestamptz) then raise exception 'Hay un partido anterior pendiente para el equipo' using errcode='22023'; end if;
 projection:=forecast_season.build_team(p);
 if projection is null then raise exception 'Lectura no publicable' using errcode='22023'; end if;
 update forecast_season.drafts set run_key=k,fixture_key=p->>'fixture_key',payload=p,projection=projection,checked_at=now(),outcome='saved',reason=null where team=p->>'team';
 insert into forecast_season.attempts(key,run_key,team,fixture_key,input_hash,outcome) values(k,p_run,p->>'team',p->>'fixture_key',md5(p::text),'saved');
 update public.forecast_season_public set checked_at=now(),status=case when status='withdrawn' then 'withdrawn' else 'pending' end,attempted_fixture_key=p->>'fixture_key' where team=p->>'team';
 update forecast_season.control set version=version+1;
 return jsonb_build_object('key',k,'outcome','saved','already_saved',false);
end;
$body$;

create function forecast_season.block_team(p_run text,p_team text,p_reason text,p_sources jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $body$
declare k text; s jsonb; a forecast_season.attempts%rowtype; input jsonb;
begin
 perform 1 from forecast_season.control for update;
 input:=jsonb_build_object('reason',p_reason,'sources',p_sources);k:=p_run||'-'||p_team;
 select * into a from forecast_season.attempts where key=k;
 if found then
  if a.input_hash<>md5(input::text) then raise exception 'Turno ya registrado' using errcode='23505'; end if;
  return to_jsonb(a)||jsonb_build_object('already_saved',true);
 end if;
 k:=forecast_season.check_attempt(p_run,p_team);
 if length(btrim(coalesce(p_reason,''))) not between 10 and 1200 or jsonb_typeof(p_sources) is distinct from 'array' or octet_length(p_sources::text)>8192 then raise exception 'Causa o comprobaciones inválidas' using errcode='22023'; end if;
 if jsonb_array_length(p_sources)<>3 or (select count(distinct value->>'id') from jsonb_array_elements(p_sources))<>3 then raise exception 'Registra el estado de las tres fuentes' using errcode='22023'; end if;
 for s in select value from jsonb_array_elements(p_sources) loop
  if not coalesce(s->>'id' in ('futbolfantasy','jornadaperfecta','comuniate'),false) or not coalesce(s->>'status' in ('read','unavailable','mismatch','stale','not_read'),false)
   or (s->>'url' is not null and not forecast_season.source_url(s->>'id',s->>'url'))
   or (s->>'status'='not_read' and s->>'fetched_at' is not null)
   or (s->>'status'<>'not_read' and (s->>'url' is null or s->>'fetched_at' is null or (s->>'fetched_at')::timestamptz not between now()-interval '2 hours' and now()+interval '5 minutes')) then raise exception 'Comprobación de fuente inválida' using errcode='22023'; end if;
 end loop;
 update forecast_season.drafts set run_key=k,fixture_key=null,payload=input,projection=null,checked_at=now(),outcome='blocked',reason=p_reason where team=p_team;
 insert into forecast_season.attempts(key,run_key,team,input_hash,outcome,reason) values(k,p_run,p_team,md5(input::text),'blocked',p_reason);
 update public.forecast_season_public set checked_at=now(),status=case when status='withdrawn' then 'withdrawn' else 'blocked' end where team=p_team;
 update forecast_season.control set version=version+1;
 return jsonb_build_object('key',k,'outcome','blocked','reason',p_reason);
end;
$body$;

create function forecast_season.publish_team(p_team text,p_age interval,p_manual boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $body$
declare d forecast_season.drafts%rowtype; projection jsonb; horizon text; source_xi jsonb;
begin
 select * into d from forecast_season.drafts where team=p_team;
 if d.team is null or d.projection is null or d.outcome not in ('saved','ready','published') or (d.paused and not p_manual) then raise exception 'No hay lectura lista para publicar' using errcode='22023'; end if;
 projection:=forecast_season.build_team(d.payload,p_age);
 if projection is null or not exists(select 1 from forecast_season.fixtures f where f.key=d.fixture_key and f.kickoff_at>now()) then raise exception 'Partido iniciado o lectura inválida' using errcode='22023'; end if;
 if (projection->>'evidence_at')::timestamptz<now()-p_age then raise exception 'Lectura caducada' using errcode='22023'; end if;
 if exists(select 1 from forecast_season.fixtures f where p_team in(f.home,f.away) and f.kickoff_at>now() and f.kickoff_at<(projection->>'kickoff_at')::timestamptz) then raise exception 'Existe un partido anterior del equipo' using errcode='22023'; end if;
 if exists(select 1 from public.forecast_season_public where team=p_team and payload=projection and status='published') then return jsonb_build_object('team',p_team,'outcome','unchanged'); end if;
 update public.forecast_season_public set payload=projection,published_at=now(),checked_at=d.checked_at,status='published',attempted_fixture_key=d.fixture_key where team=p_team;
 update forecast_season.drafts set outcome='published',paused=false where team=p_team;
 update forecast_season.attempts set outcome='published',published_at=now() where key=d.run_key;
 horizon:=case when (projection->>'kickoff_at')::timestamptz-now()<=interval '6 hours' then 'matchday' when (projection->>'kickoff_at')::timestamptz-now()<=interval '48 hours' then 'near' when (projection->>'kickoff_at')::timestamptz-now()<=interval '120 hours' then 'medium' else 'distant' end;
 select jsonb_agg(jsonb_build_object('id',s->>'id','url',s->>'url','fetched_at',s->'fetched_at','starter_ids',s->'starter_ids','player_observations',s->'player_observations')) into source_xi from jsonb_array_elements(d.payload->'sources') s;
 insert into forecast_season.archive(fixture_key,team,horizon,published_at,projection,source_starters) values(d.fixture_key,p_team,horizon,now(),projection,source_xi)
 on conflict(fixture_key,team,horizon) do update set published_at=excluded.published_at,projection=excluded.projection,source_starters=excluded.source_starters;
 return jsonb_build_object('team',p_team,'outcome','published','published_at',now(),'fixture_key',d.fixture_key);
end;
$body$;

create function forecast_season.deliver(p_key text) returns jsonb
language plpgsql security invoker set search_path='' as $body$
declare a forecast_season.attempts%rowtype; d forecast_season.drafts%rowtype; mode_now text; result jsonb;
begin
 select mode into mode_now from forecast_season.control for update;
 select * into a from forecast_season.attempts where key=p_key;
 if not found then raise exception 'Lectura no encontrada' using errcode='22023'; end if;
 if a.outcome<>'saved' then return to_jsonb(a)||jsonb_build_object('already_delivered',true); end if;
 select * into d from forecast_season.drafts where run_key=p_key;
 if not found then raise exception 'Existe una lectura posterior' using errcode='40001'; end if;
 if mode_now='manual' or d.paused then
  update forecast_season.drafts set outcome='ready' where team=d.team;
  update forecast_season.attempts set outcome='ready' where key=p_key;
  update public.forecast_season_public set status=case when d.paused then 'withdrawn' else 'ready' end where team=d.team;
  result:=jsonb_build_object('team',d.team,'outcome','ready');
 else
  begin result:=forecast_season.publish_team(d.team,interval '2 hours');
  exception when sqlstate '22023' then
   update forecast_season.drafts set outcome='blocked',reason=sqlerrm where team=d.team;
   update forecast_season.attempts set outcome='blocked',reason=sqlerrm where key=p_key;
   update public.forecast_season_public set status='blocked' where team=d.team;
   result:=jsonb_build_object('team',d.team,'outcome','blocked','reason',sqlerrm);
  end;
 end if;
 update forecast_season.control set version=version+1;
 return result||jsonb_build_object('key',p_key);
end;
$body$;

create function forecast_season.finish_run(p_key text) returns jsonb
language plpgsql security invoker set search_path='' as $body$
declare r forecast_season.runs%rowtype; summary jsonb; complete_count integer;
begin
 perform 1 from forecast_season.control for update;
 select * into r from forecast_season.runs where key=p_key;
 if not found then raise exception 'Ejecución no encontrada' using errcode='22023'; end if;
 select count(*) filter(where outcome in ('published','ready','blocked')),jsonb_build_object('published',count(*) filter(where outcome='published'),'ready',count(*) filter(where outcome='ready'),'blocked',count(*) filter(where outcome='blocked'),'saved_without_delivery',count(*) filter(where outcome='saved')) into complete_count,summary from forecast_season.attempts where run_key=p_key;
 update forecast_season.runs set finished_at=coalesce(finished_at,now()) where key=p_key;
 return summary||jsonb_build_object('run_key',p_key,'expected',jsonb_array_length(r.expected),'completed',complete_count,'missing',jsonb_array_length(r.expected)-complete_count,'complete',complete_count=jsonb_array_length(r.expected));
end;
$body$;

create function private.get_forecast_season() returns jsonb
language plpgsql stable security definer set search_path='' as $body$
declare result jsonb;
begin
 if (select auth.uid()) is null or not coalesce(private.is_league_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 select jsonb_build_object('mode',mode,'version',version,'schedule_timezone','America/New_York','season','2026-27') into result from forecast_season.control;
 return result||jsonb_build_object('last_run',(select to_jsonb(r)||jsonb_build_object('results',coalesce((select jsonb_agg(jsonb_build_object('team',a.team,'outcome',a.outcome)) from forecast_season.attempts a where a.run_key=r.key),'[]'::jsonb)) from forecast_season.runs r order by slot_at desc limit 1),'teams',(select jsonb_agg(jsonb_build_object('team',d.team,'paused',d.paused,'outcome',d.outcome,'reason',d.reason,'checked_at',d.checked_at,'fixture_key',d.fixture_key,'preview',d.projection,'published_at',p.published_at,'public_status',p.status,'ready',d.outcome='ready' and d.projection is not null and (d.projection->>'evidence_at')::timestamptz>=now()-interval '24 hours' and (d.projection->>'kickoff_at')::timestamptz>now()) order by d.team) from forecast_season.drafts d join public.forecast_season_public p using(team)));
end;
$body$;

create function private.command_forecast_season(p_action text,p_expected_version bigint,p_request_id uuid,p_team text default null) returns jsonb
language plpgsql security definer set search_path='' as $body$
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
$body$;
create function public.get_forecast_season() returns jsonb language sql stable security invoker set search_path='' as $body$ select private.get_forecast_season(); $body$;
create function public.command_forecast_season(p_action text,p_expected_version bigint,p_request_id uuid,p_team text default null) returns jsonb language sql security invoker set search_path='' as $body$ select private.command_forecast_season(p_action,p_expected_version,p_request_id,p_team); $body$;
revoke all on all functions in schema forecast_season from public,anon,authenticated,service_role;
revoke all on function private.get_forecast_season(),private.command_forecast_season(text,bigint,uuid,text),public.get_forecast_season(),public.command_forecast_season(text,bigint,uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.get_forecast_season(),private.command_forecast_season(text,bigint,uuid,text),public.get_forecast_season(),public.command_forecast_season(text,bigint,uuid,text) to authenticated;
notify pgrst,'reload schema';
