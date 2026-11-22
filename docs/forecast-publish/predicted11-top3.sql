-- Maintenance: new saves require top3 + top3; historical/saved 7 + 7 stays readable.
-- No DML, schedule, weights, table permissions or public projection changes.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $top3$
declare
 builder text:=pg_get_functiondef('forecast_season.build_team(jsonb,interval)'::regprocedure);
 saver text:=pg_get_functiondef('forecast_season.save_draft(text,jsonb)'::regprocedure);
 before_meta jsonb; after_meta jsonb; needle text; replacement text;
begin
 if md5(builder)<>'12773c40d7f05de2ba5b01b824204f9d' then
  raise exception 'Predicted11 builder changed since top3 review';
 end if;
 select jsonb_agg(jsonb_build_object('oid',oid,'acl',proacl,'owner',proowner,'security_definer',prosecdef,'config',proconfig,'volatility',provolatile) order by oid)
 into before_meta from pg_proc where oid in('forecast_season.build_team(jsonb,interval)'::regprocedure,'forecast_season.save_draft(text,jsonb)'::regprocedure);

 for needle,replacement in select * from (values
  ('complete_count integer:=0; vote_count integer;', 'complete_count integer:=0; vote_count integer; p11_rank_size integer:=7;'),
  ('p11:=s;', $branch$p11:=s;
   if s ? 'selection_policy' then
    if s->>'selection_policy' is distinct from 'top3-global-top3-club-v1' then
     raise exception 'Política Predicted11 desconocida' using errcode='22023';
    end if;
    p11_rank_size:=3;
   end if;$branch$),
  ('jsonb_array_length(ranking->''authors'')<>7', 'jsonb_array_length(ranking->''authors'')<>p11_rank_size'),
  ('(select count(distinct value->>''id'') from jsonb_array_elements(ranking->''authors''))<>7', '(select count(distinct value->>''id'') from jsonb_array_elements(ranking->''authors''))<>p11_rank_size'),
  ('(select count(distinct value->>''rank'') from jsonb_array_elements(ranking->''authors''))<>7', '(select count(distinct value->>''rank'') from jsonb_array_elements(ranking->''authors''))<>p11_rank_size'),
  ('Ranking requiere los primeros siete', 'Ranking no corresponde al tamaño de su política'),
  ('coalesce(author->>''rank'','''') !~ ''^[1-7]$''', 'coalesce(author->>''rank'','''') !~ (''^[1-''||p11_rank_size||'']$'')')
 ) changes(needle,replacement) loop
  if length(builder)-length(replace(builder,needle,''))<>length(needle) then
   raise exception 'Unexpected top3 builder patch point: %',needle;
  end if;
  builder:=replace(builder,needle,replacement);
 end loop;

 -- After the idempotent already_saved return. Pending saved drafts remain
 -- deliverable under their original policy; only NEW evidence must use top3.
 needle:='k:=forecast_season.check_attempt(p_run,p->>''team'');';
 if length(saver)-length(replace(saver,needle,''))<>length(needle) then
  raise exception 'Unexpected top3 save guard patch point';
 end if;
 saver:=replace(saver,needle,needle||$guard$
 if not exists(select 1 from jsonb_array_elements(p->'sources') s
   where s->>'id'='predicted11' and s->>'selection_policy'='top3-global-top3-club-v1') then
  raise exception 'Las nuevas lecturas requieren Predicted11 top3 global + top3 club' using errcode='22023';
 end if;
$guard$);
 execute builder;
 execute saver;
 select jsonb_agg(jsonb_build_object('oid',oid,'acl',proacl,'owner',proowner,'security_definer',prosecdef,'config',proconfig,'volatility',provolatile) order by oid)
 into after_meta from pg_proc where oid in('forecast_season.build_team(jsonb,interval)'::regprocedure,'forecast_season.save_draft(text,jsonb)'::regprocedure);
 if after_meta is distinct from before_meta then raise exception 'Top3 changed private function metadata';end if;
end;
$top3$;
commit;
