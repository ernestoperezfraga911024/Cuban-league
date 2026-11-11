-- Run BEGIN + migration.sql + this file together. Always rolls back.
do $test$
declare admin_id uuid; key text; summaries jsonb; detail jsonb; role_name text;
begin
  select user_id into admin_id from private.league_admins limit 1;
  if admin_id is null then raise exception 'Needs an existing admin for authorization test'; end if;
  select run_key into key from forecast_pilot.drafts order by created_at desc limit 1;
  foreach role_name in array array['anon','authenticated','service_role'] loop
    if has_table_privilege(role_name,'forecast_pilot.drafts','select') then raise exception 'Direct table access leaked'; end if;
  end loop;
  foreach role_name in array array['anon','service_role'] loop
    if has_function_privilege(role_name,'public.get_forecast_pilot_drafts(text)','execute')
       or has_function_privilege(role_name,'private.get_forecast_pilot_drafts(text)','execute') then
      raise exception 'RPC granted to wrong role';
    end if;
  end loop;
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role authenticated;
  begin
    perform public.get_forecast_pilot_drafts();
    raise exception 'Missing identity accepted';
  exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
  set local role authenticated;
  begin
    perform public.get_forecast_pilot_drafts();
    raise exception 'Non-admin accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform private.get_forecast_pilot_drafts();
    raise exception 'Private helper bypassed guard';
  exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  set local role authenticated;
  summaries := public.get_forecast_pilot_drafts();
  if jsonb_typeof(summaries) <> 'array' or jsonb_array_length(summaries) > 20 then raise exception 'Invalid bounded list'; end if;
  if exists(select 1 from jsonb_array_elements(summaries) s where s ? 'payload') then raise exception 'List exposes detail'; end if;
  if key is not null then
    detail := public.get_forecast_pilot_drafts(key);
    if detail->>'run_key' is distinct from key or detail->'payload'->'publication_allowed' is distinct from 'false'::jsonb then raise exception 'Readback failed'; end if;
  end if;
  if public.get_forecast_pilot_drafts('pilot-nonexistent-test') is not null then raise exception 'Missing key should be null'; end if;
  begin
    perform public.get_forecast_pilot_drafts('invalid');
    raise exception 'Invalid key accepted';
  exception when invalid_parameter_value then null; end;
  reset role;
end;
$test$;
select 'Authorization, bounded list, detail and invalid-input checks passed; transaction will roll back' as result;
rollback;
