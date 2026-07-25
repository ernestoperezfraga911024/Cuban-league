-- CUBAN LEAGUE · PANEL DE ADMINISTRACIÓN
-- Ejecutar una sola vez en Supabase > SQL Editor.
-- El único administrador autorizado será:
-- ernestoperezfraga911024@gmail.com

begin;

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create table if not exists private.league_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now()
);

revoke all on private.league_admins from public;
revoke all on private.league_admins from anon;
revoke all on private.league_admins from authenticated;

do $$
declare
  admin_user_id uuid;
begin
  select id
    into admin_user_id
  from auth.users
  where lower(email) = lower('ernestoperezfraga911024@gmail.com')
  limit 1;

  if admin_user_id is null then
    raise exception 'No existe el usuario administrador. Créalo primero en Authentication > Users con el correo ernestoperezfraga911024@gmail.com';
  end if;

  insert into private.league_admins (user_id, email)
  values (admin_user_id, 'ernestoperezfraga911024@gmail.com')
  on conflict (user_id) do update
    set email = excluded.email;
end
$$;

create or replace function private.is_league_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.league_admins
    where user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_league_admin() from public;
revoke all on function private.is_league_admin() from anon;
revoke all on function private.is_league_admin() from authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_league_admin() to authenticated;

create or replace function public.is_league_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_league_admin();
$$;

revoke all on function public.is_league_admin() from public;
revoke all on function public.is_league_admin() from anon;
revoke all on function public.is_league_admin() from authenticated;
grant execute on function public.is_league_admin() to authenticated;

create table if not exists public.matchday_stats (
  id uuid primary key default gen_random_uuid(),
  season text not null,
  matchday integer not null check (matchday between 1 and 60),
  participant_name text not null,
  points integer not null default 0,
  goals integer not null default 0 check (goals >= 0),
  clean_sheets integer not null default 0 check (clean_sheets >= 0),
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season, matchday, participant_name)
);

create or replace function private.set_matchday_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.set_matchday_updated_at() from public;
revoke all on function private.set_matchday_updated_at() from anon;
revoke all on function private.set_matchday_updated_at() from authenticated;

drop trigger if exists set_matchday_stats_updated_at on public.matchday_stats;
create trigger set_matchday_stats_updated_at
before update on public.matchday_stats
for each row
execute function private.set_matchday_updated_at();

alter table public.matchday_stats enable row level security;

revoke all on public.matchday_stats from anon;
revoke all on public.matchday_stats from authenticated;
grant select on public.matchday_stats to anon;
grant select, insert, update, delete on public.matchday_stats to authenticated;

drop policy if exists "Public can read published matchdays" on public.matchday_stats;
create policy "Public can read published matchdays"
on public.matchday_stats
for select
to anon
using (published = true);

drop policy if exists "Administrators can read every matchday" on public.matchday_stats;
create policy "Administrators can read every matchday"
on public.matchday_stats
for select
to authenticated
using (published = true or (select private.is_league_admin()));

drop policy if exists "Administrators can insert matchdays" on public.matchday_stats;
create policy "Administrators can insert matchdays"
on public.matchday_stats
for insert
to authenticated
with check ((select private.is_league_admin()));

drop policy if exists "Administrators can update matchdays" on public.matchday_stats;
create policy "Administrators can update matchdays"
on public.matchday_stats
for update
to authenticated
using ((select private.is_league_admin()))
with check ((select private.is_league_admin()));

drop policy if exists "Administrators can delete matchdays" on public.matchday_stats;
create policy "Administrators can delete matchdays"
on public.matchday_stats
for delete
to authenticated
using ((select private.is_league_admin()));

commit;

select
  'Cuban League configurada correctamente' as resultado,
  count(*) as administradores
from private.league_admins;
