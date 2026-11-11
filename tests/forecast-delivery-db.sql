-- Self-rolling-back test block. The deliberate ZX001 rolls back every test row.
-- Sequence values can have gaps. No real publication or draft is changed.
do $test$
declare src jsonb; good jsonb; result jsonb; again jsonb; original jsonb; n bigint; v bigint; rid bigint;
 admin_id uuid; req uuid:=gen_random_uuid(); actor uuid; role_name text; k text:='pilot-delivery-transaction-test';
begin
 begin
  select jsonb_build_object('drafts',(select jsonb_agg(to_jsonb(d) order by run_key) from forecast_pilot.drafts d),
    'public',(select jsonb_agg(to_jsonb(p)) from public.forecast_public p)) into original;
  select payload into src from forecast_pilot.drafts where payload->>'method_version'='editorial-v2' order by created_at desc limit 1;
  if src is null then raise exception 'Needs an existing v2 reference'; end if;
  src:=jsonb_set(src,'{sources}',(select jsonb_agg(s||jsonb_build_object('fetched_at',now())) from jsonb_array_elements(src->'sources') s));
  src:=jsonb_set(src,'{limitations}','["Prueba sintética transaccional. No debe publicarse fuera de esta transacción."]');
  good:=src;
  perform forecast_pilot.save_draft(k,'scheduled',src);
  select version into v from forecast_publish.state;
  select system_actor into actor from forecast_publish.delivery_config;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if has_function_privilege(role_name,'forecast_publish.command_delivery(text,bigint,uuid,text,uuid)','execute')
    or has_function_privilege(role_name,'forecast_publish.prepare_delivery(text,interval)','execute')
    or has_table_privilege(role_name,'forecast_publish.delivery_config','select,insert,update,delete')
    or has_table_privilege(role_name,'forecast_publish.delivery_commands','select,insert,update,delete') then raise exception 'Private access leaked'; end if;
  end loop;
  perform set_config('request.jwt.claims','{}',true);perform set_config('request.jwt.claim.sub','',true);
  set local role authenticated;
  begin perform public.get_forecast_delivery();raise exception 'Missing identity accepted';exception when insufficient_privilege then null;end;
  reset role;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  set local role authenticated;
  begin perform public.command_forecast_delivery('automatic',v,gen_random_uuid());raise exception 'Non-admin accepted';exception when insufficient_privilege then null;end;
  begin perform private.get_forecast_delivery();raise exception 'Private wrapper bypass';exception when insufficient_privilege then null;end;
  reset role;
  set local role anon;
  begin perform public.get_forecast_delivery();raise exception 'Anon access accepted';exception when insufficient_privilege then null;end;
  reset role;
  select user_id into admin_id from private.league_admins limit 1;
  if admin_id is null then raise exception 'No admin fixture'; end if;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  set local role authenticated;
  result:=public.command_forecast_delivery('manual',v,gen_random_uuid());v:=(result->>'version')::bigint;
  if public.get_forecast_delivery()->>'readiness'<>'ready' then raise exception 'Manual readiness missing'; end if;
  begin perform public.command_forecast_delivery('deliver',v,gen_random_uuid(),k);raise exception 'Admin can masquerade as scheduler';exception when invalid_parameter_value then null;end;
  reset role;
  result:=forecast_publish.command_delivery('deliver',v,req,k);
  if result->>'outcome'<>'ready' then raise exception 'Manual delivery published'; end if;
  if original->'public' is distinct from (select jsonb_agg(to_jsonb(p)) from public.forecast_public p) then raise exception 'Manual mode changed public data'; end if;
  again:=forecast_publish.command_delivery('deliver',v,req,k);
  if again->'already_applied'<>'true'::jsonb or again->'version'<>result->'version' then raise exception 'Retry failed'; end if;
  begin perform forecast_publish.command_delivery('automatic',v,req);raise exception 'UUID reuse accepted';exception when unique_violation then null;end;
  begin perform forecast_publish.command_delivery('automatic',v,gen_random_uuid());raise exception 'Stale version accepted';exception when serialization_failure then null;end;
  v:=(result->>'version')::bigint;
  set local role authenticated;
  result:=public.command_forecast_delivery('publish',v,gen_random_uuid(),k);v:=(result->>'version')::bigint;
  if result->>'outcome'<>'published' then raise exception 'One-click publication failed'; end if;
  rid:=(result->>'revision_id')::bigint;
  reset role;
  if (select author from forecast_publish.revisions where id=rid)<>admin_id then raise exception 'Manual actor wrong'; end if;
  select count(*) into n from forecast_publish.revisions;
  result:=forecast_publish.command_delivery('automatic',v,gen_random_uuid());v:=(result->>'version')::bigint;
  result:=forecast_publish.command_delivery('deliver',v,gen_random_uuid(),k);v:=(result->>'version')::bigint;
  if result->>'outcome'<>'unchanged' or n<>(select count(*) from forecast_publish.revisions) then raise exception 'Same payload duplicated'; end if;
  -- Mutations below affect only the synthetic test row and roll back in this block.
  update forecast_pilot.drafts set payload=jsonb_set(good,'{limitations}','["Otra nota sintética de prueba transaccional."]') where run_key=k;
  result:=forecast_publish.command_delivery('deliver',v,gen_random_uuid(),k);v:=(result->>'version')::bigint;
  if result->>'outcome'<>'published' then raise exception 'Automatic publication failed'; end if;
  rid:=(result->>'revision_id')::bigint;
  if (select author from forecast_publish.revisions where id=rid)<>actor or actor=admin_id then raise exception 'Automatic identity wrong'; end if;
  if (select payload ? 'assessment' or payload ? 'source_key' or payload->'sources'->0 ? 'starters' from public.forecast_public) then raise exception 'Private data leaked'; end if;
  update forecast_pilot.drafts set payload=jsonb_set(jsonb_set(good,'{status}','"blocked"'),'{proposal}','null'),status='blocked' where run_key=k;
  result:=forecast_publish.command_delivery('deliver',v,gen_random_uuid(),k);v:=(result->>'version')::bigint;
  if result->>'outcome'<>'blocked' or (select current_revision from forecast_publish.state)<>rid then raise exception 'Blocked attempt changed publication'; end if;
  begin perform forecast_publish.command_delivery('publish',v,gen_random_uuid(),k);raise exception 'Blocked manual publication accepted';exception when invalid_parameter_value then null;end;
  update forecast_pilot.drafts set payload=jsonb_set(good,'{sources}',(select jsonb_agg(s||jsonb_build_object('fetched_at',now()-interval '25 hours')) from jsonb_array_elements(good->'sources') s)),status='draft' where run_key=k;
  result:=forecast_publish.command_delivery('deliver',v,gen_random_uuid(),k);v:=(result->>'version')::bigint;
  if result->>'outcome'<>'blocked' then raise exception 'Stale source accepted'; end if;
  update forecast_pilot.drafts set payload=jsonb_set(good,'{kickoff_at}',to_jsonb(now()-interval '1 hour')) where run_key=k;
  begin perform forecast_publish.prepare_delivery(k);raise exception 'Started fixture accepted';exception when invalid_parameter_value then null;end;
  begin perform forecast_publish.prepare_delivery('pilot-older-source');raise exception 'Older source accepted';exception when invalid_parameter_value then null;end;
  update forecast_pilot.drafts set payload=jsonb_set(good,'{proposal,players,0,probability}','1') where run_key=k;
  begin perform forecast_publish.prepare_delivery(k);raise exception 'Invalid scores accepted';exception when invalid_parameter_value then null;end;
  -- Old history and withdraw/restore still work with the automatic publication event.
  set local role authenticated;
  perform public.command_forecast_publication('withdraw',v,gen_random_uuid());v:=v+1;
  perform public.command_forecast_publication('restore',v,gen_random_uuid(),p_revision_id=>rid);
  reset role;
  raise exception 'Rollback successful test' using errcode='ZX001';
 exception when sqlstate 'ZX001' then null;
 end;
 if original is distinct from jsonb_build_object('drafts',(select jsonb_agg(to_jsonb(d) order by run_key) from forecast_pilot.drafts d),
   'public',(select jsonb_agg(to_jsonb(p)) from public.forecast_public p)) then raise exception 'Tests did not roll back'; end if;
end;
$test$;
