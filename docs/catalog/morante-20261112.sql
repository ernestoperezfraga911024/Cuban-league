-- Alta individual autorizada por Ernesto el 12/11/2026.
-- Identidad/club: https://www.realbetisbalompie.es/primer-equipo/jugador/j-morante-3452412
-- Mantener el mismo ID y nombre que catalog/players.json. Solo datos, sin DDL.
do $morante$
declare before_digest text; after_digest text;
begin
  lock table forecast_league.roster in share row exclusive mode;
  if exists (
    select 1 from forecast_league.roster
    where id='j-morante' and (team<>'real-betis' or name<>'J. Morante')
  ) or exists (
    select 1 from forecast_league.roster
    where id<>'j-morante' and name ilike '%morante%'
  ) then
    raise exception 'Conflicto de identidad: revisar Morante antes del alta';
  end if;
  select md5(string_agg(to_jsonb(r)::text,',' order by id)) into before_digest
  from forecast_league.roster r where id<>'j-morante';
  insert into forecast_league.roster(id,team,name)
  values('j-morante','real-betis','J. Morante')
  on conflict(id) do nothing;
  select md5(string_agg(to_jsonb(r)::text,',' order by id)) into after_digest
  from forecast_league.roster r where id<>'j-morante';
  if before_digest is distinct from after_digest then
    raise exception 'El alta no debe modificar identidades existentes';
  end if;
end;
$morante$;
