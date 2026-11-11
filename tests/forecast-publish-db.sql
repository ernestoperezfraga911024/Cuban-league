-- Execute BEGIN + docs/forecast-publish/migration.sql + this file. No commits.
do $test$
declare admin_id uuid; source_key text; source jsonb; players jsonb; result jsonb; second_result jsonb;
 first_id bigint; second_id bigint; request_id uuid := gen_random_uuid(); role_name text; bad jsonb; before_hash text;
begin
 select user_id into admin_id from private.league_admins limit 1;
 select d.run_key,d.payload into source_key,source from forecast_pilot.drafts d
   where d.payload->>'method_version'='editorial-v1' and d.status='draft' order by d.created_at desc limit 1;
 if admin_id is null or source is null then raise exception 'Needs existing admin and assessed private source'; end if;
 select md5(string_agg(d.payload::text,',' order by d.run_key)) into before_hash from forecast_pilot.drafts d;
 select jsonb_agg(jsonb_build_object('id',p->>'id','slot',p->'slot','probability',p->'probability',
   'alternative_id',p->'alternative'->'id','reason',p->>'reason') order by (p->>'slot')::integer)
   into players from jsonb_array_elements(source->'proposal'->'players') p;
 foreach role_name in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(role_name,'forecast_publish.revisions','select')
     or has_table_privilege(role_name,'forecast_publish.events','select')
     or has_table_privilege(role_name,'public.forecast_public','insert,update,delete') then raise exception 'Unsafe table grants'; end if;
 end loop;
 foreach role_name in array array['anon','service_role'] loop
   if has_function_privilege(role_name,'public.command_forecast_publication(text,bigint,uuid,text,jsonb,text,bigint)','execute') then raise exception 'Command grant leaked'; end if;
 end loop;
 perform set_config('request.jwt.claims','{}',true);
 perform set_config('request.jwt.claim.sub','',true);
 set local role authenticated;
 begin perform public.get_forecast_publication();raise exception 'Missing identity accepted';exception when insufficient_privilege then null;end;
 reset role;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
 set local role authenticated;
 begin perform public.command_forecast_publication('save',0,gen_random_uuid(),source_key,players,'Nota pública de prueba.');raise exception 'Non-admin accepted';exception when insufficient_privilege then null;end;
 begin perform private.get_forecast_publication();raise exception 'Private helper bypass';exception when insufficient_privilege then null;end;
 reset role;
 set local role anon;
 if (select count(*) from public.forecast_public)<>0 then raise exception 'Unexpected public snapshot'; end if;
 reset role;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 set local role authenticated;
 result := public.command_forecast_publication('save',0,request_id,source_key,players,'Nota pública de prueba.');first_id:=(result->>'revision_id')::bigint;
 if (select count(*) from public.forecast_public)<>0 then raise exception 'Save published without command'; end if;
 second_result := public.command_forecast_publication('save',0,request_id,source_key,players,'Nota pública de prueba.');
 if second_result->'already_applied'<>'true'::jsonb or second_result->'revision_id'<>result->'revision_id' then raise exception 'Retry duplicated revision'; end if;
 begin perform public.command_forecast_publication('save',0,request_id,source_key,players,'Una nota distinta de prueba.');raise exception 'Request reused with other contents';exception when unique_violation then null;end;
 begin perform public.command_forecast_publication('publish',0,gen_random_uuid(),p_revision_id=>first_id);raise exception 'Lost update accepted';exception when serialization_failure then null;end;
 bad:=jsonb_set(players,'{0,id}',to_jsonb('unknown-player'::text));
 begin perform public.command_forecast_publication('save',1,gen_random_uuid(),source_key,bad,'Nota pública de prueba.');raise exception 'Unknown player accepted';exception when invalid_parameter_value then null;end;
 bad:=jsonb_set(players,'{0,alternative_id}',players->1->'id');
 begin perform public.command_forecast_publication('save',1,gen_random_uuid(),source_key,bad,'Nota pública de prueba.');raise exception 'Alternative inside XI accepted';exception when invalid_parameter_value then null;end;
 bad:=jsonb_set(players,'{0,probability}','70');
 begin perform public.command_forecast_publication('save',1,gen_random_uuid(),source_key,bad,'Nota pública de prueba.');raise exception 'High probability with alternative accepted';exception when invalid_parameter_value then null;end;
 bad:=jsonb_set(players,'{0,probability}','69.5');
 begin perform public.command_forecast_publication('save',1,gen_random_uuid(),source_key,bad,'Nota pública de prueba.');raise exception 'Fraction accepted';exception when invalid_parameter_value then null;end;
 result:=public.command_forecast_publication('publish',1,gen_random_uuid(),p_revision_id=>first_id);
 if result->>'current_revision'<>first_id::text then raise exception 'Publish failed'; end if;
 reset role;
 set local role anon;
 select payload into bad from public.forecast_public;
 if jsonb_array_length(bad->'players')<>11 or bad ? 'source_key' or bad ? 'author' or bad->'sources'->0 ? 'starters'
   or bad->'players'->0 ? 'assessment' then raise exception 'Wrong public projection'; end if;
 begin insert into public.forecast_public select * from public.forecast_public;raise exception 'Anonymous write accepted';exception when insufficient_privilege then null;end;
 reset role;
 set local role authenticated;
 bad:=jsonb_set(players,'{0,reason}',to_jsonb('Motivo editorial revisado manualmente.'::text));
 second_result:=public.command_forecast_publication('save',2,gen_random_uuid(),source_key,bad,'Segunda nota pública de prueba.');second_id:=(second_result->>'revision_id')::bigint;
 if (select revision_id from public.forecast_public)<>first_id then raise exception 'Save changed published XI'; end if;
 if public.get_forecast_publication(second_id)->'revision'->'payload'->'players'->0->>'method'<>'editorial-manual-v1' then raise exception 'Manual override mislabelled'; end if;
 begin perform public.command_forecast_publication('restore',3,gen_random_uuid(),p_revision_id=>second_id);raise exception 'Unpublished restore accepted';exception when invalid_parameter_value then null;end;
 perform public.command_forecast_publication('publish',3,gen_random_uuid(),p_revision_id=>second_id);
 perform public.command_forecast_publication('restore',4,gen_random_uuid(),p_revision_id=>first_id);
 perform public.command_forecast_publication('withdraw',5,gen_random_uuid());
 if (select count(*) from public.forecast_public)<>0 then raise exception 'Withdraw failed'; end if;
 perform public.command_forecast_publication('restore',6,gen_random_uuid(),p_revision_id=>first_id);
 reset role;
 -- New, isolated test revisions only: no mutation of the original source drafts.
 update forecast_publish.revisions set payload=jsonb_set(payload,'{evidence_at}',to_jsonb(now()-interval '25 hours')) where id=second_id;
 set local role authenticated;
 begin perform public.command_forecast_publication('publish',7,gen_random_uuid(),p_revision_id=>second_id);raise exception 'Stale evidence accepted';exception when invalid_parameter_value then null;end;
 reset role;
 if (select count(*) from forecast_publish.revisions)<>2 then raise exception 'Failed commands leaked revisions'; end if;
 if before_hash is distinct from (select md5(string_agg(d.payload::text,',' order by d.run_key)) from forecast_pilot.drafts d) then raise exception 'Pilot data changed'; end if;
end;
$test$;
select 'PASS: authorization, immutable saves, retry, conflict, validation, public projection, publish, withdraw, restore, freshness and original hashes; rolling back' as result;
rollback;
