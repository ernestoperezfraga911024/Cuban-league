-- Private append-only metadata. No raw requests, SQL, URLs, page bodies or secrets.
-- Install after automation_ops audit.sql; does not alter any sporting table/function.
create table automation_ops.trace_events(
 execution_key text not null,
 process_id uuid not null,
 seq integer not null check(seq>0),
 run_key text not null,
 code_sha text not null,
 occurred_at timestamptz not null,
 recorded_at timestamptz not null default clock_timestamp(),
 event jsonb not null,
 primary key(execution_key,process_id,seq)
);
create index trace_events_run_time on automation_ops.trace_events(run_key,occurred_at);
alter table automation_ops.trace_events enable row level security;
revoke all on automation_ops.trace_events from public,anon,authenticated,service_role;

create function automation_ops.record_trace(p jsonb) returns jsonb
language plpgsql set search_path='' as $fn$
declare item jsonb; old automation_ops.trace_events%rowtype; instant timestamptz; n integer:=0;
begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>65536
  or exists(select 1 from jsonb_object_keys(p) k where k not in('execution_key','process_id','run_key','code_sha','events'))
  or coalesce(p->>'execution_key','') !~ '^[a-z0-9-]{5,120}$'
  or coalesce(p->>'process_id','') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  or coalesce(p->>'run_key','') !~ '^season-[a-z0-9-]{1,150}$'
  or coalesce(p->>'code_sha','') !~ '^[a-f0-9]{40}$'
  or jsonb_typeof(p->'events') is distinct from 'array'
 then raise exception 'Invalid trace envelope' using errcode='22023'; end if;
 if jsonb_array_length(p->'events') not between 1 and 64 then raise exception 'Invalid trace batch size' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended((p->>'execution_key')||':'||(p->>'process_id'),0));
 select * into old from automation_ops.trace_events where execution_key=p->>'execution_key' and process_id=(p->>'process_id')::uuid limit 1;
 if found and (old.run_key<>p->>'run_key' or old.code_sha<>p->>'code_sha') then raise exception 'Trace process identity changed' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p->'events') loop
  if jsonb_typeof(item) is distinct from 'object' or octet_length(item::text)>1024
   or exists(select 1 from jsonb_object_keys(item) k where k not in('seq','occurred_at','phase','status','team','request_id','error_code','duration_ms','bytes','count','http_status','body_sha256','response_sha256','event_sha256','source','kind'))
   or jsonb_typeof(item->'seq') is distinct from 'number' or coalesce(item->>'seq','') !~ '^[1-9][0-9]{0,8}$'
   or coalesce(item->>'phase','') !~ '^[a-zA-Z0-9_-]{1,80}$'
   or not coalesce(item->>'status' in('started','completed','error','pending','accepted','timeout','protocol_error','published','ready','blocked','saved','missing','unknown','interrupted','partial','idle','reused'),false)
   or (item ? 'source' and not coalesce(item->>'source' in('futbolfantasy','jornadaperfecta','comuniate','predicted11'),false))
   or (item ? 'kind' and not coalesce(item->>'kind' in('page','script','ballot'),false))
   or exists(select 1 from jsonb_each(item) x where x.key in('team','request_id','error_code') and (jsonb_typeof(x.value) is distinct from 'string' or x.value#>>'{}' !~ '^[a-zA-Z0-9_-]{1,80}$'))
   or exists(select 1 from jsonb_each(item) x where x.key in('duration_ms','bytes','count','http_status') and (jsonb_typeof(x.value) is distinct from 'number' or x.value::text !~ '^[0-9]{1,16}$' or (x.value#>>'{}')::numeric>9007199254740991))
   or coalesce(item->>'event_sha256','') !~ '^[a-f0-9]{64}$'
   or exists(select 1 from jsonb_each(item) x where x.key in('body_sha256','response_sha256') and (jsonb_typeof(x.value) is distinct from 'string' or x.value#>>'{}' !~ '^[a-f0-9]{64}$'))
   or coalesce(item->>'occurred_at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
  then raise exception 'Invalid trace event' using errcode='22023';end if;
  instant:=(item->>'occurred_at')::timestamptz;
  if instant>clock_timestamp()+interval '5 minutes' then raise exception 'Future trace event' using errcode='22023';end if;
  insert into automation_ops.trace_events(execution_key,process_id,seq,run_key,code_sha,occurred_at,event)
   values(p->>'execution_key',(p->>'process_id')::uuid,(item->>'seq')::integer,p->>'run_key',p->>'code_sha',instant,item)
   on conflict(execution_key,process_id,seq) do nothing;
  select * into old from automation_ops.trace_events where execution_key=p->>'execution_key' and process_id=(p->>'process_id')::uuid and seq=(item->>'seq')::integer;
  if old.run_key<>p->>'run_key' or old.code_sha<>p->>'code_sha' or old.event<>item
   then raise exception 'Trace event identity conflict' using errcode='22023';end if;
  n:=n+1;
 end loop;
 return jsonb_build_object('accepted',true,'events',n);
end;$fn$;
revoke all on function automation_ops.record_trace(jsonb) from public,anon,authenticated,service_role;
