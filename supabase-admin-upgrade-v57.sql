-- CUBAN LEAGUE · ACTUALIZACIÓN DEL PANEL V57
-- Ejecutar una sola vez en Supabase > SQL Editor.
-- Añade borradores automáticos, vista previa segura, historial y deshacer.

begin;

create table if not exists public.matchday_drafts (
  id uuid primary key default gen_random_uuid(),
  season text not null,
  matchday integer not null check (matchday between 1 and 60),
  participant_name text not null,
  points integer,
  goals integer check (goals is null or goals >= 0),
  clean_sheets integer check (clean_sheets is null or clean_sheets >= 0),
  saved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season, matchday, participant_name)
);

drop trigger if exists set_matchday_drafts_updated_at on public.matchday_drafts;
create trigger set_matchday_drafts_updated_at
before update on public.matchday_drafts
for each row
execute function private.set_matchday_updated_at();

alter table public.matchday_drafts enable row level security;
revoke all on public.matchday_drafts from anon;
revoke all on public.matchday_drafts from authenticated;
grant select, insert, update, delete on public.matchday_drafts to authenticated;

drop policy if exists "Administrators can read matchday drafts" on public.matchday_drafts;
create policy "Administrators can read matchday drafts"
on public.matchday_drafts
for select
to authenticated
using ((select private.is_league_admin()));

drop policy if exists "Administrators can insert matchday drafts" on public.matchday_drafts;
create policy "Administrators can insert matchday drafts"
on public.matchday_drafts
for insert
to authenticated
with check ((select private.is_league_admin()));

drop policy if exists "Administrators can update matchday drafts" on public.matchday_drafts;
create policy "Administrators can update matchday drafts"
on public.matchday_drafts
for update
to authenticated
using ((select private.is_league_admin()))
with check ((select private.is_league_admin()));

drop policy if exists "Administrators can delete matchday drafts" on public.matchday_drafts;
create policy "Administrators can delete matchday drafts"
on public.matchday_drafts
for delete
to authenticated
using ((select private.is_league_admin()));

create table if not exists public.matchday_change_log (
  id uuid primary key default gen_random_uuid(),
  season text not null,
  matchday integer not null check (matchday between 1 and 60),
  action text not null check (action in ('publish', 'correction')),
  before_snapshot jsonb not null default '[]'::jsonb,
  after_snapshot jsonb not null default '[]'::jsonb,
  changed_by uuid references auth.users(id) on delete set null,
  changed_by_email text,
  created_at timestamptz not null default now(),
  undone boolean not null default false,
  undone_at timestamptz,
  undone_by uuid references auth.users(id) on delete set null
);

create index if not exists matchday_change_log_lookup_idx
on public.matchday_change_log (season, matchday, created_at desc);

alter table public.matchday_change_log enable row level security;
revoke all on public.matchday_change_log from anon;
revoke all on public.matchday_change_log from authenticated;
grant select on public.matchday_change_log to authenticated;

drop policy if exists "Administrators can read matchday history" on public.matchday_change_log;
create policy "Administrators can read matchday history"
on public.matchday_change_log
for select
to authenticated
using ((select private.is_league_admin()));

-- Conserva los borradores creados con la versión anterior del panel.
insert into public.matchday_drafts (
  season,
  matchday,
  participant_name,
  points,
  goals,
  clean_sheets,
  saved_by,
  created_at,
  updated_at
)
select
  season,
  matchday,
  participant_name,
  points,
  goals,
  clean_sheets,
  (select auth.uid()),
  created_at,
  updated_at
from public.matchday_stats
where published = false
on conflict (season, matchday, participant_name)
do update set
  points = excluded.points,
  goals = excluded.goals,
  clean_sheets = excluded.clean_sheets,
  updated_at = excluded.updated_at;

delete from public.matchday_stats
where published = false;

