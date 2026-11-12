-- LaLiga 2026/27 J13-J38: immutable forecasts and verified actual starting XIs.
-- Additive migration. Existing prediction functions, rows and privileges remain unchanged.
-- Fail atomically if an existing publication, catalog row, mode or permission changes.
create temporary table history_protected_before on commit drop as select jsonb_build_object(
 'public',(select md5(string_agg(to_jsonb(t)::text,',' order by team)) from public.forecast_season_public t),
 'runs',(select md5(string_agg(to_jsonb(t)::text,',' order by key)) from forecast_season.runs t),
 'attempts',(select md5(string_agg(to_jsonb(t)::text,',' order by key)) from forecast_season.attempts t),
 'drafts',(select md5(string_agg(to_jsonb(t)::text,',' order by team)) from forecast_season.drafts t),
 'fixtures',(select md5(string_agg(to_jsonb(t)::text,',' order by key)) from forecast_season.fixtures t),
 'archive',(select md5(string_agg(to_jsonb(t)::text,',' order by fixture_key,team,horizon)) from forecast_season.archive t),
 'roster',(select md5(string_agg(to_jsonb(t)::text,',' order by team,id)) from forecast_league.roster t),
 'control',(select to_jsonb(t) from forecast_season.control t),
 'functions',(select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),',' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('forecast_season','forecast_publish')),
 'permissions',(select jsonb_agg(jsonb_build_object('oid',c.oid,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity) order by c.oid) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and(n.nspname in('forecast_season','forecast_league') or(n.nspname='public' and c.relname='forecast_season_public')))
) as state;

create schema forecast_history;
revoke all on schema forecast_history from public,anon,authenticated,service_role;

create table forecast_history.snapshots(
 id text primary key, fixture_key text not null references forecast_season.fixtures(key),
 team text not null references forecast_league.teams(team), published_at timestamptz not null,
 projection jsonb not null, source_starters jsonb not null,
 check(octet_length(projection::text)<=65536), check(octet_length(source_starters::text)<=65536)
);
create index history_snapshot_lookup on forecast_history.snapshots(fixture_key,team,published_at desc);
create table forecast_history.records(
 fixture_key text not null references forecast_season.fixtures(key),team text not null references forecast_league.teams(team),
 version bigint not null default 1, result jsonb not null, official jsonb,
 input_hash text, attempted_at timestamptz, next_check_at timestamptz,
 outcome text not null default 'ready' check(outcome in('ready','published')),
 reason text, started boolean not null default false,suppressed boolean not null default false,
 primary key(fixture_key,team),check(octet_length(result::text)<=65536),check(octet_length(official::text)<=16384)
);
create index history_due_lookup on forecast_history.records(next_check_at) where outcome='ready' or not started;
create table forecast_history.official_evidence(
 input_hash text primary key,fixture_key text not null,team text not null, fetched_at timestamptz not null,
 evidence jsonb not null,check(octet_length(evidence::text)<=16384),
 foreign key(fixture_key,team) references forecast_history.records(fixture_key,team)
);
create index history_evidence_lookup on forecast_history.official_evidence(fixture_key,team,fetched_at desc);
create table forecast_history.commands(request_id uuid primary key,request jsonb not null,result jsonb not null,created_at timestamptz not null default now());
create table public.forecast_history_public(
 fixture_key text not null,team text not null,season text not null check(season='2026-27'),
 matchday integer not null check(matchday between 13 and 38),home text not null,away text not null,
 kickoff_at timestamptz not null,prediction jsonb,prediction_published_at timestamptz,cutoff_at timestamptz not null,
 status text not null check(status in('pending','evaluated','no_prediction')),
 official_starters jsonb not null default '[]',correct_ids jsonb not null default '[]',missed_ids jsonb not null default '[]',
 unexpected_starters jsonb not null default '[]',hits integer check(hits between 0 and 11),
 verification_stage text check(verification_stage in('initial','final')),verified_at timestamptz,
 source_url text,source_updated_at timestamptz,published_at timestamptz not null default now(),visible boolean not null default true,
 primary key(fixture_key,team),foreign key(fixture_key,team) references forecast_history.records(fixture_key,team),
 check((status='evaluated')=(hits is not null)),check(jsonb_typeof(official_starters)='array'),
 check(status<>'evaluated' or(jsonb_array_length(official_starters)=11 and jsonb_array_length(correct_ids)=hits and jsonb_array_length(missed_ids)=11-hits))
);
create index history_public_round on public.forecast_history_public(matchday,team) where visible;
alter table forecast_history.snapshots enable row level security;
alter table forecast_history.records enable row level security;
alter table forecast_history.official_evidence enable row level security;
alter table forecast_history.commands enable row level security;
alter table public.forecast_history_public enable row level security;
revoke all on all tables in schema forecast_history from public,anon,authenticated,service_role;
revoke all on public.forecast_history_public from public,anon,authenticated,service_role;
grant select on public.forecast_history_public to anon,authenticated;
create policy visible_history_read on public.forecast_history_public for select to anon,authenticated using(visible);

