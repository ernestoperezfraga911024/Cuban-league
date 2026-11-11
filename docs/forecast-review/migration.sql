-- Apply AFTER review. Requires private_forecast_pilot (already installed; PR #75).
-- New read-only functions only. No changes to pilot tables, RLS or save_draft.
create function private.get_forecast_pilot_drafts(p_run_key text default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $body$
declare result jsonb;
begin
  if (select auth.uid()) is null or not coalesce(private.is_league_admin(), false) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_run_key is not null then
    if length(p_run_key) > 106 or p_run_key !~ '^pilot-[a-z0-9-]{8,100}$' then
      raise exception 'Invalid run key' using errcode = '22023';
    end if;
    select jsonb_build_object('run_key', d.run_key, 'created_at', d.created_at,
      'status', d.status, 'payload', d.payload) into result
      from forecast_pilot.drafts d where d.run_key = p_run_key;
    return result;
  end if;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at desc, s.run_key desc), '[]'::jsonb)
    into result from (
      select d.run_key, d.created_at, d.status, d.execution_kind,
        d.payload->>'team' as team, d.payload->>'fixture_key' as fixture_key,
        d.payload->>'kickoff_at' as kickoff_at
      from forecast_pilot.drafts d order by d.created_at desc, d.run_key desc limit 20
    ) s;
  return result;
end;
$body$;
revoke all on function private.get_forecast_pilot_drafts(text) from public, anon, authenticated, service_role;
grant execute on function private.get_forecast_pilot_drafts(text) to authenticated;

create function public.get_forecast_pilot_drafts(p_run_key text default null)
returns jsonb language sql stable security invoker set search_path = ''
as $body$
  select private.get_forecast_pilot_drafts(p_run_key);
$body$;
revoke all on function public.get_forecast_pilot_drafts(text) from public, anon, authenticated, service_role;
grant execute on function public.get_forecast_pilot_drafts(text) to authenticated;
comment on function public.get_forecast_pilot_drafts(text) is 'Admin-only read of private pilot. Null key lists metadata; key fetches one immutable draft. No writes.';
