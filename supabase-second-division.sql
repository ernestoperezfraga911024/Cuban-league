-- Additive Second Division schema. Existing sporting tables/functions are untouched.
-- General is matchday 0. Historical XIs are separate so table reads stay small.
create table public.second_division_standings (
  season text not null check (season ~ '^[0-9]{4}/[0-9]{2}$'),
  matchday integer not null check (matchday between 0 and 38),
  league_id text not null check (league_id = '978196'),
  standings jsonb not null check (jsonb_typeof(standings) = 'array' and jsonb_array_length(standings) between 1 and 99),
  revision bigint not null check (revision > 0),
  captured_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (season, matchday)
);
create table public.second_division_lineups (
  season text not null,
  matchday integer not null check (matchday between 1 and 38),
  manager_id text not null check (manager_id ~ '^[0-9]{1,20}$'),
  gameweek_id bigint not null check (gameweek_id > 0),
  revision bigint not null check (revision > 0),
  points integer not null,
  negative_balance boolean not null,
  lineup jsonb not null check (jsonb_typeof(lineup) = 'array' and jsonb_array_length(lineup) in (0,11)),
  primary key (season, matchday, manager_id),
  foreign key (season, matchday) references public.second_division_standings(season, matchday)
);
alter table public.second_division_standings enable row level security;
alter table public.second_division_lineups enable row level security;
revoke all on public.second_division_standings, public.second_division_lineups from public, anon, authenticated;
grant select on public.second_division_standings, public.second_division_lineups to anon, authenticated;
create policy second_division_public_read on public.second_division_standings for select to anon, authenticated using (true);
create policy second_division_lineups_read on public.second_division_lineups for select to anon, authenticated using (true);

create table private.second_division_settings (
  season text primary key,
  excluded_manager_id text not null check (excluded_manager_id ~ '^[0-9]{1,20}$')
);
create table private.second_division_history (
  import_id uuid primary key,
  season text not null,
  matchday integer not null,
  revision bigint not null,
  snapshot jsonb not null,
  fingerprint text not null,
  published_by uuid not null,
  created_at timestamptz not null default now(),
  unique (season, matchday, revision)
);
alter table private.second_division_settings enable row level security;
alter table private.second_division_history enable row level security;
revoke all on private.second_division_settings, private.second_division_history from public, anon, authenticated;

