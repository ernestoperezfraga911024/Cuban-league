alter table public.matchday_stats
  add column if not exists negative_balance_no_score boolean not null default false;

alter table public.matchday_drafts
  add column if not exists negative_balance_no_score boolean not null default false;

alter table public.matchday_stats
  drop constraint if exists matchday_stats_negative_balance_zero_check;

alter table public.matchday_stats
  add constraint matchday_stats_negative_balance_zero_check
  check (
    not negative_balance_no_score
    or (
      points = 0
      and goals = 0
      and clean_sheets = 0
      and red_cards = 0
      and lineup = '[]'::jsonb
    )
  );

alter table public.matchday_drafts
  drop constraint if exists matchday_drafts_negative_balance_zero_check;

alter table public.matchday_drafts
  add constraint matchday_drafts_negative_balance_zero_check
  check (
    not negative_balance_no_score
    or (
      points = 0
      and goals = 0
      and clean_sheets = 0
      and red_cards = 0
      and lineup = '[]'::jsonb
    )
  );

CREATE OR REPLACE FUNCTION public.save_matchday_draft(p_season text, p_matchday integer, p_rows jsonb)
 RETURNS SETOF matchday_drafts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_postponed boolean;
  submitted_postponed boolean;
  postponed_values integer;
  effective_rows jsonb;
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

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Draft rows are required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_season), p_matchday);

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as submitted(row_object)
    where jsonb_typeof(submitted.row_object) <> 'object'
       or (
         submitted.row_object ? 'lineup'
         and submitted.row_object -> 'lineup' <> 'null'::jsonb
         and jsonb_typeof(submitted.row_object -> 'lineup') <> 'array'
       )
  ) then
    raise exception 'Invalid draft row';
  end if;

  select bool_or(existing.has_postponed_matches)
    into current_postponed
  from (
    select stats.has_postponed_matches
    from public.matchday_stats as stats
    where stats.season = p_season
      and stats.matchday = p_matchday
      and stats.published = true
    union all
    select drafts.has_postponed_matches
    from public.matchday_drafts as drafts
    where drafts.season = p_season
      and drafts.matchday = p_matchday
  ) as existing;

  select
    bool_or(row_data.has_postponed_matches),
    count(distinct row_data.has_postponed_matches)
      filter (where row_data.has_postponed_matches is not null)
    into submitted_postponed, postponed_values
  from jsonb_to_recordset(p_rows) as row_data(
    participant_name text,
    points integer,
    goals integer,
    clean_sheets integer,
    red_cards integer,
    has_postponed_matches boolean
  );

  if postponed_values > 1 then
    raise exception 'Every participant must share the same postponed status';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as row_data(
      participant_name text,
      points integer,
      goals integer,
      clean_sheets integer,
      red_cards integer,
      has_postponed_matches boolean
    )
    where participant_name is null
       or btrim(participant_name) = ''
       or (goals is not null and goals < 0)
       or (clean_sheets is not null and clean_sheets < 0)
       or (red_cards is not null and red_cards < 0)
  ) then
    raise exception 'Invalid draft row';
  end if;

  select jsonb_agg(
    submitted.row_object || jsonb_build_object(
      'negative_balance_no_score',
      coalesce(
        case
          when submitted.row_object ? 'negative_balance_no_score'
            then (submitted.row_object ->> 'negative_balance_no_score')::boolean
          else null
        end,
        drafts.negative_balance_no_score,
        stats.negative_balance_no_score,
        false
      ),
      'lineup',
      case
        when coalesce(
        case
          when submitted.row_object ? 'negative_balance_no_score'
            then (submitted.row_object ->> 'negative_balance_no_score')::boolean
          else null
        end,
        drafts.negative_balance_no_score,
        stats.negative_balance_no_score,
        false
      )
          then '[]'::jsonb
        else private.normalize_matchday_lineup(
          case
            when submitted.row_object ? 'lineup'
             and jsonb_typeof(submitted.row_object -> 'lineup') = 'array'
              then submitted.row_object -> 'lineup'
            else coalesce(drafts.lineup, stats.lineup)
          end,
          false
        )
      end
    )
    order by submitted.row_object ->> 'participant_name'
  )
  into effective_rows
  from jsonb_array_elements(p_rows) as submitted(row_object)
  left join public.matchday_drafts as drafts
    on drafts.season = p_season
   and drafts.matchday = p_matchday
   and drafts.participant_name = submitted.row_object ->> 'participant_name'
  left join public.matchday_stats as stats
    on stats.season = p_season
   and stats.matchday = p_matchday
   and stats.participant_name = submitted.row_object ->> 'participant_name'
   and stats.published = true;

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
    red_cards,
    has_postponed_matches,
    negative_balance_no_score,
    lineup,
    saved_by
  )
  select
    p_season,
    p_matchday,
    row_data.participant_name,
    case when row_data.negative_balance_no_score then 0 else row_data.points end,
    case when row_data.negative_balance_no_score then 0 else row_data.goals end,
    case when row_data.negative_balance_no_score then 0 else row_data.clean_sheets end,
    case when row_data.negative_balance_no_score then 0 else row_data.red_cards end,
    coalesce(row_data.has_postponed_matches, submitted_postponed, current_postponed, false),
    row_data.negative_balance_no_score,
    case when row_data.negative_balance_no_score then '[]'::jsonb else row_data.lineup end,
    (select auth.uid())
  from jsonb_to_recordset(effective_rows) as row_data(
    participant_name text,
    points integer,
    goals integer,
    clean_sheets integer,
    red_cards integer,
    has_postponed_matches boolean,
    negative_balance_no_score boolean,
    lineup jsonb
  );

  return query
  select drafts.*
  from public.matchday_drafts as drafts
  where drafts.season = p_season
    and drafts.matchday = p_matchday
  order by drafts.participant_name;
