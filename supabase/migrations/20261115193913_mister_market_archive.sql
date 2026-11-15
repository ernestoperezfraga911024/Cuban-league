-- Additive storage. No writes to sporting results, participant data or game rules.
create schema mister_market;
revoke all on schema mister_market from public,anon,authenticated,service_role;

create table mister_market.archives (
 sha256 text primary key check(sha256 ~ '^[a-f0-9]{64}$'),
 league_id text not null check(league_id='649733'),
 season text not null check(season='2026-27'),
 codec text not null default 'gzip' check(codec='gzip'),
 body bytea not null check(octet_length(body) between 1 and 10000000),
 raw_sha256 text not null check(raw_sha256 ~ '^[a-f0-9]{64}$'),
 raw_bytes integer not null check(raw_bytes between 1 and 30000000),
 created_at timestamptz not null default now(),
 check(sha256=encode(sha256(body),'hex'))
);
alter table mister_market.archives enable row level security;
revoke all on mister_market.archives from public,anon,authenticated,service_role;

create function mister_market.prevent_archive_mutation() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'market_archive_is_immutable'; end;
$$;
revoke all on function mister_market.prevent_archive_mutation() from public,anon,authenticated,service_role;
create trigger immutable_archive before update or delete on mister_market.archives
for each row execute function mister_market.prevent_archive_mutation();

create table public.mister_market_public (
 league_id text not null check(league_id='649733'),
 season text not null check(season='2026-27'),
 revision text not null check(revision ~ '^[a-f0-9]{64}$'),
 archive_sha256 text not null references mister_market.archives(sha256),
 captured_at timestamptz not null,
 payload jsonb not null,
 visible boolean not null default false,
 published_at timestamptz,
 primary key(league_id,season),
 check(not visible or published_at is not null)
);
alter table public.mister_market_public enable row level security;
revoke all on public.mister_market_public from public,anon,authenticated,service_role;
grant select on public.mister_market_public to anon,authenticated;
create policy market_visible on public.mister_market_public for select to anon,authenticated using(visible);

-- Operator-only staging. A new revision always stays hidden pending review.
create function mister_market.stage(p_archive bytea,p_raw_sha256 text,p_raw_bytes integer,p_payload jsonb,p_expected_revision text default null)
returns jsonb language plpgsql set search_path='' as $$
declare a text:=encode(sha256(p_archive),'hex'); r text:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
 old public.mister_market_public; x jsonb; seen text[]:='{}'; manager_ids text[]; participant_ids text[]; player_ids text[];
begin
 perform pg_advisory_xact_lock(649733,202627);
 if p_payload is null or not(p_payload @> '{"schemaVersion":1,"leagueId":"649733","season":"2026-27"}'::jsonb)
  or (p_payload->>'snapshotHash') is null or (p_payload->>'snapshotHash') !~ '^[a-f0-9]{64}$'
  or (p_payload->>'capturedAt') is null or (p_payload->>'capturedAt')::timestamptz>now()+interval '5 minutes'
  or jsonb_typeof(p_payload->'managers') is distinct from 'array' or jsonb_array_length(p_payload->'managers')<>20
  or jsonb_typeof(p_payload->'players') is distinct from 'array' or jsonb_array_length(p_payload->'players') not between 100 and 2000
  or not coalesce(p_payload->'history' @> '{"source":"player_profiles","completeSeason":false,"reconciliation":"pending"}'::jsonb,false)
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
   or (x->>'date') is null or (x->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
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

create function mister_market.publish(p_revision text) returns boolean
language plpgsql set search_path='' as $$
begin
 update public.mister_market_public set visible=true,published_at=coalesce(published_at,now())
 where league_id='649733' and season='2026-27' and revision=p_revision;
 if not found then raise exception 'market_revision_conflict'; end if;
 return true;
end;
$$;
revoke all on function mister_market.publish(text) from public,anon,authenticated,service_role;
