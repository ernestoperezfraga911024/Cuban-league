-- Review before applying to the existing Cuban League project. No automatic publication.
-- Dependencies: forecast_pilot, private.is_league_admin(), forecast-review RPC.
create schema forecast_publish;
revoke all on schema forecast_publish from public, anon, authenticated, service_role;

create table forecast_publish.roster (id text primary key, name text not null);
-- Snapshot of the existing catalog, Madrid only. Photos remain in the catalog.
insert into forecast_publish.roster(id,name) values
 ('k-mbappe','K. Mbappé'),('v-junior','V. Júnior'),('j-bellingham','J. Bellingham'),
 ('y-diomande','Y. Diomande'),('f-valverde','F. Valverde'),('a-tchouameni','A. Tchouaméni'),
 ('a-guler','A. Güler'),('m-cucurella','M. Cucurella'),('t-courtois','T. Courtois'),
 ('i-konate','I. Konaté'),('c-espi','C. Espí'),('d-huijsen','D. Huijsen'),
 ('a-rudiger','A. Rüdiger'),('b-silva','B. Silva'),('d-dumfries','D. Dumfries'),
 ('t-alexander-arnold','T. Alexander-Arnold'),('e-camavinga','E. Camavinga'),
 ('b-diaz','B. Díaz'),('a-carreras','Á. Carreras'),('endrick','Endrick'),
 ('a-lunin','A. Lunin'),('rodrygo','Rodrygo'),('r-asencio','R. Asencio'),
 ('t-pitarch','T. Pitarch'),('s-martinez','S. Martinez'),('f-mendy','F. Mendy'),('mister-17452','É. Militão');
create table forecast_publish.revisions (
 id bigint generated always as identity primary key,
 source_key text not null references forecast_pilot.drafts(run_key),
 created_at timestamptz not null default now(), author uuid not null,
 payload jsonb not null check (octet_length(payload::text) <= 65536)
);
create table forecast_publish.state (
 singleton boolean primary key default true check(singleton), version bigint not null default 0,
 current_revision bigint references forecast_publish.revisions(id)
);
insert into forecast_publish.state(singleton) values(true);
create table forecast_publish.events (
 request_id uuid primary key, request jsonb not null, result jsonb not null,
 action text not null check(action in ('save','publish','withdraw','restore')),
 revision_id bigint references forecast_publish.revisions(id), author uuid not null,
 created_at timestamptz not null default now()
);
create index forecast_publish_events_revision on forecast_publish.events(revision_id,action);
alter table forecast_publish.roster enable row level security;
alter table forecast_publish.revisions enable row level security;
alter table forecast_publish.state enable row level security;
alter table forecast_publish.events enable row level security;
revoke all on all tables in schema forecast_publish from public, anon, authenticated, service_role;
revoke all on all sequences in schema forecast_publish from public, anon, authenticated, service_role;

-- Only the explicitly published, sanitized snapshot is readable anonymously.
create table public.forecast_public (
 fixture_key text primary key check(fixture_key='laliga-2026-27-j13-real-madrid-celta'),
 revision_id bigint not null, published_at timestamptz not null, payload jsonb not null
);
alter table public.forecast_public enable row level security;
revoke all on public.forecast_public from public, anon, authenticated, service_role;
grant select on public.forecast_public to anon, authenticated;
create policy forecast_public_read on public.forecast_public for select to anon, authenticated using(true);

-- Pure validation helper. Never callable by browser roles.
create function forecast_publish.assess(e jsonb) returns integer
language plpgsql immutable security invoker set search_path = '' as $body$
declare weights constant jsonb := '{"role":{"established":85,"preferred":75,"contested":55},"availability":{"clear":0,"concern":-15,"unknown":-10},"rotation":{"low":0,"possible":-10,"high":-20},"agreement":{"consistent":0,"disputed":-10},"quality":{"primary":0,"secondary":-5,"limited":-10},"horizon":{"near":0,"medium":-5,"distant":-10}}';
 k text; score integer := 0;
