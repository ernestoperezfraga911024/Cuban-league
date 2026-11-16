-- Private, bounded pilot. No public data, publication endpoint or scheduled DB job.
create schema forecast_pilot authorization postgres;
revoke all on schema forecast_pilot from public, anon, authenticated, service_role;

create table forecast_pilot.drafts (
  run_key text primary key,
  execution_kind text not null check (execution_kind in ('interactive', 'scheduled')),
  status text not null check (status in ('draft', 'blocked')),
  created_at timestamptz not null default now(),
  publication_allowed boolean not null default false check (publication_allowed = false),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 65536)
);
alter table forecast_pilot.drafts enable row level security;
revoke all on forecast_pilot.drafts from public, anon, authenticated, service_role;

create function forecast_pilot.save_draft(p_run_key text, p_execution_kind text, p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, forecast_pilot
as $body$
declare
  v_source jsonb;
  v_player jsonb;
  v_previous forecast_pilot.drafts%rowtype;
  v_status text;
  v_probability numeric;
  v_sources jsonb;
  v_players jsonb;
  v_source_ids text[];
  v_created timestamptz;
begin
  if p_run_key is null or p_run_key !~ '^pilot-[a-z0-9-]{8,100}$'
     or p_execution_kind is null or p_execution_kind not in ('interactive', 'scheduled') then
    raise exception 'Invalid pilot execution identity' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text) > 65536 then
    raise exception 'Invalid or oversized payload' using errcode = '22023';
  end if;
  if p_payload->>'schema_version' is distinct from '1'
     or p_payload->>'team' is distinct from 'real-madrid'
     or p_payload->>'fixture_key' is distinct from 'laliga-2026-27-j13-real-madrid-celta'
     or p_payload->>'opponent' is distinct from 'celta'
     or p_payload->>'matchday' is distinct from '13'
     or p_payload->>'kickoff_at' is distinct from '2026-11-21T20:00:00Z'
     or p_payload->>'probability_kind' is distinct from 'editorial_uncalibrated'
     or p_payload->'publication_allowed' is distinct from 'false'::jsonb then
    raise exception 'Payload outside the private pilot scope' using errcode = '22023';
  end if;
  v_status := p_payload->>'status';
  if v_status is null or v_status not in ('draft', 'blocked')
     or jsonb_typeof(p_payload->'limitations') is distinct from 'array' then
    raise exception 'Missing status or limitations' using errcode = '22023';
  end if;

  v_sources := p_payload->'sources';
  if jsonb_typeof(v_sources) is distinct from 'array' then
    raise exception 'Sources must be an array' using errcode = '22023';
  end if;
  select array_agg(x->>'id' order by x->>'id') into v_source_ids from jsonb_array_elements(v_sources) x;
  if v_source_ids is distinct from array['comuniate','futbolfantasy','jornadaperfecta'] then
    raise exception 'Exactly the three distinct sources are required' using errcode = '22023';
  end if;
  for v_source in select value from jsonb_array_elements(v_sources) loop
    if v_source->>'url' is null or
      not (case v_source->>'id'
        when 'comuniate' then v_source->>'url' ~ '^https://www\.comuniate\.com/'
        when 'futbolfantasy' then v_source->>'url' ~ '^https://www\.futbolfantasy\.com/'
        when 'jornadaperfecta' then v_source->>'url' ~ '^https://www\.jornadaperfecta\.com/'
        else false end)
      or v_source->>'status' is null or v_source->>'status' not in ('read','unavailable','stale','mismatch')
      or v_source->>'fetched_at' is null then
      raise exception 'Invalid source evidence' using errcode = '22023';
    end if;
    if (v_source->>'fetched_at')::timestamptz > now() + interval '5 minutes'
       or (v_source->>'fetched_at')::timestamptz < now() - interval '2 hours' then
      raise exception 'Source observation time outside pilot window' using errcode = '22023';
    end if;
    if v_source->>'status' = 'read' then
      if v_source->'fixture_verified' is distinct from 'true'::jsonb
         or jsonb_typeof(v_source->'starters') is distinct from 'array' then
        raise exception 'Read source requires verified fixture and starters' using errcode = '22023';
      end if;
      if jsonb_array_length(v_source->'starters') <> 11
         or (select count(distinct lower(btrim(value #>> '{}'))) from jsonb_array_elements(v_source->'starters')) <> 11
         or exists (select 1 from jsonb_array_elements(v_source->'starters') x
                    where jsonb_typeof(x) <> 'string' or length(btrim(x #>> '{}')) = 0) then
        raise exception 'Read source must contain eleven distinct named starters' using errcode = '22023';
      end if;
    elsif v_status = 'draft' then
      raise exception 'Incomplete source coverage must be blocked' using errcode = '22023';
    end if;
  end loop;

  if v_status = 'blocked' then
    if p_payload->'proposal' is distinct from 'null'::jsonb
       or jsonb_array_length(p_payload->'limitations') = 0 then
      raise exception 'Blocked draft requires null proposal and a reason' using errcode = '22023';
    end if;
  else
    if p_payload->'proposal'->>'formation' is distinct from '4-2-3-1'
       or jsonb_typeof(p_payload->'proposal'->'players') is distinct from 'array' then
      raise exception 'Invalid pilot formation or players' using errcode = '22023';
    end if;
    v_players := p_payload->'proposal'->'players';
    if jsonb_array_length(v_players) <> 11
       or (select count(distinct x->>'id') from jsonb_array_elements(v_players) x) <> 11
       or (select count(*) from jsonb_array_elements(v_players) x where x->>'position' = 'GK') <> 1
       or (select count(*) from jsonb_array_elements(v_players) x where x->>'position' = 'DF') <> 4
       or (select count(*) from jsonb_array_elements(v_players) x where x->>'position' = 'MF') <> 5
       or (select count(*) from jsonb_array_elements(v_players) x where x->>'position' = 'FW') <> 1 then
      raise exception 'Invalid eleven or positional composition' using errcode = '22023';
    end if;
    for v_player in select value from jsonb_array_elements(v_players) loop
      if coalesce(v_player->>'id','') !~ '^[a-z0-9-]+$'
         or length(btrim(coalesce(v_player->>'name',''))) = 0
         or length(btrim(coalesce(v_player->>'reason',''))) = 0
         or jsonb_typeof(v_player->'probability') is distinct from 'number' then
        raise exception 'Player requires identity, reason and numeric probability' using errcode = '22023';
      end if;
      v_probability := (v_player->>'probability')::numeric;
      if v_probability < 0 or v_probability > 100 or v_probability <> trunc(v_probability) then
        raise exception 'Probability must be an integer from zero to one hundred' using errcode = '22023';
      end if;
      if v_probability < 70 then
        if jsonb_typeof(v_player->'alternative') is distinct from 'object'
           or coalesce(v_player->'alternative'->>'id','') !~ '^[a-z0-9-]+$'
           or length(btrim(coalesce(v_player->'alternative'->>'name',''))) = 0
           or exists (select 1 from jsonb_array_elements(v_players) x
                      where x->>'id' = v_player->'alternative'->>'id') then
          raise exception 'Below seventy requires a distinct alternative outside the main eleven' using errcode = '22023';
        end if;
      elsif v_player->'alternative' is distinct from 'null'::jsonb then
        raise exception 'At least seventy uses no displayed alternative' using errcode = '22023';
      end if;
    end loop;
  end if;

  perform pg_advisory_xact_lock(hashtext('cuban-league-private-forecast-pilot-v1'));
  select * into v_previous from forecast_pilot.drafts where run_key = p_run_key;
  if found then
    if v_previous.payload is distinct from p_payload or v_previous.execution_kind is distinct from p_execution_kind then
      raise exception 'Run key already used with different content' using errcode = '23505';
    end if;
    return jsonb_build_object('run_key', p_run_key, 'status', v_previous.status,
      'created_at', v_previous.created_at, 'publication_allowed', false, 'already_saved', true);
  end if;
  if (select count(*) from forecast_pilot.drafts) >= 20 then
    raise exception 'Pilot storage limit reached; no automatic expansion' using errcode = '54000';
  end if;
  insert into forecast_pilot.drafts(run_key,execution_kind,status,payload)
    values(p_run_key,p_execution_kind,v_status,p_payload) returning created_at into v_created;
  return jsonb_build_object('run_key',p_run_key,'status',v_status,'created_at',v_created,
    'publication_allowed',false,'already_saved',false);
end;
$body$;
revoke all on function forecast_pilot.save_draft(text,text,jsonb) from public, anon, authenticated, service_role;

comment on schema forecast_pilot is 'One-team private feasibility pilot; no publication, no paid services.';
comment on table forecast_pilot.drafts is 'Private append-only through save_draft; max 20 entries, 64 KiB each. No app role access.';
