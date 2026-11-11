-- Supply a valid private test payload through set_config('forecast_test.payload', ..., true).
-- Run inside BEGIN / ROLLBACK against an isolated test transaction before first publication.
do $round_tests$
declare p jsonb:=current_setting('forecast_test.payload')::jsonb; t jsonb; bad jsonb; v jsonb; first_result jsonb; u uuid:=gen_random_uuid(); counts_before bigint; old_hash text; i integer; test_count integer:=0;
begin
 select count(*) into counts_before from forecast_pilot.drafts;
 select md5(payload::text) into old_hash from public.forecast_public;
 if has_schema_privilege('anon','forecast_league','usage') or has_schema_privilege('authenticated','forecast_league','usage')
  or has_table_privilege('anon','public.forecast_round_public','insert') or has_table_privilege('authenticated','public.forecast_round_public','update')
  or not has_table_privilege('anon','public.forecast_round_public','select') then raise exception 'Unexpected ACL'; end if;
 for t in select value from jsonb_array_elements(p->'teams') loop
  v:=forecast_league.build_team(t);
  if jsonb_array_length(v->'players')<>11 or jsonb_array_length(v->'sources')<>3 or v::text like '%assessment%' then raise exception 'Projection failed';end if;
  test_count:=test_count+1;
 end loop;
 t:=p->'teams'->0;
 for i in 1..7 loop
  bad:=case i
   when 1 then jsonb_set(t,'{sources,0,fetched_at}',to_jsonb((now()-interval '3 hours')::text))
   when 2 then jsonb_set(t,'{sources,0,fetched_at}',to_jsonb((now()+interval '10 minutes')::text))
   when 3 then jsonb_set(t,'{proposal,players,0,probability}','99')
   when 4 then jsonb_set(t,'{proposal,players,0,id}','"k-mbappe"')
   when 5 then jsonb_set(t,'{sources,1,id}','"futbolfantasy"')
   when 6 then jsonb_set(t,'{sources,0,observed_fixture,matchday}','12')
   when 7 then jsonb_set(t,'{proposal,players,0,slot}','2') end;
  begin perform forecast_league.build_team(bad);raise exception 'Invalid fixture accepted: %',i; exception when sqlstate '22023' then test_count:=test_count+1;end;
 end loop;
 bad:=jsonb_set(jsonb_set(jsonb_set(t,'{sources,0,status}','"mismatch"'),'{status}','"blocked"'),'{proposal}','null');
 if forecast_league.build_team(bad) is not null then raise exception 'Blocked XI exposed';end if;
 begin
  first_result:=forecast_league.save_batch('all-j13-test-20261111-v1',p);
  if first_result->>'valid_teams'<>'20' then raise exception 'Save failed';end if;
  v:=forecast_league.save_batch('all-j13-test-20261111-v1',p);
  if v->>'already_saved'<>'true' then raise exception 'Save not idempotent';end if;
  first_result:=forecast_league.publish_batch('all-j13-test-20261111-v1',u);
  if first_result->>'published_teams'<>'20' or (select count(*) from public.forecast_round_public)<>19 then raise exception 'Publish failed';end if;
  v:=forecast_league.publish_batch('all-j13-test-20261111-v1',u);
  if v->>'already_published'<>'true' or v->>'published_at'<>first_result->>'published_at' then raise exception 'Duplicate publication';end if;
  begin perform forecast_league.publish_batch('all-j13-test-20261111-v1',gen_random_uuid());raise exception 'UUID mismatch allowed';exception when unique_violation then null;end;
  raise exception 'Intentional rollback of all test publication data' using errcode='ZX001';
 exception when sqlstate 'ZX001' then null;end;
 if (select count(*) from forecast_pilot.drafts)<>counts_before or exists(select 1 from public.forecast_round_public)
  or (select md5(payload::text) from public.forecast_public) is distinct from old_hash then raise exception 'Test data escaped rollback';end if;
 raise notice 'PASS % team/invalid checks, ACL, blocked, full save/publish, idempotency, preserved public Madrid',test_count;
end;
$round_tests$;
