-- Noticias v2: auditable coverage, resumable work and 08:00/11:00/14:00 Miami.
-- Existing publications and completed runs are preserved. Collector-only functions.
do $guard$ begin
 if md5(pg_get_functiondef('league_news.plan()'::regprocedure))<>'106a59df5c19172ce21e23ebeb15986d'
 or md5(pg_get_functiondef('league_news.begin_run(text)'::regprocedure))<>'5fe21c69907165e5963f0456f84f361d'
 or md5(pg_get_functiondef('league_news.save_draft(text,jsonb)'::regprocedure))<>'71e696e2919233dc0eb2d78687bea07b'
 or md5(pg_get_functiondef('league_news.deliver(text)'::regprocedure))<>'6d5b1a04b123918ec021b5a1602106e8'
 or md5(pg_get_functiondef('league_news.finish_run(text,jsonb)'::regprocedure))<>'1335e6c05f91019812c2a00bcd525a02'
 then raise exception 'News functions changed since review';end if;
end;$guard$;

alter table league_news.runs add column contract_version integer not null default 1 check(contract_version in(1,2)),
 add column reason text,add column superseded_by text references league_news.runs(key);
alter table public.news_status add column progress jsonb;
create table league_news.run_teams(
 run_key text not null references league_news.runs(key),team text not null references forecast_league.teams(team),
 status text not null default 'pending' check(status in('pending','reviewed','partial')),checks jsonb,note text,checked_at timestamptz,
 primary key(run_key,team));
create table league_news.run_events(
 run_key text not null references league_news.runs(key),key text not null,team text not null references forecast_league.teams(team),
 status text not null default 'pending' check(status in('pending','failed','omitted','published','unchanged','ready')),
 urls jsonb not null,reason text not null,fetched_at timestamptz not null,updated_at timestamptz not null default now(),
 was_public boolean not null default false,prior_version bigint not null default 0,verified_version bigint,duplicate_of text references league_news.items(key),
 primary key(run_key,key),foreign key(run_key,team) references league_news.run_teams(run_key,team));
alter table league_news.run_teams enable row level security;
alter table league_news.run_events enable row level security;
revoke all on league_news.run_teams,league_news.run_events from public,anon,authenticated,service_role;
create index news_open_runs on league_news.runs(started_at) where finished_at is null and superseded_by is null;
create index news_run_successor on league_news.runs(superseded_by);
create index news_coverage_team on league_news.run_teams(team);
create index news_pending_events on league_news.run_events(run_key,status);
create index news_event_delivery on league_news.run_events(key,run_key);
create index news_event_club_run on league_news.run_events(run_key,team);
create index news_event_team on league_news.run_events(team);
create index news_event_duplicate on league_news.run_events(duplicate_of);
create index news_visible_cursor on public.news_public(updated_at desc,key) where visible;
create index news_visible_club_cursor on public.news_public((payload->>'team'),updated_at desc,key) where visible;

create function league_news.slot_at(p_at timestamptz) returns text language plpgsql stable set search_path='' as $$
declare t timestamp:=p_at at time zone 'America/New_York';h integer;
begin
 if t::date not between date '2026-11-12' and date '2027-06-30' then return null;end if;
 h:=case when extract(hour from t) between 8 and 9 then 8 when extract(hour from t) between 11 and 12 then 11 when extract(hour from t) between 14 and 15 then 14 end;
 if h is null then return null;end if;
 return 'news-'||to_char(t,'YYYYMMDD')||'-'||lpad(h::text,2,'0');
end;$$;

create function league_news.active_run(p_key text) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from league_news.runs where key=p_key and contract_version=2 and finished_at is null and superseded_by is null and started_at>now()-interval '24 hours');
$$;

