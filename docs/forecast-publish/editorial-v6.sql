-- Source-only v6. Existing v1..v5 formulas, rows and function privileges remain intact.
-- Reviewed against the installed definitions on 2026-11-16. Apply as maintenance only.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $v6$
declare
 assessment text:=pg_get_functiondef('forecast_publish.assess(jsonb)'::regprocedure);
 builder text:=pg_get_functiondef('forecast_season.build_team(jsonb,interval)'::regprocedure);
 before_rows jsonb:='{}'; after_rows jsonb:='{}'; before_meta jsonb; after_meta jsonb;
 r record; digest text; needle text; replacement text;
 additions text:=$branch$
 -- v6 accepts only source observations as calculation inputs. Extra metadata is
 -- deliberately ignored. Reuse the guarded v5 source validation and arithmetic
 -- with fixed neutral compatibility fields; these fields are never projected.
 if e->>'method'='editorial-v6' then
   return forecast_publish.assess(jsonb_build_object(
     'method','editorial-v5','sources',e->'sources','confirmed_out',false,
     'availability',jsonb_build_object('value','unknown','reason','Internal neutral compatibility field; no medical observation.','refs',e->'sources'->0->'refs'),
     'rotation',jsonb_build_object('value','low','reason','Source-only v6 has no external rotation adjustment.','refs',e->'sources'->0->'refs'),
     'horizon',jsonb_build_object('value','near','reason','Source-only v6 has no horizon adjustment.','refs',e->'sources'->0->'refs'),
     'context',jsonb_build_object('points',0,'reason','Source-only v6 has no external contextual adjustment.','refs',e->'sources'->0->'refs')));
 end if;
$branch$;
begin
 if md5(assessment)<>'1e3dae90e7f37624d6b5ca686835cefe'
 or md5(builder)<>'f30f730355203b835804b2f6c08b7188'
 then raise exception 'Editorial functions changed since v6 review';end if;

 -- Block concurrent forecast writes briefly, then prove rows and table ACL/RLS
 -- did not change. The inventory is restricted to forecast-owned tables.
 for r in select n.nspname,c.relname,c.oid,c.relacl,c.relrowsecurity,c.relforcerowsecurity
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where c.relkind in ('r','p') and (n.nspname in ('forecast_publish','forecast_league','forecast_season','forecast_health')
     or n.nspname='public' and c.relname like 'forecast%') order by n.nspname,c.relname loop
   execute format('lock table %I.%I in share mode',r.nspname,r.relname);
   execute format('select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text)::text,''[]'')) from %I.%I x',r.nspname,r.relname) into digest;
   before_rows:=before_rows||jsonb_build_object(r.nspname||'.'||r.relname,jsonb_build_object('rows',digest,'acl',r.relacl,'rls',r.relrowsecurity,'force_rls',r.relforcerowsecurity));
 end loop;
 select jsonb_agg(jsonb_build_object('oid',oid,'acl',proacl,'owner',proowner,'security_definer',prosecdef,'config',proconfig,'volatility',provolatile) order by oid)
 into before_meta from pg_proc where oid in('forecast_publish.assess(jsonb)'::regprocedure,'forecast_season.build_team(jsonb,interval)'::regprocedure);

 needle:=E'begin\n if e->>''method'' in (''editorial-v3'',''editorial-v4'',''editorial-v5'') then';
 if length(assessment)-length(replace(assessment,needle,''))<>length(needle) then raise exception 'Expected exactly one assessment entry point';end if;
 assessment:=replace(assessment,needle,'begin'||additions||E'\n if e->>''method'' in (''editorial-v3'',''editorial-v4'',''editorial-v5'') then');

 -- Version allowlists change only; all source, identity, XI, alternative,
 -- actual fixture/time and public-projection guards remain in place.
 for needle,replacement in select * from (values
   ('(''editorial-v3'',''editorial-v4'',''editorial-v5'')','(''editorial-v3'',''editorial-v4'',''editorial-v5'',''editorial-v6'')'),
   ('(''editorial-v2'',''editorial-v3'',''editorial-v4'',''editorial-v5'')','(''editorial-v2'',''editorial-v3'',''editorial-v4'',''editorial-v5'',''editorial-v6'')'),
   ('(''editorial-v4'',''editorial-v5'')','(''editorial-v4'',''editorial-v5'',''editorial-v6'')'),
   ('Candidatos requieren evaluación editorial-v4 o editorial-v5','Candidatos requieren evaluación editorial-v4, editorial-v5 o editorial-v6'),
   ('x->''assessment''->''horizon''->>''value'' is distinct from horizon','(p->>''method_version''<>''editorial-v6'' and x->''assessment''->''horizon''->>''value'' is distinct from horizon)'),
   ('x#>>''{assessment,horizon,value}'' is distinct from horizon','(p->>''method_version''<>''editorial-v6'' and x#>>''{assessment,horizon,value}'' is distinct from horizon)')
 ) changes(needle,replacement) loop
   if length(builder)-length(replace(builder,needle,''))<>length(needle) then raise exception 'Unexpected v6 builder patch point: %',needle;end if;
   builder:=replace(builder,needle,replacement);
 end loop;
 execute assessment;
 execute builder;

 for r in select n.nspname,c.relname,c.oid,c.relacl,c.relrowsecurity,c.relforcerowsecurity
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where c.relkind in ('r','p') and (n.nspname in ('forecast_publish','forecast_league','forecast_season','forecast_health')
     or n.nspname='public' and c.relname like 'forecast%') order by n.nspname,c.relname loop
   execute format('select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text)::text,''[]'')) from %I.%I x',r.nspname,r.relname) into digest;
   after_rows:=after_rows||jsonb_build_object(r.nspname||'.'||r.relname,jsonb_build_object('rows',digest,'acl',r.relacl,'rls',r.relrowsecurity,'force_rls',r.relforcerowsecurity));
 end loop;
 select jsonb_agg(jsonb_build_object('oid',oid,'acl',proacl,'owner',proowner,'security_definer',prosecdef,'config',proconfig,'volatility',provolatile) order by oid)
 into after_meta from pg_proc where oid in('forecast_publish.assess(jsonb)'::regprocedure,'forecast_season.build_team(jsonb,interval)'::regprocedure);
 if after_rows is distinct from before_rows or after_meta is distinct from before_meta
 then raise exception 'Source-only v6 changed protected rows, ACL/RLS or function identity';end if;
end;
$v6$;
commit;