-- Registra como versión inicial cualquier jornada que ya estuviera publicada.
insert into public.matchday_change_log (
  season,
  matchday,
  action,
  before_snapshot,
  after_snapshot,
  changed_by_email,
  created_at
)
select
  stats.season,
  stats.matchday,
  'publish',
  '[]'::jsonb,
  jsonb_agg(
    jsonb_build_object(
      'participant_name', stats.participant_name,
      'points', stats.points,
      'goals', stats.goals,
      'clean_sheets', stats.clean_sheets,
      'published', stats.published
    )
    order by stats.participant_name
  ),
  'Sistema · datos anteriores',
  max(stats.updated_at)
from public.matchday_stats as stats
where stats.published = true
  and not exists (
    select 1
    from public.matchday_change_log as history
    where history.season = stats.season
      and history.matchday = stats.matchday
  )
group by stats.season, stats.matchday;

create or replace function public.save_matchday_draft(
  p_season text,
  p_matchday integer,
  p_rows jsonb
)
returns setof public.matchday_drafts
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_league_admin() then
    raise exception 'Not authorized';
  end if;

  if p_season is null or btrim(p_season) = '' then
    raise exception 'Season is required';
  end if;

  if p_matchday is null or p_matchday not between 1 and 60 then
    raise exception 'Invalid matchday';
  end if;

  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Draft rows are required';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as row_data(
      participant_name text,
      points integer,
      goals integer,
      clean_sheets integer
    )
    where participant_name is null
       or btrim(participant_name) = ''
       or (goals is not null and goals < 0)
       or (clean_sheets is not null and clean_sheets < 0)
  ) then
    raise exception 'Invalid draft row';
  end if;

  delete from public.matchday_drafts
  where season = p_season
    and matchday = p_matchday;

  insert into public.matchday_drafts (
    season,
    matchday,
    participant_name,
    points,
    goals,
    clean_sheets,
    saved_by
  )
  select
    p_season,
    p_matchday,
    row_data.participant_name,
    row_data.points,
    row_data.goals,
    row_data.clean_sheets,
    (select auth.uid())
  from jsonb_to_recordset(p_rows) as row_data(
    participant_name text,
    points integer,
    goals integer,
    clean_sheets integer
  );

  return query
  select drafts.*
  from public.matchday_drafts as drafts
  where drafts.season = p_season
    and drafts.matchday = p_matchday
  order by drafts.participant_name;
end;
$$;

revoke all on function public.save_matchday_draft(text, integer, jsonb) from public;
revoke all on function public.save_matchday_draft(text, integer, jsonb) from anon;
revoke all on function public.save_matchday_draft(text, integer, jsonb) from authenticated;
grant execute on function public.save_matchday_draft(text, integer, jsonb) to authenticated;

create or replace function public.publish_matchday_revision(
  p_season text,
  p_matchday integer,
  p_rows jsonb
)
returns setof public.matchday_stats
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_rows jsonb;
  after_rows jsonb;
  history_action text;
  total_rows integer;
  distinct_rows integer;
