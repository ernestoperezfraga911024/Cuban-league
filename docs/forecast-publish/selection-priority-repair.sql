-- Explicit interactive correction of CURRENT published rows, never a new read.
-- Wrapped in a transaction with optimistic fingerprints by priority-repair.cjs.
do $repair$
declare targets jsonb:=current_setting('forecast_maintenance.priority_targets')::jsonb;
 target jsonb; pair jsonb; d forecast_season.drafts%rowtype; pub public.forecast_season_public%rowtype;
 proposal jsonb; expected jsonb; repaired_projection jsonb; new_payload jsonb;
 starter jsonb; candidate jsonb; old_player jsonb; old_candidate jsonb;
 before_rows jsonb:='{}'; after_rows jsonb:='{}'; changes jsonb:='[]';
 r record; digest text; row_expr text; checks jsonb:='[]';
begin
 if md5(pg_get_functiondef('forecast_season.build_team(jsonb,interval)'::regprocedure))<>'12773c40d7f05de2ba5b01b824204f9d' then raise exception 'Priority guard not installed';end if;
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind='r' and (n.nspname in('forecast_league','forecast_season','forecast_health') or n.nspname='public' and c.relname like 'forecast%') order by n.nspname,c.relname loop
  execute format('lock table %I.%I in share row exclusive mode',r.nspname,r.relname);
  row_expr:='to_jsonb(x)';
  if r.nspname='forecast_season' and r.relname='drafts' then row_expr:='case when exists(select 1 from jsonb_array_elements($1) t where t->>''team''=x.team) then to_jsonb(x)-''payload''-''projection'' else to_jsonb(x) end';end if;
  if r.nspname='public' and r.relname='forecast_season_public' then row_expr:='case when exists(select 1 from jsonb_array_elements($1) t where t->>''team''=x.team) then to_jsonb(x)-''payload'' else to_jsonb(x) end';end if;
  execute format('select md5(coalesce(jsonb_agg(v order by v::text)::text,''[]'')) from(select %s v from %I.%I x) q',row_expr,r.nspname,r.relname) into digest using targets;
  before_rows:=before_rows||jsonb_build_object(r.nspname||'.'||r.relname,digest);
 end loop;
 for target in select value from jsonb_array_elements(targets) loop
  select * into d from forecast_season.drafts where team=target->>'team';
  select * into pub from public.forecast_season_public where team=target->>'team';
  if md5(to_jsonb(d)::text) is distinct from target->>'draft_hash' or md5(to_jsonb(pub)::text) is distinct from target->>'public_hash'
   or d.paused or d.outcome<>'published' or pub.status<>'published' or d.projection is distinct from pub.payload
   or d.payload->>'method_version'<>'editorial-v6' or (pub.payload->>'kickoff_at')::timestamptz<=now()
   then raise exception 'Current publication changed or is not repairable: %',target->>'team';end if;
  proposal:=d.payload->'proposal';expected:=pub.payload;
  for pair in select value from jsonb_array_elements(target->'pairs') loop
   select value into starter from jsonb_array_elements(proposal->'players') where value->>'id'=pair->>'from';
   select value into candidate from jsonb_array_elements(proposal->'candidates') where value->>'id'=pair->>'to';
   if starter is null or candidate is null or starter#>>'{alternative,id}' is distinct from pair->>'to'
    or (starter->>'probability')::int>=(candidate->>'probability')::int then raise exception 'Expected inverted pair changed';end if;
   proposal:=jsonb_set(proposal,'{players}',(select jsonb_agg(case when value->>'id'=pair->>'from'
    then candidate||jsonb_build_object('slot',starter->'slot','position',starter->'position','alternative',case when (candidate->>'probability')::int<70 then jsonb_build_object('id',starter->>'id','name',starter->>'name') else 'null'::jsonb end)
    else value end order by ord) from jsonb_array_elements(proposal->'players') with ordinality a(value,ord)));
   proposal:=jsonb_set(proposal,'{candidates}',(select jsonb_agg(case when value->>'id'=pair->>'to' then starter-'slot'-'position'-'alternative' else value end order by ord) from jsonb_array_elements(proposal->'candidates') with ordinality a(value,ord)));
   select value into old_player from jsonb_array_elements(expected->'players') where value->>'id'=pair->>'from';
   select value into old_candidate from jsonb_array_elements(expected->'candidates') where value->>'id'=pair->>'to';
   expected:=jsonb_set(expected,'{players}',(select jsonb_agg(case when value->>'id'=pair->>'from'
    then old_candidate||jsonb_build_object('slot',old_player->'slot','position',old_player->'position','alternative',case when (old_candidate->>'probability')::int<70 then jsonb_build_object('id',old_player->>'id','name',old_player->>'name') else 'null'::jsonb end)
    else value end order by ord) from jsonb_array_elements(expected->'players') with ordinality a(value,ord)));
   expected:=jsonb_set(expected,'{candidates}',(select jsonb_agg(case when value->>'id'=pair->>'to' then old_player-'slot'-'position'-'alternative' else value end order by ord) from jsonb_array_elements(expected->'candidates') with ordinality a(value,ord)));
  end loop;
  new_payload:=jsonb_set(d.payload,'{proposal}',proposal);
  repaired_projection:=forecast_season.build_team(new_payload,interval '24 hours');
  if repaired_projection is distinct from expected then raise exception 'Correction changed data beyond the reviewed pairs';end if;
  update forecast_season.drafts set payload=new_payload,projection=repaired_projection where team=d.team;
  update public.forecast_season_public set payload=repaired_projection where team=d.team;
  changes:=changes||jsonb_build_array(jsonb_build_object('team',d.team,'pairs',target->'pairs','old_payload_hash',md5(d.payload::text),'new_payload_hash',md5(new_payload::text),'old_projection_hash',md5(pub.payload::text),'new_projection_hash',md5(repaired_projection::text)));
 end loop;
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind='r' and (n.nspname in('forecast_league','forecast_season','forecast_health') or n.nspname='public' and c.relname like 'forecast%') order by n.nspname,c.relname loop
  row_expr:='to_jsonb(x)';
  if r.nspname='forecast_season' and r.relname='drafts' then row_expr:='case when exists(select 1 from jsonb_array_elements($1) t where t->>''team''=x.team) then to_jsonb(x)-''payload''-''projection'' else to_jsonb(x) end';end if;
  if r.nspname='public' and r.relname='forecast_season_public' then row_expr:='case when exists(select 1 from jsonb_array_elements($1) t where t->>''team''=x.team) then to_jsonb(x)-''payload'' else to_jsonb(x) end';end if;
  execute format('select md5(coalesce(jsonb_agg(v order by v::text)::text,''[]'')) from(select %s v from %I.%I x) q',row_expr,r.nspname,r.relname) into digest using targets;
  after_rows:=after_rows||jsonb_build_object(r.nspname||'.'||r.relname,digest);
 end loop;
 if before_rows is distinct from after_rows then raise exception 'Correction changed protected rows, dates or metadata';end if;
 for target in select value from jsonb_array_elements(changes) loop
  checks:=checks||jsonb_build_array(target->>'team'||': projection '||(target->>'old_projection_hash')||' -> '||(target->>'new_projection_hash'),target->>'team'||': payload '||(target->>'old_payload_hash')||' -> '||(target->>'new_payload_hash'));
  for pair in select value from jsonb_array_elements(target->'pairs') loop
   checks:=checks||jsonb_build_array(target->>'team'||': promoted '||(pair->>'to')||'; alternative '||(pair->>'from'));
  end loop;
 end loop;
 checks:=checks||jsonb_build_array('SQL revalidated original source evidence and percentages. No new sports read.','Original timestamps, archive, attempts, catalog, health and unrelated publications preserved exactly.');
 perform automation_ops.record_run(jsonb_build_object('execution_key',current_setting('forecast_maintenance.execution_key'),'scheduled_for',null,'methodology_version','ops-v2','code_sha',current_setting('forecast_maintenance.code_sha'),'status','maintenance','report',jsonb_build_object('flows','{}'::jsonb,'metrics','{}'::jsonb,'incidents','[]'::jsonb,'checks',checks)));
 perform set_config('forecast_maintenance.priority_result',changes::text,true);
end;
$repair$;
select current_setting('forecast_maintenance.priority_result')::jsonb as result;