begin
 if e->>'method' is distinct from 'editorial-v1' or e->'confirmed_out' is distinct from 'false'::jsonb then
   raise exception 'Evaluación editorial incompleta' using errcode='22023'; end if;
 for k in select jsonb_object_keys(weights) loop
   if not coalesce((weights->k) ? (e->k->>'value'),false)
     or length(btrim(coalesce(e->k->>'reason',''))) = 0
     or jsonb_typeof(e->k->'refs') is distinct from 'array' then
     raise exception 'Criterio editorial inválido' using errcode='22023'; end if;
   if jsonb_array_length(e->k->'refs') = 0 or exists(select 1 from jsonb_array_elements(e->k->'refs') r
       where jsonb_typeof(r) <> 'string' or (r #>> '{}') !~ '^https://') then
     raise exception 'Faltan evidencias del criterio' using errcode='22023'; end if;
   score := score + (weights->k->>(e->k->>'value'))::integer;
 end loop;
 return greatest(5,least(90,score));
end;
$body$;

create function forecast_publish.build(p_source jsonb,p_players jsonb,p_note text) returns jsonb
language plpgsql stable security invoker set search_path = '' as $body$
declare x jsonb; original jsonb; person text; alt_name text; score integer; slot integer;
 result jsonb := '[]'; sources jsonb; oldest timestamptz; horizon text; method text;
begin
 if p_source->>'status' is distinct from 'draft' or p_source->>'method_version' is distinct from 'editorial-v1'
   or p_source->>'fixture_key' is distinct from 'laliga-2026-27-j13-real-madrid-celta'
   or p_source->'publication_allowed' is distinct from 'false'::jsonb then
   raise exception 'Se necesita una lectura nueva con método editorial v1' using errcode='22023'; end if;
 if jsonb_typeof(p_players) is distinct from 'array' or length(btrim(coalesce(p_note,''))) not between 10 and 1200
   or octet_length(p_players::text)>32768 then
   raise exception 'Once o nota pública inválidos' using errcode='22023'; end if;
 if jsonb_array_length(p_players) <> 11
   or (select count(distinct item->>'id') from jsonb_array_elements(p_players) items(item)) <> 11
   or (select count(distinct item->>'slot') from jsonb_array_elements(p_players) items(item)) <> 11 then
   raise exception 'Se necesitan once jugadores y once puestos distintos' using errcode='22023'; end if;
 select min((s->>'fetched_at')::timestamptz), jsonb_agg(jsonb_build_object(
   'id',s->>'id','url',s->>'url','fetched_at',s->'fetched_at','source_updated_at',s->'source_updated_at') order by s->>'id')
   into oldest,sources from jsonb_array_elements(p_source->'sources') s;
 horizon := case when (p_source->>'kickoff_at')::timestamptz-oldest <= interval '48 hours' then 'near'
   when (p_source->>'kickoff_at')::timestamptz-oldest <= interval '120 hours' then 'medium' else 'distant' end;
 for original in select value from jsonb_array_elements(p_source->'proposal'->'players') loop
   if forecast_publish.assess(original->'assessment') is distinct from (original->>'probability')::integer
     or original->'assessment'->'horizon'->>'value' is distinct from horizon then
     raise exception 'La evaluación de origen no coincide con sus evidencias' using errcode='22023'; end if;
 end loop;
 for x in select value from jsonb_array_elements(p_players) order by (value->>'slot')::integer loop
   if jsonb_typeof(x->'slot') is distinct from 'number' or coalesce(x->>'slot','') !~ '^(1[01]|[1-9])$'
     or jsonb_typeof(x->'probability') is distinct from 'number' or coalesce(x->>'probability','') !~ '^(100|[1-9]?[0-9])$'
     or jsonb_typeof(x->'reason') is distinct from 'string' or length(btrim(coalesce(x->>'reason',''))) not between 10 and 800 then
     raise exception 'Puesto, porcentaje entero o motivo inválidos' using errcode='22023'; end if;
   slot := (x->>'slot')::integer; score := (x->>'probability')::integer;
   select r.name into person from forecast_publish.roster r where r.id=x->>'id';
   if person is null then raise exception 'Jugador fuera del catálogo del piloto' using errcode='22023'; end if;
   alt_name := null;
   if score < 70 then
     select r.name into alt_name from forecast_publish.roster r where r.id=x->>'alternative_id';
     if alt_name is null or exists(select 1 from jsonb_array_elements(p_players) y where y->>'id'=x->>'alternative_id') then
       raise exception 'Bajo 70 se exige alternativa del catálogo fuera del once' using errcode='22023'; end if;
   elsif x->'alternative_id' is distinct from 'null'::jsonb then
     raise exception 'Desde 70 la alternativa debe ser null' using errcode='22023'; end if;
   select value into original from jsonb_array_elements(p_source->'proposal'->'players') y where y->>'id'=x->>'id';
   method := case when original->'probability'=x->'probability' and original->>'reason'=x->>'reason'
     and (original->'alternative'->>'id') is not distinct from (x->>'alternative_id')
     and original->'slot'=x->'slot' then 'editorial-v1' else 'editorial-manual-v1' end;
   result := result || jsonb_build_array(jsonb_build_object('id',x->>'id','name',person,'slot',slot,
     'position',case when slot=1 then 'GK' when slot<=5 then 'DF' when slot<=10 then 'MF' else 'FW' end,
     'probability',score,'reason',btrim(x->>'reason'),'method',method,
     'alternative',case when alt_name is null then 'null'::jsonb else jsonb_build_object('id',x->>'alternative_id','name',alt_name) end));
 end loop;
 return jsonb_build_object('schema_version',1,'fixture_key','laliga-2026-27-j13-real-madrid-celta',
   'team','real-madrid','opponent','celta','matchday',13,'kickoff_at','2026-11-21T20:00:00Z',
   'formation','4-2-3-1','probability_kind','editorial_uncalibrated','note',btrim(p_note),
   'sources',sources,'evidence_at',oldest,'players',result);
end;
$body$;
revoke all on all functions in schema forecast_publish from public, anon, authenticated, service_role;

create function private.get_forecast_publication(p_revision_id bigint default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $body$
declare result jsonb; versions jsonb;
begin
 if (select auth.uid()) is null or not coalesce(private.is_league_admin(),false) then
   raise exception 'Administrator access required' using errcode='42501'; end if;
 select jsonb_build_object('version',s.version,'current_revision',s.current_revision) into result from forecast_publish.state s;
 if p_revision_id is not null then
   select jsonb_build_object('id',r.id,'created_at',r.created_at,'source_key',r.source_key,'payload',r.payload)
     into versions from forecast_publish.revisions r where r.id=p_revision_id;
   return result || jsonb_build_object('revision',versions);
 end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.id desc),'[]') into versions from (
   select r.id,r.created_at,r.source_key,r.payload->>'evidence_at' as evidence_at,
     exists(select 1 from forecast_publish.events e where e.revision_id=r.id and e.action in ('publish','restore')) as ever_published
   from forecast_publish.revisions r order by r.id desc limit 100) x;
 return result || jsonb_build_object('revisions',versions);
end;
$body$;

create function private.command_forecast_publication(p_action text,p_expected_version bigint,p_request_id uuid,
 p_source_key text default null,p_players jsonb default null,p_note text default null,p_revision_id bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $body$
declare state_row forecast_publish.state%rowtype; old_event forecast_publish.events%rowtype;
 request jsonb; result jsonb; payload jsonb; source jsonb; revision bigint; actor uuid := (select auth.uid());
begin
 if actor is null or not coalesce(private.is_league_admin(),false) then
   raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_request_id is null or p_expected_version is null or p_expected_version<0
   or p_action is null or p_action not in ('save','publish','withdraw','restore') then
   raise exception 'Comando inválido' using errcode='22023'; end if;
 request := jsonb_build_object('action',p_action,'expected_version',p_expected_version,'source_key',p_source_key,
   'players',p_players,'note',p_note,'revision_id',p_revision_id,'actor',actor);
 if octet_length(request::text)>65536 then raise exception 'Solicitud demasiado grande' using errcode='22023'; end if;
 select * into state_row from forecast_publish.state where singleton for update;
 select * into old_event from forecast_publish.events where request_id=p_request_id;
 if found then
   if old_event.request is distinct from request then raise exception 'Identificador ya usado' using errcode='23505'; end if;
   return old_event.result || jsonb_build_object('already_applied',true);
 end if;
 if state_row.version <> p_expected_version then
   raise exception 'Otra sesión cambió esta publicación. Recarga antes de continuar.' using errcode='40001'; end if;
 if (select count(*) from forecast_publish.events)>=500 then raise exception 'Límite del piloto alcanzado' using errcode='54000'; end if;
 if p_action='save' then
   if p_revision_id is not null then raise exception 'Guardar crea una revisión nueva' using errcode='22023'; end if;
   if (select count(*) from forecast_publish.revisions)>=100 then raise exception 'Límite de revisiones alcanzado' using errcode='54000'; end if;
   select d.payload into source from forecast_pilot.drafts d where d.run_key=p_source_key;
   payload := forecast_publish.build(source,p_players,p_note);
   insert into forecast_publish.revisions(source_key,author,payload) values(p_source_key,actor,payload) returning id into revision;
 elsif p_action in ('publish','restore') then
   if p_players is not null or p_source_key is not null or p_note is not null then
     raise exception 'Publicar solo acepta una revisión guardada' using errcode='22023'; end if;
   select r.payload into payload from forecast_publish.revisions r where r.id=p_revision_id;
   if payload is null then raise exception 'Revisión inexistente' using errcode='22023'; end if;
   if p_action='restore' and not exists(select 1 from forecast_publish.events e where e.revision_id=p_revision_id and e.action in ('publish','restore')) then
     raise exception 'Solo se restaura una revisión publicada anteriormente' using errcode='22023'; end if;
   if (payload->>'evidence_at')::timestamptz < now()-interval '24 hours'
     or exists(select 1 from jsonb_array_elements(payload->'sources') s where (s->>'fetched_at')::timestamptz>now()+interval '5 minutes')
     or (payload->>'kickoff_at')::timestamptz <= now() then
     raise exception 'Fuentes caducadas o partido iniciado: se requiere una lectura nueva' using errcode='22023'; end if;
   revision := p_revision_id;
   insert into public.forecast_public(fixture_key,revision_id,published_at,payload)
     values(payload->>'fixture_key',revision,now(),payload)
     on conflict(fixture_key) do update set revision_id=excluded.revision_id,published_at=excluded.published_at,payload=excluded.payload;
   update forecast_publish.state set current_revision=revision where singleton;
 else
   if p_source_key is not null or p_players is not null or p_note is not null or p_revision_id is not null then
     raise exception 'Retirar no acepta contenido' using errcode='22023'; end if;
   revision := state_row.current_revision;
   delete from public.forecast_public where fixture_key='laliga-2026-27-j13-real-madrid-celta';
   update forecast_publish.state set current_revision=null where singleton;
 end if;
 update forecast_publish.state set version=version+1 where singleton;
 select jsonb_build_object('version',s.version,'current_revision',s.current_revision,'revision_id',revision,'action',p_action,'already_applied',false)
   into result from forecast_publish.state s;
 insert into forecast_publish.events(request_id,request,result,action,revision_id,author) values(p_request_id,request,result,p_action,revision,actor);
 return result;
end;
$body$;
create function public.get_forecast_publication(p_revision_id bigint default null) returns jsonb
language sql stable security invoker set search_path = '' as $body$ select private.get_forecast_publication(p_revision_id); $body$;
create function public.command_forecast_publication(p_action text,p_expected_version bigint,p_request_id uuid,
 p_source_key text default null,p_players jsonb default null,p_note text default null,p_revision_id bigint default null)
returns jsonb language sql security invoker set search_path = '' as $body$
 select private.command_forecast_publication(p_action,p_expected_version,p_request_id,p_source_key,p_players,p_note,p_revision_id);
$body$;
revoke all on function private.get_forecast_publication(bigint),public.get_forecast_publication(bigint),
 private.command_forecast_publication(text,bigint,uuid,text,jsonb,text,bigint),public.command_forecast_publication(text,bigint,uuid,text,jsonb,text,bigint)
 from public, anon, authenticated, service_role;
grant execute on function private.get_forecast_publication(bigint),public.get_forecast_publication(bigint),
 private.command_forecast_publication(text,bigint,uuid,text,jsonb,text,bigint),public.command_forecast_publication(text,bigint,uuid,text,jsonb,text,bigint)
 to authenticated;
