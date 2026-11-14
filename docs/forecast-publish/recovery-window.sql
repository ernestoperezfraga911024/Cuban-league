-- Private recovery runs retain fresh evidence limits and the existing delivery path.
-- Run through apply_migration after review. No public payload is changed here.
do $guard$ begin
 if md5(pg_get_functiondef('forecast_season.plan()'::regprocedure))<>'2aa4e0aaef68ecd908a8a4397453a2e1'
 or md5(pg_get_functiondef('forecast_season.finish_run(text)'::regprocedure))<>'d94774781a0a6cf14a275db73d558235'
 or md5(pg_get_functiondef('forecast_season.deliver(text)'::regprocedure))<>'724cd9ce5bb3aec9c975e54eb32b87e5'
 or md5(pg_get_functiondef('forecast_season.save_draft(text,jsonb)'::regprocedure))<>'a232b47346fd31589f2086b15fc354aa'
 or md5(pg_get_functiondef('forecast_season.check_attempt(text,text)'::regprocedure))<>'768e3dd966fc7791fe2dfccb40c4a036'
 then raise exception 'Recovery prerequisites changed; review installed functions';end if;
end;$guard$;

create table forecast_season.recovery_requests(
 request_id uuid primary key,
 run_key text not null unique references forecast_season.runs(key),
 source_run_key text not null references forecast_season.runs(key),
 reason text not null check(length(reason) between 10 and 1000),
 automatic boolean not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 closed_at timestamptz,
 check(expires_at>created_at and expires_at<=created_at+interval '2 hours')
);
alter table forecast_season.recovery_requests enable row level security;
revoke all on forecast_season.recovery_requests from public,anon,authenticated,service_role;

-- Copy, rather than rename, keeps plan()'s OID and existing callers intact.
do $copy$ begin
 execute replace(pg_get_functiondef('forecast_season.plan()'::regprocedure),
  'FUNCTION forecast_season.plan()', 'FUNCTION forecast_season.plan_scheduled()');
end;$copy$;

create or replace function forecast_season.plan() returns jsonb
language plpgsql stable security invoker set search_path='' as $body$
declare token text:=nullif(current_setting('forecast_season.recovery_request',true),'');
 q forecast_season.recovery_requests%rowtype; r forecast_season.runs%rowtype;
 cfg forecast_season.control%rowtype; items jsonb;
begin
 if token is null then return forecast_season.plan_scheduled();end if;
 select * into q from forecast_season.recovery_requests where request_id::text=token;
 if q.request_id is null or q.closed_at is not null or q.expires_at<=now()
 or now()>=timestamptz '2027-07-01 04:00Z'
 then raise exception 'Recuperación inexistente, cerrada o caducada' using errcode='22023';end if;
 select * into r from forecast_season.runs where key=q.run_key;
 select * into cfg from forecast_season.control;
 select coalesce(jsonb_agg(jsonb_build_object('team',t.team,'fixture',to_jsonb(f)-'checks',
  'comuniate_team_url',t.source_urls->>'comuniate','needs_fixture',f.key is null,'paused',d.paused) order by t.team),'[]'::jsonb)
 into items from forecast_league.teams t join forecast_season.drafts d using(team)
 left join lateral(select * from forecast_season.fixtures f where t.team in(f.home,f.away)
  and f.kickoff_at>now() order by f.kickoff_at,f.key limit 1)f on true
 where r.expected ? t.team;
 return jsonb_build_object('observed_at',now(),'slot',r.slot_at,'run_key',r.key,
  'mode',cfg.mode,'version',cfg.version,'teams',items,'recovery_request',q.request_id,
  'source_run_key',q.source_run_key,'expires_at',q.expires_at);
end;$body$;

-- A later recovery's terminal result counts once. Generic old blocks remain blocks.
create function forecast_season.recovery_pending(p_source text) returns jsonb
language sql stable security invoker set search_path='' as $body$
 select coalesce(jsonb_agg(t.team order by t.team),'[]'::jsonb)
 from forecast_season.runs r cross join lateral jsonb_array_elements_text(r.expected)t(team)
 where r.key=p_source and not exists(
  select 1 from forecast_season.attempts a
  where a.team=t.team and a.outcome in('published','ready','blocked')
   and (a.run_key=p_source or a.run_key in(
    select q.run_key from forecast_season.recovery_requests q where q.source_run_key=p_source))
 );
$body$;

