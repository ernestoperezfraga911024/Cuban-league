CREATE OR REPLACE FUNCTION forecast_publish.assess(e jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare weights constant jsonb := '{"role":{"established":85,"preferred":75,"contested":55},"availability":{"clear":0,"concern":-15,"unknown":-10},"rotation":{"low":0,"possible":-10,"high":-20},"agreement":{"consistent":0,"disputed":-10},"quality":{"primary":0,"secondary":-5,"limited":-10},"horizon":{"near":0,"medium":-5,"distant":-10}}';
 k text; score integer := 0; s jsonb; item jsonb; signal numeric; total numeric := 0;
 weights_v2 constant jsonb := '{"availability":{"clear":0,"concern":-8,"unknown":-4},"rotation":{"low":0,"possible":-3,"high":-8},"horizon":{"near":0,"medium":-1,"distant":-2}}';
begin

 if e->>'method'='editorial-v2' then
   if e->'confirmed_out' is distinct from 'false'::jsonb or jsonb_typeof(e->'sources') is distinct from 'array' then
     raise exception 'Evaluación v2 incompleta o baja confirmada' using errcode='22023'; end if;
   if jsonb_array_length(e->'sources')<>3 or (select count(distinct x->>'id') from jsonb_array_elements(e->'sources') x)<>3 then
     raise exception 'Se requieren las tres fuentes distintas' using errcode='22023'; end if;
   for s in select value from jsonb_array_elements(e->'sources') loop
     if not coalesce(s->>'id' in ('futbolfantasy','jornadaperfecta','comuniate'),false)
       or not coalesce(s->>'prediction' in ('starter','alternative','not_listed'),false)
       or (s->'probability' is distinct from 'null'::jsonb and (jsonb_typeof(s->'probability') is distinct from 'number' or coalesce(s->>'probability','') !~ '^(100|[1-9]?[0-9])$')) then
       raise exception 'Observación de fuente inválida' using errcode='22023'; end if;
     if jsonb_typeof(s->'refs') is distinct from 'array' then raise exception 'Faltan referencias' using errcode='22023'; end if;
     if not exists(select 1 from jsonb_array_elements_text(s->'refs') r where r ~ ('^https://www\.'||(s->>'id')||'\.com/')) then
       raise exception 'Referencia ajena a la fuente' using errcode='22023'; end if;
     signal := case when s->'probability'='null'::jsonb then case s->>'prediction' when 'starter' then 90 when 'alternative' then 40 else 25 end else (s->>'probability')::numeric end;
     total := total + signal;
   end loop;
   if jsonb_typeof(e->'role'->'value') is distinct from 'number' or coalesce(e->'role'->>'value','') !~ '^(100|[1-9]?[0-9])$'
     or jsonb_typeof(e->'context'->'points') is distinct from 'number' or coalesce(e->'context'->>'points','') !~ '^-?(10|[0-9])$' then
     raise exception 'Rol o ajuste inválidos' using errcode='22023'; end if;
   total := .8*total/3 + .2*(e->'role'->>'value')::numeric + (e->'context'->>'points')::numeric;
   for k in select jsonb_object_keys(weights_v2) loop
     if not coalesce((weights_v2->k)?(e->k->>'value'),false) then raise exception 'Criterio v2 inválido' using errcode='22023'; end if;
     total := total + (weights_v2->k->>(e->k->>'value'))::numeric;
   end loop;
   for item in select value from jsonb_array_elements((e->'sources')||jsonb_build_array(e->'role',e->'context',e->'availability',e->'rotation',e->'horizon')) loop
     if jsonb_typeof(item->'reason') is distinct from 'string' or length(btrim(coalesce(item->>'reason','')))=0 or jsonb_typeof(item->'refs') is distinct from 'array' then
       raise exception 'Falta el motivo o las referencias' using errcode='22023'; end if;
     if jsonb_array_length(item->'refs')=0 or exists(select 1 from jsonb_array_elements(item->'refs') r where jsonb_typeof(r)<>'string' or (r#>>'{}') !~ '^https://') then
       raise exception 'Referencias inválidas' using errcode='22023'; end if;
   end loop;
   return greatest(5,least(case when e->'horizon'->>'value'='distant' then 90 else 95 end,round(total)::integer));
 end if;
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
$function$;

CREATE OR REPLACE FUNCTION forecast_season.build_team(p jsonb, p_max_age interval DEFAULT '02:00:00'::interval)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION forecast_season.check_attempt(p_run text, p_team text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare r forecast_season.runs%rowtype; p jsonb;
begin
 select * into r from forecast_season.runs where key=p_run;
 p:=forecast_season.plan();
 if not found or p_run is distinct from p->>'run_key' or not(r.expected ? p_team) then raise exception 'Turno o equipo no autorizado' using errcode='22023'; end if;
 if (select count(*) from forecast_season.attempts)>=20000 then raise exception 'Límite de intentos de temporada' using errcode='54000'; end if;
 return p_run||'-'||p_team;
end;
$function$;

CREATE OR REPLACE FUNCTION forecast_season.publish_team(p_team text, p_age interval, p_manual boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare d forecast_season.drafts%rowtype; v_projection jsonb; v_horizon text; source_xi jsonb;
begin
 select * into d from forecast_season.drafts where team=p_team;
 if d.team is null or d.projection is null or d.outcome not in ('saved','ready','published') or (d.paused and not p_manual) then raise exception 'No hay lectura lista para publicar' using errcode='22023'; end if;
 v_projection:=forecast_season.build_team(d.payload,p_age);
 if v_projection is null or not exists(select 1 from forecast_season.fixtures f where f.key=d.fixture_key and f.kickoff_at>now()) then raise exception 'Partido iniciado o lectura inválida' using errcode='22023'; end if;
 if (v_projection->>'evidence_at')::timestamptz<now()-p_age then raise exception 'Lectura caducada' using errcode='22023'; end if;
 if exists(select 1 from forecast_season.fixtures f where p_team in(f.home,f.away) and f.kickoff_at>now() and f.kickoff_at<(v_projection->>'kickoff_at')::timestamptz) then raise exception 'Existe un partido anterior del equipo' using errcode='22023'; end if;
 if exists(select 1 from public.forecast_season_public where team=p_team and payload=v_projection and status='published') then return jsonb_build_object('team',p_team,'outcome','unchanged'); end if;
 update public.forecast_season_public set payload=v_projection,published_at=now(),checked_at=d.checked_at,status='published',attempted_fixture_key=d.fixture_key where team=p_team;
 update forecast_season.drafts set outcome='published',paused=false where team=p_team;
 update forecast_season.attempts set outcome='published',published_at=now() where key=d.run_key;
 v_horizon:=case when (v_projection->>'kickoff_at')::timestamptz-now()<=interval '6 hours' then 'matchday' when (v_projection->>'kickoff_at')::timestamptz-now()<=interval '48 hours' then 'near' when (v_projection->>'kickoff_at')::timestamptz-now()<=interval '120 hours' then 'medium' else 'distant' end;
 select jsonb_agg(jsonb_build_object('id',s->>'id','url',s->>'url','fetched_at',s->'fetched_at','starter_ids',s->'starter_ids','player_observations',s->'player_observations')) into source_xi from jsonb_array_elements(d.payload->'sources') s;
 insert into forecast_season.archive(fixture_key,team,horizon,published_at,projection,source_starters) values(d.fixture_key,p_team,v_horizon,now(),v_projection,source_xi)
 on conflict(fixture_key,team,horizon) do update set published_at=excluded.published_at,projection=excluded.projection,source_starters=excluded.source_starters;
 return jsonb_build_object('team',p_team,'outcome','published','published_at',now(),'fixture_key',d.fixture_key);
end;
$function$;

drop function if exists forecast_season.begin_run(text);