end;
$function$;

CREATE OR REPLACE FUNCTION public.publish_matchday_revision(p_season text, p_matchday integer, p_rows jsonb)
 RETURNS SETOF matchday_stats
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  before_rows jsonb;
  after_rows jsonb;
  history_action text;
  total_rows integer;
  distinct_rows integer;
  current_postponed boolean;
  submitted_postponed boolean;
  postponed_values integer;
  effective_rows jsonb;
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

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Published rows are required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_season), p_matchday);

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as submitted(row_object)
    where jsonb_typeof(submitted.row_object) <> 'object'
       or (
         submitted.row_object ? 'lineup'
         and submitted.row_object -> 'lineup' <> 'null'::jsonb
         and jsonb_typeof(submitted.row_object -> 'lineup') <> 'array'
       )
  ) then
    raise exception 'Invalid published row';
  end if;

  select
    count(*),
    count(distinct row_data.participant_name),
    bool_or(row_data.has_postponed_matches),
    count(distinct row_data.has_postponed_matches)
      filter (where row_data.has_postponed_matches is not null)
    into total_rows, distinct_rows, submitted_postponed, postponed_values
  from jsonb_to_recordset(p_rows) as row_data(
    participant_name text,
    points integer,
    goals integer,
    clean_sheets integer,
    red_cards integer,
    has_postponed_matches boolean
  );

  if total_rows <> distinct_rows then
    raise exception 'Participants cannot be repeated';
  end if;

  if postponed_values > 1 then
    raise exception 'Every participant must share the same postponed status';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as row_data(
      participant_name text,
      points integer,
      goals integer,
      clean_sheets integer,
      red_cards integer,
      has_postponed_matches boolean
    )
    where participant_name is null
       or btrim(participant_name) = ''
       or points is null
       or goals is null
       or clean_sheets is null
       or red_cards is null
       or goals < 0
       or clean_sheets < 0
       or red_cards < 0
  ) then
    raise exception 'Every participant needs points, goals, clean sheets and red cards';
  end if;

  select
    bool_or(stats.has_postponed_matches),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'participant_name', stats.participant_name,
          'points', stats.points,
          'goals', stats.goals,
          'clean_sheets', stats.clean_sheets,
          'red_cards', stats.red_cards,
          'has_postponed_matches', stats.has_postponed_matches,
          'negative_balance_no_score', stats.negative_balance_no_score,
          'lineup', stats.lineup,
          'published', stats.published
        )
        order by stats.participant_name
      ),
      '[]'::jsonb
    )
    into current_postponed, before_rows
  from public.matchday_stats as stats
  where stats.season = p_season
    and stats.matchday = p_matchday
    and stats.published = true;

  current_postponed := coalesce(
    (
      select bool_or(drafts.has_postponed_matches)
      from public.matchday_drafts as drafts
      where drafts.season = p_season
        and drafts.matchday = p_matchday
    ),
    current_postponed,
    false
  );

  select jsonb_agg(
    submitted.row_object || jsonb_build_object(
      'negative_balance_no_score',
      coalesce(
        case
          when submitted.row_object ? 'negative_balance_no_score'
            then (submitted.row_object ->> 'negative_balance_no_score')::boolean
          else null
        end,
        drafts.negative_balance_no_score,
        stats.negative_balance_no_score,
        false
      ),
      'lineup',
      case
        when coalesce(
        case
          when submitted.row_object ? 'negative_balance_no_score'
            then (submitted.row_object ->> 'negative_balance_no_score')::boolean
          else null
        end,
        drafts.negative_balance_no_score,
        stats.negative_balance_no_score,
        false
      )
          then '[]'::jsonb
        else private.normalize_matchday_lineup(
          case
            when submitted.row_object ? 'lineup'
             and jsonb_typeof(submitted.row_object -> 'lineup') = 'array'
              then submitted.row_object -> 'lineup'
            else coalesce(drafts.lineup, stats.lineup)
          end,
          true
        )
      end
    )
    order by submitted.row_object ->> 'participant_name'
  )
  into effective_rows
  from jsonb_array_elements(p_rows) as submitted(row_object)
  left join public.matchday_drafts as drafts
    on drafts.season = p_season
   and drafts.matchday = p_matchday
   and drafts.participant_name = submitted.row_object ->> 'participant_name'
  left join public.matchday_stats as stats
    on stats.season = p_season
   and stats.matchday = p_matchday
   and stats.participant_name = submitted.row_object ->> 'participant_name'
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
    red_cards,
    has_postponed_matches,
    negative_balance_no_score,
    lineup,
    published
  )
  select
    p_season,
    p_matchday,
    row_data.participant_name,
    case when row_data.negative_balance_no_score then 0 else row_data.points end,
    case when row_data.negative_balance_no_score then 0 else row_data.goals end,
    case when row_data.negative_balance_no_score then 0 else row_data.clean_sheets end,
    case when row_data.negative_balance_no_score then 0 else row_data.red_cards end,
    coalesce(row_data.has_postponed_matches, submitted_postponed, current_postponed, false),
    row_data.negative_balance_no_score,
    case when row_data.negative_balance_no_score then '[]'::jsonb else row_data.lineup end,
    true
  from jsonb_to_recordset(effective_rows) as row_data(
    participant_name text,
    points integer,
    goals integer,
    clean_sheets integer,
    red_cards integer,
    has_postponed_matches boolean,
    negative_balance_no_score boolean,
    lineup jsonb
  );

  select jsonb_agg(
    jsonb_build_object(
      'participant_name', stats.participant_name,
      'points', stats.points,
      'goals', stats.goals,
      'clean_sheets', stats.clean_sheets,
      'red_cards', stats.red_cards,
      'has_postponed_matches', stats.has_postponed_matches,
      'negative_balance_no_score', stats.negative_balance_no_score,
      'lineup', stats.lineup,
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
$function$;

CREATE OR REPLACE FUNCTION public.undo_last_matchday_publication(p_season text, p_matchday integer)
 RETURNS SETOF matchday_stats
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  last_change public.matchday_change_log%rowtype;
begin
  if not private.is_league_admin() then
    raise exception 'Not authorized';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_season), p_matchday);

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
      red_cards,
      has_postponed_matches,
      negative_balance_no_score,
      lineup,
      published
    )
    select
      p_season,
      p_matchday,
      row_data.participant_name,
      row_data.points,
      row_data.goals,
      row_data.clean_sheets,
      coalesce(row_data.red_cards, 0),
      coalesce(row_data.has_postponed_matches, false),
      coalesce(row_data.negative_balance_no_score, false),
      case
        when coalesce(row_data.negative_balance_no_score, false) then '[]'::jsonb
        else row_data.lineup
      end,
      coalesce(row_data.published, true)
    from jsonb_to_recordset(last_change.before_snapshot) as row_data(
      participant_name text,
      points integer,
      goals integer,
      clean_sheets integer,
      red_cards integer,
      has_postponed_matches boolean,
      negative_balance_no_score boolean,
      lineup jsonb,
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
$function$;

CREATE OR REPLACE FUNCTION public.undo_last_matchday_publication_v124(p_season text, p_matchday integer, p_restore_generation uuid, p_expected_write_revision uuid, p_expected_change_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  selected_change_id uuid;
  saved_before_milestone jsonb;
  saved_milestone_tracked boolean;
  restored_rows jsonb;
  new_write_revision uuid;
begin
  perform private.assert_league_restore_generation(p_restore_generation);
  perform private.assert_matchday_write_revision(
    p_season,
    p_matchday,
    p_expected_write_revision
  );

  select selected.id, selected.before_milestone, selected.milestone_tracked
    into selected_change_id, saved_before_milestone, saved_milestone_tracked
  from public.matchday_change_log as selected
  where selected.season = p_season
    and selected.matchday = p_matchday
    and selected.id = p_expected_change_id
    and selected.id = (
      select latest.id
      from public.matchday_change_log as latest
      where latest.season = p_season
        and latest.matchday = p_matchday
        and latest.undone = false
      order by latest.created_at desc, latest.id desc
      limit 1
    )
    and selected.undone = false
  for update;

  if selected_change_id is null then
    raise exception 'Publication revision changed; reload the matchday';
  end if;

  delete from public.matchday_stats
  where season = p_season
    and matchday = p_matchday;

  if exists (
    select 1
    from public.matchday_change_log
    where id = selected_change_id
      and jsonb_array_length(before_snapshot) > 0
  ) then
    insert into public.matchday_stats (
      season,
      matchday,
      participant_name,
      points,
      goals,
      clean_sheets,
      red_cards,
      has_postponed_matches,
      negative_balance_no_score,
      lineup,
      published
    )
    select
      p_season,
      p_matchday,
      row_data.participant_name,
      row_data.points,
      row_data.goals,
      row_data.clean_sheets,
      coalesce(row_data.red_cards, 0),
      coalesce(row_data.has_postponed_matches, false),
      coalesce(row_data.negative_balance_no_score, false),
      case
        when coalesce(row_data.negative_balance_no_score, false) then '[]'::jsonb
        else row_data.lineup
      end,
      coalesce(row_data.published, true)
    from public.matchday_change_log as history,
      jsonb_to_recordset(history.before_snapshot) as row_data(
        participant_name text,
        points integer,
        goals integer,
        clean_sheets integer,
        red_cards integer,
        has_postponed_matches boolean,
        negative_balance_no_score boolean,
        lineup jsonb,
        published boolean
      )
    where history.id = selected_change_id;
  end if;

  update public.matchday_change_log
  set undone = true,
      undone_at = now(),
      undone_by = (select auth.uid())
  where id = selected_change_id;

  delete from public.matchday_drafts
  where season = p_season
    and matchday = p_matchday;

  if saved_milestone_tracked then
    if saved_before_milestone is null then
      delete from public.matchday_milestones
      where season = btrim(p_season)
        and matchday = p_matchday;
    else
      insert into public.matchday_milestones (
        season, matchday, matchday_date, is_month_end, is_year_end, saved_by
      )
      values (
        btrim(p_season),
        p_matchday,
        (saved_before_milestone ->> 'matchdayDate')::date,
        coalesce((saved_before_milestone ->> 'isMonthEnd')::boolean, false),
        coalesce((saved_before_milestone ->> 'isYearEnd')::boolean, false),
        (select auth.uid())
      )
      on conflict (season, matchday)
      do update set
        matchday_date = excluded.matchday_date,
        is_month_end = excluded.is_month_end,
        is_year_end = excluded.is_year_end,
        saved_by = excluded.saved_by,
        updated_at = now();
    end if;
  end if;

  delete from private.matchday_milestone_drafts
  where season = btrim(p_season)
    and matchday = p_matchday;

  select coalesce(
    jsonb_agg(to_jsonb(stats) order by stats.participant_name),
    '[]'::jsonb
  )
    into restored_rows
  from public.matchday_stats as stats
  where stats.season = p_season
    and stats.matchday = p_matchday;

  new_write_revision := private.rotate_matchday_write_revision(p_season, p_matchday);
  return jsonb_build_object(
    'rows', restored_rows,
    'writeRevision', new_write_revision
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.restore_league_backup(p_backup_id uuid, p_confirmation text, p_expected_restore_generation uuid, p_expected_data_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  selected_backup private.league_backups%rowtype;
  tables jsonb;
  safety_backup_id uuid;
  restored_counts jsonb;
  new_restore_generation uuid;
  new_data_revision bigint;
  completed_at timestamptz;
begin
  if not private.is_league_admin() then
    raise exception 'Not authorized';
  end if;

  if btrim(coalesce(p_confirmation, '')) <> 'RESTAURAR' then
    raise exception 'Type RESTAURAR to confirm';
  end if;

  -- Todas las operaciones adquieren primero el candado de respaldos y luego
  -- el de restauración. Este orden evita un ciclo con el cron automático.
  perform set_config('lock_timeout', '10s', true);
  perform pg_advisory_xact_lock(hashtextextended('cuban-league:backup:v124', 0));
  perform pg_advisory_xact_lock(hashtextextended('cuban-league:restore:v124', 0));

  if p_expected_restore_generation is distinct from (
    select restore_generation
    from private.league_backup_state
    where state_key = 'league'
  ) then
    raise exception 'Restore generation changed; reopen the restore preview';
  end if;

  if p_expected_data_revision is distinct from (
    select data_revision
    from private.league_backup_state
    where state_key = 'league'
  ) then
    raise exception 'League data changed; reopen the restore preview';
  end if;

  lock table public.matchday_stats in access exclusive mode;
  lock table public.matchday_drafts in access exclusive mode;
  lock table private.matchday_milestone_drafts in access exclusive mode;
  lock table public.matchday_change_log in access exclusive mode;
  lock table public.matchday_milestones in access exclusive mode;

  select *
    into selected_backup
  from private.league_backups
  where id = p_backup_id
  for update;

  if selected_backup.id is null then
    raise exception 'Backup not found';
  end if;

  if selected_backup.schema_version <> 124
     or (selected_backup.snapshot ->> 'format') is distinct from 'cuban-league-backup'
     or jsonb_typeof(selected_backup.snapshot -> 'tables') is distinct from 'object'
     or private.league_backup_checksum(selected_backup.snapshot) is distinct from selected_backup.checksum
     or private.league_backup_snapshot_counts(selected_backup.snapshot) is distinct from selected_backup.row_counts then
    raise exception 'Backup integrity check failed';
  end if;

  tables := selected_backup.snapshot -> 'tables';

  if jsonb_typeof(tables -> 'matchday_stats') is distinct from 'array'
     or jsonb_typeof(tables -> 'matchday_drafts') is distinct from 'array'
     or jsonb_typeof(tables -> 'matchday_milestone_drafts') is distinct from 'array'
     or jsonb_typeof(tables -> 'matchday_change_log') is distinct from 'array'
     or jsonb_typeof(tables -> 'matchday_milestones') is distinct from 'array' then
    raise exception 'Backup table format is invalid';
  end if;

  safety_backup_id := private.capture_league_backup(
    'pre_restore',
    (select auth.uid()),
    selected_backup.id
  );

  delete from public.matchday_milestones;
  delete from public.matchday_change_log;
  delete from private.matchday_milestone_drafts;
  delete from public.matchday_drafts;
  delete from public.matchday_stats;

  with restored as (
    select *
    from jsonb_populate_recordset(null::public.matchday_stats, tables -> 'matchday_stats')
  )
  insert into public.matchday_stats (
    id, season, matchday, participant_name, points, goals, clean_sheets,
    published, created_at, updated_at, red_cards, has_postponed_matches,
    negative_balance_no_score, lineup
  )
  select
    id, season, matchday, participant_name, points, goals, clean_sheets,
    published, created_at, updated_at, red_cards, has_postponed_matches,
    coalesce(negative_balance_no_score, false), lineup
  from restored;

  with restored as (
    select *
    from jsonb_populate_recordset(
      null::private.matchday_milestone_drafts,
      tables -> 'matchday_milestone_drafts'
    )
  )
  insert into private.matchday_milestone_drafts (
    season, matchday, matchday_date, is_month_end, is_year_end,
    saved_by, created_at, updated_at
  )
  select
    restored.season,
    restored.matchday,
    restored.matchday_date,
    restored.is_month_end,
    restored.is_year_end,
    case
      when restored.saved_by is null
        or exists (select 1 from auth.users where auth.users.id = restored.saved_by)
      then restored.saved_by
      else null
    end,
    restored.created_at,
    restored.updated_at
  from restored;

  with restored as (
    select *
    from jsonb_populate_recordset(null::public.matchday_drafts, tables -> 'matchday_drafts')
  )
  insert into public.matchday_drafts (
    id, season, matchday, participant_name, points, goals, clean_sheets,
    saved_by, created_at, updated_at, red_cards, has_postponed_matches,
    negative_balance_no_score, lineup
  )
  select
    restored.id,
    restored.season,
    restored.matchday,
    restored.participant_name,
    restored.points,
    restored.goals,
    restored.clean_sheets,
    case
      when restored.saved_by is null
        or exists (select 1 from auth.users where auth.users.id = restored.saved_by)
      then restored.saved_by
      else null
    end,
    restored.created_at,
    restored.updated_at,
    restored.red_cards,
    restored.has_postponed_matches,
    coalesce(restored.negative_balance_no_score, false),
    restored.lineup
  from restored;

  with restored as (
    select *
    from jsonb_populate_recordset(null::public.matchday_change_log, tables -> 'matchday_change_log')
  )
  insert into public.matchday_change_log (
    id, season, matchday, action, before_snapshot, after_snapshot,
    changed_by, changed_by_email, created_at, undone, undone_at, undone_by,
    before_milestone, after_milestone, milestone_tracked
  )
  select
    restored.id,
    restored.season,
    restored.matchday,
    restored.action,
    restored.before_snapshot,
    restored.after_snapshot,
    case
      when restored.changed_by is null
        or exists (select 1 from auth.users where auth.users.id = restored.changed_by)
      then restored.changed_by
      else null
    end,
    restored.changed_by_email,
    restored.created_at,
    restored.undone,
    restored.undone_at,
    case
      when restored.undone_by is null
        or exists (select 1 from auth.users where auth.users.id = restored.undone_by)
      then restored.undone_by
      else null
    end,
    restored.before_milestone,
    restored.after_milestone,
    coalesce(restored.milestone_tracked, false)
  from restored;

  with restored as (
    select *
    from jsonb_populate_recordset(null::public.matchday_milestones, tables -> 'matchday_milestones')
  )
  insert into public.matchday_milestones (
    id, season, matchday, matchday_date, is_month_end, is_year_end,
    saved_by, created_at, updated_at
  )
  select
    restored.id,
    restored.season,
    restored.matchday,
    restored.matchday_date,
    restored.is_month_end,
    restored.is_year_end,
    case
      when restored.saved_by is null
        or exists (select 1 from auth.users where auth.users.id = restored.saved_by)
      then restored.saved_by
      else null
    end,
    restored.created_at,
    restored.updated_at
  from restored;

  restored_counts := private.league_backup_row_counts();

  if restored_counts <> selected_backup.row_counts then
    raise exception 'Restored row counts do not match the backup';
  end if;

  update private.league_backups
  set restored_at = now(),
      restored_by = (select auth.uid())
  where id = selected_backup.id;

  -- El contenido de todas las jornadas acaba de cambiar de época. Rotar sus
  -- tokens hace explícito que ninguna revisión operativa anterior sigue viva.
  update private.matchday_write_state
  set write_revision = gen_random_uuid(),
      updated_at = now();

  update private.league_backup_state
  set restore_generation = gen_random_uuid(),
      data_revision = data_revision + 1,
      last_restore_at = now(),
      last_restore_backup_id = selected_backup.id,
      updated_by = (select auth.uid())
  where state_key = 'league'
  returning restore_generation, data_revision, last_restore_at
    into new_restore_generation, new_data_revision, completed_at;

  return jsonb_build_object(
    'restoredBackupId', selected_backup.id,
    'safetyBackupId', safety_backup_id,
    'restoredCounts', restored_counts,
    'restoreGeneration', new_restore_generation,
    'dataRevision', new_data_revision,
    'restoredAt', completed_at
  );
end;
$function$;