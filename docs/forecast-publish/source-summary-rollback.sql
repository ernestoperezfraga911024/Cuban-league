-- Remove only the projection extension. Already published summaries remain readable.
-- No source evidence, forecasts, history, dates or permissions are rewritten.
do $rollback$
declare definition text; extension text := ',''source_summary'',forecast_season.source_summary(x->''assessment'')';
begin
 definition:=pg_get_functiondef('forecast_season.build_team(jsonb,interval)'::regprocedure);
 if md5(definition)<>'f30f730355203b835804b2f6c08b7188' then
  raise exception 'build_team changed since source summary review';
 end if;
 execute replace(definition,extension,'');
end;$rollback$;
drop function forecast_season.source_summary(jsonb);