create function forecast_season.begin_recovery(p_request uuid,p_source text,p_teams jsonb,p_reason text,p_automatic boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $body$
declare old forecast_season.recovery_requests%rowtype; source forecast_season.runs%rowtype;
 ids jsonb; k text; pending jsonb; created timestamptz:=now();
begin
 perform 1 from forecast_season.control for update;
 if p_request is null or p_source is null or p_reason is null or length(p_reason) not between 10 and 1000
 or p_automatic is null or jsonb_typeof(p_teams) is distinct from 'array'
 then raise exception 'Solicitud de recuperación inválida' using errcode='22023';end if;
 if jsonb_array_length(p_teams) not between 1 and 20
 or exists(select 1 from jsonb_array_elements(p_teams)x where jsonb_typeof(x)<>'string')
 or (select count(distinct x) from jsonb_array_elements_text(p_teams)x)<>jsonb_array_length(p_teams)
 then raise exception 'Equipos de recuperación inválidos' using errcode='22023';end if;
 select jsonb_agg(x order by x) into ids from jsonb_array_elements_text(p_teams)x;
 select * into source from forecast_season.runs where key=p_source;
 if source.key is null or source.key !~ '^season-[0-9]{8}-[0-9]{4}$'
 or source.slot_at<now()-interval '24 hours' or source.slot_at>now()
 or now()<timestamptz '2026-11-12 14:00Z' or now()>=timestamptz '2027-07-01 04:00Z'
 or exists(select 1 from jsonb_array_elements_text(ids)x where not(source.expected ? x)
  or not exists(select 1 from forecast_season.drafts d where d.team=x))
 then raise exception 'Origen o equipos fuera del alcance de recuperación' using errcode='22023';end if;
 select * into old from forecast_season.recovery_requests where request_id=p_request;
 if found then
  if old.source_run_key<>p_source or old.reason<>p_reason or old.automatic<>p_automatic
   or (select expected from forecast_season.runs where key=old.run_key)<>ids
  then raise exception 'Solicitud reutilizada con otro contenido' using errcode='23505';end if;
  perform set_config('forecast_season.recovery_request',p_request::text,true);
  return forecast_season.begin_run();
 end if;
 if exists(select 1 from forecast_season.commands where request_id=p_request)
 then raise exception 'Identificador ya utilizado' using errcode='23505';end if;
 if p_automatic then
  pending:=forecast_season.recovery_pending(p_source);
  if ids is distinct from pending or p_source is distinct from(
   select key from forecast_season.runs where key ~ '^season-[0-9]{8}-[0-9]{4}$' order by slot_at desc limit 1)
  then raise exception 'La recuperación automática admite solo equipos pendientes del último turno' using errcode='22023';end if;
  if exists(select 1 from forecast_season.attempts a join forecast_season.drafts d on d.run_key=a.key
   left join forecast_season.recovery_requests q on q.run_key=a.run_key
   where a.outcome='saved' and ids ? a.team and (a.run_key=p_source or q.source_run_key=p_source)
   and (d.projection->>'evidence_at')::timestamptz>=now()-interval '2 hours'
   and (q.request_id is null or (q.closed_at is null and q.expires_at>now()))
   and not exists(select 1 from public.forecast_season_public pub where pub.team=a.team and (
    (pub.payload->>'evidence_at')::timestamptz>(d.projection->>'evidence_at')::timestamptz
    or (q.request_id is not null and pub.published_at>q.created_at))))
  then raise exception 'Entrega primero los borradores guardados' using errcode='40001';end if;
 end if;
 if exists(select 1 from forecast_season.recovery_requests q join forecast_season.runs r on r.key=q.run_key
  where q.closed_at is null and q.expires_at>now() and exists(select 1 from jsonb_array_elements_text(ids)x where r.expected ? x))
 then raise exception 'Hay una recuperación activa para estos equipos' using errcode='40001';end if;
 if (select count(*) from forecast_season.runs)>=1000 then raise exception 'Límite de ejecuciones de temporada' using errcode='54000';end if;
 k:='season-recovery-'||p_request::text;
 insert into forecast_season.runs(key,slot_at,expected) values(k,created,ids);
 insert into forecast_season.recovery_requests(request_id,run_key,source_run_key,reason,automatic,created_at,expires_at)
 values(p_request,k,p_source,p_reason,p_automatic,created,least(created+interval '2 hours',timestamptz '2027-07-01 04:00Z'));
 insert into forecast_season.commands(request_id,request,result) values(p_request,
  jsonb_build_object('action','begin_recovery','source_run_key',p_source,'teams',ids,'reason',p_reason,'automatic',p_automatic),
  jsonb_build_object('run_key',k,'source_run',to_jsonb(source),'source_attempts',coalesce((select jsonb_agg(to_jsonb(a)) from forecast_season.attempts a where a.run_key=p_source),'[]'::jsonb),
   'previous_drafts',(select jsonb_agg(to_jsonb(d)) from forecast_season.drafts d where ids ? d.team),
   'previous_public',(select jsonb_agg(to_jsonb(p)) from public.forecast_season_public p where ids ? p.team)));
 perform set_config('forecast_season.recovery_request',p_request::text,true);
 return forecast_season.begin_run();
end;$body$;

-- Hourly callers can resume a missed window without changing scheduled hours.
create function forecast_season.resume_incomplete() returns jsonb
language plpgsql security invoker set search_path='' as $body$
declare source forecast_season.runs%rowtype; q forecast_season.recovery_requests%rowtype; ids jsonb; scheduled jsonb; saved jsonb;
begin
 perform 1 from forecast_season.control for update;
 perform set_config('forecast_season.recovery_request','',true);
 scheduled:=forecast_season.plan_scheduled();
 if scheduled->>'run_key' is not null then return jsonb_build_object('outcome','scheduled_window','plan',scheduled);end if;
 select * into source from forecast_season.runs where key ~ '^season-[0-9]{8}-[0-9]{4}$'
  and slot_at>=now()-interval '24 hours' and slot_at<=now() order by slot_at desc limit 1;
 if source.key is null then return jsonb_build_object('outcome','no_recent_run');end if;
 ids:=forecast_season.recovery_pending(source.key);
 if jsonb_array_length(ids)=0 then return jsonb_build_object('outcome','complete','source_run_key',source.key,'teams',ids);end if;
 select jsonb_agg(jsonb_build_object('key',a.key,'run_key',a.run_key,'team',a.team,'checked_at',a.checked_at,
  'recovery_request',q0.request_id,'expires_at',q0.expires_at) order by a.checked_at) into saved
 from forecast_season.attempts a join forecast_season.drafts d on d.run_key=a.key
 left join forecast_season.recovery_requests q0 on q0.run_key=a.run_key
 where a.outcome='saved' and ids ? a.team and (a.run_key=source.key or q0.source_run_key=source.key)
 and (d.projection->>'evidence_at')::timestamptz>=now()-interval '2 hours'
 and (q0.request_id is null or (q0.closed_at is null and q0.expires_at>now()))
 and not exists(select 1 from public.forecast_season_public pub where pub.team=a.team and (
  (pub.payload->>'evidence_at')::timestamptz>(d.projection->>'evidence_at')::timestamptz
  or (q0.request_id is not null and pub.published_at>q0.created_at)));
 if saved is not null then return jsonb_build_object('outcome','awaiting_delivery','source_run_key',source.key,'saved_attempts',saved);end if;
 select q0.* into q from forecast_season.recovery_requests q0 join forecast_season.runs r on r.key=q0.run_key
 where q0.closed_at is null and q0.expires_at>now()
 and exists(select 1 from jsonb_array_elements_text(ids)x where r.expected ? x)
 order by q0.created_at limit 1;
 if found then
  if not q.automatic or q.source_run_key<>source.key then return jsonb_build_object('outcome','recovery_in_progress','request_id',q.request_id);end if;
  if exists(select 1 from forecast_season.attempts a where a.run_key=q.run_key and a.outcome='saved' and ids ? a.team)
   or exists(select 1 from forecast_season.drafts d where ids ? d.team and d.run_key is distinct from q.run_key||'-'||d.team and d.checked_at>q.created_at)
   or exists(select 1 from public.forecast_season_public p where ids ? p.team and p.published_at>q.created_at) then
   -- Every deliverable saved attempt already returned above. Keep unusable attempts
   -- in their original run and read again under a new, audited request.
   update forecast_season.recovery_requests set closed_at=now() where request_id=q.request_id;
  else
   perform set_config('forecast_season.recovery_request',q.request_id::text,true);
   return forecast_season.begin_run();
  end if;
 end if;
 return forecast_season.begin_recovery(gen_random_uuid(),source.key,ids,
  'Continuación automática de equipos pendientes después de la ventana programada.',true);
end;$body$;

create or replace function forecast_season.finish_run(p_key text) returns jsonb
language plpgsql security invoker set search_path='' as $body$
declare r forecast_season.runs%rowtype; summary jsonb; complete_count integer; published_count integer;
begin
 perform 1 from forecast_season.control for update;
 select * into r from forecast_season.runs where key=p_key;
 if not found then raise exception 'Ejecución no encontrada' using errcode='22023';end if;
 select count(*) filter(where outcome in('published','ready','blocked')),count(*) filter(where outcome='published'),
  jsonb_build_object('published',count(*) filter(where outcome='published'),'ready',count(*) filter(where outcome='ready'),
   'blocked',count(*) filter(where outcome='blocked'),'saved_without_delivery',count(*) filter(where outcome='saved'))
 into complete_count,published_count,summary from forecast_season.attempts where run_key=p_key and r.expected ? team;
 update forecast_season.runs set finished_at=case when complete_count=jsonb_array_length(r.expected) then coalesce(finished_at,now()) else null end where key=p_key;
 if complete_count=jsonb_array_length(r.expected) then
  update forecast_season.recovery_requests set closed_at=coalesce(closed_at,now()) where run_key=p_key;
 end if;
 return summary||jsonb_build_object('run_key',p_key,'expected',jsonb_array_length(r.expected),'completed',complete_count,
  'missing',jsonb_array_length(r.expected)-complete_count,'complete',complete_count=jsonb_array_length(r.expected),
  'publication_complete',published_count=jsonb_array_length(r.expected));
end;$body$;

-- A recovery cannot overwrite work that happened after it began, or older evidence.
do $concurrency$ declare definition text; marker text; begin
 definition:=pg_get_functiondef('forecast_season.check_attempt(text,text)'::regprocedure);
 marker:='if (select count(*) from forecast_season.attempts)>=20000';
 if position(marker in definition)=0 then raise exception 'Unexpected check_attempt body';end if;
 definition:=replace(definition,marker,
  'if exists(select 1 from forecast_season.recovery_requests q where q.run_key=p_run and (
   exists(select 1 from forecast_season.drafts d where d.team=p_team and d.run_key is distinct from p_run||''-''||p_team and d.checked_at>q.created_at)
   or exists(select 1 from public.forecast_season_public p where p.team=p_team and p.published_at>q.created_at)))
  then raise exception ''Hay una actualización posterior para este equipo'' using errcode=''40001'';end if;
 '||marker);
 execute definition;
 definition:=pg_get_functiondef('forecast_season.save_draft(text,jsonb)'::regprocedure);
 marker:='update forecast_season.drafts set run_key=k,fixture_key=p->>''fixture_key''';
 if position(marker in definition)=0 then raise exception 'Unexpected save_draft body';end if;
 definition:=replace(definition,marker,
  'if (
   exists(select 1 from public.forecast_season_public old where old.team=p->>''team'' and (old.payload->>''evidence_at'')::timestamptz>(v_projection->>''evidence_at'')::timestamptz)
   or exists(select 1 from forecast_season.drafts old where old.team=p->>''team'' and (old.projection->>''evidence_at'')::timestamptz>(v_projection->>''evidence_at'')::timestamptz))
  then raise exception ''Ya existe evidencia más reciente para este equipo'' using errcode=''40001'';end if;
 '||marker);
 execute definition;
end;$concurrency$;

-- Keep the original delivery body and guard only new recovery attempts.
do $delivery$ declare definition text; marker text; begin
 definition:=pg_get_functiondef('forecast_season.deliver(text)'::regprocedure);
 marker:='if a.outcome<>''saved'' then return to_jsonb(a)||jsonb_build_object(''already_delivered'',true); end if;';
 if position(marker in definition)=0 then raise exception 'Unexpected deliver body';end if;
 definition:=replace(definition,marker,
  'if a.outcome<>''saved'' then return to_jsonb(a)||jsonb_build_object(''already_delivered'',true); end if;
 if exists(select 1 from forecast_season.recovery_requests where run_key=a.run_key) then
  perform forecast_season.check_attempt(a.run_key,a.team);
 end if;');
 execute definition;
end;$delivery$;

revoke all on function forecast_season.plan_scheduled(),forecast_season.recovery_pending(text),
 forecast_season.begin_recovery(uuid,text,jsonb,text,boolean),forecast_season.resume_incomplete()
 from public,anon,authenticated,service_role;
