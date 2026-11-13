begin;

-- Pure clock decision for regression tests; it does not open or publish a run.
create or replace function forecast_season.dispatch_gate_at(p_scheduled_for timestamptz, p_observed_at timestamptz)
returns jsonb language plpgsql immutable set search_path='' as $$
declare target timestamptz:=p_scheduled_for; local_target timestamp; seconds integer; inferred boolean:=false;
begin
 if p_observed_at is null or not isfinite(p_observed_at) then raise exception 'A finite observation time is required'; end if;
 if target is null then
  -- Some runners omit scheduled_for. Cover the observed five-minute early launch.
  target:=date_trunc('hour',p_observed_at at time zone 'America/New_York') at time zone 'America/New_York';
  if p_observed_at>=target+interval '50 minutes' then target:=target+interval '1 hour'; end if;
  inferred:=true;
 end if;
 local_target:=target at time zone 'America/New_York';
 if not isfinite(target) or local_target<>date_trunc('hour',local_target)
  or extract(hour from local_target) not between 6 and 23
  or target<timestamptz '2026-11-12 11:00Z' or target>=timestamptz '2027-07-01 04:00Z'
  or target>p_observed_at+interval '15 minutes' then
  return jsonb_build_object('state','invalid','observed_at',p_observed_at,'scheduled_for',target,'inferred',inferred,'poll_seconds',0);
 end if;
 seconds:=greatest(0,ceil(extract(epoch from target-p_observed_at)))::integer;
 return jsonb_build_object('state',case when seconds>0 then 'wait' when p_observed_at>=target+interval '2 hours' then 'late' else 'ready' end,
  'observed_at',p_observed_at,'scheduled_for',target,'inferred',inferred,'wait_seconds',seconds,'poll_seconds',least(45,seconds));
end;$$;

-- Production entry point always reads the database wall clock. No caller clock.
create or replace function forecast_season.dispatch_gate(p_scheduled_for timestamptz default null)
returns jsonb language sql volatile set search_path='' as $$
 select forecast_season.dispatch_gate_at(p_scheduled_for,clock_timestamp());
$$;
revoke all on function forecast_season.dispatch_gate_at(timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function forecast_season.dispatch_gate(timestamptz) from public,anon,authenticated;
commit;