create function league_news.progress(p_key text) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('run_key',r.key,'started_at',r.started_at,'updated_at',now(),
 'status',case when r.finished_at is not null then case when t.partial>0 or exists(select 1 from jsonb_array_elements(coalesce(r.checks,'[]'))x where x->>'status'='unavailable') then 'partial' else 'complete' end when t.audited=0 and e.total=0 then 'running' else 'incomplete' end,
 'teams_expected',t.total,'teams_reviewed',t.reviewed,'teams_partial',t.partial,
 'pending',e.pending,'new',e.new_count,'updated',e.updated_count,'unchanged',e.unchanged,'omitted',e.omitted,'ready',e.ready,'publication_complete',r.finished_at is not null and e.pending=0 and e.ready=0)
 from league_news.runs r cross join lateral(select count(*) as total,count(*)filter(where status='reviewed') as reviewed,count(*)filter(where status='partial') as partial,count(*)filter(where status<>'pending') as audited from league_news.run_teams where run_key=r.key)t
 cross join lateral(select count(*) as total,count(*)filter(where status in('pending','failed')) as pending,count(*)filter(where status='published' and not was_public) as new_count,count(*)filter(where status='published' and was_public) as updated_count,count(*)filter(where status='unchanged') as unchanged,count(*)filter(where status='omitted') as omitted,count(*)filter(where status='ready') as ready from league_news.run_events where run_key=r.key)e where r.key=p_key;
$$;

create function league_news.refresh_progress(p_key text) returns void language plpgsql set search_path='' as $$
declare p jsonb;r league_news.runs;
begin
 select * into r from league_news.runs where key=p_key;
 if r.contract_version is distinct from 2 then return;end if;
 p:=league_news.progress(p_key);
 update public.news_status set progress=p,result=case when r.finished_at is null then 'partial' else result end
 where coalesce((progress->>'started_at')::timestamptz,'-infinity')<=r.started_at;
end;$$;

create or replace function league_news.plan() returns jsonb language plpgsql stable set search_path='' as $$
declare k text;s text:=league_news.slot_at(now());expired boolean;
begin
 if s is not null and not exists(select 1 from league_news.runs where key=s) then k:=s;
 else select key into k from league_news.runs where contract_version=2 and finished_at is null and superseded_by is null and started_at>now()-interval '24 hours' order by started_at,key limit 1;end if;
 expired:=exists(select 1 from league_news.runs where contract_version=2 and finished_at is null and superseded_by is null and started_at<=now()-interval '24 hours');
 if k is null then
  k:=s;
  if expired and (k is null or exists(select 1 from league_news.runs where key=k)) then k:='news-recovery-'||to_char(now() at time zone 'America/New_York','YYYYMMDD-HH24');end if;
 end if;
 if (now() at time zone 'America/New_York')::date>date '2027-06-30' then k:=null;end if;
 return jsonb_build_object('observed_at',now(),'run_key',k,'scheduled_key',s,'completed',exists(select 1 from league_news.runs where key=k and finished_at is not null),'mode',(select mode from league_news.control),
 'progress',league_news.progress(k),'pending',coalesce((select jsonb_agg(to_jsonb(e) order by e.updated_at,e.key) from league_news.run_events e where e.run_key=k and e.status in('pending','failed','ready')),'[]'),
 'teams',coalesce((select jsonb_agg(to_jsonb(t) order by t.team) from league_news.run_teams t where t.run_key=k),'[]'),
 'recent',coalesce((select jsonb_agg(jsonb_build_object('key',key,'payload',payload,'outcome',outcome,'suppressed',suppressed)) from (select * from league_news.items order by checked_at desc,key limit 80)x),'[]'));
end;$$;

