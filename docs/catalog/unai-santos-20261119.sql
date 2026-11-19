-- Alta individual autorizada por Ernesto el 17/11/2026.
-- Identidad y club verificados con LaLiga y CA Osasuna el 19/11/2026.
-- Mantener el mismo ID y nombre que catalog/players.json. Solo datos, sin DDL.
do $unai_santos$
declare before_digest text; after_digest text;
begin
  lock table forecast_league.roster in share row exclusive mode;
  if exists (
    select 1 from forecast_league.roster
    where id='unai-santos' and (team<>'osasuna' or name<>'U. Santos')
  ) or exists (
    select 1 from forecast_league.roster
    where id<>'unai-santos'
      and (lower(name) in ('unai santos','u. santos') or lower(name) like '%unai%santos%')
  ) then
    raise exception 'Conflicto de identidad: revisar Unai Santos antes del alta';
  end if;
  select md5(string_agg(to_jsonb(r)::text,',' order by id)) into before_digest
  from forecast_league.roster r where id<>'unai-santos';
  insert into forecast_league.roster(id,team,name)
  values('unai-santos','osasuna','U. Santos')
  on conflict(id) do nothing;
  select md5(string_agg(to_jsonb(r)::text,',' order by id)) into after_digest
  from forecast_league.roster r where id<>'unai-santos';
  if before_digest is distinct from after_digest then
    raise exception 'El alta no debe modificar identidades existentes';
  end if;
end;
$unai_santos$;
