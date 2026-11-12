-- Additive Noticias storage. Does not modify fantasy or forecast records.
create schema league_news;
revoke all on schema league_news from public,anon,authenticated,service_role;
create table league_news.control(singleton boolean primary key default true check(singleton),mode text not null default 'automatic' check(mode in('automatic','manual')),version bigint not null default 1);
insert into league_news.control default values;
create table league_news.runs(key text primary key,started_at timestamptz not null default now(),finished_at timestamptz,checks jsonb);
create table league_news.items(key text primary key,payload jsonb not null,version bigint not null default 1,outcome text not null default 'ready',suppressed boolean not null default false,checked_at timestamptz not null default now());
create table league_news.commands(id uuid primary key,result jsonb not null,request jsonb not null);
create table public.news_public(key text primary key,payload jsonb not null,published_at timestamptz not null default now(),updated_at timestamptz not null default now(),visible boolean not null default true);
create table public.news_status(singleton boolean primary key default true check(singleton),checked_at timestamptz,coverage jsonb not null default '[]',result text not null default 'pending');
insert into public.news_status default values;
alter table league_news.control enable row level security;
alter table league_news.runs enable row level security;
alter table league_news.items enable row level security;
alter table league_news.commands enable row level security;
alter table public.news_public enable row level security;
alter table public.news_status enable row level security;
revoke all on public.news_public,public.news_status from public,anon,authenticated,service_role;
grant select on public.news_public,public.news_status to anon,authenticated;
create policy news_visible on public.news_public for select to anon,authenticated using(visible);
create policy news_status_read on public.news_status for select to anon,authenticated using(true);
create index news_recent on public.news_public(updated_at desc) where visible;

create function league_news.valid_url(u text) returns boolean language sql immutable set search_path='' as $$
 select coalesce(u ~ '^https://(www\.)?(futbolfantasy\.com|jornadaperfecta\.com|comuniate\.com|rfef\.es|laliga\.com|realmadrid\.com|fcbarcelona\.(es|com)|atleticodemadrid\.com|athletic-club\.eus|realbetisbalompie\.es|villarrealcf\.es|sevillafc\.es|rccelta\.es|valenciacf\.com|osasuna\.es|realsociedad\.eus|rayoVallecano\.es|rayovallecano\.es|elchecf\.es|deportivoalaves\.com|getafecf\.com|rcdespanyol\.com|rcdeportivo\.es|levanteud\.com|realracingclub\.es|malagacf\.com)/[^[:space:]<>]*$',false);
$$;
create function league_news.plan() returns jsonb language plpgsql stable set search_path='' as $$
declare t timestamp:=now() at time zone 'America/New_York'; h int; k text;
begin
 h:=case when extract(hour from t) between 8 and 9 then 8 when extract(hour from t) between 14 and 15 then 14 end;
 if t::date>'2027-06-30' or t::date<'2026-11-12' then h:=null; end if;
 if h is not null then k:='news-'||to_char(t,'YYYYMMDD')||'-'||lpad(h::text,2,'0');end if;
 return jsonb_build_object('observed_at',now(),'run_key',k,'completed',exists(select 1 from league_news.runs where key=k and finished_at is not null),'mode',(select mode from league_news.control),'recent',coalesce((select jsonb_agg(jsonb_build_object('key',key,'payload',payload,'outcome',outcome,'suppressed',suppressed)) from (select * from league_news.items order by checked_at desc limit 80) x),'[]'));
end;$$;
create function league_news.begin_run(p_key text) returns jsonb language plpgsql set search_path='' as $$
begin
 if p_key is null or (p_key is distinct from league_news.plan()->>'run_key' and p_key<>'news-initial-20261112') then raise exception 'Invalid news turn';end if;
 if p_key='news-initial-20261112' and (now() at time zone 'America/New_York')::date<>'2026-11-12' then raise exception 'Initial turn expired';end if;
 insert into league_news.runs(key) values(p_key) on conflict do nothing;
 return (select to_jsonb(r) from league_news.runs r where key=p_key);
