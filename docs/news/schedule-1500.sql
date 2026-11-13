begin;
-- User requested 14:00 -> 15:00 America/New_York on 2026-11-13.
-- Existing run keys/ledgers stay intact; plan() can still resume their pending work.
create or replace function league_news.slot_at(p_at timestamptz)
returns text language plpgsql stable set search_path='' as $$
declare t timestamp:=p_at at time zone 'America/New_York'; h integer;
begin
 if t::date not between date '2026-11-12' and date '2027-06-30' then return null;end if;
 h:=case when extract(hour from t) between 8 and 9 then 8
  when extract(hour from t) between 11 and 12 then 11
  when extract(hour from t) between 15 and 16 then 15 end;
 if h is null then return null;end if;
 return 'news-'||to_char(t,'YYYYMMDD')||'-'||lpad(h::text,2,'0');
end;$$;
revoke all on function league_news.slot_at(timestamptz) from public,anon,authenticated;
commit;
