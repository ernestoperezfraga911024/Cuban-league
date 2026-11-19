-- Mister league 649733, 2026/27. Verified against the 119 completed match scorecards.
-- Penalties scored count once; own goals count only toward the opponent's scoreboard.
-- J8 Rayo–Athletic is pending. J1/J5 GNT D ZONA have one extra goal in each published team total.
-- Apply once to the reviewed publications; a repeat is a no-op. Refuse a changed source lineup.
do $backfill$
declare
  r record;
  observed jsonb;
  existing jsonb;
  revision_id uuid;
  fingerprint text;
begin
  perform pg_advisory_xact_lock(hashtextextended('cuban-league:backup:v124',0));
  for r in select generate_series(1,12) as day loop
    perform pg_advisory_xact_lock(hashtext('2026/27'),r.day);
  end loop;
  select md5(string_agg(to_jsonb(s)::text,'|' order by matchday,participant_name collate "C"))
    into fingerprint from public.matchday_stats s
    where season='2026/27' and published and matchday between 1 and 12;
  if fingerprint is distinct from '2b6140f7f0a6869a66180131838b0526' then
    raise exception 'The historical publications have changed. Reconcile before backfilling.';
  end if;
  if exists(select from private.matchday_milestone_drafts where season='2026/27' and matchday between 1 and 12
    and (official_xi is not null or player_goals is not null)) then raise exception 'Another import is in progress'; end if;
  for r in select * from (values
      (1,220,'{"a-baena":1,"a-budimir":1,"a-garcia":1,"a-martin":1,"f-lopez":1,"i-aspas":1,"j-guridi":1,"k-lee":1,"k-mbappe":3,"m-aguado":1,"n-pepe":1,"n-tenaglia":1,"p-aubameyang":1,"p-fernandez":1,"p-gueye":1,"r-fernandez":2,"raphinha":1,"t-dolan":1,"v-junior":1}'::jsonb,'[]'::jsonb),
      (2,218,'{"a-calatrava":1,"a-paredes":1,"chupete":1,"f-lopez":2,"g-mikautadze":1,"g-moreno":1,"g-simeone":1,"i-romero-sevilla":1,"j-bellingham":1,"k-adeyemi":1,"p-aubameyang":1,"r-riquelme":1,"raphinha":2,"s-camello":1}'::jsonb,'[]'::jsonb),
      (3,220,'{"a-baena":2,"a-berenguer":1,"a-budimir":1,"a-de-la-fuente":1,"a-guler":1,"a-lookman":1,"b-sangare":1,"e-bardeli":1,"f-nino":1,"j-ander-olasagasti":1,"j-bellingham":1,"k-mbappe":1,"l-boye":1,"l-yamal":2,"m-bartra":1,"m-sierra":1,"o-oskarsson":1,"p-aubameyang":1,"r-fernandez":1,"r-riquelme":1,"raphinha":2,"s-camello":2}'::jsonb,'[]'::jsonb),
      (4,220,'{"a-budimir":2,"f-lopez":1,"f-nino":1,"l-boye":3,"l-cruz":1,"l-sucic":1,"l-yamal":2,"m-satriano":1,"mariano-diaz":1,"n-pepe":1,"n-williams":1,"o-sancet":1,"p-aubameyang":1,"p-garcia":1,"p-ibanez":1,"pedri":1,"raphinha":1,"s-camello":2,"s-canales":1,"y-herrera":1}'::jsonb,'[]'::jsonb),
      (5,220,'{"a-carreras":1,"f-jutgla":1,"g-moreno":1,"i-romero":1,"j-bellingham":1,"j-iglesias":1,"k-adeyemi":1,"k-mbappe":2,"l-yamal":2,"n-souza":1,"p-aubameyang":1,"r-brugue":1,"r-fernandez":2,"r-terrats":1,"s-camello":1,"v-koski":1,"x-espart":1,"y-zabiri":2}'::jsonb,'[]'::jsonb),
      (6,209,'{"a-baena":1,"a-berenguer":1,"a-ezzalzouli":1,"a-garcia":1,"a-moleiro":1,"a-pedrosa":1,"c-dotor":1,"e-eyong":1,"f-nino":1,"k-lee":1,"k-mbappe":1,"l-yamal":1,"m-sierra":1,"p-gueye":2,"r-fernandez":1,"raphinha":3,"y-zabiri":1}'::jsonb,'[]'::jsonb),
      (7,220,'{"a-budimir":1,"c-hernandez":1,"c-soler":1,"f-nino":2,"g-mikautadze":1,"g-valera":1,"i-romero":1,"l-sucic":1,"m-roman":1,"raphinha":3,"s-camello":1,"youssouf-fofana":1}'::jsonb,'[]'::jsonb),
      (8,196,'{"a-budimir":1,"a-de-la-fuente":1,"a-ezzalzouli":1,"a-gordon":1,"a-grimaldo":1,"c-romero-atletico":1,"felix-correia":1,"g-guedes":1,"i-romero":1,"isco":2,"ivan-martin":1,"m-soriano":1,"mister-4764213":1,"y-diomande":1,"y-hernandez":1,"y-zabiri":1}'::jsonb,'["a-berenguer","a-garcia","a-paredes","a-pedrosa","a-ratiu","b-gerenabarrena","emil-audero","f-lejeune","i-palazon","i-ruiz-de-galarreta","i-williams","j-de-frutos","m-jauregizar","mujaid-sadick","o-sancet","o-valentin","p-canales","p-ciss","p-diaz","r-navarro","s-camello","u-lopez","u-simon","y-berchiche"]'::jsonb),
      (9,220,'{"a-baena":1,"a-budimir":1,"a-ezzalzouli":1,"a-garcia":1,"a-guler":1,"b-nsongo":1,"d-olmo":1,"e-garcia":1,"f-jutgla":1,"g-guedes":1,"k-mbappe":2,"l-yamal":1,"m-oyarzabal":2,"m-satriano":1,"mister-27861":1,"mister-4764213":1,"o-oskarsson":1,"r-hernandez":1,"t-kubo":1,"y-diomande":1}'::jsonb,'[]'::jsonb),
      (10,220,'{"a-berenguer":1,"a-freeman":1,"a-nino":1,"a-paredes":1,"e-exposito":1,"f-nino":1,"f-redondo":1,"felix-correia":1,"g-mikautadze":1,"g-valera":1,"i-williams":1,"j-alvarez":1,"k-mbappe":2,"o-oskarsson":1,"pepelu":1,"raphinha":1,"y-zabiri":1}'::jsonb,'[]'::jsonb),
      (11,220,'{"a-berenguer":1,"a-budimir":1,"a-gordon":1,"a-grimaldo":1,"a-nino":1,"b-nsongo":1,"e-unal":1,"f-lopez":1,"g-simeone":1,"i-williams":1,"j-bellingham":1,"j-de-frutos":2,"k-mbappe":1,"k-salas":1,"l-cabrera":1,"l-sucic":1,"l-yamal":2,"m-bartra":1,"m-satriano":1,"m-soriano":1,"mariano-diaz":1,"p-fornals":1,"raphinha":2,"u-lopez":1,"y-diomande":1}'::jsonb,'[]'::jsonb),
      (12,220,'{"a-catena":1,"a-guler":1,"c-dotor":1,"f-lopez":2,"f-valverde":1,"g-simeone":1,"k-mbappe":1,"m-bartra":1,"n-williams":1,"o-oskarsson":1,"r-riquelme":1,"y-zabiri":1}'::jsonb,'[]'::jsonb)
    ) v(day,expected_count,scorers,pending)
  loop
    select jsonb_object_agg(key,coalesce(r.scorers->key,'0'::jsonb)) into observed from (
      select distinct slot->>'player_id' as key from public.matchday_stats s
      cross join lateral jsonb_array_elements(s.lineup) slot
      where season='2026/27' and matchday=r.day and published and not negative_balance_no_score
    ) slots where key not like 'empty-slot-%' and not (r.pending ? key);
    if (select count(*) from jsonb_object_keys(observed)) <> r.expected_count or not (observed @> r.scorers)
      then raise exception 'Lineup coverage mismatch on J%',r.day; end if;
    select id,after_milestone->'playerGoals' into strict revision_id,existing
      from public.matchday_change_log where season='2026/27' and matchday=r.day and not undone
      order by created_at desc,id desc limit 1 for update;
    if existing is null then
      update public.matchday_change_log set after_milestone=after_milestone || jsonb_build_object('playerGoals',observed)
        where id=revision_id and milestone_tracked and after_milestone is not null;
      if not found then raise exception 'No suitable publication on J%',r.day; end if;
    elsif existing <> observed then raise exception 'Conflicting existing player goals on J%',r.day; end if;
  end loop;
end;
$backfill$;
