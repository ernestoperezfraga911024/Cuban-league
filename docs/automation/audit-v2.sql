-- Update only the private audit function; existing rows, RLS and sports data remain unchanged.
create or replace function automation_ops.record_run(p jsonb) returns jsonb
language plpgsql set search_path='' as $fn$
declare result jsonb; f jsonb; metric jsonb; issue jsonb; scheduled timestamptz;
begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>16384
  or coalesce(p->>'execution_key','') !~ '^[a-z0-9-]{5,120}$'
  or coalesce(p->>'methodology_version','') !~ '^ops-v[1-9][0-9]*$'
  or coalesce(p->>'code_sha','') !~ '^[a-f0-9]{40}$'
  or not coalesce(p->>'status' in('running','completed','partial','failed','idle','maintenance'),false)
  or jsonb_typeof(p->'report') is distinct from 'object'
  or exists(select 1 from jsonb_object_keys(p) k where k not in('execution_key','scheduled_for','methodology_version','code_sha','status','report'))
 then raise exception 'Invalid automation audit envelope' using errcode='22023';end if;
 scheduled:=(p->>'scheduled_for')::timestamptz;
 if scheduled>clock_timestamp()+interval '5 minutes' then raise exception 'Future audit schedule' using errcode='22023';end if;
 if exists(select 1 from jsonb_object_keys(p->'report') k where k not in('flows','metrics','incidents','checks'))
  or jsonb_typeof(p#>'{report,flows}') is distinct from 'object'
  or jsonb_typeof(p#>'{report,metrics}') is distinct from 'object'
  or jsonb_typeof(p#>'{report,incidents}') is distinct from 'array'
  or jsonb_typeof(p#>'{report,checks}') is distinct from 'array'
 then raise exception 'Invalid audit report' using errcode='22023';end if;
 for f in select jsonb_build_object('name',key,'value',value) from jsonb_each(p#>'{report,flows}') loop
  if f->>'name' not in('forecasts','news','health','history','set_pieces') or jsonb_typeof(f->'value') is distinct from 'object'
   or exists(select 1 from jsonb_object_keys(f->'value') k where k not in('run_key','status','expected','published','ready','blocked','missing','saved','verified','checked','pending'))
   or not coalesce(f#>>'{value,status}' in('running','completed','partial','failed','idle','not_due'),false)
   or length(coalesce(f#>>'{value,run_key}',''))>160
   or exists(select 1 from jsonb_each(f->'value') e where e.key not in('run_key','status') and (jsonb_typeof(e.value) is distinct from 'number' or e.value::text !~ '^[0-9]{1,6}$'))
  then raise exception 'Invalid audit flow' using errcode='22023';end if;
  if p->>'methodology_version'='ops-v2' and f->>'name'='news' and f->'value' ? 'expected' then
   if not (f->'value' ?& array['checked','pending'])
    or (f#>>'{value,checked}')::integer>(f#>>'{value,expected}')::integer
    or (f#>>'{value,pending}')::integer<>(f#>>'{value,expected}')::integer-(f#>>'{value,checked}')::integer
    or (f#>>'{value,status}'='completed' and (f#>>'{value,pending}')::integer<>0)
   then raise exception 'News coverage must match expected, checked and pending clubs' using errcode='22023';end if;
  end if;
 end loop;
 for metric in select jsonb_build_object('name',key,'value',value) from jsonb_each(p#>'{report,metrics}') loop
  if metric->>'name' not in('wall_ms','read_ms','review_ms','sql_ms','downloads','reused','bytes','retries','tool_calls','chatgpt_tokens')
   or (metric->'value'<>'null'::jsonb and (jsonb_typeof(metric->'value') is distinct from 'number' or metric->>'value' !~ '^[0-9]{1,12}$'))
  then raise exception 'Invalid audit metric' using errcode='22023';end if;
 end loop;
 if jsonb_array_length(p#>'{report,incidents}')>30 or jsonb_array_length(p#>'{report,checks}')>40 then raise exception 'Audit report too long' using errcode='22023';end if;
 for issue in select value from jsonb_array_elements(p#>'{report,incidents}') loop
  if jsonb_typeof(issue) is distinct from 'object' or coalesce(issue->>'code','') !~ '^[a-z][a-z0-9-]{3,79}$'
   or coalesce(issue->>'flow','') not in('forecasts','news','health','history','set_pieces','dispatcher','audit')
   or length(btrim(coalesce(issue->>'summary',''))) not between 10 and 500
   or exists(select 1 from jsonb_object_keys(issue) k where k not in('code','flow','summary'))
  then raise exception 'Invalid audit incident' using errcode='22023';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p#>'{report,checks}') x where jsonb_typeof(x) is distinct from 'string' or length(x#>>'{}') not between 1 and 180)
 then raise exception 'Invalid audit check' using errcode='22023';end if;
 insert into automation_ops.run_log(execution_key,scheduled_for,methodology_version,code_sha,status,report)
 values(p->>'execution_key',scheduled,p->>'methodology_version',p->>'code_sha',p->>'status',p->'report')
 on conflict(execution_key) do update set updated_at=clock_timestamp(),status=excluded.status,report=jsonb_set(excluded.report,'{incidents}',(select coalesce(jsonb_agg(latest.i order by latest.i->>'flow',latest.i->>'code'),'[]'::jsonb) from (select distinct on (i->>'flow',i->>'code') i from jsonb_array_elements((run_log.report->'incidents')||(excluded.report->'incidents')) with ordinality entries(i,n) order by i->>'flow',i->>'code',n desc) latest))
 where run_log.scheduled_for is not distinct from excluded.scheduled_for
  and run_log.methodology_version=excluded.methodology_version and run_log.code_sha=excluded.code_sha
  and (excluded.status<>'running' or run_log.status='running')
 returning jsonb_build_object('execution_key',execution_key,'status',status,'recorded_at',updated_at) into result;
 if result is null then raise exception 'Audit identity changed or completed entry reopened' using errcode='22023';end if;
 return result;
end;$fn$;
revoke all on function automation_ops.record_run(jsonb) from public,anon,authenticated,service_role;