end;$$;
create function league_news.save_draft(p_run text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare s jsonb; pl jsonb; f timestamptz; k text:=p->>'key'; old league_news.items; history jsonb; clean jsonb;
begin
 perform 1 from league_news.control for update;
 if not exists(select 1 from league_news.runs where key=p_run and finished_at is null and started_at>now()-interval '2 hours') then raise exception 'No active news run';end if;
 if octet_length(p::text)>16384 or coalesce(p->>'season','')<>'2026-27' or k is null or k!~'^[a-z0-9-]{8,140}$' or not exists(select 1 from forecast_league.teams where team=p->>'team') then raise exception 'Invalid identity';end if;
 if coalesce(p->>'category','') not in('press','injury','recovery','training','rotation','transfer') or coalesce(p->>'certainty','') not in('confirmed','reported','doubt','rumor') then raise exception 'Invalid news type';end if;
 if p->>'certainty'='rumor' and p->>'category'<>'transfer' then raise exception 'Rumor category required';end if;
 if coalesce(length(p->>'title'),0) not between 12 and 150 or coalesce(length(p->>'summary'),0) not between 20 and 900 or coalesce(length(p->>'impact'),0) not between 10 and 500 then raise exception 'Invalid editorial length';end if;
 if jsonb_typeof(p->'sources') is distinct from 'array' or jsonb_array_length(p->'sources') not between 1 and 5 or jsonb_typeof(p->'players') is distinct from 'array' or jsonb_array_length(p->'players')>8 then raise exception 'Invalid sources/players';end if;
 for pl in select value from jsonb_array_elements(p->'players') loop
  if not exists(select 1 from forecast_league.roster where id=pl->>'id' and name=pl->>'name') then raise exception 'Player not in verified catalog: %',pl->>'id';end if;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(p->'players'))<>jsonb_array_length(p->'players') then raise exception 'Duplicate player';end if;
 for s in select value from jsonb_array_elements(p->'sources') loop
  if not league_news.valid_url(s->>'url') or coalesce(length(s->>'name'),0) not between 2 and 80 then raise exception 'Invalid source URL';end if;
  f:=(s->>'fetched_at')::timestamptz;
  if f is null or f<now()-interval '2 hours' or f>now()+interval '5 minutes' then raise exception 'Stale source';end if;
  if s->>'published_at' is not null and (s->>'published_at')::timestamptz>now()+interval '5 minutes' then raise exception 'Future article';end if;
 end loop;
 if p->>'certainty'='confirmed' and not exists(select 1 from jsonb_array_elements(p->'sources') x where x->>'kind'='official') then raise exception 'Official evidence required';end if;
 select * into old from league_news.items where key=k for update;
 if old.key is not null and old.payload->>'team'<>p->>'team' then raise exception 'Event team cannot change';end if;
 clean:=jsonb_build_object('key',k,'season','2026-27','team',p->>'team','category',p->>'category','certainty',p->>'certainty','title',p->>'title','summary',p->>'summary','impact',p->>'impact','players',p->'players','sources',p->'sources');
 if old.key is not null and (old.payload-'sources'-'timeline')=(clean-'sources') then return jsonb_build_object('outcome','unchanged','key',k);end if;
 if old.key is not null and (select max((value->>'fetched_at')::timestamptz) from jsonb_array_elements(old.payload->'sources'))>(select min((value->>'fetched_at')::timestamptz) from jsonb_array_elements(p->'sources')) then raise exception 'Older evidence cannot replace news';end if;
 history:=jsonb_build_array(jsonb_build_object('at',now(),'text',coalesce(nullif(left(p->>'change_note',180),''),'Primera publicación')))||coalesce(old.payload->'timeline','[]');
 clean:=clean||jsonb_build_object('timeline',(select jsonb_agg(value) from (select value from jsonb_array_elements(history) limit 6) q));
 insert into league_news.items(key,payload) values(k,clean) on conflict(key) do update set payload=excluded.payload,version=league_news.items.version+1,outcome='ready',checked_at=now();
 update league_news.control set version=version+1;
 return jsonb_build_object('outcome','saved','key',k);
