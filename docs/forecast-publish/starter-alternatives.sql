-- Ernesto 17/11/2026: v6 starters may be alternatives for another tactical slot.
-- Function-only maintenance. Never rewrite published data or source arithmetic.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare
 builder text:=pg_get_functiondef('forecast_season.build_team(jsonb,interval)'::regprocedure);
 before_rows jsonb:='{}'; after_rows jsonb:='{}'; before_meta jsonb; after_meta jsonb;
 r record; digest text; needle text; replacement text;
begin
 if md5(builder)<>'5136698aeb7ea9eb7d7beed48a97033b' then raise exception 'build_team changed since starter-alternative review';end if;
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind='r' and (n.nspname in('forecast_league','forecast_season','forecast_health') or n.nspname='public' and c.relname like 'forecast%') order by n.nspname,c.relname loop
  execute format('lock table %I.%I in share mode',r.nspname,r.relname);
  execute format('select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text)::text,''[]'')) from %I.%I x',r.nspname,r.relname) into digest;
  before_rows:=before_rows||jsonb_build_object(r.nspname||'.'||r.relname,digest);
 end loop;
 select jsonb_build_object('oid',oid,'acl',proacl,'owner',proowner,'config',proconfig,'definer',prosecdef,'volatility',provolatile) into before_meta
 from pg_proc where oid='forecast_season.build_team(jsonb,interval)'::regprocedure;
 for needle,replacement in select * from (values
 ($old$if alt is null or exists(select 1 from jsonb_array_elements(p->'proposal'->'players') q where q->>'id'=x->'alternative'->>'id') then raise exception 'Falta alternativa fuera del once' using errcode='22023'; end if;$old$,
  $new$if alt is null or x->>'id'=x->'alternative'->>'id' or (p->>'method_version'<>'editorial-v6' and exists(select 1 from jsonb_array_elements(p->'proposal'->'players') q where q->>'id'=x->'alternative'->>'id')) then raise exception 'Falta alternativa distinta y evaluada (fuera del once en versiones anteriores)' using errcode='22023'; end if;$new$),
 ($old$if exists(select 1 from jsonb_array_elements(players) q where q->'alternative'<>'null'::jsonb and not exists(select 1 from jsonb_array_elements(candidates) c where c->>'id'=q#>>'{alternative,id}')) then$old$,
  $new$if exists(select 1 from jsonb_array_elements(players) q where q->'alternative'<>'null'::jsonb and not exists(select 1 from jsonb_array_elements(candidates || case when p->>'method_version'='editorial-v6' then players else '[]'::jsonb end) c where c->>'id'=q#>>'{alternative,id}')) then$new$)
 ) changes(needle,replacement) loop
  if length(builder)-length(replace(builder,needle,''))<>length(needle) then raise exception 'Unexpected starter-alternative patch point';end if;
  builder:=replace(builder,needle,replacement);
 end loop;
 execute builder;
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind='r' and (n.nspname in('forecast_league','forecast_season','forecast_health') or n.nspname='public' and c.relname like 'forecast%') order by n.nspname,c.relname loop
  execute format('select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text)::text,''[]'')) from %I.%I x',r.nspname,r.relname) into digest;
  after_rows:=after_rows||jsonb_build_object(r.nspname||'.'||r.relname,digest);
 end loop;
 select jsonb_build_object('oid',oid,'acl',proacl,'owner',proowner,'config',proconfig,'definer',prosecdef,'volatility',provolatile) into after_meta
 from pg_proc where oid='forecast_season.build_team(jsonb,interval)'::regprocedure;
 if before_rows is distinct from after_rows or before_meta is distinct from after_meta then raise exception 'Starter-alternative migration changed protected data or metadata';end if;
end;
$patch$;
commit;
