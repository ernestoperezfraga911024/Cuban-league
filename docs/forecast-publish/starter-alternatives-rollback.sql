-- Restore the previous v6 alternative guard only; never rewrite data.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $rollback$
declare builder text:=pg_get_functiondef('forecast_season.build_team(jsonb,interval)'::regprocedure);needle text;replacement text;
begin
 if md5(builder)<>'105206b17439613a07159868f261bc9e' then raise exception 'build_team changed after starter-alternative installation';end if;
 for needle,replacement in select * from (values
($old$if alt is null or x->>'id'=x->'alternative'->>'id' or (p->>'method_version'<>'editorial-v6' and exists(select 1 from jsonb_array_elements(p->'proposal'->'players') q where q->>'id'=x->'alternative'->>'id')) then raise exception 'Falta alternativa distinta y evaluada (fuera del once en versiones anteriores)' using errcode='22023'; end if;$old$,$new$if alt is null or exists(select 1 from jsonb_array_elements(p->'proposal'->'players') q where q->>'id'=x->'alternative'->>'id') then raise exception 'Falta alternativa fuera del once' using errcode='22023'; end if;$new$),
($old$if exists(select 1 from jsonb_array_elements(players) q where q->'alternative'<>'null'::jsonb and not exists(select 1 from jsonb_array_elements(candidates || case when p->>'method_version'='editorial-v6' then players else '[]'::jsonb end) c where c->>'id'=q#>>'{alternative,id}')) then$old$,$new$if exists(select 1 from jsonb_array_elements(players) q where q->'alternative'<>'null'::jsonb and not exists(select 1 from jsonb_array_elements(candidates) c where c->>'id'=q#>>'{alternative,id}')) then$new$)
 )changes(needle,replacement) loop
  if length(builder)-length(replace(builder,needle,''))<>length(needle) then raise exception 'Unexpected rollback patch point';end if;
  builder:=replace(builder,needle,replacement);
 end loop;
 if md5(builder)<>'5136698aeb7ea9eb7d7beed48a97033b' then raise exception 'Rollback definition mismatch';end if;
 execute builder;
end;
$rollback$;
commit;
