-- Run after season.sql in the SAME migration transaction. All synthetic evidence,
-- test clock changes and publications roll back inside the subtransaction below.
do $tests$
declare p jsonb; s jsonb; f forecast_season.fixtures%rowtype; fixture_doc jsonb; proof jsonb; source_list jsonb; originals jsonb:='{}'; result jsonb; before_public text; before_pilot text; before_plan jsonb; bad jsonb; stage text; stamp text;
begin
 select md5(jsonb_agg(to_jsonb(t) order by team)::text) into before_public from public.forecast_season_public t;
 select md5(jsonb_agg(to_jsonb(t) order by run_key)::text) into before_pilot from forecast_pilot.drafts t;
 before_plan:=forecast_season.plan();stamp:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"');
 if not has_table_privilege('anon','public.forecast_season_public','SELECT') or has_table_privilege('anon','public.forecast_season_public','INSERT') or has_table_privilege('authenticated','forecast_season.drafts','SELECT') or has_function_privilege('authenticated','forecast_season.deliver(text)','EXECUTE') or has_function_privilege('anon','public.get_forecast_season()','EXECUTE') then raise exception 'Season privilege regression'; end if;
 begin perform private.get_forecast_season();raise exception 'Unauthenticated admin access allowed' using errcode='ZX002';exception when sqlstate '42501' then null;end;
 begin
  execute $ddl$create or replace function forecast_season.plan() returns jsonb language sql stable security invoker set search_path='' as $stub$
   select jsonb_build_object('observed_at',now(),'slot',now()+substring(current_setting('forecast_test.run'),'[0-9]+$')::integer*interval '1 second','run_key',current_setting('forecast_test.run'),'mode',(select mode from forecast_season.control),'version',(select version from forecast_season.control),'teams',(select jsonb_agg(jsonb_build_object('team',team)) from forecast_league.teams));
  $stub$;$ddl$;
  perform set_config('forecast_test.run','season-test-1',true);
  update forecast_season.control set mode='automatic';
  result:=forecast_season.begin_run();
  if jsonb_array_length(result->'teams')<>20 then raise exception 'Missing season teams'; end if;
  for p in select value from forecast_league.batches b,jsonb_array_elements(b.payload->'teams') where b.run_key='all-j13-20261111-v1' loop
   p:=p||jsonb_build_object('schema_version',3,'season','2026-27');
   select jsonb_agg(value||jsonb_build_object('fetched_at',stamp)) into source_list from jsonb_array_elements(p->'sources');
   p:=jsonb_set(p,'{sources}',source_list);
   select * into f from forecast_season.fixtures where key=p->>'fixture_key';
   fixture_doc:=jsonb_build_object('key',f.key,'season',f.season,'home',f.home,'away',f.away,'matchday',f.matchday,'kickoff_at',p->>'kickoff_at');
   proof:='[]';
   for s in select value from jsonb_array_elements(source_list) loop
    proof:=proof||jsonb_build_array(jsonb_build_object('id',s->>'id','url',f.source_urls->>(s->>'id'),'fetched_at',stamp,'fixture_verified',true,'observed_fixture',s->'observed_fixture'));
   end loop;
   perform forecast_season.register_fixture(fixture_doc||jsonb_build_object('sources',proof));
   result:=forecast_season.save_draft('season-test-1',p);
   if result->>'outcome'<>'saved' then raise exception 'Save failed'; end if;
   result:=forecast_season.deliver('season-test-1-'||(p->>'team'));
   if result->>'outcome'<>'published' then raise exception 'Auto publication failed: %',result; end if;
   result:=forecast_season.save_draft('season-test-1',p);
   if result->'already_saved' is distinct from 'true'::jsonb then raise exception 'Save retry not idempotent'; end if;
   result:=forecast_season.deliver('season-test-1-'||(p->>'team'));
   if result->'already_delivered' is distinct from 'true'::jsonb then raise exception 'Delivery retry not idempotent'; end if;
   originals:=originals||jsonb_build_object(p->>'team',p);
  end loop;
  if (select count(*) from public.forecast_season_public where payload->'schema_version'='3'::jsonb)<>20 then raise exception 'Expected twenty validated season publications'; end if;
  result:=forecast_season.finish_run('season-test-1');
  if result->'complete' is distinct from 'true'::jsonb or result->>'published'<>'20' then raise exception 'Incorrect run summary: %',result; end if;
  p:=originals->'real-madrid';
  bad:=jsonb_set(p,'{proposal,players,0,probability}',to_jsonb((p#>>'{proposal,players,0,probability}')::integer-1));
  begin perform forecast_season.build_team(bad);raise exception 'Inconsistent probability accepted' using errcode='ZX002';exception when sqlstate '22023' then null;end;
  bad:=jsonb_set(p,'{sources,0,observed_fixture,matchday}','14'::jsonb);
  begin perform forecast_season.build_team(bad);raise exception 'Wrong source fixture accepted' using errcode='ZX002';exception when sqlstate '22023' then null;end;
  bad:=jsonb_set(p,'{sources,0,fetched_at}',to_jsonb(to_char((now()-interval '3 hours') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  begin perform forecast_season.build_team(bad);raise exception 'Stale evidence accepted' using errcode='ZX002';exception when sqlstate '22023' then null;end;
  bad:=jsonb_set(p,'{proposal,players,1,id}',p#>'{proposal,players,0,id}');
  begin perform forecast_season.build_team(bad);raise exception 'Duplicate player accepted' using errcode='ZX002';exception when sqlstate '22023' then null;end;
  begin perform forecast_season.save_draft('season-test-1',jsonb_set(p,'{limitations}','["Changed retry content must not replace the original draft."]'));raise exception 'Changed idempotent payload accepted' using errcode='ZX002';exception when sqlstate '23505' then null;end;
  perform set_config('forecast_test.run','season-test-2',true);perform forecast_season.begin_run();update forecast_season.control set mode='manual';
  perform forecast_season.save_draft('season-test-2',p);result:=forecast_season.deliver('season-test-2-real-madrid');
  if result->>'outcome'<>'ready' or (select status from public.forecast_season_public where team='real-madrid')<>'ready' then raise exception 'Manual mode published automatically'; end if;
  result:=forecast_season.publish_team('real-madrid',interval '24 hours',true);
  if result->>'outcome'<>'published' then raise exception 'Manual publication failed'; end if;
  -- A newer failed reading must make an earlier valid draft unpublishable.
  perform set_config('forecast_test.run','season-test-3',true);perform forecast_season.begin_run();
  result:=forecast_season.block_team('season-test-3','real-madrid','Synthetic fixture discovery failure; no real sources were read by this test.','[{"id":"futbolfantasy","url":null,"status":"not_read","fetched_at":null},{"id":"jornadaperfecta","url":null,"status":"not_read","fetched_at":null},{"id":"comuniate","url":null,"status":"not_read","fetched_at":null}]');
  if result->>'outcome'<>'blocked' or (select payload is null from public.forecast_season_public where team='real-madrid') then raise exception 'Blocked attempt erased previous publication'; end if;
  begin perform forecast_season.publish_team('real-madrid',interval '24 hours',true);raise exception 'Older draft published after failure' using errcode='ZX002';exception when sqlstate '22023' then null;end;
  result:=forecast_season.finish_run('season-test-3');if result->>'missing'<>'19' or result->'complete' is distinct from 'false'::jsonb then raise exception 'Missing teams reported as complete'; end if;
  -- Repeated publication is barred after kickoff and after a verified reschedule.
  update forecast_season.fixtures set kickoff_at=now()-interval '1 minute' where key=p->>'fixture_key';
  begin perform forecast_season.build_team(p);raise exception 'Old kickoff accepted after schedule change' using errcode='ZX002';exception when sqlstate '22023' then null;end;
  -- Advance one club to J14 while other clubs still have J13 pending.
  fixture_doc:=jsonb_build_object('key','laliga-2026-27-j14-real-madrid-athletic-club','season','2026-27','home','real-madrid','away','athletic-club','matchday',14,'kickoff_at',to_char((now()+interval '17 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  proof:='[]';source_list:='[]';
  for s in select value from jsonb_array_elements(p->'sources') loop
   s:=s||jsonb_build_object('observed_fixture',fixture_doc-'season','url',case s->>'id' when 'futbolfantasy' then 'https://www.futbolfantasy.com/partidos/99999-season-synthetic-test' when 'jornadaperfecta' then 'https://www.jornadaperfecta.com/partido/99999/season-synthetic-test' else 'https://www.comuniate.com/partido/26/99/14/season-synthetic-test' end);
   source_list:=source_list||jsonb_build_array(s);proof:=proof||jsonb_build_array(jsonb_build_object('id',s->>'id','url',s->>'url','fetched_at',stamp,'fixture_verified',true,'observed_fixture',fixture_doc-'season'));
  end loop;
  perform forecast_season.register_fixture(fixture_doc||jsonb_build_object('sources',proof));
  p:=p||(fixture_doc-'key')||jsonb_build_object('fixture_key',fixture_doc->>'key','opponent','athletic-club','sources',source_list);
  perform set_config('forecast_test.run','season-test-4',true);perform forecast_season.begin_run();update forecast_season.control set mode='automatic';
  perform forecast_season.save_draft('season-test-4',p);result:=forecast_season.deliver('season-test-4-real-madrid');
  if result->>'outcome'<>'published' or (select payload->>'matchday' from public.forecast_season_public where team='real-madrid')<>'14' or (select payload->>'matchday' from public.forecast_season_public where team='athletic-club')<>'13' then raise exception 'Independent next-match rollover failed'; end if;
  raise exception 'rollback synthetic season tests' using errcode='ZX001';
 exception when sqlstate 'ZX001' then null;
 end;
 if (select count(*) from forecast_season.runs)<>0 or (select count(*) from forecast_season.attempts)<>0 or (select count(*) from forecast_season.archive)<>0 then raise exception 'Synthetic rows escaped rollback'; end if;
 if before_public is distinct from (select md5(jsonb_agg(to_jsonb(t) order by team)::text) from public.forecast_season_public t) or before_pilot is distinct from (select md5(jsonb_agg(to_jsonb(t) order by run_key)::text) from forecast_pilot.drafts t) or before_plan is distinct from forecast_season.plan() then raise exception 'Tests changed persistent state'; end if;
end;
$tests$;