create function league_news.initialize_run(p_key text,p_reason text) returns jsonb language plpgsql set search_path='' as $$
declare old_key text;
begin
 perform 1 from league_news.control for update;
 insert into league_news.runs(key,contract_version,reason) values(p_key,2,p_reason) on conflict do nothing;
 if not league_news.active_run(p_key) then return (select to_jsonb(r) from league_news.runs r where key=p_key);end if;
 insert into league_news.run_teams(run_key,team) select p_key,team from forecast_league.teams on conflict do nothing;
 for old_key in select key from league_news.runs where contract_version=2 and key<>p_key and finished_at is null and superseded_by is null and (started_at<=now()-interval '24 hours' or p_key=league_news.slot_at(now())) order by started_at loop
  insert into league_news.run_events(run_key,key,team,status,urls,reason,fetched_at,was_public,prior_version)
   select p_key,e.key,e.team,'pending',e.urls,'Pendiente trasladado al siguiente turno; comprobar evidencia: '||left(e.reason,400),e.fetched_at,exists(select 1 from public.news_public p where p.key=e.key),coalesce((select version from league_news.items i where i.key=e.key),0)
   from league_news.run_events e where e.run_key=old_key and e.status in('pending','failed','ready') on conflict do nothing;
  update league_news.runs set superseded_by=p_key,reason=coalesce(reason,'')||' · Pendientes trasladados con auditoría; comprobar la evidencia actual.' where key=old_key;
 end loop;
 perform league_news.refresh_progress(p_key);
 return (select to_jsonb(r) from league_news.runs r where key=p_key);
end;$$;

create or replace function league_news.begin_run(p_key text) returns jsonb language plpgsql set search_path='' as $$
begin
 perform 1 from league_news.control for update;
 if p_key is null or p_key is distinct from league_news.plan()->>'run_key' then raise exception 'Invalid news turn';end if;
 return league_news.initialize_run(p_key,'Turno programado o reanudación de pendientes');
end;$$;

create function league_news.begin_exception(p_reason text) returns jsonb language plpgsql set search_path='' as $$
declare k text;
begin
 perform 1 from league_news.control for update;
 if length(trim(coalesce(p_reason,''))) not between 10 and 500 then raise exception 'Explicit exception reason required';end if;
 k:=league_news.plan()->>'run_key';
 if exists(select 1 from league_news.runs where key=k and finished_at is not null) then k:=null;end if;
 if k is null then k:='news-extra-'||to_char(clock_timestamp() at time zone 'UTC','YYYYMMDD-HH24MISS-US');end if;
 perform league_news.initialize_run(k,p_reason);
 return league_news.plan();
end;$$;

create function league_news.valid_checks(p jsonb) returns boolean language plpgsql stable set search_path='' as $$
begin
 if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p)<>3 then return false;end if;
 if (select count(distinct x->>'id') from jsonb_array_elements(p)x where x->>'id' in('futbolfantasy','jornadaperfecta','comuniate'))<>3 then return false;end if;
 return not exists(select 1 from jsonb_array_elements(p)x where coalesce(x->>'status','') not in('read','unavailable') or not league_news.valid_url(x->>'url') or x->>'url' !~ ('^https://(www\.)?'||(x->>'id')||'\.com/') or x->>'fetched_at' is null or (x->>'fetched_at')::timestamptz not between now()-interval '2 hours' and now()+interval '5 minutes');
exception when invalid_datetime_format or datetime_field_overflow then return false;
end;$$;

