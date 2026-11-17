-- Alta individual autorizada por Ernesto el 17/11/2026.
-- Identidad: https://www.futbolfantasy.com/jugadores/hugo-burcio/laliga-26-27
-- Club: https://www.comuniate.com/jugadores/3972/hugo-burcio
-- Mantener el mismo ID y nombre que catalog/players.json. Solo datos, sin DDL.
do $burcio$
declare before_digest text; after_digest text;
begin
  lock table forecast_league.roster in share row exclusive mode;
  if exists (
    select 1 from forecast_league.roster
    where id='mister-68516' and (team<>'celta-vigo' or name<>'H. Burcio')
  ) or exists (
    select 1 from forecast_league.roster
    where id<>'mister-68516' and name ilike '%burcio%'
  ) then
    raise exception 'Conflicto de identidad: revisar Burcio antes del alta';
  end if;
  select md5(string_agg(to_jsonb(r)::text,',' order by id)) into before_digest
  from forecast_league.roster r where id<>'mister-68516';
  insert into forecast_league.roster(id,team,name)
  values('mister-68516','celta-vigo','H. Burcio')
  on conflict(id) do nothing;
  select md5(string_agg(to_jsonb(r)::text,',' order by id)) into after_digest
  from forecast_league.roster r where id<>'mister-68516';
  if before_digest is distinct from after_digest then
    raise exception 'El alta no debe modificar identidades existentes';
  end if;
end;
$burcio$;
