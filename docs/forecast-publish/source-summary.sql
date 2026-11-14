-- Add public source evidence after the existing assessment/evidence validation.
-- No recalculation, new source reads, schedule changes or permission expansion.
do $guard$ begin
 if md5(pg_get_functiondef('forecast_season.build_team(jsonb,interval)'::regprocedure))<>'cfd66a978f1a98fc7ccdaf501d36d541' then
  raise exception 'build_team changed since review';
 end if;
end;$guard$;

create function forecast_season.source_summary(assessment jsonb) returns jsonb
language sql immutable set search_path='' as $summary$
 select coalesce(jsonb_agg(
  jsonb_build_object('id',s->>'id','prediction',s->>'prediction','probability',s->'probability')
  || case when s->>'id'='predicted11' then jsonb_build_object('votes',s->'votes','ballots',s->'ballots') else '{}'::jsonb end
  order by ordinal), '[]'::jsonb)
 from jsonb_array_elements(assessment->'sources') with ordinality as sources(s,ordinal)
 where s->>'id' in ('futbolfantasy','comuniate','jornadaperfecta','predicted11');
$summary$;
revoke all on function forecast_season.source_summary(jsonb) from public,anon,authenticated,service_role;

do $builder$
declare definition text; needle text := '''reason'',x->>''reason'',''method'',p->>''method_version''';
begin
 definition:=pg_get_functiondef('forecast_season.build_team(jsonb,interval)'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>2 then
  raise exception 'Expected starter and candidate projection points';
 end if;
 definition:=replace(definition,needle,needle||',''source_summary'',forecast_season.source_summary(x->''assessment'')');
 execute definition;
end;$builder$;
