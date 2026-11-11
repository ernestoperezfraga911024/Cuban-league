-- Revert the admin frontend PR first. Retains all original drafts and permissions.
begin;
drop function public.get_forecast_pilot_drafts(text);
drop function private.get_forecast_pilot_drafts(text);
commit;
