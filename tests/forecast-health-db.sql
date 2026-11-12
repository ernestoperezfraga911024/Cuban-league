-- Execute after health-and-two-daily.sql. Every test write rolls back in the
-- nested subtransaction, including modes, health rows and withdrawals.
do $tests$
declare p jsonb; bad jsonb; r jsonb; one record; stamp text; previous jsonb; definition text; test_case record;
begin
 previous:=jsonb_build_object('control',(select to_jsonb(t) from forecast_season.control t),
  'drafts',(select md5(jsonb_agg(to_jsonb(t) order by team)::text) from forecast_season.drafts t),
  'public',(select md5(jsonb_agg(to_jsonb(t) order by team)::text) from public.forecast_season_public t),
  'health',(select md5(jsonb_agg(to_jsonb(t) order by team,player_id)::text) from forecast_health.drafts t),
  'health_public',(select md5(jsonb_agg(to_jsonb(t) order by team,player_id)::text) from public.forecast_health_public t));
 if has_table_privilege('anon','public.forecast_health_public','INSERT')
 or has_table_privilege('authenticated','public.forecast_health_public','UPDATE')
 or has_table_privilege('authenticated','forecast_health.drafts','SELECT')
 or has_function_privilege('anon','forecast_health.save_batch(jsonb)','EXECUTE')
 or has_function_privilege('authenticated','forecast_health.deliver(text)','EXECUTE')
 or not has_table_privilege('anon','public.forecast_health_public','SELECT')
 then raise exception 'Health permissions regression';end if;
 begin perform private.get_forecast_season();raise exception 'Anonymous admin read' using errcode='ZX001';exception when sqlstate '42501' then null;end;
 definition:=replace(replace(pg_get_functiondef('forecast_season.plan()'::regprocedure),'forecast_season.plan()','pg_temp.health_schedule_test(p_at timestamptz)'),'now()','p_at');
 execute definition;
 for test_case in select * from (values
 ('2026-11-13T11:00:00Z'::timestamptz,'season-20261113-0600'::text,20),
 ('2026-11-13T19:00:00Z'::timestamptz,'season-20261113-1400'::text,20),
 ('2026-11-13T20:59:59Z'::timestamptz,'season-20261113-1400'::text,20),
 ('2026-11-13T21:00:01Z'::timestamptz,null::text,0),
 ('2026-11-13T14:00:00Z'::timestamptz,null::text,0),
 ('2027-03-14T10:00:00Z'::timestamptz,'season-20270314-0600'::text,20),
 ('2027-03-14T18:00:00Z'::timestamptz,'season-20270314-1400'::text,20),
 ('2027-06-30T18:00:00Z'::timestamptz,'season-20270630-1400'::text,20),
 ('2027-07-01T04:00:00Z'::timestamptz,null::text,0)
 ) v(at_time,key,n) loop
  r:=pg_temp.health_schedule_test(test_case.at_time);
  if r->>'run_key' is distinct from test_case.key or jsonb_array_length(r->'teams')<>test_case.n then raise exception 'Schedule case failed: %',r;end if;
  if exists(select 1 from jsonb_array_elements(r->'teams') x where (x->'fixture'->>'kickoff_at')::timestamptz<=test_case.at_time) then raise exception 'Started match returned';end if;
 end loop;
 drop function pg_temp.health_schedule_test(timestamptz);
 begin
  select id,name into one from forecast_league.roster where team='real-madrid' order by id limit 1;
  stamp:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  p:=jsonb_build_object('season','2026-27','team','real-madrid','matchday',13,
   'source',jsonb_build_object('id','futbolfantasy','url','https://www.futbolfantasy.com/laliga/equipos/real-madrid','fetched_at',stamp,'source_updated_at',null),
   'players',jsonb_build_array(jsonb_build_object('id',one.id,'name',one.name,'status','doubt','source_label','Duda','detail','Synthetic test only; rolled back before any commit.','event_date',null)));
  update forecast_season.control set mode='automatic';
  update forecast_season.drafts set paused=false where team='real-madrid';
  r:=forecast_health.save_batch(p);if r->>'outcome'<>'saved' then raise exception 'Save failed';end if;
  if forecast_health.save_batch(p)->>'outcome'<>'unchanged' then raise exception 'Retry changed evidence';end if;
  if forecast_health.deliver('real-madrid')->>'outcome'<>'published' then raise exception 'Automatic delivery failed';end if;
  if forecast_health.deliver('real-madrid')->>'outcome'<>'unchanged' then raise exception 'Delivery duplicate';end if;
  for bad in select value from jsonb_array_elements(jsonb_build_array(
   jsonb_set(p,'{players,0,id}','"invented-id"'),
   jsonb_set(p,'{players,0,status}','"available"'),
   jsonb_set(p,'{source,url}','"https://www.futbolfantasy.com/laliga/equipos/valencia"'),
   jsonb_set(p,'{source,fetched_at}','"2000-01-01T00:00:00Z"'),
   jsonb_set(p,'{players,0,detail}','"short"'),
   jsonb_set(p,'{players,0,event_date}','"2099-01-01"')
  )) loop
   begin perform forecast_health.save_batch(bad);raise exception 'Invalid health accepted' using errcode='ZX001';exception when sqlstate '22023' then null;end;
  end loop;
  begin perform forecast_health.save_batch(jsonb_set(p,'{players,0,detail}','"Conflicting same-time observation"'));raise exception 'Conflict accepted' using errcode='ZX001';exception when sqlstate '23505' then null;end;
  update forecast_season.control set mode='manual';
  p:=jsonb_set(p,'{source,fetched_at}',to_jsonb(to_char((now()+interval '1 second') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  p:=jsonb_set(jsonb_set(p,'{players,0,status}','"available"'),'{players,0,source_label}','"Disponible"');
  perform forecast_health.save_batch(p);
  if forecast_health.deliver('real-madrid')->>'outcome'<>'ready' then raise exception 'Manual leaked';end if;
  if (select payload->>'status' from public.forecast_health_public where team='real-madrid' and player_id=one.id)<>'doubt' then raise exception 'Manual changed publication';end if;
  update forecast_season.drafts set paused=true where team='real-madrid';
  update forecast_season.control set mode='automatic';
  if forecast_health.deliver('real-madrid')->>'outcome'<>'ready' then raise exception 'Withdrawal bypassed';end if;
  if (forecast_health.publish_ready('real-madrid')->>'players')::int<>0 then raise exception 'Paused team published';end if;
  update public.forecast_season_public set status='withdrawn' where team='real-madrid';
  execute 'set local role anon';
  if exists(select 1 from public.forecast_health_public where team='real-madrid') then raise exception 'Withdrawn health exposed to anonymous reader';end if;
  execute 'reset role';
  update forecast_season.drafts set paused=false where team='real-madrid';
  if forecast_health.deliver('real-madrid')->>'outcome'<>'published' then raise exception 'Availability delivery failed';end if;
  if (select payload->>'status' from public.forecast_health_public where team='real-madrid' and player_id=one.id)<>'available' then raise exception 'Availability not updated';end if;
  raise exception 'Rollback test writes' using errcode='ZX999';
 exception when sqlstate 'ZX999' then null;
 end;
 if previous is distinct from jsonb_build_object('control',(select to_jsonb(t) from forecast_season.control t),
  'drafts',(select md5(jsonb_agg(to_jsonb(t) order by team)::text) from forecast_season.drafts t),
  'public',(select md5(jsonb_agg(to_jsonb(t) order by team)::text) from public.forecast_season_public t),
  'health',(select md5(jsonb_agg(to_jsonb(t) order by team,player_id)::text) from forecast_health.drafts t),
  'health_public',(select md5(jsonb_agg(to_jsonb(t) order by team,player_id)::text) from public.forecast_health_public t))
 then raise exception 'Tests left persisted changes';end if;
end;$tests$;
