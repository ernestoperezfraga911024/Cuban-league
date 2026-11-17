-- Restore only the pre-priority function; leave all data untouched.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $rollback$
declare builder text:=pg_get_functiondef('forecast_season.build_team(jsonb,interval)'::regprocedure);
 needle text:=$needle$ -- A valid forecast cannot publish a lower-scored starter above its alternative.
 -- All scores have already been independently validated against the sources.
 if p->>'method_version'='editorial-v6' and exists(
  select 1 from jsonb_array_elements(players) slot_player
  where slot_player->'alternative'<>'null'::jsonb and not exists(
   select 1 from jsonb_array_elements(players||candidates) option_player
   where option_player->>'id'=slot_player#>>'{alternative,id}'
    and (option_player->>'probability')::integer<=(slot_player->>'probability')::integer
  )
 ) then raise exception 'La alternativa supera al titular: revisar mayor porcentaje por puesto' using errcode='22023';end if;
 return jsonb_build_object('schema_version',case when v3 then 4 else 3 end$needle$;
 replacement text:=$replacement$ return jsonb_build_object('schema_version',case when v3 then 4 else 3 end$replacement$;
begin
 if md5(builder)<>'12773c40d7f05de2ba5b01b824204f9d' then raise exception 'build_team changed after selection-priority installation';end if;
 if length(builder)-length(replace(builder,needle,''))<>length(needle) then raise exception 'Unexpected priority rollback point';end if;
 builder:=replace(builder,needle,replacement);
 if md5(builder)<>'105206b17439613a07159868f261bc9e' then raise exception 'Priority rollback definition mismatch';end if;
 execute builder;
end;
$rollback$;
commit;
