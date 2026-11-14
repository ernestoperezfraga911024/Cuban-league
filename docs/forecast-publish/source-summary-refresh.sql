-- Refresh only matching current publications, using their own saved source evidence.
-- Run in one transaction after source-summary.sql. Old history is never updated.
do $refresh$
declare row record; projected jsonb; stripped jsonb;
begin
 for row in select d.team,d.payload as draft,d.projection as previous
  from forecast_season.drafts d join public.forecast_season_public p using(team)
  where d.projection=p.payload and d.payload->'proposal' is not null
    and (d.projection->>'evidence_at')::timestamptz>=now()-interval '24 hours'
  for update of d,p
 loop
  projected:=forecast_season.build_team(row.draft,interval '24 hours');
  stripped:=jsonb_set(projected,'{players}',(select jsonb_agg(x-'source_summary' order by ord)
   from jsonb_array_elements(projected->'players') with ordinality as a(x,ord)));
  if projected ? 'candidates' then
   stripped:=jsonb_set(stripped,'{candidates}',coalesce((select jsonb_agg(x-'source_summary' order by ord)
    from jsonb_array_elements(projected->'candidates') with ordinality as a(x,ord)),'[]'::jsonb));
  end if;
  if stripped is distinct from row.previous then
   raise exception 'Source summary would change other forecast data for %',row.team;
  end if;
  update forecast_season.drafts set projection=projected where team=row.team;
  update public.forecast_season_public set payload=projected where team=row.team;
 end loop;
end;$refresh$;