begin
  if not private.is_league_admin() then
    raise exception 'Not authorized';
  end if;

  if p_season is null or btrim(p_season) = '' then
    raise exception 'Season is required';
  end if;

  if p_matchday is null or p_matchday not between 1 and 60 then
    raise exception 'Invalid matchday';
  end if;

  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Published rows are required';
  end if;

  select count(*), count(distinct participant_name)
    into total_rows, distinct_rows
  from jsonb_to_recordset(p_rows) as row_data(
    participant_name text,
    points integer,
    goals integer,
    clean_sheets integer
  );

  if total_rows <> distinct_rows then
    raise exception 'Participants cannot be repeated';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as row_data(
      participant_name text,
      points integer,
      goals integer,
      clean_sheets integer
    )
    where participant_name is null
       or btrim(participant_name) = ''
       or points is null
       or goals is null
       or clean_sheets is null
       or goals < 0
       or clean_sheets < 0
  ) then
    raise exception 'Every participant needs points, goals and clean sheets';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'participant_name', stats.participant_name,
        'points', stats.points,
        'goals', stats.goals,
        'clean_sheets', stats.clean_sheets,
        'published', stats.published
      )
      order by stats.participant_name
    ),
    '[]'::jsonb
  )
  into before_rows
  from public.matchday_stats as stats
  where stats.season = p_season
    and stats.matchday = p_matchday
    and stats.published = true;

  history_action := case
    when jsonb_array_length(before_rows) = 0 then 'publish'
    else 'correction'
  end;

  delete from public.matchday_stats
  where season = p_season
    and matchday = p_matchday;

  insert into public.matchday_stats (
    season,
    matchday,
    participant_name,
    points,
    goals,
    clean_sheets,
    published
  )
  select
    p_season,
    p_matchday,
    row_data.participant_name,
    row_data.points,
    row_data.goals,
    row_data.clean_sheets,
    true
  from jsonb_to_recordset(p_rows) as row_data(
    participant_name text,
    points integer,
    goals integer,
    clean_sheets integer
  );

  select jsonb_agg(
    jsonb_build_object(
      'participant_name', stats.participant_name,
      'points', stats.points,
      'goals', stats.goals,
      'clean_sheets', stats.clean_sheets,
      'published', stats.published
    )
    order by stats.participant_name
  )
  into after_rows
  from public.matchday_stats as stats
  where stats.season = p_season
    and stats.matchday = p_matchday;

  insert into public.matchday_change_log (
    season,
    matchday,
    action,
    before_snapshot,
    after_snapshot,
    changed_by,
    changed_by_email
  )
  values (
    p_season,
    p_matchday,
    history_action,
    before_rows,
    after_rows,
    (select auth.uid()),
    coalesce((select auth.jwt() ->> 'email'), 'Administrador')
  );

  delete from public.matchday_drafts
  where season = p_season
    and matchday = p_matchday;

  return query
  select stats.*
  from public.matchday_stats as stats
  where stats.season = p_season
    and stats.matchday = p_matchday
  order by stats.participant_name;
end;
$$;

revoke all on function public.publish_matchday_revision(text, integer, jsonb) from public;
revoke all on function public.publish_matchday_revision(text, integer, jsonb) from anon;
revoke all on function public.publish_matchday_revision(text, integer, jsonb) from authenticated;
grant execute on function public.publish_matchday_revision(text, integer, jsonb) to authenticated;

create or replace function public.undo_last_matchday_publication(
  p_season text,
  p_matchday integer
)
returns setof public.matchday_stats
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_change public.matchday_change_log%rowtype;
begin
  if not private.is_league_admin() then
    raise exception 'Not authorized';
  end if;

  select *
    into last_change
  from public.matchday_change_log
  where season = p_season
    and matchday = p_matchday
    and undone = false
  order by created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'There is no publication to undo';
  end if;

  delete from public.matchday_stats
  where season = p_season
    and matchday = p_matchday;

  if jsonb_array_length(last_change.before_snapshot) > 0 then
    insert into public.matchday_stats (
      season,
      matchday,
      participant_name,
      points,
      goals,
      clean_sheets,
      published
    )
    select
      p_season,
      p_matchday,
      row_data.participant_name,
      row_data.points,
      row_data.goals,
      row_data.clean_sheets,
      coalesce(row_data.published, true)
    from jsonb_to_recordset(last_change.before_snapshot) as row_data(
      participant_name text,
      points integer,
      goals integer,
      clean_sheets integer,
      published boolean
    );
  end if;

  update public.matchday_change_log
  set
    undone = true,
    undone_at = now(),
    undone_by = (select auth.uid())
  where id = last_change.id;

  delete from public.matchday_drafts
  where season = p_season
    and matchday = p_matchday;

  return query
  select stats.*
  from public.matchday_stats as stats
  where stats.season = p_season
    and stats.matchday = p_matchday
  order by stats.participant_name;
end;
$$;

revoke all on function public.undo_last_matchday_publication(text, integer) from public;
revoke all on function public.undo_last_matchday_publication(text, integer) from anon;
revoke all on function public.undo_last_matchday_publication(text, integer) from authenticated;
grant execute on function public.undo_last_matchday_publication(text, integer) to authenticated;

commit;

select
  'Panel V57 configurado correctamente' as resultado,
  (select count(*) from public.matchday_drafts) as borradores,
  (select count(*) from public.matchday_change_log) as versiones_guardadas;
