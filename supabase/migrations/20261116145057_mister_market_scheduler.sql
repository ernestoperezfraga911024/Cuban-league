-- Independent clock. Installed disabled; never contains credentials or sporting data.
create extension if not exists pg_net;
create extension if not exists pg_cron with schema pg_catalog;

create table mister_market.scheduler_config (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 dispatch_mode text not null default 'test' check(dispatch_mode in ('test','sync')),
 last_tick_at timestamptz,
 last_error text
);
insert into mister_market.scheduler_config(singleton) values(true);
create table mister_market.scheduler_slots (
 id uuid primary key default gen_random_uuid(),
 scheduled_for timestamptz not null,
 mode text not null check(mode in ('test','sync')),
 status text not null default 'pending' check(status in ('pending','requested','running','tested','published','failed','exhausted','expired')),
 worker_run text references mister_market.worker_runs(run_id),
 created_at timestamptz not null default now(),
 started_at timestamptz,
 completed_at timestamptz,
 error_code text,
 unique(scheduled_for,mode)
);
create table mister_market.scheduler_attempts (
 id uuid primary key default gen_random_uuid(),
 slot_id uuid not null references mister_market.scheduler_slots(id),
 requested_at timestamptz not null default now(),
 request_id bigint unique,
 response_at timestamptz,
 http_status integer,
 github_run_id text,
 error_code text
);
create index scheduler_attempts_slot_idx on mister_market.scheduler_attempts(slot_id,requested_at);
alter table mister_market.worker_runs add column scheduler_slot uuid references mister_market.scheduler_slots(id);
alter table mister_market.scheduler_config enable row level security;
alter table mister_market.scheduler_slots enable row level security;
alter table mister_market.scheduler_attempts enable row level security;
revoke all on mister_market.scheduler_config,mister_market.scheduler_slots,mister_market.scheduler_attempts from public,anon,authenticated,service_role;

-- Pure calendar helper; all mutations below use the database's actual clock.
create function mister_market.latest_slot(p_now timestamptz)
returns timestamptz language sql stable strict set search_path='' as $$
 select max(candidate) from (
  select ((p_now at time zone 'America/New_York')::date - d + make_time(h,0,0)) at time zone 'America/New_York' as candidate
  from generate_series(0,1) d cross join unnest(array[4,9,13,17,21]) h
 ) s where candidate<=p_now;
$$;
revoke all on function mister_market.latest_slot(timestamptz) from public,anon,authenticated,service_role;

