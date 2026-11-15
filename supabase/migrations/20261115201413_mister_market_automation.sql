-- Additive worker plumbing; credentials remain private, with explicit workload identity.
create or replace function mister_market.stage(p_archive bytea,p_raw_sha256 text,p_raw_bytes integer,p_payload jsonb,p_expected_revision text default null)
returns jsonb language plpgsql set search_path='' as $$
declare a text:=encode(sha256(p_archive),'hex'); r text:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
 old public.mister_market_public; x jsonb; seen text[]:='{}'; manager_ids text[]; participant_ids text[]; player_ids text[];
begin
 perform pg_advisory_xact_lock(649733,202627);
 if p_payload is null or not(p_payload @> '{"leagueId":"649733","season":"2026-27"}'::jsonb) or (p_payload->>'schemaVersion') not in ('1','2')
  or (p_payload->>'snapshotHash') is null or (p_payload->>'snapshotHash') !~ '^[a-f0-9]{64}$'
  or (p_payload->>'capturedAt') is null or (p_payload->>'capturedAt')::timestamptz>now()+interval '5 minutes'
  or jsonb_typeof(p_payload->'managers') is distinct from 'array' or jsonb_array_length(p_payload->'managers')<>20
  or jsonb_typeof(p_payload->'players') is distinct from 'array' or jsonb_array_length(p_payload->'players') not between 100 and 2000
  or not coalesce((p_payload->>'schemaVersion'='1' and p_payload->'history' @> '{"source":"player_profiles","completeSeason":false,"reconciliation":"pending"}'::jsonb) or (p_payload->>'schemaVersion'='2' and p_payload->'history' @> '{"source":"reconciled","completeSeason":false,"reconciliation":"minimum_confirmed"}'::jsonb),false)
  or jsonb_typeof(p_payload->'history'->'events') is distinct from 'array'
 then raise exception 'invalid_market_projection'; end if;
 select array_agg(value->>'id'),array_agg(value->>'participantId') into manager_ids,participant_ids from jsonb_array_elements(p_payload->'managers');
 if (select count(distinct v) from unnest(manager_ids) v)<>20 or (select count(distinct v) from unnest(participant_ids) v)<>20 then raise exception 'ambiguous_manager_binding'; end if;
 for x in select value from jsonb_array_elements(p_payload->'players') loop
  if (x->>'id') is null or (x->>'id')=any(seen) or (x->>'id') !~ '^[1-9][0-9]*$'
   or (x->>'value') is null or (x->>'value') !~ '^[0-9]+$' or (x->>'value')::numeric>9007199254740991
   or (x->>'position') is null or (x->>'position') not in ('PT','DF','MC','DL')
   or not(x ? 'ownerId') or not(x ? 'clause')
   or (x->>'ownerId' is null and x->>'clause' is not null)
   or (x->>'ownerId' is not null and (not(x->>'ownerId'=any(manager_ids)) or x->>'clause' is null or (x->>'clause') !~ '^[0-9]+$' or (x->>'clause')::numeric>9007199254740991))
  then raise exception 'invalid_market_player'; end if;
  seen:=array_append(seen,x->>'id');
 end loop;
 player_ids:=seen;seen:='{}';
 for x in select value from jsonb_array_elements(p_payload->'history'->'events') loop
  if (x->>'reference') is null or (x->>'reference')=any(seen) or not coalesce(x->>'playerId'=any(player_ids),false)
   or not coalesce(x->>'from'=any(manager_ids),false) or not coalesce(x->>'to'=any(manager_ids),false) or x->>'from'=x->>'to'
   or (x->>'amount') is null or (x->>'amount') !~ '^[0-9]+$' or (x->>'amount')::numeric>9007199254740991
   or not(x ? 'date') or ((x->>'date') is null and p_payload->>'schemaVersion'<>'2') or ((x->>'date') is not null and (x->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
  then raise exception 'invalid_clause_evidence'; end if;
  perform (x->>'date')::date;
  seen:=array_append(seen,x->>'reference');
 end loop;
 select * into old from public.mister_market_public where league_id='649733' and season='2026-27' for update;
 if old.revision is distinct from r and old.revision is distinct from p_expected_revision then raise exception 'market_revision_conflict'; end if;
 if old.captured_at is not null and (p_payload->>'capturedAt')::timestamptz<old.captured_at then raise exception 'stale_market_capture'; end if;
 insert into mister_market.archives(sha256,league_id,season,body,raw_sha256,raw_bytes)
 values(a,'649733','2026-27',p_archive,p_raw_sha256,p_raw_bytes) on conflict(sha256) do nothing;
 if not exists(select 1 from mister_market.archives where sha256=a and raw_sha256=p_raw_sha256 and raw_bytes=p_raw_bytes) then raise exception 'archive_metadata_conflict'; end if;
 if old.revision=r then return jsonb_build_object('outcome','unchanged','revision',r,'archive',a,'visible',old.visible); end if;
 insert into public.mister_market_public(league_id,season,revision,archive_sha256,captured_at,payload)
 values('649733','2026-27',r,a,(p_payload->>'capturedAt')::timestamptz,p_payload)
 on conflict(league_id,season) do update set revision=excluded.revision,archive_sha256=excluded.archive_sha256,captured_at=excluded.captured_at,payload=excluded.payload,visible=false,published_at=null;
 return jsonb_build_object('outcome','staged','revision',r,'archive',a,'visible',false);
end;
$$;
revoke all on function mister_market.stage(bytea,text,integer,jsonb,text) from public,anon,authenticated,service_role;

create table mister_market.worker_config (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 latest_archive text references mister_market.archives(sha256),
 public_key text,
 vault_key uuid,
 sealed_session jsonb,
 active_run text,
 lease_until timestamptz
);
insert into mister_market.worker_config(singleton,latest_archive)
 values(true,(select archive_sha256 from public.mister_market_public where league_id='649733' and season='2026-27'));
alter table mister_market.worker_config enable row level security;
revoke all on mister_market.worker_config from public,anon,authenticated,service_role;
create table mister_market.worker_runs (
 run_id text primary key,sha text not null,mode text not null check(mode in ('test','sync')),
 started_at timestamptz not null default now(),completed_at timestamptz,
 status text not null check(status in ('running','tested','published','failed','expired')),
 archive_sha256 text references mister_market.archives(sha256),revision text,metrics jsonb,error_code text
);
alter table mister_market.worker_runs enable row level security;
revoke all on mister_market.worker_runs from public,anon,authenticated,service_role;

-- No arbitrary SQL, league selection, secret selection or sporting writes.
create function public.mister_market_worker(p_action text,p_run text,p_sha text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg mister_market.worker_config; run mister_market.worker_runs; a mister_market.archives;
 result jsonb; revision text; k text; mode text; compressed bytea; archive_hash text;
begin
 if p_run !~ '^[0-9]+:[0-9]+$' or p_sha !~ '^[a-f0-9]{40}$' then raise exception 'invalid_worker_identity'; end if;
 select * into cfg from mister_market.worker_config where singleton for update;
 if p_action='begin' then
  mode:=p_data->>'mode';if mode is null or mode not in ('test','sync') then raise exception 'invalid_worker_mode'; end if;
  if mode='sync' and not cfg.enabled then return jsonb_build_object('skipped',true,'reason','disabled');end if;
  if cfg.sealed_session is null or cfg.vault_key is null or cfg.public_key is null or cfg.latest_archive is null then raise exception 'worker_not_enrolled';end if;
  if cfg.active_run is not null and cfg.lease_until>now() then raise exception 'worker_busy';end if;
  if cfg.active_run is not null then update mister_market.worker_runs set status='expired',completed_at=now(),error_code='lease_expired' where run_id=cfg.active_run and status='running';end if;
  insert into mister_market.worker_runs(run_id,sha,mode,status) values(p_run,p_sha,mode,'running');
  update mister_market.worker_config set active_run=p_run,lease_until=now()+interval '30 minutes' where singleton;
  select * into a from mister_market.archives where sha256=cfg.latest_archive;
  select decrypted_secret into k from vault.decrypted_secrets where id=cfg.vault_key;
  select p.revision into revision from public.mister_market_public p where league_id='649733' and season='2026-27';
  return jsonb_build_object('privateKey',k,'publicKey',cfg.public_key,'sealedSession',cfg.sealed_session,'expectedRevision',revision,
   'archive',jsonb_build_object('sha256',a.sha256,'rawSha256',a.raw_sha256,'rawBytes',a.raw_bytes,'compressedBase64',encode(a.body,'base64')));
 end if;
 select * into run from mister_market.worker_runs where run_id=p_run;
 if cfg.active_run is distinct from p_run or run.sha is distinct from p_sha or run.status is distinct from 'running' or cfg.lease_until<=now() then raise exception 'worker_fence_rejected';end if;
 if p_action='fail' then
  update mister_market.worker_runs set status='failed',completed_at=now(),error_code=case when (p_data->>'code') ~ '^[a-z_]{1,80}$' then p_data->>'code' else 'reader_failed' end where run_id=p_run;
  update mister_market.worker_config set active_run=null,lease_until=null where singleton;
  return jsonb_build_object('recorded',true);
 elsif p_action<>'finish' then raise exception 'invalid_worker_action';end if;
 if not coalesce(p_data->'sealedSession' @> '{"version":1,"algorithm":"RSA-OAEP-256+A256GCM"}'::jsonb,false) then raise exception 'invalid_sealed_session';end if;
 if (p_data->'payload'->>'capturedAt')::timestamptz<run.started_at-interval '1 minute' or (p_data->'payload'->>'schemaVersion')<>'2' then raise exception 'stale_worker_capture';end if;
 compressed:=decode(p_data->'archive'->>'compressedBase64','base64');archive_hash:=encode(sha256(compressed),'hex');
 if archive_hash is distinct from p_data->'archive'->>'sha256' then raise exception 'archive_hash_mismatch';end if;
 -- A test saves a recoverable archive but never hides or replaces the live page.
 if run.mode='test' then
  insert into mister_market.archives(sha256,league_id,season,body,raw_sha256,raw_bytes)
   values(archive_hash,'649733','2026-27',compressed,p_data->'archive'->>'rawSha256',(p_data->'archive'->>'rawBytes')::integer) on conflict(sha256) do nothing;
  result:=jsonb_build_object('outcome','tested','archive',archive_hash);
 else
  if not cfg.enabled then raise exception 'worker_disabled';end if;
  result:=mister_market.stage(compressed,p_data->'archive'->>'rawSha256',(p_data->'archive'->>'rawBytes')::integer,p_data->'payload',p_data->>'expectedRevision');
  perform mister_market.publish(result->>'revision');
  result:=result||jsonb_build_object('outcome','published','visible',true);
 end if;
 update mister_market.worker_config set latest_archive=archive_hash,sealed_session=p_data->'sealedSession',active_run=null,lease_until=null where singleton;
 update mister_market.worker_runs set completed_at=now(),status=case when run.mode='test' then 'tested' else 'published' end,
  archive_sha256=archive_hash,revision=result->>'revision',metrics=p_data->'metrics' where run_id=p_run;
 return result;
end;
$$;
revoke all on function public.mister_market_worker(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.mister_market_worker(text,text,text,jsonb) to service_role;
