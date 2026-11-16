-- Exact reviewed owner maintenance applied 16/11/2026; retained for audit/replay checks.
-- Never a periodic worker command. The request UUID makes exact replays idempotent.
-- Expected state observed 2026-11-16 20:48:29 UTC. Re-read if any guard rejects.
-- No auth.uid/JWT impersonation, privilege changes, deletion or payload rewriting.
begin;
do $maintenance$
declare
 command_id uuid:='98df416c-4093-4d35-95a2-5b875380168e';
 expected_control bigint:=248;
 expected jsonb:='[
  {"key":"atletico-lookman-molestias-nigeria-20261113","version":4,"md5":"f8f1e422c5458fe24ba7aa9814892b66","withdraw":false},
  {"key":"atletico-lookman-nigeria-molestias-20261113","version":1,"md5":"d99a5920dc563cba9bbeaa77ff2966c3","withdraw":true},
  {"key":"atletico-sorloth-juventus-rumor-20261112","version":1,"md5":"bfeed4a55a9b5e233e171e221523bf59","withdraw":false},
  {"key":"atletico-sorloth-juventus-20261112","version":1,"md5":"a305f4639d352710f711f4f2a3dfc04a","withdraw":true}
 ]'::jsonb;
 pairs jsonb:='[
  {"keep":"atletico-lookman-molestias-nigeria-20261113","withdraw":"atletico-lookman-nigeria-molestias-20261113","reason":"Mismo acontecimiento Nigeria-Tanzania del 13/11; se conserva la primera noticia y su evolución hasta el 16/11."},
  {"keep":"atletico-sorloth-juventus-rumor-20261112","withdraw":"atletico-sorloth-juventus-20261112","reason":"Mismo rumor y mismo artículo Comuniate 38991; la copia del 14/11 no añade hechos."}
 ]'::jsonb;
 req jsonb; prior league_news.commands; e jsonb; i league_news.items; p public.news_public;
 before_state jsonb; after_state jsonb; affected integer;
begin
 if current_user<>'postgres' or session_user<>'postgres' then raise exception 'Explicit database owner maintenance only' using errcode='42501';end if;
 perform 1 from league_news.control for update;
 req:=jsonb_build_object('origin','owner-maintenance','database_role',current_user,'action','suppress-confirmed-duplicates','expected_control_version',expected_control,'expected',expected,'pairs',pairs);
 select * into prior from league_news.commands where id=command_id;
 if found then
  if prior.request<>req then raise exception 'Maintenance request identity conflict';end if;
  return;
 end if;
 if not exists(select 1 from league_news.control where mode='automatic' and version=expected_control) then raise exception 'Refresh news control state' using errcode='40001';end if;
 for e in select value from jsonb_array_elements(expected) loop
  select * into i from league_news.items where key=e->>'key' for update;
  select * into p from public.news_public where key=e->>'key' for update;
  if i.key is null or p.key is null or i.version<>(e->>'version')::bigint or i.outcome<>'published' or i.suppressed or not p.visible
   or md5(i.payload::text)<>e->>'md5' or p.payload<>i.payload then raise exception 'News snapshot changed: %',e->>'key' using errcode='40001';end if;
 end loop;
 select jsonb_build_object('control',(select to_jsonb(c) from league_news.control c),
  'items',(select jsonb_agg(to_jsonb(x) order by x.key) from league_news.items x where key in(select value->>'key' from jsonb_array_elements(expected))),
  'public',(select jsonb_agg(to_jsonb(x) order by x.key) from public.news_public x where key in(select value->>'key' from jsonb_array_elements(expected)))) into before_state;
 update league_news.items set suppressed=true where key in(select value->>'key' from jsonb_array_elements(expected) where (value->>'withdraw')::boolean);
 get diagnostics affected=row_count;if affected<>2 then raise exception 'Unexpected private row count';end if;
 update public.news_public set visible=false where key in(select value->>'key' from jsonb_array_elements(expected) where (value->>'withdraw')::boolean);
 get diagnostics affected=row_count;if affected<>2 then raise exception 'Unexpected public row count';end if;
 -- Same version invalidation as two existing withdraw commands; timestamps stay intact.
 update league_news.control set version=version+2;
 select jsonb_build_object('control',(select to_jsonb(c) from league_news.control c),
  'items',(select jsonb_agg(to_jsonb(x) order by x.key) from league_news.items x where key in(select value->>'key' from jsonb_array_elements(expected))),
  'public',(select jsonb_agg(to_jsonb(x) order by x.key) from public.news_public x where key in(select value->>'key' from jsonb_array_elements(expected)))) into after_state;
 if exists(select 1 from jsonb_array_elements(before_state->'items') b join jsonb_array_elements(after_state->'items') a on a->>'key'=b->>'key' where (b-'suppressed')<>(a-'suppressed'))
  or exists(select 1 from jsonb_array_elements(before_state->'public') b join jsonb_array_elements(after_state->'public') a on a->>'key'=b->>'key' where (b-'visible')<>(a-'visible'))
 then raise exception 'Maintenance changed protected news fields';end if;
 insert into league_news.commands(id,request,result) values(command_id,req,jsonb_build_object('status','completed','recorded_at',clock_timestamp(),'before',before_state,'after',after_state,'pairs',pairs));
end;$maintenance$;
commit;
select id,request->>'origin' as origin,result->>'status' as status,result->'pairs' as pairs
from league_news.commands where id='98df416c-4093-4d35-95a2-5b875380168e';