-- Returns only recognized fields. Never expose arbitrary imported JSON publicly.
create function private.validate_second_division_lineup(p_lineup jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare p jsonb; result jsonb := '[]'; ids text[] := '{}'; n integer := 0; captains integer := 0; keepers integer := 0; pts numeric; mult numeric;
begin
  if jsonb_typeof(p_lineup) is distinct from 'array' then raise exception 'Alineación ilegible.'; end if;
  if jsonb_array_length(p_lineup) <> 11 then raise exception 'La alineación debe contener 11 puestos.'; end if;
  for p in select value from jsonb_array_elements(p_lineup) loop
    n := n + 1;
    if jsonb_typeof(p) is distinct from 'object'
      or jsonb_typeof(p->'slot') is distinct from 'number' or p->>'slot' is distinct from n::text
      or coalesce(p->>'position','') not in ('PT','DF','MC','DL')
      or jsonb_typeof(p->'id') is distinct from 'string'
      or jsonb_typeof(p->'name') is distinct from 'string' or length(btrim(p->>'name')) not between 1 and 120
      or jsonb_typeof(p->'points') is distinct from 'number' or (p->>'points') !~ '^-?[0-9]{1,4}(\.5)?$'
      or coalesce(p->>'status','') not in ('scored','pending','did-not-play','empty')
      or jsonb_typeof(p->'captain') is distinct from 'boolean'
      or jsonb_typeof(p->'multiplier') is distinct from 'number' or coalesce(p->>'multiplier','') not in ('1','1.5','2','3')
      then raise exception 'Hay un puesto ilegible en la alineación.'; end if;
    pts := (p->>'points')::numeric; mult := (p->>'multiplier')::numeric;
    if abs(pts) > 1000 then raise exception 'Puntos de jugador fuera de rango.'; end if;
    if p->>'status' = 'empty' then
      if p->>'id' <> '' or pts <> -4 or (p->>'captain')::boolean then raise exception 'Posición vacía no válida.'; end if;
    else
      if p->>'id' !~ '^[0-9]{1,20}$' or (p->>'id') = any(ids) then raise exception 'Jugador duplicado o sin identidad.'; end if;
      ids := array_append(ids, p->>'id');
    end if;
    if p->>'status' in ('pending','did-not-play') and pts <> 0 then raise exception 'Estado y puntos contradictorios.'; end if;
    if (p->>'captain')::boolean then
      captains := captains + 1;
      if mult = 1 then raise exception 'Multiplicador de capitán ilegible.'; end if;
    elsif mult <> 1 then raise exception 'Multiplicador sin capitán.'; end if;
    if p->>'position' = 'PT' then keepers := keepers + 1; end if;
    result := result || jsonb_build_array(jsonb_build_object('slot',n,'id',p->>'id','name',btrim(p->>'name'),
      'position',p->>'position','points',pts,'status',p->>'status','captain',(p->>'captain')::boolean,'multiplier',mult));
  end loop;
  if captains > 1 or keepers <> 1 then raise exception 'Formación o capitán no válido.'; end if;
  return result;
end;
$$;
revoke all on function private.validate_second_division_lineup(jsonb) from public, anon, authenticated;

create function public.get_second_division_admin_state(p_season text, p_matchday integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare current_snapshot jsonb; excluded text; baseline jsonb;
begin
  if auth.uid() is null or not private.is_league_admin() then raise exception 'Acceso no autorizado.' using errcode = '42501'; end if;
  if p_season is null or p_season !~ '^[0-9]{4}/[0-9]{2}$' or p_matchday is null or p_matchday not between 0 and 38
    then raise exception 'Temporada o jornada no válida.'; end if;
  select to_jsonb(s) into current_snapshot from public.second_division_standings s where s.season = p_season and s.matchday = p_matchday;
  select excluded_manager_id into excluded from private.second_division_settings where season = p_season;
  select standings into baseline from public.second_division_standings where season = p_season and matchday = 0;
  return jsonb_build_object('snapshot',current_snapshot,'revision',coalesce((current_snapshot->>'revision')::bigint,0),
    'excludedId',excluded,'baselineStandings',coalesce(current_snapshot->'standings',baseline,'[]'::jsonb));
end;
$$;
revoke all on function public.get_second_division_admin_state(text,integer) from public, anon;
grant execute on function public.get_second_division_admin_state(text,integer) to authenticated;

create function public.publish_second_division(
  p_payload jsonb, p_excluded_manager_id text, p_expected_revision bigint,
  p_import_id uuid, p_allow_roster_change boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  season_key text := p_payload->>'season'; members jsonb := p_payload->'managers';
  day integer; capture_time timestamptz; cleaned jsonb; lineups jsonb := '[]'; m jsonb; xi jsonb; baseline jsonb;
  current_row public.second_division_standings%rowtype;
  stored_exclusion text; existing_fingerprint text; fingerprint text; next_revision bigint;
begin
  if auth.uid() is null or not private.is_league_admin() then raise exception 'Acceso no autorizado.' using errcode = '42501'; end if;
  if p_payload is null or octet_length(p_payload::text) > 500000 or p_import_id is null
    or p_expected_revision is null or p_expected_revision < 0
    or season_key is null or season_key !~ '^[0-9]{4}/[0-9]{2}$'
    or (p_payload->>'version') is distinct from '1'
    or (p_payload#>>'{league,id}') is distinct from '978196'
    or jsonb_typeof(p_payload->'matchday') is distinct from 'number'
    or coalesce(p_payload->>'matchday','') !~ '^([0-9]|[12][0-9]|3[0-8])$'
    or jsonb_typeof(members) is distinct from 'array' then raise exception 'Captura de Segunda no válida.'; end if;
  day := (p_payload->>'matchday')::integer;
  if (day = 0 and p_payload->>'kind' is distinct from 'general')
    or (day > 0 and p_payload->>'kind' is distinct from 'matchday') then raise exception 'Clasificación incorrecta.'; end if;
  if day > 0 and (jsonb_typeof(p_payload->'gameweekId') is distinct from 'number'
    or coalesce(p_payload->>'gameweekId','') !~ '^[1-9][0-9]{0,9}$'
    or p_payload->>'excludedManagerId' is distinct from p_excluded_manager_id) then raise exception 'Jornada o cuenta excluida no válida.'; end if;
  if jsonb_array_length(members) not between 2 and 100 then raise exception 'Clasificación vacía o incompleta.'; end if;
  if p_excluded_manager_id is null or p_excluded_manager_id !~ '^[0-9]{1,20}$' then raise exception 'Falta identificar la cuenta de administrador.'; end if;
  capture_time := (p_payload->>'capturedAt')::timestamptz;
  if capture_time is null or capture_time > now() + interval '5 minutes' or capture_time < now() - interval '1 hour'
    then raise exception 'La captura ha caducado. Vuelve a importar desde Mister.'; end if;
  if exists (
    select 1 from jsonb_array_elements(members) with ordinality as r(value,pos)
    where jsonb_typeof(value) is distinct from 'object'
      or jsonb_typeof(value->'id') is distinct from 'string' or (value->>'id') !~ '^[0-9]{1,20}$'
      or jsonb_typeof(value->'name') is distinct from 'string' or length(btrim(value->>'name')) not between 1 and 120
      or jsonb_typeof(value->'points') is distinct from 'number' or (value->>'points') !~ '^-?[0-9]{1,7}$'
      or jsonb_typeof(value->'rank') is distinct from 'number' or (value->>'rank') is distinct from pos::text
  ) then raise exception 'Hay nombres, puntos o posiciones ilegibles.'; end if;
  if exists (select 1 from jsonb_array_elements(members) r where abs((r->>'points')::numeric) > 1000000)
    or (select count(distinct r->>'id') from jsonb_array_elements(members) r) <> jsonb_array_length(members)
    or (select count(*) from jsonb_array_elements(members) r where r->>'id' = p_excluded_manager_id) <> 1
    then raise exception 'Participantes duplicados o cuenta excluida ausente.'; end if;
  if exists (select 1 from (
    select (value->>'points')::int pts, lag((value->>'points')::int) over (order by pos) previous
    from jsonb_array_elements(members) with ordinality as r(value,pos)
  ) ordered where pts > previous) then raise exception 'La tabla no está ordenada por puntos.'; end if;

  -- A separate lock from First Division. All day snapshots share the exclusion setting.
  perform pg_advisory_xact_lock(hashtextextended('cuban-second:' || season_key,0));
  select * into current_row from public.second_division_standings where season = season_key and matchday = day for update;
  select excluded_manager_id into stored_exclusion from private.second_division_settings where season = season_key;
  if day > 0 and stored_exclusion is null then raise exception 'Publica primero General para identificar la cuenta de administrador.'; end if;
  if stored_exclusion is not null and stored_exclusion <> p_excluded_manager_id
    then raise exception 'La cuenta excluida no coincide con la configuración guardada.'; end if;
  fingerprint := md5(p_payload::text || ':' || p_excluded_manager_id);
  select h.fingerprint into existing_fingerprint from private.second_division_history h where import_id = p_import_id;
  if found then
    if fingerprint <> existing_fingerprint then raise exception 'La solicitud ya se utilizó con otros datos.'; end if;
    return to_jsonb(current_row);
  end if;
  if coalesce(current_row.revision,0) <> p_expected_revision
    then raise exception 'Otra pestaña actualizó esta tabla de Segunda. Vuelve a importar.' using errcode = '40001'; end if;
  if current_row.captured_at is not null and capture_time < current_row.captured_at
    then raise exception 'Existe una captura más reciente. Vuelve a importar.'; end if;

  for m in select value from jsonb_array_elements(members) where value->>'id' <> p_excluded_manager_id loop
    if day > 0 then
      if jsonb_typeof(m->'negativeBalance') is distinct from 'boolean' then raise exception 'Falta el estado del participante.'; end if;
      if (m->>'negativeBalance')::boolean then
        if (m->>'points')::int <> 0 or m->'lineup' is distinct from '[]'::jsonb then raise exception 'Saldo negativo contradictorio.'; end if;
        xi := '[]';
      else xi := private.validate_second_division_lineup(m->'lineup'); end if;
      lineups := lineups || jsonb_build_array(jsonb_build_object('manager_id',m->>'id','points',(m->>'points')::int,
        'negative_balance',(m->>'negativeBalance')::boolean,'lineup',xi));
    end if;
  end loop;
  select jsonb_agg(jsonb_build_object('id',value->>'id','name',btrim(value->>'name'),
    'points',(value->>'points')::int,'rank',new_rank) order by new_rank) into cleaned
  from (select value, row_number() over (order by pos) new_rank
    from jsonb_array_elements(members) with ordinality as r(value,pos) where value->>'id' <> p_excluded_manager_id) participants;
  select standings into baseline from public.second_division_standings where season = season_key and matchday = 0;
  baseline := coalesce(current_row.standings,baseline);
  if baseline is not null and not coalesce(p_allow_roster_change,false) and (
    (select array_agg(x->>'id' order by x->>'id') from jsonb_array_elements(cleaned) x) is distinct from
    (select array_agg(x->>'id' order by x->>'id') from jsonb_array_elements(baseline) x)
  ) then raise exception 'Cambió la lista de participantes. Revisa y confirma el cambio antes de publicar.'; end if;

  next_revision := coalesce(current_row.revision,0) + 1;
  insert into public.second_division_standings (season,matchday,league_id,standings,revision,captured_at)
    values (season_key,day,'978196',cleaned,next_revision,capture_time)
    on conflict (season,matchday) do update set standings = excluded.standings, revision = excluded.revision,
      captured_at = excluded.captured_at, updated_at = now() returning * into current_row;
  if day > 0 then
    delete from public.second_division_lineups where season = season_key and matchday = day;
    insert into public.second_division_lineups (season,matchday,manager_id,gameweek_id,revision,points,negative_balance,lineup)
      select season_key,day,x->>'manager_id',(p_payload->>'gameweekId')::bigint,next_revision,
        (x->>'points')::int,(x->>'negative_balance')::boolean,x->'lineup' from jsonb_array_elements(lineups) x;
  end if;
  insert into private.second_division_settings values (season_key,p_excluded_manager_id) on conflict (season) do nothing;
  insert into private.second_division_history (import_id,season,matchday,revision,snapshot,fingerprint,published_by)
    values (p_import_id,season_key,day,next_revision,jsonb_build_object('table',to_jsonb(current_row),'lineups',lineups),fingerprint,auth.uid());
  return to_jsonb(current_row);
end;
$$;
revoke all on function public.publish_second_division(jsonb,text,bigint,uuid,boolean) from public, anon;
grant execute on function public.publish_second_division(jsonb,text,bigint,uuid,boolean) to authenticated;
