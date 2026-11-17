-- Ernesto 17/11/2026: the highest final probability occupies each reviewed slot.
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
 if md5(builder)<>'105206b17439613a07159868f261bc9e' then raise exception 'build_team changed since selection-priority review';end if;
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind='r' and (n.nspname in('forecast_league','forecast_season','forecast_health') or n.nspname='public' and c.relname like 'forecast%') order by n.nspname,c.relname loop
  execute format('lock table %I.%I in share mode',r.nspname,r.relname);
  execute format('select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text)::text,''[]'')) from %I.%I x',r.nspname,r.relname) into digest;
  before_rows:=before_rows||jsonb_build_object(r.nspname||'.'||r.relname,digest);
 end loop;
 select jsonb_build_object('oid',oid,'acl',proacl,'owner',proowner,'config',proconfig,'definer',prosecdef,'volatility',provolatile) into before_meta
 from pg_proc where oid='forecast_season.build_team(jsonb,interval)'::regprocedure;
 needle:=$old$ return jsonb_build_object('schema_version',case when v3 then 4 else 3 end$old$;
 replacement:=$new$ -- A valid forecast cannot publish a lower-scored starter above its alternative.
 -- All scores have already been independently validated against the sources.
 if p->>'method_version'='editorial-v6' and exists(
  select 1 from jsonb_array_elements(players) slot_player
  where slot_player->'alternative'<>'null'::jsonb and not exists(
   select 1 from jsonb_array_elements(players||candidates) option_player
   where option_player->>'id'=slot_player#>>'{alternative,id}'
    and (option_player->>'probability')::integer<=(slot_player->>'probability')::integer
  )
 ) then raise exception 'La alternativa supera al titular: revisar mayor porcentaje por puesto' using errcode='22023';end if;
 return jsonb_build_object('schema_version',case when v3 then 4 else 3 end$new$;
 if length(builder)-length(replace(builder,needle,''))<>length(needle) then raise exception 'Unexpected priority patch point';end if;
 builder:=replace(builder,needle,replacement);
 execute builder;
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind='r' and (n.nspname in('forecast_league','forecast_season','forecast_health') or n.nspname='public' and c.relname like 'forecast%') order by n.nspname,c.relname loop
  execute format('select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text)::text,''[]'')) from %I.%I x',r.nspname,r.relname) into digest;
  after_rows:=after_rows||jsonb_build_object(r.nspname||'.'||r.relname,digest);
 end loop;
 select jsonb_build_object('oid',oid,'acl',proacl,'owner',proowner,'config',proconfig,'definer',prosecdef,'volatility',provolatile) into after_meta
 from pg_proc where oid='forecast_season.build_team(jsonb,interval)'::regprocedure;
 if before_rows is distinct from after_rows or before_meta is distinct from after_meta then raise exception 'Selection-priority migration changed protected data or metadata';end if;
end;
$patch$;
commit;