create function forecast_history.immutable_row() returns trigger language plpgsql security invoker set search_path='' as $body$
begin raise exception 'Historical evidence is immutable' using errcode='22023'; end;
$body$;
create trigger history_snapshot_immutable before update or delete on forecast_history.snapshots for each row execute function forecast_history.immutable_row();
create trigger history_evidence_immutable before update or delete on forecast_history.official_evidence for each row execute function forecast_history.immutable_row();

create function forecast_history.build_result(p_fixture text,p_team text,p_official jsonb default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $body$
declare f forecast_season.fixtures%rowtype; s forecast_history.snapshots%rowtype; cutoff timestamptz;
 xi jsonb:='[]'; correct jsonb:='[]'; missed jsonb:='[]'; unexpected jsonb:='[]'; count_hits integer;
begin
 select * into f from forecast_season.fixtures where key=p_fixture;
 if not found or f.season<>'2026-27' or f.matchday not between 13 and 38 or p_team not in(f.home,f.away) then raise exception 'Partido o equipo fuera del historial autorizado' using errcode='22023';end if;
 cutoff:=f.kickoff_at-interval '2 hours';
 if p_official#>>'{source,announced_at}' is not null then cutoff:=least(cutoff,(p_official#>>'{source,announced_at}')::timestamptz);end if;
 -- Never forget an earlier verified release when a later page omits its timestamp.
 select least(cutoff,min((e.evidence#>>'{source,announced_at}')::timestamptz)) into cutoff
 from forecast_history.official_evidence e where e.fixture_key=p_fixture and e.team=p_team
  and(e.evidence#>>'{observed_fixture,kickoff_at}')::timestamptz=f.kickoff_at;
 select * into s from forecast_history.snapshots where fixture_key=p_fixture and team=p_team and published_at<=least(now(),cutoff)
  and (projection->>'kickoff_at')::timestamptz=f.kickoff_at
  and jsonb_typeof(projection->'sources')='array'
  and not exists(select 1 from jsonb_array_elements(projection->'sources') x where x->>'fetched_at' is null or(x->>'fetched_at')::timestamptz>cutoff)
  order by published_at desc,id desc limit 1;
 if p_official is not null then
  xi:=p_official->'starters';
  if s.id is not null then
   select coalesce(jsonb_agg(x->>'id' order by (x->>'slot')::integer),'[]') into correct from jsonb_array_elements(s.projection->'players') x where exists(select 1 from jsonb_array_elements(xi) y where y->>'id'=x->>'id');
   select coalesce(jsonb_agg(x->>'id' order by (x->>'slot')::integer),'[]') into missed from jsonb_array_elements(s.projection->'players') x where not exists(select 1 from jsonb_array_elements(xi) y where y->>'id'=x->>'id');
   select coalesce(jsonb_agg(x order by x->>'id'),'[]') into unexpected from jsonb_array_elements(xi) x where not exists(select 1 from jsonb_array_elements(s.projection->'players') y where y->>'id'=x->>'id');
   count_hits:=jsonb_array_length(correct);
  end if;
 end if;
 return jsonb_build_object('fixture_key',f.key,'team',p_team,'season',f.season,'matchday',f.matchday,'home',f.home,'away',f.away,'kickoff_at',f.kickoff_at,
  'prediction',s.projection,'prediction_published_at',s.published_at,'cutoff_at',cutoff,
  'status',case when p_official is null then 'pending' when s.id is null then 'no_prediction' else 'evaluated' end,
  'official_starters',xi,'correct_ids',correct,'missed_ids',missed,'unexpected_starters',unexpected,'hits',count_hits,
  'verification_stage',case when p_official is null then null when p_official->>'match_state'='finished' then 'final' else 'initial' end,
  'verified_at',(p_official#>>'{source,fetched_at}')::timestamptz,'source_url',p_official#>>'{source,url}','source_updated_at',(p_official#>>'{source,source_updated_at}')::timestamptz);
end;
$body$;

create function forecast_history.deliver(p_fixture text,p_team text,p_manual boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $body$
declare r forecast_history.records%rowtype; mode_now text; paused_now boolean; x jsonb;
begin
 select mode into mode_now from forecast_season.control for update;
 select paused into paused_now from forecast_season.drafts where team=p_team;
 select * into r from forecast_history.records where fixture_key=p_fixture and team=p_team for update;
 if not found then raise exception 'Resultado historico inexistente' using errcode='22023';end if;
 if coalesce(paused_now,true) or(not p_manual and(mode_now='manual' or r.suppressed)) then return jsonb_build_object('fixture_key',p_fixture,'team',p_team,'outcome','ready','paused',paused_now);end if;
 x:=r.result;
 if r.outcome='published' and exists(select 1 from public.forecast_history_public h where h.fixture_key=p_fixture and h.team=p_team and h.visible) then
  update forecast_history.records set outcome='published' where fixture_key=p_fixture and team=p_team;
  return jsonb_build_object('fixture_key',p_fixture,'team',p_team,'outcome','unchanged');
 end if;
 insert into public.forecast_history_public(fixture_key,team,season,matchday,home,away,kickoff_at,prediction,prediction_published_at,cutoff_at,status,official_starters,correct_ids,missed_ids,unexpected_starters,hits,verification_stage,verified_at,source_url,source_updated_at,published_at,visible)
 values(p_fixture,p_team,x->>'season',(x->>'matchday')::integer,x->>'home',x->>'away',(x->>'kickoff_at')::timestamptz,nullif(x->'prediction','null'),(x->>'prediction_published_at')::timestamptz,(x->>'cutoff_at')::timestamptz,x->>'status',x->'official_starters',x->'correct_ids',x->'missed_ids',x->'unexpected_starters',(x->>'hits')::integer,x->>'verification_stage',(x->>'verified_at')::timestamptz,x->>'source_url',(x->>'source_updated_at')::timestamptz,now(),true)
 on conflict(fixture_key,team) do update set season=excluded.season,matchday=excluded.matchday,home=excluded.home,away=excluded.away,kickoff_at=excluded.kickoff_at,prediction=excluded.prediction,prediction_published_at=excluded.prediction_published_at,cutoff_at=excluded.cutoff_at,status=excluded.status,official_starters=excluded.official_starters,correct_ids=excluded.correct_ids,missed_ids=excluded.missed_ids,unexpected_starters=excluded.unexpected_starters,hits=excluded.hits,verification_stage=excluded.verification_stage,verified_at=excluded.verified_at,source_url=excluded.source_url,source_updated_at=excluded.source_updated_at,published_at=excluded.published_at,visible=true;
 update forecast_history.records set outcome='published',suppressed=false where fixture_key=p_fixture and team=p_team;
 return jsonb_build_object('fixture_key',p_fixture,'team',p_team,'outcome','published','status',x->>'status','hits',x->'hits');
end;
$body$;

create function forecast_history.capture_snapshot(p_fixture text,p_team text,p_published timestamptz,p_projection jsonb,p_sources jsonb) returns void
language plpgsql security invoker set search_path='' as $body$
declare hash text; result_now jsonb; old forecast_history.records%rowtype;
begin
 if p_projection->>'fixture_key' is distinct from p_fixture or p_projection->>'team' is distinct from p_team
  or p_published is null or p_published>now()+interval '5 minutes' or jsonb_typeof(p_projection->'players') is distinct from 'array' then raise exception 'Publicacion historica invalida' using errcode='22023';end if;
 if jsonb_array_length(p_projection->'players')<>11 or(select count(distinct x->>'id') from jsonb_array_elements(p_projection->'players') x)<>11 then raise exception 'Once historico incompleto' using errcode='22023';end if;
 hash:=md5(jsonb_build_array(p_fixture,p_team,extract(epoch from p_published),p_projection)::text);
 if (select count(*) from forecast_history.snapshots)>=25000 and not exists(select 1 from forecast_history.snapshots where id=hash) then raise exception 'Limite de archivo de temporada' using errcode='54000';end if;
 insert into forecast_history.snapshots(id,fixture_key,team,published_at,projection,source_starters) values(hash,p_fixture,p_team,p_published,p_projection,p_sources) on conflict do nothing;
 select * into old from forecast_history.records where fixture_key=p_fixture and team=p_team for update;
 -- Capturing another forecast never replaces a comparison after the match started.
 if old.started then return;end if;
 result_now:=forecast_history.build_result(p_fixture,p_team);
 if old.result is not distinct from result_now then return;end if;
 insert into forecast_history.records(fixture_key,team,result) values(p_fixture,p_team,result_now)
 on conflict(fixture_key,team) do update set result=excluded.result,version=forecast_history.records.version+1,outcome='ready',suppressed=false;
 perform forecast_history.deliver(p_fixture,p_team);
end;
$body$;

create function forecast_history.capture_archive() returns trigger language plpgsql security invoker set search_path='' as $body$
begin
 perform forecast_history.capture_snapshot(new.fixture_key,new.team,new.published_at,new.projection,new.source_starters);
 return new;
end;
$body$;
create trigger history_archive_capture after insert or update on forecast_season.archive for each row execute function forecast_history.capture_archive();

create function forecast_history.withdraw_team() returns trigger language plpgsql security invoker set search_path='' as $body$
begin
 if new.paused and new.paused is distinct from old.paused then
  update public.forecast_history_public set visible=false where team=new.team;
  update forecast_history.records set outcome='ready',suppressed=true,version=version+1 where team=new.team;
 end if;
 return new;
end;
$body$;
create trigger history_withdraw_team after update of paused on forecast_season.drafts for each row execute function forecast_history.withdraw_team();

create function forecast_history.fixture_changed() returns trigger language plpgsql security invoker set search_path='' as $body$
declare t text; result_now jsonb;
begin
 if new.kickoff_at is not distinct from old.kickoff_at then return new;end if;
 if exists(select 1 from forecast_history.records where fixture_key=new.key and started) then raise exception 'Un encuentro comenzado no puede reabrir el pronostico' using errcode='22023';end if;
 for t in select unnest(array[new.home,new.away]) loop
  result_now:=forecast_history.build_result(new.key,t);
  insert into forecast_history.records(fixture_key,team,result) values(new.key,t,result_now)
  on conflict(fixture_key,team) do update set result=excluded.result,official=null,input_hash=null,attempted_at=null,next_check_at=null,reason='Horario verificado modificado; pendiente de lectura',outcome='ready',version=forecast_history.records.version+1;
  -- Old kickoff and pending snapshots must not remain visible after postponement.
  update public.forecast_history_public set visible=false where fixture_key=new.key and team=t;
  perform forecast_history.deliver(new.key,t);
 end loop;
 return new;
end;
$body$;
create trigger history_fixture_changed after update of kickoff_at on forecast_season.fixtures for each row execute function forecast_history.fixture_changed();

create function forecast_history.plan() returns jsonb language sql stable security invoker set search_path='' as $body$
 with due as(
  select f.key,f.season,f.matchday,f.home,f.away,f.kickoff_at,f.source_urls->>'futbolfantasy' as source_url,t.team,
   d.paused,r.result->>'verification_stage' as previous_stage,r.attempted_at,r.reason
  from forecast_season.fixtures f cross join lateral unnest(array[f.home,f.away]) t(team)
  join forecast_season.drafts d on d.team=t.team
  left join forecast_history.records r on r.fixture_key=f.key and r.team=t.team
  where now()>=timestamptz '2026-11-12 14:00Z' and now()<timestamptz '2027-07-01 04:00Z'
   and f.season='2026-27' and f.matchday between 13 and 38 and f.kickoff_at<=now() and not d.paused
   and not coalesce(r.suppressed,false) and coalesce(r.result->>'verification_stage','')<>'final' and coalesce(r.next_check_at,'-infinity'::timestamptz)<=now()
 ), fixture_ids as(select key,min(attempted_at) as attempted from due group by key order by min(attempted_at) nulls first,min(kickoff_at),key limit 10),
 items as(select d.key as fixture_key,d.season,d.matchday,d.home,d.away,d.kickoff_at,d.source_url,
  jsonb_agg(jsonb_build_object('team',d.team,'paused',d.paused,'previous_stage',d.previous_stage,'last_attempt_at',d.attempted_at,'reason',d.reason) order by d.team) as teams
  from due d join fixture_ids i using(key) group by d.key,d.season,d.matchday,d.home,d.away,d.kickoff_at,d.source_url)
 select jsonb_build_object('observed_at',now(),'mode',(select mode from forecast_season.control),'fixtures',coalesce((select jsonb_agg(to_jsonb(i) order by kickoff_at,fixture_key) from items i),'[]'::jsonb),
  'deliveries',coalesce((select jsonb_agg(jsonb_build_object('fixture_key',r.fixture_key,'team',r.team,'version',r.version) order by r.fixture_key,r.team)
   from forecast_history.records r join forecast_season.drafts d using(team)
   where r.outcome='ready' and not r.suppressed and not d.paused and(select mode from forecast_season.control)='automatic'
    and now()<timestamptz '2027-07-01 04:00Z'),'[]'::jsonb));
$body$;

create function forecast_history.save_official(p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $body$
declare f forecast_season.fixtures%rowtype; old forecast_history.records%rowtype; source jsonb; x jsonb; canonical jsonb:='[]';
 observed jsonb; team_now text; fetched timestamptz; announced timestamptz; source_updated timestamptz; hash text; result_now jsonb; rname text;
begin
 perform 1 from forecast_season.control for update;
 if now()>=timestamptz '2027-07-01 04:00Z' or octet_length(p::text)>16384 then raise exception 'Fuera del alcance del historial' using errcode='22023';end if;
 source:=p->'source';team_now:=p->>'team';
 select * into f from forecast_season.fixtures where key=p#>>'{observed_fixture,key}';
 if not found or f.season<>'2026-27' or f.matchday not between 13 and 38 or team_now is null or team_now not in(f.home,f.away) then raise exception 'Identidad de partido o club incorrecta' using errcode='22023';end if;
 observed:=jsonb_build_object('key',f.key,'season',f.season,'home',f.home,'away',f.away,'matchday',f.matchday,'kickoff_at',to_char(f.kickoff_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
 if p->'observed_fixture' is distinct from observed or f.kickoff_at>now() then raise exception 'Partido futuro o calendario discordante' using errcode='22023';end if;
 if source->>'id' is distinct from 'futbolfantasy' or source->>'url' is distinct from f.source_urls->>'futbolfantasy'
  or not coalesce(source->>'url' ~ '^https://www\.futbolfantasy\.com/partidos/[a-zA-Z0-9_-]+$',false)
  or source->'confirmed' is distinct from 'true'::jsonb or not coalesce(p->>'match_state' in('in_progress','finished'),false)
  or source->>'fetched_at' is null or jsonb_typeof(p->'starters') is distinct from 'array' then raise exception 'Falta un once confirmado verificable de FutbolFantasy' using errcode='22023';end if;
 fetched:=(source->>'fetched_at')::timestamptz;announced:=(source->>'announced_at')::timestamptz;source_updated:=(source->>'source_updated_at')::timestamptz;
 if fetched not between greatest(now()-interval '2 hours',f.kickoff_at) and now()+interval '5 minutes'
  or (announced is not null and(announced>fetched or announced<f.kickoff_at-interval '24 hours'))
  or(source_updated is not null and source_updated>fetched+interval '5 minutes')
  or(p->>'match_state'='finished' and fetched<f.kickoff_at+interval '90 minutes') then raise exception 'Fechas de verificacion invalidas' using errcode='22023';end if;
 if jsonb_array_length(p->'starters')<>11 or(select count(distinct candidate->>'id') from jsonb_array_elements(p->'starters') candidate)<>11 then raise exception 'Se requieren once titulares distintos' using errcode='22023';end if;
 for x in select value from jsonb_array_elements(p->'starters') loop
  select name into rname from forecast_league.roster where team=team_now and id=x->>'id';
  if not found or x->>'name' is distinct from rname then raise exception 'Titular sin identidad exacta en el catalogo autorizado' using errcode='22023';end if;
  canonical:=canonical||jsonb_build_array(jsonb_build_object('id',x->>'id','name',rname));
 end loop;
 select jsonb_agg(candidate order by candidate->>'id') into canonical from jsonb_array_elements(canonical) candidate;
 p:=jsonb_build_object('team',team_now,'match_state',p->>'match_state','observed_fixture',observed,'starters',canonical,
  'source',jsonb_build_object('id','futbolfantasy','url',source->>'url',
   'fetched_at',to_char(fetched at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'source_updated_at',to_char(source_updated at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'confirmed',true,
   'announced_at',to_char(announced at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
 hash:=md5(p::text);
 select * into old from forecast_history.records where fixture_key=f.key and team=team_now for update;
 if old.input_hash=hash or exists(select 1 from forecast_history.official_evidence where input_hash=hash) then return jsonb_build_object('fixture_key',f.key,'team',team_now,'outcome',old.outcome,'already_saved',true,'version',old.version);end if;
 if old.official is not null and fetched<=(old.official#>>'{source,fetched_at}')::timestamptz then raise exception 'Lectura oficial anterior o conflictiva' using errcode='40001';end if;
 if old.result->>'verification_stage'='final' and p->>'match_state'<>'finished' then raise exception 'Un resultado final no vuelve a provisional' using errcode='22023';end if;
 if(select count(*) from forecast_history.official_evidence)>=5000 then raise exception 'Limite de verificaciones oficiales' using errcode='54000';end if;
 result_now:=forecast_history.build_result(f.key,team_now,p);
 insert into forecast_history.records(fixture_key,team,result,official,input_hash,attempted_at,next_check_at,started,suppressed)
 values(f.key,team_now,result_now,p,hash,fetched,case when p->>'match_state'='finished' then null else greatest(now()+interval '1 hour',f.kickoff_at+interval '150 minutes') end,true,(select paused from forecast_season.drafts where team=team_now))
 on conflict(fixture_key,team) do update set result=excluded.result,official=excluded.official,input_hash=excluded.input_hash,attempted_at=excluded.attempted_at,next_check_at=excluded.next_check_at,started=true,reason=null,outcome='ready',suppressed=forecast_history.records.suppressed or excluded.suppressed,version=forecast_history.records.version+1;
 insert into forecast_history.official_evidence(input_hash,fixture_key,team,fetched_at,evidence) values(hash,f.key,team_now,fetched,p) on conflict do nothing;
 return jsonb_build_object('fixture_key',f.key,'team',team_now,'outcome','ready','already_saved',false,'status',result_now->>'status','hits',result_now->'hits','version',(select version from forecast_history.records where fixture_key=f.key and team=team_now));
end;
$body$;

create function forecast_history.record_failure(p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $body$
declare f forecast_season.fixtures%rowtype; old forecast_history.records%rowtype; fetched timestamptz; t text; result_now jsonb;
begin
 perform 1 from forecast_season.control for update;
 t:=p->>'team';select * into f from forecast_season.fixtures where key=p->>'fixture_key';
 if now()>=timestamptz '2027-07-01 04:00Z' or not found or t is null or t not in(f.home,f.away) or f.kickoff_at>now()
  or octet_length(p::text)>4096 or p->>'url' is distinct from f.source_urls->>'futbolfantasy'
  or not coalesce(p->>'status' in('unavailable','mismatch','pending','postponed'),false)
  or length(coalesce(p->>'reason','')) not between 10 and 500 or p->>'fetched_at' is null then raise exception 'Comprobacion pendiente invalida' using errcode='22023';end if;
 fetched:=(p->>'fetched_at')::timestamptz;
 if fetched not between now()-interval '2 hours' and now()+interval '5 minutes' then raise exception 'Fecha de consulta invalida' using errcode='22023';end if;
 select * into old from forecast_history.records where fixture_key=f.key and team=t for update;
 if old.result->>'verification_stage'='final' then return jsonb_build_object('fixture_key',f.key,'team',t,'outcome',old.outcome,'already_final',true);end if;
 if old.attempted_at is not null and fetched<=old.attempted_at then return jsonb_build_object('fixture_key',f.key,'team',t,'outcome','pending','already_checked',true);end if;
 result_now:=coalesce(old.result,forecast_history.build_result(f.key,t));
 insert into forecast_history.records(fixture_key,team,result,attempted_at,next_check_at,reason)
 values(f.key,t,result_now,fetched,now()+interval '1 hour',p->>'reason')
 on conflict(fixture_key,team) do update set attempted_at=excluded.attempted_at,next_check_at=excluded.next_check_at,reason=excluded.reason;
 -- Preserve a previously published evaluation when a later read fails.
 if old.result is null then perform forecast_history.deliver(f.key,t);end if;
 return jsonb_build_object('fixture_key',f.key,'team',t,'outcome','pending','reason',p->>'reason');
end;
$body$;

create function private.get_forecast_history_admin() returns jsonb language plpgsql stable security definer set search_path='' as $body$
begin
 if(select auth.uid()) is null or not coalesce(private.is_league_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 return jsonb_build_object('mode',(select mode from forecast_season.control),
  'ready',coalesce((select jsonb_agg(jsonb_build_object('fixture_key',r.fixture_key,'team',r.team,'matchday',r.result->'matchday','version',r.version,'hits',r.result->'hits','verification_stage',r.result->'verification_stage') order by r.result->>'kickoff_at',r.team) from forecast_history.records r join forecast_season.drafts d using(team) where r.outcome='ready' and r.official is not null and not d.paused),'[]'::jsonb),
  'pending_count',(select count(*) from forecast_history.records where official is null and(result->>'kickoff_at')::timestamptz<=now()));
end;
$body$;
create function private.publish_forecast_history(p_expected jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $body$
declare req jsonb; previous forecast_history.commands%rowtype; item jsonb; r forecast_history.records%rowtype; results jsonb:='[]';
begin
 if(select auth.uid()) is null or not coalesce(private.is_league_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 if p_request_id is null or jsonb_typeof(p_expected) is distinct from 'array' or octet_length(p_expected::text)>65536 then raise exception 'Solicitud de publicacion invalida' using errcode='22023';end if;
 if jsonb_array_length(p_expected) not between 1 and 520 or(select count(distinct(x->>'fixture_key',x->>'team')) from jsonb_array_elements(p_expected) x)<>jsonb_array_length(p_expected) then raise exception 'Seleccion de resultados invalida' using errcode='22023';end if;
 perform 1 from forecast_season.control for update;
 req:=jsonb_build_object('actor',(select auth.uid()),'expected',p_expected);
 select * into previous from forecast_history.commands where request_id=p_request_id;
 if found then
  if previous.request is distinct from req then raise exception 'Solicitud reutilizada con otro contenido' using errcode='23505';end if;
  return previous.result;
 end if;
 if(select count(*) from forecast_history.commands)>=5000 then raise exception 'Limite de comandos del historial' using errcode='54000';end if;
 for item in select value from jsonb_array_elements(p_expected) loop
  select * into r from forecast_history.records where fixture_key=item->>'fixture_key' and team=item->>'team' for update;
  if not found or r.version::text is distinct from item->>'version' or r.outcome<>'ready' or r.official is null or exists(select 1 from forecast_season.drafts where team=r.team and paused) then raise exception 'El historial cambio; actualiza antes de publicar' using errcode='40001';end if;
  results:=results||jsonb_build_array(forecast_history.deliver(r.fixture_key,r.team,true));
 end loop;
 insert into forecast_history.commands(request_id,request,result) values(p_request_id,req,jsonb_build_object('outcome','processed','results',results));
 return jsonb_build_object('outcome','processed','results',results);
end;
$body$;
create function public.get_forecast_history_admin() returns jsonb language sql stable security invoker set search_path='' as $body$ select private.get_forecast_history_admin();$body$;
create function public.publish_forecast_history(p_expected jsonb,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $body$ select private.publish_forecast_history(p_expected,p_request_id);$body$;

revoke all on all functions in schema forecast_history from public,anon,authenticated,service_role;
revoke all on function private.get_forecast_history_admin(),private.publish_forecast_history(jsonb,uuid),public.get_forecast_history_admin(),public.publish_forecast_history(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function private.get_forecast_history_admin(),private.publish_forecast_history(jsonb,uuid),public.get_forecast_history_admin(),public.publish_forecast_history(jsonb,uuid) to authenticated;

-- Preserve original publication times. This import is not a fresh source reading.
do $seed$
declare a record;
begin
 for a in select * from forecast_season.archive order by published_at,fixture_key,team loop
  perform forecast_history.capture_snapshot(a.fixture_key,a.team,a.published_at,a.projection,a.source_starters);
 end loop;
end;
$seed$;
do $preserve$
begin
 if (select state from pg_temp.history_protected_before) is distinct from jsonb_build_object(
 'public',(select md5(string_agg(to_jsonb(t)::text,',' order by team)) from public.forecast_season_public t),
 'runs',(select md5(string_agg(to_jsonb(t)::text,',' order by key)) from forecast_season.runs t),
 'attempts',(select md5(string_agg(to_jsonb(t)::text,',' order by key)) from forecast_season.attempts t),
 'drafts',(select md5(string_agg(to_jsonb(t)::text,',' order by team)) from forecast_season.drafts t),
 'fixtures',(select md5(string_agg(to_jsonb(t)::text,',' order by key)) from forecast_season.fixtures t),
 'archive',(select md5(string_agg(to_jsonb(t)::text,',' order by fixture_key,team,horizon)) from forecast_season.archive t),
 'roster',(select md5(string_agg(to_jsonb(t)::text,',' order by team,id)) from forecast_league.roster t),
 'control',(select to_jsonb(t) from forecast_season.control t),
 'functions',(select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),',' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('forecast_season','forecast_publish')),
 'permissions',(select jsonb_agg(jsonb_build_object('oid',c.oid,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity) order by c.oid) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and(n.nspname in('forecast_season','forecast_league') or(n.nspname='public' and c.relname='forecast_season_public')))
) then
  raise exception 'History migration changed existing data, controls, functions or permissions';
 end if;
end;
$preserve$;
notify pgrst,'reload schema';
