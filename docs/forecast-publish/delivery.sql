-- Bounded Madrid-Celta pilot. No scheduler, credentials or sporting data in this migration.
-- Default manual; activation is a separate audited command after the schedule is verified.
create table forecast_publish.delivery_config (
 singleton boolean primary key default true check(singleton),
 mode text not null default 'manual' check(mode in ('manual','automatic')),
 system_actor uuid not null default gen_random_uuid()
);
insert into forecast_publish.delivery_config(singleton) values(true);
create table forecast_publish.delivery_commands (
 request_id uuid primary key, request jsonb not null, result jsonb not null,
 created_at timestamptz not null default now()
);
alter table forecast_publish.delivery_config enable row level security;
alter table forecast_publish.delivery_commands enable row level security;
revoke all on forecast_publish.delivery_config,forecast_publish.delivery_commands from public,anon,authenticated,service_role;

-- Uses only the newest stored attempt; never falls back silently to an older draft.
create function forecast_publish.prepare_delivery(p_source_key text,p_max_age interval default interval '24 hours') returns jsonb
language plpgsql stable security invoker set search_path='' as $body$
declare src jsonb; players jsonb; note text; newest text; payload jsonb;
begin
 select d.run_key into newest from forecast_pilot.drafts d order by d.created_at desc,d.run_key desc limit 1;
 if p_source_key is null or p_source_key is distinct from newest then
   raise exception 'Hay una lectura más reciente. Actualiza el estado.' using errcode='22023'; end if;
 select d.payload into src from forecast_pilot.drafts d where d.run_key=p_source_key;
 if src->>'status' is distinct from 'draft' or src->>'method_version' is distinct from 'editorial-v2' then
   raise exception 'La última lectura está bloqueada o necesita el método editorial v2.' using errcode='22023'; end if;
 if jsonb_typeof(src->'sources') is distinct from 'array' then raise exception 'Fuentes incompletas' using errcode='22023'; end if;
 if jsonb_array_length(src->'sources')<>3 or (select count(distinct s->>'id') from jsonb_array_elements(src->'sources') s)<>3
   or exists(select 1 from jsonb_array_elements(src->'sources') s where s->>'status' is distinct from 'read' or s->'fixture_verified' is distinct from 'true'::jsonb) then
   raise exception 'Se necesitan las tres fuentes verificadas.' using errcode='22023'; end if;
 select jsonb_agg(jsonb_build_object('id',p->>'id','slot',p->'slot','probability',p->'probability',
   'alternative_id',p->'alternative'->>'id','reason',p->>'reason')) into players from jsonb_array_elements(src->'proposal'->'players') p;
 select left(string_agg(value,' ' order by ord),1200) into note from jsonb_array_elements_text(src->'limitations') with ordinality x(value,ord);
 payload:=forecast_publish.build(src,players,note);
 if (payload->>'evidence_at')::timestamptz < now()-p_max_age
   or exists(select 1 from jsonb_array_elements(payload->'sources') s where (s->>'fetched_at')::timestamptz>now()+interval '5 minutes')
   or (payload->>'kickoff_at')::timestamptz<=now() then
   raise exception 'Fuentes caducadas o partido iniciado: hace falta una lectura nueva.' using errcode='22023'; end if;
 return payload;
end;
$body$;

