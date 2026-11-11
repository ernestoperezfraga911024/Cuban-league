-- Pure helpers only. Preserve editorial-v1, stored payloads, permissions and publication commands.
create or replace function forecast_publish.assess(e jsonb) returns integer
language plpgsql immutable security invoker set search_path = '' as $body$
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
$body$;

create or replace function forecast_publish.build(p_source jsonb,p_players jsonb,p_note text) returns jsonb
language plpgsql stable security invoker set search_path = '' as $body$
declare x jsonb; original jsonb; person text; alt_name text; score integer; slot integer;
 result jsonb := '[]'; sources jsonb; oldest timestamptz; horizon text; method text; observation jsonb; source_observation jsonb;
begin
 if p_source->>'status' is distinct from 'draft' or not coalesce(p_source->>'method_version' in ('editorial-v1','editorial-v2'),false)
   or p_source->>'fixture_key' is distinct from 'laliga-2026-27-j13-real-madrid-celta'
   or p_source->'publication_allowed' is distinct from 'false'::jsonb then
   raise exception 'Se necesita una lectura nueva con método editorial compatible' using errcode='22023'; end if;
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
   if original->'assessment'->>'method' is distinct from p_source->>'method_version'
     or forecast_publish.assess(original->'assessment') is distinct from (original->>'probability')::integer
     or original->'assessment'->'horizon'->>'value' is distinct from horizon then
     raise exception 'La evaluación de origen no coincide con sus evidencias' using errcode='22023'; end if;
   if p_source->>'method_version'='editorial-v2' then
     for observation in select value from jsonb_array_elements(original->'assessment'->'sources') loop
       select o into source_observation from jsonb_array_elements(p_source->'sources') s,
         jsonb_array_elements(s->'player_observations') o where s->>'id'=observation->>'id' and o->>'player_id'=original->>'id';
       if source_observation is null or source_observation->'prediction' is distinct from observation->'prediction'
         or source_observation->'probability' is distinct from observation->'probability' then
         raise exception 'La evaluación no coincide con la observación guardada' using errcode='22023'; end if;
     end loop;
   end if;
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
     and original->'slot'=x->'slot' then p_source->>'method_version' else 'editorial-manual-v1' end;
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