create function league_news.record_team(p_run text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare s text;
begin
 perform 1 from league_news.control for update;
 if not league_news.active_run(p_run) or not league_news.valid_checks(p->'checks') or length(trim(coalesce(p->>'note',''))) not between 10 and 500 then raise exception 'Invalid club coverage';end if;
 s:=case when exists(select 1 from jsonb_array_elements(p->'checks')x where x->>'status'='unavailable') then 'partial' else 'reviewed' end;
 update league_news.run_teams set status=s,checks=p->'checks',note=p->>'note',checked_at=now() where run_key=p_run and team=p->>'team';
 if not found then raise exception 'Club outside this news run';end if;
 perform league_news.refresh_progress(p_run);return league_news.progress(p_run);
end;$$;

create function league_news.sync_event(p_run text,p_key text) returns void language plpgsql set search_path='' as $$
declare i league_news.items;e league_news.run_events;p public.news_public;s text;
begin
 select * into e from league_news.run_events where run_key=p_run and key=p_key;
 if not found then return;end if;
 select * into i from league_news.items where key=p_key;
 select * into p from public.news_public where key=p_key;
 if i.key is null then return;end if;
 if i.suppressed or (select mode from league_news.control)='manual' and i.outcome<>'published' then s:='ready';
 elsif i.outcome='published' and p.visible and p.payload=i.payload then s:=case when e.was_public and i.version=e.prior_version then 'unchanged' else 'published' end;
 else s:='pending';end if;
 update league_news.run_events set status=s,verified_version=case when s in('published','unchanged','ready') then i.version end,updated_at=now() where run_key=p_run and key=p_key;
 perform league_news.refresh_progress(p_run);
end;$$;

create function league_news.record_event(p_run text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare k text:=p->>'key';s text:=p->>'status';f timestamptz;i league_news.items;
begin
 perform 1 from league_news.control for update;
 if not league_news.active_run(p_run) or k is null or k!~'^[a-z0-9-]{8,140}$' or coalesce(s,'') not in('pending','failed','omitted','published','unchanged','ready') then raise exception 'Invalid event audit';end if;
 if jsonb_typeof(p->'urls') is distinct from 'array' or jsonb_array_length(p->'urls') not between 1 and 10 or exists(select 1 from jsonb_array_elements_text(p->'urls')x where not league_news.valid_url(x)) then raise exception 'Invalid event URLs';end if;
 f:=(p->>'fetched_at')::timestamptz;
 if f is null or f not between now()-interval '2 hours' and now()+interval '5 minutes' or length(trim(coalesce(p->>'reason',''))) not between 10 and 500 then raise exception 'Current observation and reason required';end if;
 if p->>'duplicate_of' is not null and (s<>'omitted' or p->>'duplicate_of'=k or not exists(select 1 from league_news.items where key=p->>'duplicate_of')) then raise exception 'Duplicate must link to another verified event';end if;
 if exists(select 1 from league_news.run_events where run_key=p_run and key=k and team<>p->>'team') then raise exception 'Event club cannot change';end if;
 select * into i from league_news.items where key=k;
 if s in('published','unchanged','ready') and (i.key is null or i.payload->>'team' is distinct from p->>'team') then raise exception 'No matching saved event';end if;
 insert into league_news.run_events(run_key,key,team,status,urls,reason,fetched_at,was_public,prior_version,duplicate_of)
 values(p_run,k,p->>'team',case when s in('published','unchanged','ready') then 'pending' else s end,p->'urls',p->>'reason',f,exists(select 1 from public.news_public where key=k),coalesce(i.version,0),p->>'duplicate_of')
 on conflict(run_key,key) do update set status=excluded.status,urls=excluded.urls,reason=excluded.reason,fetched_at=excluded.fetched_at,updated_at=now(),duplicate_of=excluded.duplicate_of;
 if s in('published','unchanged','ready') then
  perform league_news.sync_event(p_run,k);
  if (select status from league_news.run_events where run_key=p_run and key=k) not in('published','unchanged','ready') then raise exception 'Event not delivered or legitimately private';end if;
 end if;
 perform league_news.refresh_progress(p_run);return (select to_jsonb(e) from league_news.run_events e where run_key=p_run and key=k);
end;$$;

create function league_news.track_saved(p_run text,p jsonb) returns void language plpgsql set search_path='' as $$
begin
 if (select contract_version from league_news.runs where key=p_run)<>2 then return;end if;
 perform league_news.record_event(p_run,jsonb_build_object('key',p->>'key','team',p->>'team','status','pending','urls',(select jsonb_agg(x->>'url') from jsonb_array_elements(p->'sources')x),'fetched_at',(select min((x->>'fetched_at')::timestamptz) from jsonb_array_elements(p->'sources')x),'reason','Acontecimiento validado; pendiente de comprobar la entrega pública.'));
end;$$;

do $patch$ declare s text;begin
 s:=pg_get_functiondef('league_news.save_draft(text,jsonb)'::regprocedure);
 s:=replace(s,'if not exists(select 1 from league_news.runs where key=p_run and finished_at is null and started_at>now()-interval ''2 hours'') then',
 'if not exists(select 1 from league_news.runs where key=p_run and finished_at is null and superseded_by is null and started_at>now()-case when contract_version=2 then interval ''24 hours'' else interval ''2 hours'' end) then');
 s:=replace(s,'select * into old from league_news.items where key=k for update;','perform league_news.track_saved(p_run,p); select * into old from league_news.items where key=k for update;');
 s:=replace(s,'return jsonb_build_object(''outcome'',''unchanged'',''key'',k);','perform league_news.sync_event(p_run,k); return jsonb_build_object(''outcome'',''unchanged'',''key'',k);');
 execute s;
 s:=pg_get_functiondef('league_news.deliver(text)'::regprocedure);
 s:=replace(s,'declare r league_news.items;','declare r league_news.items; audit_run text;');
 s:=replace(s,'if r.suppressed or (select mode from league_news.control)=''manual'' then return', 'if r.suppressed or (select mode from league_news.control)=''manual'' then for audit_run in select run_key from league_news.run_events e join league_news.runs n on n.key=e.run_key where e.key=p_key and n.finished_at is null and n.superseded_by is null loop perform league_news.sync_event(audit_run,p_key);end loop; return');
 s:=replace(s,'if r.outcome=''published'' then return', 'if r.outcome=''published'' then for audit_run in select run_key from league_news.run_events e join league_news.runs n on n.key=e.run_key where e.key=p_key and n.finished_at is null and n.superseded_by is null loop perform league_news.sync_event(audit_run,p_key);end loop; return');
 s:=replace(s,'return jsonb_build_object(''outcome'',''published'',''key'',p_key);','for audit_run in select run_key from league_news.run_events e join league_news.runs n on n.key=e.run_key where e.key=p_key and n.finished_at is null and n.superseded_by is null loop perform league_news.sync_event(audit_run,p_key);end loop; return jsonb_build_object(''outcome'',''published'',''key'',p_key);');
 execute s;
end;$patch$;

create or replace function league_news.finish_run(p_key text,p_checks jsonb) returns jsonb language plpgsql set search_path='' as $$
declare r league_news.runs;e record;partial boolean;
begin
 perform 1 from league_news.control for update;
 select * into r from league_news.runs where key=p_key for update;
 if r.key is null then raise exception 'Unknown news run';end if;
 if r.finished_at is not null then return jsonb_build_object('outcome','unchanged');end if;
 if not league_news.valid_checks(p_checks) then raise exception 'Three current source checks required';end if;
 if r.contract_version=2 then
  if not league_news.active_run(p_key) then raise exception 'Run expired; carry pending work into a fresh run';end if;
  for e in select key from league_news.run_events where run_key=p_key and status in('published','unchanged','ready') loop perform league_news.sync_event(p_key,e.key);end loop;
  if exists(select 1 from league_news.run_teams where run_key=p_key and status='pending') or (select count(*) from league_news.run_teams where run_key=p_key)<>(select count(*) from forecast_league.teams) or exists(select 1 from league_news.run_events where run_key=p_key and status in('pending','failed')) then
   perform league_news.refresh_progress(p_key);return jsonb_build_object('outcome','incomplete','progress',league_news.progress(p_key));
  end if;
 end if;
 partial:=exists(select 1 from jsonb_array_elements(p_checks)x where x->>'status'='unavailable') or exists(select 1 from league_news.run_teams where run_key=p_key and status='partial');
 update league_news.runs set finished_at=now(),checks=p_checks where key=p_key;
 update public.news_status set checked_at=now(),coverage=p_checks,result=case when partial then 'partial' else 'checked' end;
 perform league_news.refresh_progress(p_key);
 return jsonb_build_object('outcome','finished','coverage_complete',not partial,'progress',league_news.progress(p_key));
end;$$;

revoke all on all functions in schema league_news from public,anon,authenticated,service_role;
