-- Stable footballer identities for portraits on the published pitch.
create or replace function public.get_published_official_xi(p_season text, p_matchday integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  with published as (
    select participant_name, lineup from public.matchday_stats
    where season = p_season and matchday = p_matchday and published
  ), latest as (
    select after_milestone->'officialXi' as xi from public.matchday_change_log
    where season = p_season and matchday = p_matchday and not undone
      and after_milestone ? 'officialXi' and exists (select from published)
    order by created_at desc, id desc limit 1
  ), aligned as (
    select distinct s.participant_name, slot->>'player_id' as player_id
    from published s cross join lateral jsonb_array_elements(s.lineup) slot
  )
  select jsonb_agg(jsonb_build_object(
    'playerId', p->>'playerId', 'misterPlayerId', p->>'misterPlayerId',
    'playerName', p->>'playerName', 'position', p->>'position', 'points', p->'points',
    'participants', coalesce((select jsonb_agg(a.participant_name order by a.participant_name)
      from aligned a where a.player_id = p->>'playerId'), '[]'::jsonb)
  ) order by ord)
  from latest cross join lateral jsonb_array_elements(xi->'players') with ordinality as players(p, ord);
$$;
revoke all on function public.get_published_official_xi(text,integer) from public;
grant execute on function public.get_published_official_xi(text,integer) to anon, authenticated;
