begin;
do $test$
declare
  p jsonb;
  bad jsonb;
  players jsonb;
  sources jsonb;
  result jsonb;
  failures integer := 0;
  role_name text;
  variant integer;
begin
  select jsonb_agg(jsonb_build_object('id','test-'||i,'name','Test '||i,
    'position',case when i=1 then 'GK' when i<=5 then 'DF' when i<=10 then 'MF' else 'FW' end,
    'probability',70,'alternative',null,'reason','Synthetic validation only') order by i)
  into players from generate_series(1,11) i;
  select jsonb_agg(jsonb_build_object('id',id,'url','https://www.'||domain||'/pilot-test',
    'status','read','fixture_verified',true,'fetched_at',now(),
    'source_updated_at',null,'starters',(select jsonb_agg('Test '||i) from generate_series(1,11) i)))
  into sources from (values ('futbolfantasy','futbolfantasy.com'),('jornadaperfecta','jornadaperfecta.com'),('comuniate','comuniate.com')) s(id,domain);
  p := jsonb_build_object('schema_version',1,'team','real-madrid',
    'fixture_key','laliga-2026-27-j13-real-madrid-celta','opponent','celta','matchday',13,
    'kickoff_at','2026-11-21T20:00:00Z','probability_kind','editorial_uncalibrated',
    'publication_allowed',false,'status','draft','limitations',jsonb_build_array('Synthetic test'),
    'sources',sources,'proposal',jsonb_build_object('formation','4-2-3-1','players',players));

  result := forecast_pilot.save_draft('pilot-validation-valid','interactive',p);
  if result->>'status' <> 'draft' or result->>'publication_allowed' <> 'false' then raise exception 'Valid draft failed'; end if;
  result := forecast_pilot.save_draft('pilot-validation-valid','interactive',p);
  if result->>'already_saved' <> 'true' then raise exception 'Retry duplicated'; end if;

  for variant in 1..10 loop
    bad := case variant
      when 1 then jsonb_set(p,'{proposal,players}',players - 10)
      when 2 then jsonb_set(p,'{proposal,players,1,id}','"test-1"')
      when 3 then jsonb_set(p,'{proposal,players,0,probability}','69')
      when 4 then jsonb_set(p,'{proposal,players,0,probability}','101')
      when 5 then jsonb_set(p,'{sources,0,status}','"unavailable"')
      when 6 then jsonb_set(p,'{sources,0,fixture_verified}','false')
      when 7 then jsonb_set(p,'{sources,0,fetched_at}',to_jsonb((now()-interval '1 day')::text))
      when 8 then jsonb_set(p,'{publication_allowed}','true')
      when 9 then p - 'team'
      when 10 then jsonb_set(p,'{proposal,players,0,alternative}','{"id":"test-other","name":"Other"}')
    end;
    begin
      perform forecast_pilot.save_draft('pilot-validation-invalid-'||variant,'interactive',bad);
    exception when sqlstate '22023' then failures := failures + 1;
    end;
  end loop;
  if failures <> 10 then raise exception 'Validation rejection count: %',failures; end if;

  bad := jsonb_set(jsonb_set(p,'{proposal,players,1,probability}','69'),
    '{proposal,players,1,alternative}','{"id":"test-other","name":"Other"}');
  perform forecast_pilot.save_draft('pilot-validation-alternative','interactive',bad);
  begin
    perform forecast_pilot.save_draft('pilot-validation-valid','interactive',bad);
    raise exception 'Collision was accepted';
  exception when unique_violation then null;
  end;

  bad := jsonb_set(jsonb_set(jsonb_set(p,'{status}','"blocked"'),'{proposal}','null'),'{sources,0,status}','"unavailable"');
  result := forecast_pilot.save_draft('pilot-validation-blocked','interactive',bad);
  if result->>'status' <> 'blocked' then raise exception 'Blocked result failed'; end if;

  foreach role_name in array array['anon','authenticated','service_role'] loop
    begin
      execute format('set local role %I',role_name);
      perform count(*) from forecast_pilot.drafts;
      execute 'reset role';
      raise exception 'Unexpected access for %',role_name;
    exception when insufficient_privilege then execute 'reset role';
    end;
  end loop;
  if (select count(*) from forecast_pilot.drafts where run_key like 'pilot-validation-%') <> 3 then
    raise exception 'Unexpected row count after retries and rejected drafts';
  end if;

  begin
    perform forecast_pilot.save_draft('pilot-validation-oversized','interactive',
      p || jsonb_build_object('oversized',repeat('x',65536)));
    raise exception 'Oversized payload was accepted';
  exception when sqlstate '22023' then null;
  end;
  for variant in 1..(20 - (select count(*)::integer from forecast_pilot.drafts)) loop
    perform forecast_pilot.save_draft('pilot-validation-capacity-'||variant,'interactive',p);
  end loop;
  begin
    perform forecast_pilot.save_draft('pilot-validation-over-capacity','interactive',p);
    raise exception 'Storage limit was exceeded';
  exception when sqlstate '54000' then null;
  end;
end;
$test$;
select 'PASS: valid draft, 70/69 boundary, ten rejection cases, idempotency, collision, blocked result, three denied roles, 64 KiB and 20-row limits' as verification;
rollback;