end;$$;
create function league_news.deliver(p_key text) returns jsonb language plpgsql set search_path='' as $$
declare r league_news.items;
begin
 perform 1 from league_news.control for update;
 select * into r from league_news.items where key=p_key for update;
 if r.key is null then raise exception 'Unknown news';end if;
 if r.suppressed or (select mode from league_news.control)='manual' then return jsonb_build_object('outcome','ready','key',p_key);end if;
 if r.outcome='published' then return jsonb_build_object('outcome','unchanged','key',p_key);end if;
 insert into public.news_public(key,payload) values(p_key,r.payload) on conflict(key) do update set payload=excluded.payload,updated_at=now();
 update league_news.items set outcome='published' where key=p_key;
 return jsonb_build_object('outcome','published','key',p_key);
end;$$;
create function league_news.finish_run(p_key text,p_checks jsonb) returns jsonb language plpgsql set search_path='' as $$
begin
 if jsonb_typeof(p_checks) is distinct from 'array' or jsonb_array_length(p_checks)<>3 or (select count(distinct value->>'id') from jsonb_array_elements(p_checks) where value->>'id' in('futbolfantasy','jornadaperfecta','comuniate'))<>3 then raise exception 'Three coverage states required';end if;
 if exists(select 1 from jsonb_array_elements(p_checks) x where coalesce(x->>'status','') not in('read','unavailable') or not league_news.valid_url(x->>'url') or x->>'fetched_at' is null or (x->>'fetched_at')::timestamptz not between now()-interval '2 hours' and now()+interval '5 minutes') then raise exception 'Invalid coverage';end if;
 update league_news.runs set finished_at=now(),checks=p_checks where key=p_key and finished_at is null;
 if not found then return jsonb_build_object('outcome','unchanged');end if;
 update public.news_status set checked_at=now(),coverage=p_checks,result=case when exists(select 1 from jsonb_array_elements(p_checks) x where x->>'status'='unavailable') then 'partial' else 'checked' end;
 return jsonb_build_object('outcome','finished');
end;$$;

create function private.news_admin(p_action text default 'read',p_key text default null,p_version bigint default null,p_request uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare c league_news.control; result jsonb; req jsonb; previous league_news.commands;
begin
 if (select auth.uid()) is null or not coalesce(private.is_league_admin(),false) then raise exception 'Administrator access required' using errcode='42501';end if;
 select * into c from league_news.control for update;
 req:=jsonb_build_object('actor',(select auth.uid()),'action',p_action,'key',p_key,'version',p_version);
 if p_action<>'read' then
  if p_request is null then raise exception 'Request ID required';end if;
  select * into previous from league_news.commands where id=p_request;
  if found then if previous.request<>req then raise exception 'Request conflict';end if;return previous.result;end if;
  if p_version is distinct from c.version then raise exception 'Refresh news state' using errcode='40001';end if;
  if p_action in('automatic','manual') then update league_news.control set mode=p_action;
  elsif p_action='publish' then
   insert into public.news_public(key,payload) select key,payload from league_news.items where outcome='ready' and not suppressed on conflict(key) do update set payload=excluded.payload,updated_at=now();
   update league_news.items set outcome='published' where outcome='ready' and not suppressed;
  elsif p_action in('withdraw','restore') then
   update league_news.items set suppressed=(p_action='withdraw') where key=p_key;
   if not found then raise exception 'Unknown news';end if;
   update public.news_public set visible=(p_action='restore') where key=p_key;
  else raise exception 'Unknown news action';end if;
  update league_news.control set version=version+1;
 end if;
 result:=jsonb_build_object('mode',(select mode from league_news.control),'version',(select version from league_news.control),'items',coalesce((select jsonb_agg(jsonb_build_object('key',key,'title',payload->>'title','outcome',outcome,'suppressed',suppressed)) from (select * from league_news.items order by checked_at desc limit 100) q),'[]'));
 if p_action<>'read' then insert into league_news.commands values(p_request,result,req);end if;
 return result;
end;$$;
create function public.news_admin(p_action text default 'read',p_key text default null,p_version bigint default null,p_request uuid default null) returns jsonb language sql security invoker set search_path='' as $$select private.news_admin(p_action,p_key,p_version,p_request);$$;
revoke all on all functions in schema league_news from public,anon,authenticated,service_role;
revoke all on function private.news_admin(text,text,bigint,uuid),public.news_admin(text,text,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function private.news_admin(text,text,bigint,uuid),public.news_admin(text,text,bigint,uuid) to authenticated;
