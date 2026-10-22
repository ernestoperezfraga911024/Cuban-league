-- Integration checks; all fixture data and revisions are rolled back.
begin;
do $$
declare
  payload jsonb; day_payload jsonb; players jsonb; result jsonb; again jsonb; req uuid := gen_random_uuid(); day_req uuid := gen_random_uuid();
  admin_id uuid; baseline text;
begin
  select user_id into admin_id from private.league_admins limit 1;
  if admin_id is null then raise exception 'No admin available to verify publication'; end if;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  select md5(coalesce(jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text)::text,'')) into baseline from public.matchday_stats s;
  payload := jsonb_build_object('version',1,'league',jsonb_build_object('id','978196'),'kind','general','matchday',0,
    'season','9999/99','capturedAt',now(),'managers',jsonb_build_array(
      jsonb_build_object('id','101','name','Fixture participant','avatarUrl','https://cdn-mister.mundodeportivo.com/avatar/101.jpg','points',75,'rank',1),
      jsonb_build_object('id','999','name','Ernesto','points',0,'rank',2)));
  result := public.publish_second_division(payload,'999',0,req);
  if jsonb_array_length(result->'standings') <> 1 or result#>>'{standings,0,id}' <> '101' then raise exception 'Admin was not excluded'; end if;
  again := public.publish_second_division(payload,'999',0,req);
  if result <> again or (again->>'revision')::int <> 1 then raise exception 'Idempotency failed'; end if;
  begin
    perform public.publish_second_division(payload,'999',0,gen_random_uuid());
    raise exception 'Expected conflict';
  exception when serialization_failure then null; end;
  begin
    perform public.publish_second_division(jsonb_set(payload,'{league,id}','"649733"'),'999',1,gen_random_uuid());
    raise exception 'Wrong league accepted';
  exception when raise_exception then if sqlerrm = 'Wrong league accepted' then raise; end if; end;
  begin
    perform public.publish_second_division(payload,'101',1,gen_random_uuid());
    raise exception 'Changed excluded ID accepted';
  exception when raise_exception then if sqlerrm = 'Changed excluded ID accepted' then raise; end if; end;
  payload := payload #- '{managers,0,avatarUrl}';
  payload := jsonb_set(payload,'{managers,1,name}','"Admin renamed"');
  payload := jsonb_set(payload,'{managers,0,points}','77');
  result := public.publish_second_division(payload,'999',1,gen_random_uuid());
  if (result#>>'{standings,0,points}')::int <> 77 or (result->>'revision')::int <> 2 then raise exception 'Reimport accumulated points'; end if;
  if result#>>'{standings,0,avatarUrl}' <> 'https://cdn-mister.mundodeportivo.com/avatar/101.jpg' then raise exception 'Reimport removed participant photo'; end if;
  if private.second_division_avatar_url('javascript:alert(1)') is not null
    or private.second_division_avatar_url('https://user:password@example.com/a') is not null
    or private.second_division_avatar_url('https://127.0.0.1/a') is not null
    or private.second_division_avatar_url('https://example.com:444/a') is not null
    or private.second_division_avatar_url('https://example.com/a"bad') is not null
    then raise exception 'Unsafe photo accepted'; end if;
  select jsonb_agg(jsonb_build_object('slot',n,'id',(1000+n)::text,'name','Player '||n,'position',case when n=11 then 'PT' when n<4 then 'DL' when n<8 then 'MC' else 'DF' end,
    'points',case when n=1 then 3 else 1 end,'status','scored','captain',n=1,'multiplier',case when n=1 then 3 else 1 end) order by n)
    into players from generate_series(1,11) n;
  day_payload := payload || jsonb_build_object('kind','matchday','matchday',5,'gameweekId',4046,'excludedManagerId','999');
  day_payload := jsonb_set(day_payload,'{managers,0}',(day_payload#>'{managers,0}')||jsonb_build_object('points',13,'negativeBalance',false,'lineup',players));
  result := public.publish_second_division(day_payload,'999',0,day_req);
  if (select count(*) from public.second_division_lineups where season='9999/99' and matchday=5) <> 1 then raise exception 'Missing XI'; end if;
  if (select jsonb_array_length(lineup) from public.second_division_lineups where season='9999/99' and matchday=5 and manager_id='101') <> 11 then raise exception 'Incomplete XI'; end if;
  if (select standings#>>'{0,points}' from public.second_division_standings where season='9999/99' and matchday=0) <> '77' then raise exception 'Day altered General'; end if;
  begin
    perform public.publish_second_division(jsonb_set(day_payload,'{managers,0,lineup}',players - 0),'999',1,gen_random_uuid());
    raise exception 'Partial XI accepted';
  exception when raise_exception then if sqlerrm = 'Partial XI accepted' then raise; end if; end;
  begin
    perform public.publish_second_division(jsonb_set(day_payload,'{managers,0,lineup,1,id}',players#>'{0,id}'),'999',1,gen_random_uuid());
    raise exception 'Duplicate player accepted';
  exception when raise_exception then if sqlerrm = 'Duplicate player accepted' then raise; end if; end;
  if (select revision from public.second_division_standings where season='9999/99' and matchday=5) <> 1 then raise exception 'Invalid capture changed table'; end if;
  day_payload := jsonb_set(day_payload,'{managers,0}',(day_payload#>'{managers,0}') || '{"points":0,"negativeBalance":true,"lineup":[]}'::jsonb);
  result := public.publish_second_division(day_payload,'999',1,gen_random_uuid());
  if (select revision <> 2 or not negative_balance or lineup <> '[]'::jsonb from public.second_division_lineups where season='9999/99' and matchday=5 and manager_id='101') then raise exception 'XI correction not atomic'; end if;
  -- Import out of order: J9 and J1 must coexist with J5 and General.
  perform public.publish_second_division(jsonb_set(day_payload,'{matchday}','9'),'999',0,gen_random_uuid());
  perform public.publish_second_division(jsonb_set(day_payload,'{matchday}','1'),'999',0,gen_random_uuid());
  if public.get_second_division_admin_state('9999/99',1)->'publishedMatchdays' <> '[0,1,5,9]'::jsonb then raise exception 'Saved matchday list incomplete'; end if;
  if (select count(*) from public.second_division_lineups where season='9999/99') <> 3 then raise exception 'Earlier XI overwritten'; end if;
  if (select revision from public.second_division_standings where season='9999/99' and matchday=5) <> 2
    or (select standings#>>'{0,points}' from public.second_division_standings where season='9999/99' and matchday=0) <> '77'
    then raise exception 'Historical import altered another table'; end if;
  if (select standings#>>'{0,avatarUrl}' from public.second_division_standings where season='9999/99' and matchday=1) <> 'https://cdn-mister.mundodeportivo.com/avatar/101.jpg' then raise exception 'Missing fallback photo from General'; end if;
  if public.get_second_division_admin_state('9999/99',5)->>'excludedId' <> '999' then raise exception 'Missing saved exclusion'; end if;
  if (select md5(coalesce(jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text)::text,'')) from public.matchday_stats s) <> baseline then raise exception 'First Division changed'; end if;
end;
$$;

-- Regression: the photo lookups must match manager IDs across a real-sized roster.
do $photo_regression$
declare
  general_payload jsonb; day_payload jsonb; players jsonb; result jsonb; again jsonb;
  admin_id uuid; day_req uuid := gen_random_uuid();
begin
  select user_id into admin_id from private.league_admins limit 1;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  select jsonb_build_object('version',1,'league',jsonb_build_object('id','978196'),
    'kind','general','matchday',0,'season','9998/98','capturedAt',now(),
    'managers',jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id',(1000+n)::text,'name','Photo fixture '||n,'points',100-n,'rank',n,
      'avatarUrl',case when n in (1,2) then 'https://example.com/avatar/'||n||'.jpg'
        when n=4 then 'javascript:alert(1)' else null end)) order by n)
      ||jsonb_build_array(jsonb_build_object('id','999','name','Excluded admin','points',0,'rank',20)))
    into general_payload from generate_series(1,19) n;
  result := public.publish_second_division(general_payload,'999',0,gen_random_uuid());
  if jsonb_array_length(result->'standings') <> 19 then raise exception 'Wrong fixture roster size'; end if;

  -- Eight players and three empty positions, including the goalkeeper.
  select jsonb_agg(jsonb_build_object('slot',n,
    'id',case when n in (2,7,11) then '' else (2000+n)::text end,
    'name',case when n in (2,7,11) then 'Posición vacía' else 'Player '||n end,
    'position',case when n=11 then 'PT' when n<=2 then 'DL' when n<=6 then 'MC' else 'DF' end,
    'points',case when n in (2,7,11) then -4 else 1 end,
    'status',case when n in (2,7,11) then 'empty' else 'scored' end,
    'captain',false,'multiplier',1) order by n) into players from generate_series(1,11) n;
  select general_payload || jsonb_build_object('kind','matchday','matchday',1,
    'gameweekId',4001,'excludedManagerId','999',
    'managers',jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id',case when n=1 then '1002' when n=2 then '1001' else (1000+n)::text end,
      'name','Photo fixture '||n,'points',case when n=19 then 0 else 100-n end,'rank',n,
      'avatarUrl',case when n=3 then 'https://example.com/day/3.jpg' else null end,
      'negativeBalance',n=19,'lineup',case when n=19 then '[]'::jsonb else players end)) order by n)
      ||jsonb_build_array(jsonb_build_object('id','999','name','Excluded admin','points',0,'rank',20)))
    into day_payload from generate_series(1,19) n;
  result := public.publish_second_division(day_payload,'999',0,day_req);
  if result#>>'{standings,0,avatarUrl}' is distinct from 'https://example.com/avatar/2.jpg'
    or result#>>'{standings,1,avatarUrl}' is distinct from 'https://example.com/avatar/1.jpg'
    or result#>>'{standings,2,avatarUrl}' is distinct from 'https://example.com/day/3.jpg'
    or result#>'{standings,3}' ? 'avatarUrl'
    then raise exception 'General fallback attached a missing or incorrect participant photo'; end if;
  again := public.publish_second_division(day_payload,'999',0,day_req);
  if result is distinct from again then raise exception 'Day publication retry was not idempotent'; end if;
  if (select count(*) from public.second_division_lineups where season='9998/98' and matchday=1) <> 19
    or (select count(*) from public.second_division_lineups where season='9998/98' and matchday=1 and lineup=players) <> 18
    or (select count(*) from public.second_division_lineups where season='9998/98' and matchday=1 and negative_balance and lineup='[]'::jsonb) <> 1
    then raise exception 'Publication failed to preserve empty slots or negative balance'; end if;

  -- A reimport uses each photo saved for this day, before considering General.
  day_payload := day_payload #- '{managers,2,avatarUrl}';
  day_payload := jsonb_set(day_payload,'{managers,1,avatarUrl}','"https://example.com/new/1.jpg"');
  result := public.publish_second_division(day_payload,'999',1,gen_random_uuid());
  if result#>>'{standings,0,avatarUrl}' is distinct from 'https://example.com/avatar/2.jpg'
    or result#>>'{standings,1,avatarUrl}' is distinct from 'https://example.com/new/1.jpg'
    or result#>>'{standings,2,avatarUrl}' is distinct from 'https://example.com/day/3.jpg'
    or result#>'{standings,3}' ? 'avatarUrl'
    or (result->>'revision')::int <> 2
    then raise exception 'Reimport did not preserve per-manager photo precedence'; end if;
  if (select count(*) from public.second_division_lineups where season='9998/98' and matchday=1 and revision=2) <> 19
    then raise exception 'Reimport did not replace all day lineups atomically'; end if;

  general_payload := general_payload #- '{managers,0,avatarUrl}' #- '{managers,1,avatarUrl}';
  result := public.publish_second_division(general_payload,'999',1,gen_random_uuid());
  if result#>>'{standings,0,avatarUrl}' is distinct from 'https://example.com/avatar/1.jpg'
    or result#>>'{standings,1,avatarUrl}' is distinct from 'https://example.com/avatar/2.jpg'
    or result#>'{standings,2}' ? 'avatarUrl'
    or result#>'{standings,3}' ? 'avatarUrl'
    then raise exception 'General reimport changed photo owners or copied a day-only photo'; end if;
  if (select revision from public.second_division_standings where season='9998/98' and matchday=1) <> 2
    then raise exception 'General reimport altered an existing day'; end if;
end;
$photo_regression$;

set local role anon;
do $$
begin
  perform count(*) from public.second_division_standings;
  perform count(*) from public.second_division_lineups;
  begin
    delete from public.second_division_standings where season='9999/99';
    raise exception 'Anonymous write allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.get_second_division_admin_state('9999/99',0);
    raise exception 'Anonymous admin read allowed';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
set local role authenticated;
do $$
begin
  begin
    perform public.get_second_division_admin_state('9999/99',0);
    raise exception 'Non-admin read allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.publish_second_division('{}','999',0,gen_random_uuid());
    raise exception 'Non-admin publish allowed';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
rollback;
select 'Second Division database integration checks passed; all fixture changes rolled back' as result;