-- Trusted connection only. No JWT impersonation; the automation has its own audit identity.
-- The guarded administrator wrapper below supplies the real auth.uid().
create function forecast_publish.command_delivery(p_action text,p_expected_version bigint,p_request_id uuid,
 p_source_key text default null,p_actor uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $body$
declare st forecast_publish.state%rowtype; cfg forecast_publish.delivery_config%rowtype;
 old forecast_publish.delivery_commands%rowtype; req jsonb; result jsonb; payload jsonb;
 revision bigint; actor uuid; outcome text; why text; should_publish boolean;
begin
 if p_action is null or p_action not in ('manual','automatic','publish','deliver') or p_request_id is null
   or p_expected_version is null or p_expected_version<0 then raise exception 'Comando inválido' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtext('cuban-league-private-forecast-pilot-v1'));
 select * into st from forecast_publish.state where singleton for update;
 select * into cfg from forecast_publish.delivery_config where singleton;
 actor:=coalesce(p_actor,cfg.system_actor);
 req:=jsonb_build_object('action',p_action,'expected_version',p_expected_version,'source_key',p_source_key,'actor',actor,
   'actor_kind',case when p_actor is null then 'automation' else 'administrator' end);
 select * into old from forecast_publish.delivery_commands where request_id=p_request_id;
 if found then
   if old.request is distinct from req then raise exception 'Identificador ya usado' using errcode='23505'; end if;
   return old.result||jsonb_build_object('already_applied',true);
 end if;
 if exists(select 1 from forecast_publish.events where request_id=p_request_id) then raise exception 'Identificador ya usado' using errcode='23505'; end if;
 if st.version<>p_expected_version then raise exception 'Otra sesión cambió el estado. Actualiza antes de continuar.' using errcode='40001'; end if;
 if (select count(*) from forecast_publish.delivery_commands)>=500 or (select count(*) from forecast_publish.events)>=500 then
   raise exception 'Límite del piloto alcanzado' using errcode='54000'; end if;
 if p_action in ('manual','automatic') then
   if p_source_key is not null then raise exception 'El modo no acepta un borrador' using errcode='22023'; end if;
   update forecast_publish.delivery_config set mode=p_action where singleton;
   cfg.mode:=p_action; outcome:='mode_changed';
 else
   should_publish:=p_action='publish' or cfg.mode='automatic';
   begin
     payload:=forecast_publish.prepare_delivery(p_source_key,case when p_action='deliver' then interval '2 hours' else interval '24 hours' end);
   exception when sqlstate '22023' then
     if p_action='publish' then raise; end if;
     outcome:='blocked'; why:=sqlerrm;
   end;
   if payload is not null then
     if not should_publish then outcome:='ready';
     elsif exists(select 1 from public.forecast_public p join forecast_publish.revisions r on r.id=p.revision_id
       where r.source_key=p_source_key and p.payload=payload) then outcome:='unchanged';revision:=st.current_revision;
     else
       if (select count(*) from forecast_publish.revisions)>=100 then raise exception 'Límite de revisiones alcanzado' using errcode='54000'; end if;
       insert into forecast_publish.revisions(source_key,author,payload) values(p_source_key,actor,payload) returning id into revision;
       insert into public.forecast_public(fixture_key,revision_id,published_at,payload) values(payload->>'fixture_key',revision,now(),payload)
         on conflict(fixture_key) do update set revision_id=excluded.revision_id,published_at=excluded.published_at,payload=excluded.payload;
       update forecast_publish.state set current_revision=revision where singleton;
       outcome:='published';
     end if;
   end if;
 end if;
 update forecast_publish.state set version=version+1 where singleton;
 select jsonb_build_object('version',s.version,'current_revision',s.current_revision,'revision_id',revision,
   'mode',cfg.mode,'outcome',outcome,'reason',why,'source_key',p_source_key,'already_applied',false) into result from forecast_publish.state s;
 insert into forecast_publish.delivery_commands(request_id,request,result) values(p_request_id,req,result);
 if outcome='published' then
   insert into forecast_publish.events(request_id,request,result,action,revision_id,author) values(p_request_id,req,result,'publish',revision,actor);
 end if;
 return result;
end;
$body$;

create function private.get_forecast_delivery() returns jsonb
language plpgsql stable security definer set search_path='' as $body$
declare result jsonb; src forecast_pilot.drafts%rowtype; payload jsonb; readiness text:='blocked'; why text;
begin
 if (select auth.uid()) is null or not coalesce(private.is_league_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 select jsonb_build_object('version',s.version,'current_revision',s.current_revision,'mode',c.mode) into result
   from forecast_publish.state s cross join forecast_publish.delivery_config c;
 select * into src from forecast_pilot.drafts order by created_at desc,run_key desc limit 1;
 begin
   payload:=forecast_publish.prepare_delivery(src.run_key);
   readiness:=case when exists(select 1 from public.forecast_public p join forecast_publish.revisions r on r.id=p.revision_id
     where r.source_key=src.run_key and p.payload=payload) then 'published' else 'ready' end;
 exception when sqlstate '22023' then why:=sqlerrm; end;
 return result||jsonb_build_object('source_key',src.run_key,'created_at',src.created_at,'readiness',readiness,
   'reason',why,'limitations',src.payload->'limitations','preview',payload,
   'last_delivery',(select jsonb_build_object('created_at',d.created_at,'outcome',d.result->>'outcome','reason',d.result->>'reason')
     from forecast_publish.delivery_commands d where d.request->>'action'='deliver' order by d.created_at desc,d.request_id desc limit 1));
end;
$body$;
create function private.command_forecast_delivery(p_action text,p_expected_version bigint,p_request_id uuid,p_source_key text default null) returns jsonb
language plpgsql security definer set search_path='' as $body$
begin
 if (select auth.uid()) is null or not coalesce(private.is_league_admin(),false) then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_action is null or p_action not in ('manual','automatic','publish') then raise exception 'Comando inválido' using errcode='22023'; end if;
 return forecast_publish.command_delivery(p_action,p_expected_version,p_request_id,p_source_key,(select auth.uid()));
end;
$body$;
create function public.get_forecast_delivery() returns jsonb
language sql stable security invoker set search_path='' as $body$ select private.get_forecast_delivery(); $body$;
create function public.command_forecast_delivery(p_action text,p_expected_version bigint,p_request_id uuid,p_source_key text default null) returns jsonb
language sql security invoker set search_path='' as $body$ select private.command_forecast_delivery(p_action,p_expected_version,p_request_id,p_source_key); $body$;
revoke all on function forecast_publish.prepare_delivery(text,interval),forecast_publish.command_delivery(text,bigint,uuid,text,uuid),
 private.get_forecast_delivery(),private.command_forecast_delivery(text,bigint,uuid,text),
 public.get_forecast_delivery(),public.command_forecast_delivery(text,bigint,uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.get_forecast_delivery(),private.command_forecast_delivery(text,bigint,uuid,text),
 public.get_forecast_delivery(),public.command_forecast_delivery(text,bigint,uuid,text) to authenticated;
