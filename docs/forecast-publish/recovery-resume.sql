BEGIN;
DO $guard$
BEGIN
 IF md5(pg_get_functiondef('forecast_season.begin_recovery(uuid,text,jsonb,text,boolean)'::regprocedure)) <> 'ac1cbe27f713f4efb389e5611fd4ffbd' THEN
  RAISE EXCEPTION 'Recovery function begin_recovery changed since review';
 END IF;
 IF md5(pg_get_functiondef('forecast_season.recovery_pending(text)'::regprocedure)) <> 'ab11947197636afea0a5c45a28f0941b' THEN
  RAISE EXCEPTION 'Recovery function recovery_pending changed since review';
 END IF;
 IF md5(pg_get_functiondef('forecast_season.resume_incomplete()'::regprocedure)) <> '274562033dfb63de76458b50ad64a374' THEN
  RAISE EXCEPTION 'Recovery function resume_incomplete changed since review';
 END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION forecast_season.begin_recovery(p_request uuid, p_source text, p_teams jsonb, p_reason text, p_automatic boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
   select key from forecast_season.runs where key ~ '^season-[0-9]{8}-[0-9]{4}$'
    and slot_at>=now()-interval '24 hours' and slot_at<=now()
    and jsonb_array_length(forecast_season.recovery_pending(key))>0
    order by slot_at desc limit 1)
  then raise exception 'La recuperación automática admite solo equipos pendientes del último turno incompleto' using errcode='22023';end if;
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
end;$function$
;

CREATE OR REPLACE FUNCTION forecast_season.recovery_pending(p_source text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(t.team order by t.team),'[]'::jsonb)
 from forecast_season.runs r cross join lateral jsonb_array_elements_text(r.expected)t(team)
 where r.key=p_source
 -- A later scheduled reading owns overlapping clubs, even if it is unfinished.
 -- Empty or disjoint runs must not hide this run's remaining work.
 and not exists(
  select 1 from forecast_season.runs newer
  where newer.key ~ '^season-[0-9]{8}-[0-9]{4}$'
   and newer.slot_at>r.slot_at and newer.slot_at<=now() and newer.expected ? t.team
 )
 and not exists(
  select 1 from forecast_season.attempts a
  where a.team=t.team and a.outcome in('published','ready','blocked')
   and (a.run_key=p_source or a.run_key in(
    select q.run_key from forecast_season.recovery_requests q where q.source_run_key=p_source))
 );
$function$
;

CREATE OR REPLACE FUNCTION forecast_season.resume_incomplete()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare source forecast_season.runs%rowtype; q forecast_season.recovery_requests%rowtype; ids jsonb; scheduled jsonb; saved jsonb;
begin
 perform 1 from forecast_season.control for update;
 perform set_config('forecast_season.recovery_request','',true);
 scheduled:=forecast_season.plan_scheduled();
 if scheduled->>'run_key' is not null then return jsonb_build_object('outcome','scheduled_window','plan',scheduled);end if;
 select * into source from forecast_season.runs where key ~ '^season-[0-9]{8}-[0-9]{4}$'
  and slot_at>=now()-interval '24 hours' and slot_at<=now()
  and jsonb_array_length(forecast_season.recovery_pending(key))>0
  order by slot_at desc limit 1;
 if source.key is null then
  select * into source from forecast_season.runs where key ~ '^season-[0-9]{8}-[0-9]{4}$'
   and slot_at>=now()-interval '24 hours' and slot_at<=now() order by slot_at desc limit 1;
  if source.key is null then return jsonb_build_object('outcome','no_recent_run');end if;
  return jsonb_build_object('outcome','complete','source_run_key',source.key,'teams','[]'::jsonb);
 end if;
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
end;$function$
;
COMMIT;

