-- Reviewed maintenance migration; no stored items, ledgers, modes or public ACLs change.
-- Source fingerprint read from the installed function on 16/11/2026.
begin;
-- Serialize against current news writers while proving rows stay unchanged.
select 1 from league_news.control for update;
create temporary table news_duplicate_install_snapshot on commit drop as
select jsonb_build_object(
 'control',(select to_jsonb(c) from league_news.control c),
 'items',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by key)::text,'[]')) from league_news.items x),
 'public',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by key)::text,'[]')) from public.news_public x),
 'runs',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by key)::text,'[]')) from league_news.runs x),
 'events',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by run_key,key)::text,'[]')) from league_news.run_events x),
 'teams',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by run_key,team)::text,'[]')) from league_news.run_teams x),
 'commands',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'[]')) from league_news.commands x),
 'status',(select to_jsonb(x) from public.news_status x)
) as fingerprints;
do $check$ begin
 if md5(pg_get_functiondef('league_news.save_draft(text,jsonb)'::regprocedure))<>'6f328c212c1b0b27cd5912b154a1fdf5'
 then raise exception 'News save_draft changed; review the installed definition before patching';end if;
end;$check$;

create function league_news.article_identity(u text) returns text
language plpgsql immutable set search_path='' as $fn$
declare base text; host text; p text; q text; clean_query text; article text; m text[];
begin
 if u is null or length(u)>2048 or u ~ '[[:space:]<>]' then return null;end if;
 base:=split_part(u,'#',1);
 if strpos(base,'?')>0 then q:=substr(base,strpos(base,'?')+1);base:=split_part(base,'?',1);else q:='';end if;
 host:=lower(substring(base from '^https://([^/]+)/'));
 host:=regexp_replace(host,'^www\.','');
 p:=substring(base from '^https://[^/]+(/.*)$');
 if host='futbolfantasy.com' then
  m:=regexp_match(p,'^/laliga/noticias/([0-9]+)([-/][^?#]*)?/?$');
  if m is not null then article:='futbolfantasy:'||m[1];end if;
 elsif host='comuniate.com' then
  m:=regexp_match(p,'^/noticias/([0-9]+)([-/][^?#]*)?/?$');
  if m is not null then article:='comuniate:'||m[1];end if;
 elsif host='jornadaperfecta.com' and p ~ '^/blog/[^/]+/?$' then
  article:='jornadaperfecta:'||regexp_replace(p,'/$','');
 end if;
 if article is null then return null;end if;
 -- Remove tracking only. Unknown query parameters retain meaning/order.
 select string_agg(part,'&' order by n) into clean_query
 from regexp_split_to_table(q,'&') with ordinality x(part,n)
 where part<>'' and lower(split_part(part,'=',1)) not like 'utm\_%' escape '\'
  and lower(split_part(part,'=',1)) not in('fbclid','gclid','mc_cid','mc_eid');
 return article||case when clean_query is null then '' else '?'||clean_query end;
end;$fn$;
revoke all on function league_news.article_identity(text) from public,anon,authenticated,service_role;

create function league_news.duplicate_candidates(p jsonb) returns jsonb
language plpgsql stable set search_path='' as $fn$
declare players text[];articles text[]; result jsonb;
begin
 if jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p->'players') is distinct from 'array'
  or jsonb_typeof(p->'sources') is distinct from 'array' then return '[]'::jsonb;end if;
 if jsonb_array_length(p->'players') not between 1 and 8 or jsonb_array_length(p->'sources') not between 1 and 5
  or exists(select 1 from jsonb_array_elements(p->'players') x where coalesce(x->>'id','')='') then return '[]'::jsonb;end if;
 select array_agg(distinct x->>'id' order by x->>'id') into players from jsonb_array_elements(p->'players') x;
 select array_agg(distinct a) into articles from (select league_news.article_identity(x->>'url') a from jsonb_array_elements(p->'sources') x) q where a is not null;
 if articles is null then return '[]'::jsonb;end if;
 select coalesce(jsonb_agg(jsonb_build_object('key',key,'version',version,'suppressed',suppressed,'matched_articles',matches) order by checked_at,key),'[]'::jsonb) into result
 from (
  select i.key,i.version,i.suppressed,i.checked_at,
   (select jsonb_agg(distinct a order by a) from (select league_news.article_identity(x->>'url') a from jsonb_array_elements(i.payload->'sources') x) q where a=any(articles)) matches
  from league_news.items i
  where i.key is distinct from p->>'key' and i.payload->>'team'=p->>'team'
   and i.payload->>'season'=p->>'season' and i.payload->>'category'=p->>'category'
   and (select array_agg(distinct x->>'id' order by x->>'id') from jsonb_array_elements(i.payload->'players') x)=players
 ) candidates where matches is not null;
 return result;
end;$fn$;
revoke all on function league_news.duplicate_candidates(jsonb) from public,anon,authenticated,service_role;

do $patch$
declare src text:=pg_get_functiondef('league_news.save_draft(text,jsonb)'::regprocedure);
 needle text:='perform league_news.track_saved(p_run,p); select * into old from league_news.items where key=k for update;';
 replacement text:=$body$select * into old from league_news.items where key=k for update;
 if old.key is null then
  duplicates:=league_news.duplicate_candidates(p);
  if jsonb_array_length(duplicates)>0 then
   raise exception 'News duplicate candidate: review the existing event key' using errcode='23505',detail=duplicates::text,
    hint='Same source article, club, category and players. Reuse the existing key for the same story; review distinct events without automatic merging.';
  end if;
 end if;
 perform league_news.track_saved(p_run,p);$body$;
begin
 if md5(src)<>'6f328c212c1b0b27cd5912b154a1fdf5' or length(src)-length(replace(src,needle,''))<>length(needle)
  or length(src)-length(replace(src,'clean jsonb;',''))<>length('clean jsonb;')
 then raise exception 'News save_draft source mismatch';end if;
 src:=replace(src,'clean jsonb;','clean jsonb; duplicates jsonb;');
 execute replace(src,needle,replacement);
end;$patch$;
do $verify$ declare after_state jsonb;begin
 select jsonb_build_object(
  'control',(select to_jsonb(c) from league_news.control c),
  'items',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by key)::text,'[]')) from league_news.items x),
  'public',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by key)::text,'[]')) from public.news_public x),
  'runs',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by key)::text,'[]')) from league_news.runs x),
  'events',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by run_key,key)::text,'[]')) from league_news.run_events x),
  'teams',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by run_key,team)::text,'[]')) from league_news.run_teams x),
  'commands',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'[]')) from league_news.commands x),
  'status',(select to_jsonb(x) from public.news_status x)
 ) into after_state;
 if after_state is distinct from (select fingerprints from pg_temp.news_duplicate_install_snapshot)
 then raise exception 'Duplicate prevention changed protected news state';end if;
end;$verify$;
select jsonb_build_object('protected_state_unchanged',true,'snapshot',fingerprints,
 'save_draft_md5',md5(pg_get_functiondef('league_news.save_draft(text,jsonb)'::regprocedure)),
 'private_helpers',(select jsonb_agg(jsonb_build_object('function',proname,'security_definer',prosecdef,'acl',proacl::text) order by proname)
 from pg_proc where oid in('league_news.article_identity(text)'::regprocedure,'league_news.duplicate_candidates(jsonb)'::regprocedure))) as result
from pg_temp.news_duplicate_install_snapshot;
commit;
