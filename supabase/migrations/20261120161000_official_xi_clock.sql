-- One private lease per match. A probe can read a real page but cannot write sports history.
create table forecast_history.xi_jobs (
 job_key text primary key, fixture jsonb not null, probe boolean not null default false,
 ticket uuid unique, phase text not null default 'idle', due_at timestamptz not null default now(),
 attempts integer not null default 0, last_attempt timestamptz, report jsonb, request_id bigint
);
create table forecast_history.xi_prediction_pins (
 fixture_key text not null, team text not null, snapshot_id text references forecast_history.snapshots(id),
 primary key(fixture_key,team)
);
revoke all on forecast_history.xi_jobs,forecast_history.xi_prediction_pins from public,anon,authenticated;
-- Limit the original selection to the saved snapshot once an official reading has chosen it.
do $$
declare original text; marker text:='and published_at<=least(now(),cutoff)';
begin
 original:=pg_get_functiondef('forecast_history.build_result(text,text,jsonb)'::regprocedure);
 if position(marker in original)=0 then raise exception 'Unknown snapshot selection'; end if;
 execute replace(original,marker,marker||' and not exists(select 1 from forecast_history.xi_prediction_pins pin
   where pin.fixture_key=p_fixture and pin.team=p_team and pin.snapshot_id is distinct from snapshots.id)');
end $$;

create function forecast_history.queue_xi(jkey text) returns void
language plpgsql set search_path='' as $$
declare capability uuid:=gen_random_uuid(); request bigint;
begin
 update forecast_history.xi_jobs set ticket=capability,phase='queued',due_at=now()+
   case when attempts<3 then interval '2 minutes' when attempts<6 then interval '15 minutes' else interval '1 hour' end,
   attempts=attempts+1,last_attempt=now() where job_key=jkey and due_at<=now();
 if not found then return; end if;
 select net.http_post(url:='https://pyahosamoisqcbpvzwka.supabase.co/functions/v1/official-xi-reader',
   headers:=jsonb_build_object('Content-Type','application/json','X-XI-Ticket',capability),
   body:='{}'::jsonb,timeout_milliseconds:=55000) into request;
 update forecast_history.xi_jobs set request_id=request where job_key=jkey;
end $$;

create function forecast_history.tick_xi() returns void language plpgsql set search_path='' as $$
declare plan jsonb; item jsonb;
begin
 if not pg_try_advisory_xact_lock(726051120) then return; end if;
 plan:=forecast_history.plan();
 for item in select value from jsonb_array_elements(plan->'deliveries') loop
   perform forecast_history.deliver(item->>'fixture_key',item->>'team');
 end loop;
 for item in select value from jsonb_array_elements(plan->'fixtures') loop
   insert into forecast_history.xi_jobs(job_key,fixture) values(item->>'fixture_key',item)
    on conflict(job_key) do update set fixture=excluded.fixture where xi_jobs.due_at<=now();
   perform forecast_history.queue_xi(item->>'fixture_key');
 end loop;
end $$;

-- Only the Edge runtime can access this RPC. Each operation additionally requires a
-- random, expiring ticket issued by the private scheduler for one specific fixture.
create function public.official_xi_worker(action text,ticket uuid,data jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j forecast_history.xi_jobs%rowtype; roster jsonb; team_entry jsonb; t text; xi jsonb;
 details jsonb:='{}'; observed jsonb; outcome jsonb; delivery jsonb; result jsonb; held boolean;
 retry integer; errors boolean:=false; snap text; remaining boolean:=false; seen_stage text;
begin
 select * into j from forecast_history.xi_jobs x where x.ticket=$2 and x.last_attempt>now()-interval '90 seconds' for update;
 if not found then return null; end if;
 if action='claim' and j.phase='queued' then
   update forecast_history.xi_jobs set phase='running' where job_key=j.job_key;
   select jsonb_agg(jsonb_build_object('id',id,'name',name,'team',team)) into roster
     from forecast_league.roster where team in (j.fixture->>'home',j.fixture->>'away');
   return jsonb_build_object('fixture',j.fixture,'roster',roster);
 end if;
 if action<>'finish' or j.phase<>'running' then return null; end if;
 if data is null or octet_length(data::text)>16384 then raise exception 'Invalid worker result'; end if;
 if j.probe then
   update forecast_history.xi_jobs set report=data,ticket=null,phase='probed' where job_key=j.job_key;
   return jsonb_build_object('probe',true);
 end if;
 observed:=jsonb_build_object('key',j.job_key,'season',j.fixture->'season','matchday',j.fixture->'matchday',
   'home',j.fixture->'home','away',j.fixture->'away','kickoff_at',to_char((j.fixture->>'kickoff_at')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
 for team_entry in select value from jsonb_array_elements(j.fixture->'teams') loop
   t:=team_entry->>'team';
   select d.paused or coalesce(r.suppressed,false),r.result->>'verification_stage' into held,seen_stage
    from forecast_season.drafts d left join forecast_history.records r on r.team=d.team and r.fixture_key=j.job_key where d.team=t;
   if coalesce(held,true) or seen_stage='final' then continue; end if;
   xi:=data#>array['teams',t,'starters'];
   if xi is null or data->>'state' is null then
     errors:=true;details:=details||jsonb_build_object(t,coalesce(data#>>array['teams',t,'reason'],data->>'reason','pendiente'));continue;
   end if;
   if seen_stage='initial' and data->>'state'='in_progress' then
     errors:=true;details:=details||jsonb_build_object(t,'pendiente_del_final');continue;
   end if;
   begin
     result:=forecast_history.build_result(j.job_key,t);
     select s.id into snap from forecast_history.snapshots s where s.fixture_key=j.job_key and s.team=t
       and s.projection=result->'prediction' and s.published_at=(result->>'prediction_published_at')::timestamptz order by id desc limit 1;
     insert into forecast_history.xi_prediction_pins values(j.job_key,t,snap) on conflict do nothing;
     outcome:=forecast_history.save_official(jsonb_build_object('team',t,'observed_fixture',observed,'starters',xi,
       'match_state',data->'state','source',jsonb_build_object('id','futbolfantasy','url',j.fixture->>'source_url',
       'fetched_at',data->>'fetched_at','confirmed',true)));
     delivery:=forecast_history.deliver(j.job_key,t);
     details:=details||jsonb_build_object(t,jsonb_build_object('saved',outcome,'delivery',delivery));
     remaining:=remaining or data->>'state'='in_progress';
   exception when others then
     errors:=true;details:=details||jsonb_build_object(t,left(sqlerrm,240));
   end;
 end loop;
 -- First three retries target elapsed minutes 1, 3 and 5; respect provider throttling.
 retry:=case when j.attempts=1 then 60 when j.attempts<4 then 120 when j.attempts<7 then 900 else 3600 end;
 if data->>'reason' in ('http_429','http_403') then retry:=greatest(retry,900); end if;

 update forecast_history.xi_jobs set ticket=null,phase=case when errors or remaining then 'waiting' else 'complete' end,
   due_at=case when errors then greatest(date_trunc('minute',j.last_attempt)+make_interval(secs=>retry), now()+make_interval(secs=>least(coalesce((data->>'retry_seconds')::numeric,0),2147483646)::integer)) else now() end,
   attempts=case when errors then attempts else 0 end,report=jsonb_build_object('state',data->'state','teams',details,'at',now())
   where job_key=j.job_key;
 return details;
end $$;
revoke all on function public.official_xi_worker(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.official_xi_worker(text,uuid,jsonb) to service_role;
revoke all on function forecast_history.queue_xi(text),forecast_history.tick_xi() from public,anon,authenticated;
