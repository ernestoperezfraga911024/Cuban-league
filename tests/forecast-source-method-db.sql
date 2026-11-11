-- Run inside BEGIN / source-weighted.sql / this file / ROLLBACK. No row writes.
do $test$
declare src jsonb; player_row jsonb; e jsonb; candidate jsonb; old_score integer; result jsonb; bad jsonb; n integer;
begin
 select payload into src from forecast_pilot.drafts where payload->>'method_version'='editorial-v1' order by created_at desc limit 1;
 if src is null then raise exception 'A historical v1 fixture is required'; end if;
 for player_row in select value from jsonb_array_elements(src->'proposal'->'players') loop
   if forecast_publish.assess(player_row->'assessment')<>(player_row->>'probability')::integer then raise exception 'v1 changed'; end if;
 end loop;
 e:=jsonb_build_object('method','editorial-v2','confirmed_out',false,
   'sources',(select jsonb_agg(jsonb_build_object('id',s->>'id','prediction','starter','probability',90,'reason','Synthetic source.','refs',jsonb_build_array(s->>'url'))) from jsonb_array_elements(src->'sources') s),
   'role',jsonb_build_object('value',90,'reason','Synthetic role.','refs',jsonb_build_array('https://example.test/')),
   'context',jsonb_build_object('points',0,'reason','Synthetic context.','refs',jsonb_build_array('https://example.test/')),
   'availability',jsonb_build_object('value','clear','reason','Synthetic availability.','refs',jsonb_build_array('https://example.test/')),
   'rotation',jsonb_build_object('value','low','reason','Synthetic rotation.','refs',jsonb_build_array('https://example.test/')),
   'horizon',jsonb_build_object('value','distant','reason','Synthetic horizon.','refs',jsonb_build_array('https://example.test/')));
 if forecast_publish.assess(e)<>88 then raise exception 'v2 weighted result'; end if;
 if forecast_publish.assess(jsonb_set(e,'{availability,value}','"concern"'))<>80 then raise exception 'v2 concern adjustment'; end if;
 for n in 1..6 loop
   bad:=case n when 1 then e-'sources' when 2 then jsonb_set(e,'{confirmed_out}','true') when 3 then jsonb_set(e,'{sources,0,probability}','101')
     when 4 then jsonb_set(e,'{context,points}','11') when 5 then jsonb_set(e,'{sources,0,refs}','["https://evil.test/"]') else jsonb_set(e,'{sources,1,id}',e->'sources'->0->'id') end;
   begin perform forecast_publish.assess(bad);raise exception 'Invalid assessment accepted %',n;
   exception when sqlstate '22023' then null;end;
 end loop;
 src:=jsonb_set(src,'{method_version}','"editorial-v2"');
 src:=jsonb_set(src,'{proposal,players}',(select jsonb_agg(p||jsonb_build_object('assessment',e,'probability',88,'alternative',null)) from jsonb_array_elements(src->'proposal'->'players') p));
 src:=jsonb_set(src,'{sources}',(select jsonb_agg(s||jsonb_build_object('player_observations',(select jsonb_agg(jsonb_build_object('player_id',p->>'id','prediction','starter','probability',90)) from jsonb_array_elements(src->'proposal'->'players') p))) from jsonb_array_elements(src->'sources') s));
 select jsonb_agg(jsonb_build_object('id',p->>'id','slot',p->'slot','probability',88,'alternative_id',null,'reason',p->>'reason')) into candidate from jsonb_array_elements(src->'proposal'->'players') p;
 result:=forecast_publish.build(src,candidate,'Synthetic private review.');
 if jsonb_array_length(result->'players')<>11 or exists(select 1 from jsonb_array_elements(result->'players') p where p->>'method'<>'editorial-v2') then raise exception 'v2 build failed'; end if;
 bad:=jsonb_set(src,'{sources,0,player_observations,0,probability}','10');
 begin perform forecast_publish.build(bad,candidate,'Synthetic private review.');raise exception 'Changed evidence accepted';exception when sqlstate '22023' then null;end;
 bad:=jsonb_set(src,'{proposal,players,0,probability}','89');
 begin perform forecast_publish.build(bad,candidate,'Synthetic private review.');raise exception 'Changed probability accepted';exception when sqlstate '22023' then null;end;
 if has_function_privilege('anon','forecast_publish.assess(jsonb)','EXECUTE') or has_function_privilege('authenticated','forecast_publish.build(jsonb,jsonb,text)','EXECUTE') then raise exception 'Private helper exposed'; end if;
end;
$test$;