-- Preserve the existing worker/lease/publication implementation, behind one gate.
alter function public.mister_market_worker(text,text,text,jsonb) set schema mister_market;
alter function mister_market.mister_market_worker(text,text,text,jsonb) rename to worker_core;
revoke all on function mister_market.worker_core(text,text,text,jsonb) from public,anon,authenticated,service_role;
create function public.mister_market_worker(p_action text,p_run text,p_sha text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg mister_market.scheduler_config; slot mister_market.scheduler_slots;
 wc mister_market.worker_config; outcome jsonb; due timestamptz; dispatch uuid; origin text;
begin
 if p_action='begin' then
  select * into cfg from mister_market.scheduler_config where singleton for update;
  origin:=p_data->>'event';
  if cfg.enabled and (origin is null or origin not in ('schedule','workflow_dispatch')) then raise exception 'invalid_worker_origin';end if;
  if nullif(p_data->>'dispatchId','') is not null then
   if not cfg.enabled then return jsonb_build_object('skipped',true,'reason','scheduler_disabled');end if;
   if origin is distinct from 'workflow_dispatch' or (p_data->>'dispatchId') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'invalid_dispatch';end if;
   dispatch:=(p_data->>'dispatchId')::uuid;
   select s.* into slot from mister_market.scheduler_slots s join mister_market.scheduler_attempts a on a.slot_id=s.id where a.id=dispatch;
   if slot.id is null or slot.mode is distinct from p_data->>'mode' then raise exception 'invalid_dispatch';end if;
   if slot.mode<>cfg.dispatch_mode then return jsonb_build_object('skipped',true,'reason','superseded_mode');end if;
  elsif cfg.enabled and cfg.dispatch_mode='sync' and origin='schedule' then
   -- Native schedule remains a fallback. A late event may only claim the current
   -- due slot; it cannot replay an old slot or repeat a completed publication.
   due:=mister_market.latest_slot(now());
   if now()>=due+interval '90 minutes' then return jsonb_build_object('skipped',true,'reason','outside_slot');end if;
   insert into mister_market.scheduler_slots(scheduled_for,mode) values(due,'sync') on conflict(scheduled_for,mode) do nothing;
   select * into slot from mister_market.scheduler_slots where scheduled_for=due and mode='sync';
  end if;
  if slot.id is not null then
   if slot.status in ('tested','published') then return jsonb_build_object('skipped',true,'reason','slot_complete');end if;
   if now()<slot.scheduled_for or now()>=slot.scheduled_for+interval '90 minutes' then return jsonb_build_object('skipped',true,'reason','outside_slot');end if;
   select * into wc from mister_market.worker_config where singleton for update;
   if wc.active_run is not null and wc.lease_until>now() then return jsonb_build_object('skipped',true,'reason','worker_busy');end if;
  end if;
  outcome:=mister_market.worker_core(p_action,p_run,p_sha,p_data);
  if slot.id is not null and not coalesce((outcome->>'skipped')::boolean,false) then
   update mister_market.worker_runs set scheduler_slot=slot.id where run_id=p_run;
   update mister_market.scheduler_slots set worker_run=p_run,status='running',started_at=now(),completed_at=null,error_code=null where id=slot.id;
  end if;
  return outcome;
 end if;
 -- Core verifies the run, SHA and unexpired lease before any completion write.
 outcome:=mister_market.worker_core(p_action,p_run,p_sha,p_data);
 update mister_market.scheduler_slots s set status=r.status,completed_at=r.completed_at,error_code=r.error_code
  from mister_market.worker_runs r where r.run_id=p_run and s.id=r.scheduler_slot and s.worker_run=p_run;
 return outcome;
end;
$$;
revoke all on function public.mister_market_worker(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.mister_market_worker(text,text,text,jsonb) to service_role;

create function mister_market.scheduler_tick()
returns jsonb language plpgsql set search_path='' as $$
declare cfg mister_market.scheduler_config; wc mister_market.worker_config; slot mister_market.scheduler_slots;
 due timestamptz; tries integer; last_request timestamptz; token text; attempt uuid; request bigint; resp record; run_number text;
begin
 if not pg_try_advisory_xact_lock(649733,202628) then return jsonb_build_object('outcome','busy');end if;
 select * into cfg from mister_market.scheduler_config where singleton for update;
 update mister_market.scheduler_config set last_tick_at=now() where singleton;
 if not cfg.enabled then return jsonb_build_object('outcome','disabled');end if;
 -- Copy only safe response metadata; never persist response bodies or headers.
 for resp in select a.id,r.status_code,r.timed_out,r.error_msg,r.content from mister_market.scheduler_attempts a
  join net._http_response r on r.id=a.request_id where a.response_at is null loop
  run_number:=null;
  if resp.status_code=200 then
   begin
    run_number:=resp.content::jsonb->>'workflow_run_id';
    if run_number !~ '^[0-9]+$' then run_number:=null;end if;
   exception when others then run_number:=null;
   end;
  end if;
  update mister_market.scheduler_attempts set response_at=now(),http_status=resp.status_code,github_run_id=run_number,
   error_code=case when resp.timed_out then 'dispatch_timeout' when resp.error_msg is not null then 'dispatch_transport_error'
    when resp.status_code not in (200,204) or resp.status_code is null then 'dispatch_http_error' else null end where id=resp.id;
 end loop;
 select * into wc from mister_market.worker_config where singleton for update;
 update mister_market.scheduler_slots set status='expired',error_code='slot_window_expired',completed_at=now()
  where scheduled_for+interval '90 minutes'<=now() and status not in ('published','tested','expired')
  and not coalesce(status='running' and worker_run is not distinct from wc.active_run and wc.lease_until>now(),false);
 if cfg.dispatch_mode='sync' and not wc.enabled then return jsonb_build_object('outcome','worker_disabled');end if;
 if wc.active_run is not null and wc.lease_until>now() then return jsonb_build_object('outcome','worker_running');end if;
 due:=mister_market.latest_slot(now());
 if now()>=due+interval '90 minutes' then return jsonb_build_object('outcome','not_due');end if;
 insert into mister_market.scheduler_slots(scheduled_for,mode) values(due,cfg.dispatch_mode) on conflict(scheduled_for,mode) do nothing;
 select * into slot from mister_market.scheduler_slots where scheduled_for=due and mode=cfg.dispatch_mode for update;
 if slot.status in ('published','tested','exhausted','expired') then return jsonb_build_object('outcome',slot.status,'slot',slot.id);end if;
 select count(*),max(requested_at) into tries,last_request from mister_market.scheduler_attempts where slot_id=slot.id;
 if last_request>now()-interval '10 minutes' then return jsonb_build_object('outcome','awaiting_start','slot',slot.id);end if;
 if tries>=3 then
  update mister_market.scheduler_slots set status='exhausted',error_code='dispatch_attempts_exhausted',completed_at=now() where id=slot.id;
  return jsonb_build_object('outcome','exhausted','slot',slot.id);
 end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='mister_market_github_dispatch_token';
 if token is null or length(token)<20 then
  update mister_market.scheduler_config set last_error='github_credential_missing' where singleton;
  return jsonb_build_object('outcome','blocked','reason','github_credential_missing');
 end if;
 -- All URLs, repository, ref, workflow and permitted input keys are fixed.
 begin
  insert into mister_market.scheduler_attempts(slot_id) values(slot.id) returning id into attempt;
  request:=net.http_post(
   url:='https://api.github.com/repos/ernestoperezfraga911024/Cuban-league/actions/workflows/mister-market-sync.yml/dispatches',
   body:=jsonb_build_object('ref','main','inputs',jsonb_build_object('mode',slot.mode,'dispatch_id',attempt::text)),
   headers:=jsonb_build_object('Accept','application/vnd.github+json','Content-Type','application/json','Authorization','Bearer '||token,
    'User-Agent','Cuban-League-Market-Scheduler','X-GitHub-Api-Version','2026-03-10'),timeout_milliseconds:=15000);
  update mister_market.scheduler_attempts set request_id=request where id=attempt;
  update mister_market.scheduler_slots set status='requested',error_code=null where id=slot.id;
  update mister_market.scheduler_config set last_error=null where singleton;
 exception when others then
  -- The subtransaction rolls back the failed enqueue. Record a safe attempt
  -- outside it so even database/network enqueue failures obey the same cap.
  insert into mister_market.scheduler_attempts(slot_id,response_at,error_code) values(slot.id,now(),'dispatch_enqueue_failed');
  update mister_market.scheduler_slots set status='failed',error_code='dispatch_enqueue_failed' where id=slot.id;
  update mister_market.scheduler_config set last_error='dispatch_enqueue_failed' where singleton;
  return jsonb_build_object('outcome','blocked','reason','dispatch_enqueue_failed');
 end;
 return jsonb_build_object('outcome','requested','slot',slot.id,'attempt',attempt,'number',tries+1);
end;
$$;
revoke all on function mister_market.scheduler_tick() from public,anon,authenticated,service_role;
-- The command and job logs contain no credentials. Disabled config does no HTTP.
select cron.schedule('cuban-league-market-dispatch','* * * * *','select mister_market.scheduler_tick();');
