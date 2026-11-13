-- Noticias por fecha de la información más reciente, sin alterar sus fuentes.
-- Apply in one transaction before deploying the client that selects news_day.
-- Stored generation runs only on writes; feed reads use the indexes below.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create function league_news.news_day(p_payload jsonb) returns date
language plpgsql immutable parallel safe set search_path='' as $$
declare
 source jsonb; field text; value text; parts text[]; month_number integer;
 candidate date; source_day date; latest_day date;
begin
 if jsonb_typeof(p_payload->'sources') is distinct from 'array' then return null;end if;
 for source in select x from jsonb_array_elements(p_payload->'sources') x loop
  if jsonb_typeof(source) is distinct from 'object' then continue;end if;
  source_day:=null;
  -- Explicit offsets make ISO parsing independent of the session TimeZone and
  -- DateStyle. A verified source update may be newer than its publication.
  foreach field in array array['published_at','source_updated_at'] loop
   value:=btrim(source->>field);
   if value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt ]([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]{1,6})?)?([Zz]|[+-][0-9]{2}:?[0-9]{2})$' then
    begin
     candidate:=(value::timestamptz at time zone 'America/New_York')::date;
     if candidate between make_date(1,1,1) and make_date(9999,12,31) then
      source_day:=greatest(source_day,candidate);
     end if;
    exception when invalid_datetime_format or datetime_field_overflow or invalid_time_zone_displacement_value then
     -- Bad source metadata must never prevent publishing otherwise valid news.
     null;
    end;
   end if;
  end loop;
  -- If no usable timestamp exists, retain the published calendar date as
  -- printed by the source. Do not invent a time zone for date-only labels.
  if source_day is null then
   value:=translate(lower(btrim(source->>'published_label')),'áéíóú','aeiou');
   parts:=regexp_match(value,'^([0-9]{1,2})/([0-9]{1,2})/([0-9]{4})(?:$|[[:space:],;.(])');
   if parts is not null then
    begin
     source_day:=make_date(parts[3]::integer,parts[2]::integer,parts[1]::integer);
    exception when datetime_field_overflow then null;
    end;
   else
    parts:=regexp_match(value,'^(?:(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo),?[[:space:]]+)?([0-9]{1,2})[[:space:]]+de[[:space:]]+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)[[:space:]]+del?[[:space:]]+([0-9]{4})(?:$|[[:space:],;.(])');
    if parts is not null then
     month_number:=array_position(array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'],replace(parts[2],'setiembre','septiembre'));
     begin
      source_day:=make_date(parts[3]::integer,month_number,parts[1]::integer);
     exception when datetime_field_overflow then null;
     end;
    end if;
   end if;
  end if;
  latest_day:=greatest(latest_day,source_day);
 end loop;
 -- Missing evidence stays NULL: fetched_at, import dates and event descriptions
 -- are deliberately excluded, so old articles imported today stay in the past.
 return latest_day;
end;$$;
revoke all on function league_news.news_day(jsonb) from public,anon,authenticated,service_role;

alter table public.news_public add column news_day date
 generated always as (league_news.news_day(payload)) stored;
create index news_visible_day_cursor on public.news_public(news_day desc nulls last,updated_at desc,key) where visible;
create index news_visible_club_day_cursor on public.news_public((payload->>'team'),news_day desc nulls last,updated_at desc,key) where visible;
notify pgrst,'reload schema';
commit;
