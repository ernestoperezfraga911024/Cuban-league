'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const clubs=['real-madrid',...Array.from({length:19},(_,i)=>'club-'+String(i).padStart(2,'0'))];
const checks=()=>['futbolfantasy','jornadaperfecta','comuniate'].map(id=>({id,url:'https://www.'+id+'.com/',status:'read',fetched_at:new Date().toISOString()}));
const article=(key='current-news-event',title='A verified current training update')=>({key,season:'2026-27',team:'real-madrid',category:'training',certainty:'reported',title,summary:'Original verified information about the current training session.',impact:'The available information supports following the next training session.',players:[{id:'test-player',name:'Local player'}],sources:[{name:'FutbolFantasy',kind:'media',url:'https://www.futbolfantasy.com/laliga/noticias/'+key,fetched_at:new Date().toISOString(),published_at:null,published_label:'Fecha original de la noticia de prueba'}]});
test('News coverage: audited 20-club runs, real publication, resumption and permissions',async t=>{
 const db=new PGlite();
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 const exec=sql=>db.exec(sql);
 const rejected=async fn=>{await exec('savepoint invalid_case');try{await assert.rejects(fn);}finally{await exec('rollback to savepoint invalid_case;release savepoint invalid_case');}};
 const sub=async(name,fn)=>t.test(name,async()=>{await exec('begin');try{await fn();}finally{await exec('rollback');}});
 const start=async()=>((await q("select league_news.begin_exception('An authorized local test of news coverage') as p")).p.run_key);
 const progress=async k=>(await q('select league_news.progress($1) as p',[k])).p;
 const save=(k,p)=>q('select league_news.save_draft($1,$2::jsonb) as r',[k,JSON.stringify(p)]);
 const deliver=key=>q('select league_news.deliver($1) as r',[key]);
 const event=(k,p)=>q('select league_news.record_event($1,$2::jsonb) as r',[k,JSON.stringify(p)]);
 const team=(k,id,c=checks())=>q('select league_news.record_team($1,$2::jsonb) as r',[k,JSON.stringify({team:id,checks:c,note:'Club checked across the three current source indexes.'})]);
 const allTeams=async k=>{for(const id of clubs)await team(k,id);};
 const finish=(k,c=checks())=>q('select league_news.finish_run($1,$2::jsonb) as r',[k,JSON.stringify(c)]);
 const audit=(key,status='pending',rest={})=>({key,team:'real-madrid',status,urls:['https://www.futbolfantasy.com/laliga/noticias/'+key],fetched_at:new Date().toISOString(),reason:'Article awaiting a verified editorial decision.',...rest});
 try{
  await exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;create schema forecast_league;
   create function auth.uid() returns uuid language sql as $$select null::uuid$$;
   create function private.is_league_admin() returns boolean language sql as $$select false$$;
   create table forecast_league.teams(team text primary key);
   create table forecast_league.roster(id text primary key,team text,name text);
   insert into forecast_league.roster values('test-player','real-madrid','Local player');`);
  for(const id of clubs)await q('insert into forecast_league.teams values($1)',[id]);
  await exec(read('docs/news/migration.sql'));
  await exec("insert into league_news.runs(key) values('legacy-fixture')");
  await save('legacy-fixture',article('legacy-news-event'));
  await deliver('legacy-news-event');await finish('legacy-fixture');
  const before={news:(await db.query('select * from public.news_public order by key')).rows,items:(await db.query('select * from league_news.items order by key')).rows,runs:(await db.query('select * from league_news.runs order by key')).rows,
   functions:(await db.query("select oid,proname,prosecdef,proacl::text,proconfig from pg_proc where pronamespace='league_news'::regnamespace order by proname")).rows};
  await exec(read('docs/news/coverage.sql'));

  await sub('migration preserves existing news, completed runs, original function identity and privileges',async()=>{
   assert.deepEqual((await db.query('select * from public.news_public order by key')).rows,before.news);
   assert.deepEqual((await db.query('select * from league_news.items order by key')).rows,before.items);
   assert.deepEqual((await db.query('select key,started_at,finished_at,checks from league_news.runs order by key')).rows,before.runs);
   assert.deepEqual((await db.query("select oid,proname,prosecdef,proacl::text,proconfig from pg_proc where pronamespace='league_news'::regnamespace and proname=any($1::text[]) order by proname",[before.functions.map(x=>x.proname)])).rows,before.functions);
   const permissions=(await db.query("select proname,prosecdef,proacl::text from pg_proc where pronamespace='league_news'::regnamespace")).rows;
   assert.ok(permissions.every(x=>!x.prosecdef&&x.proacl==='{postgres=X/postgres}'));
   assert.ok((await db.query("select relrowsecurity from pg_class where oid in ('league_news.run_events'::regclass,'league_news.run_teams'::regclass)")).rows.every(x=>x.relrowsecurity));
   await rejected(()=>exec(read('docs/news/coverage.sql')));
  });
  await sub('08/11/14 Miami slots handle standard and daylight time with exact two-hour windows',async()=>{
   for(const [time,expected]of [['2026-11-13T13:00:00Z','news-20261113-08'],['2026-11-13T15:00:00Z',null],['2026-11-13T16:00:00Z','news-20261113-11'],['2026-11-13T17:59:59Z','news-20261113-11'],['2026-11-13T18:00:00Z',null],['2026-11-13T19:00:00Z','news-20261113-14'],['2027-06-01T15:00:00Z','news-20270601-11'],['2027-07-01T15:00:00Z',null]])assert.equal((await q('select league_news.slot_at($1::timestamptz) as k',[time])).k,expected,time);
  });
  await sub('an exception is auditable and resumable; reading three indexes alone cannot complete it',async()=>{
   const k=await start();assert.ok(k.startsWith('news-'));
   assert.equal((await progress(k)).teams_expected,20);
   assert.equal((await q('select result from public.news_status')).result,'partial');
   assert.equal((await finish(k)).r.outcome,'incomplete');
   assert.equal((await q('select finished_at from league_news.runs where key=$1',[k])).finished_at,null);
   assert.equal((await q('select league_news.plan() as p')).p.run_key,k);
   assert.equal(await start(),k,'repeated exception reuses the active run');
   assert.equal((await q('select league_news.begin_run($1) as r',[k])).r.key,k);
   await rejected(()=>q("select league_news.begin_run('made-up-news-run')"));
   await rejected(()=>q("select league_news.begin_exception('')"));
  });
  await sub('all 20 club checks are mandatory, duplicate checks are idempotent and partial coverage remains honest',async()=>{
   const k=await start();for(const id of clubs.slice(0,19))await team(k,id);
   await team(k,clubs[0]);assert.equal((await progress(k)).teams_reviewed,19);
   assert.equal((await finish(k)).r.outcome,'incomplete');
   const c=checks();c[2].status='unavailable';await team(k,clubs[19],c);
   const result=(await finish(k)).r;assert.equal(result.outcome,'finished');assert.equal(result.coverage_complete,false);assert.equal(result.progress.status,'partial');assert.equal(result.progress.teams_reviewed,19);assert.equal(result.progress.teams_partial,1);
   assert.equal((await q('select result from public.news_status')).result,'partial');
   assert.equal((await finish(k)).r.outcome,'unchanged');await rejected(()=>team(k,clubs[0]));
  });
  await sub('pending and failed articles prevent completion and cannot masquerade as publication',async()=>{
   const k=await start();await allTeams(k);await event(k,audit('pending-test-article'));
   assert.equal((await finish(k)).r.outcome,'incomplete');
   await event(k,audit('pending-test-article','failed',{reason:'The article body could not be read on this attempt.'}));
   assert.equal((await progress(k)).pending,1);assert.equal((await finish(k)).r.outcome,'incomplete');
   await rejected(()=>event(k,audit('pending-test-article','published')));
   await event(k,audit('pending-test-article','omitted',{reason:'An unrelated competition; no relevant facts for these clubs.'}));
   const r=(await finish(k)).r;assert.equal(r.outcome,'finished');assert.equal(r.progress.omitted,1);assert.equal(r.progress.new,0);
  });
  await sub('save and deliver automatically audit every publication and retries keep counts stable',async()=>{
   const k=await start();await allTeams(k);
   for(let i=0;i<4;i++){const p=article('new-event-'+i);assert.equal((await save(k,p)).r.outcome,'saved');assert.equal((await progress(k)).pending,1);assert.equal((await deliver(p.key)).r.outcome,'published');}
   let p=await progress(k);assert.equal(p.new,4);assert.equal(p.pending,0);assert.equal(p.teams_reviewed,20);
   assert.equal((await save(k,article('new-event-0'))).r.outcome,'unchanged');assert.equal((await deliver('new-event-0')).r.outcome,'unchanged');assert.equal((await progress(k)).new,4);
   const r=(await finish(k)).r;assert.equal(r.progress.status,'complete');assert.equal(r.progress.publication_complete,true);
   assert.equal((await q('select count(*)::int as n from public.news_public')).n,5);
  });
  await sub('existing event updates are counted separately and do not invent a second event',async()=>{
   const k=await start();await save(k,article('legacy-news-event','Updated verified facts about the same training event'));await deliver('legacy-news-event');
   assert.equal((await progress(k)).updated,1);assert.equal((await progress(k)).new,0);
   await save(k,article('another-new-event'));await deliver('another-new-event');
   assert.equal((await progress(k)).new,1);assert.equal((await q("select version from league_news.items where key='legacy-news-event'")).version,2);
  });
  await sub('unchanged evidence is counted as unchanged and a duplicate keeps its verified event link',async()=>{
   const k=await start();assert.equal((await save(k,article('legacy-news-event'))).r.outcome,'unchanged');assert.equal((await progress(k)).unchanged,1);
   const duplicate=audit('omitted-duplicate-article','omitted',{duplicate_of:'legacy-news-event',reason:'Same event already evaluated under the linked stable news key.'});await event(k,duplicate);await event(k,duplicate);
   const e=await q("select * from league_news.run_events where run_key=$1 and key='omitted-duplicate-article'",[k]);assert.equal(e.duplicate_of,'legacy-news-event');assert.equal((await progress(k)).omitted,1);
   await rejected(()=>event(k,{...duplicate,key:'invalid-duplicate-article',duplicate_of:'unverified-key'}));
   await rejected(()=>event(k,{...duplicate,key:'legacy-news-event',duplicate_of:'legacy-news-event'}));
  });
  await sub('Manual and withdrawn items remain private and are never counted as published',async()=>{
   const k=await start();await allTeams(k);await exec("update league_news.control set mode='manual'");
   await save(k,article('manual-news-event'));assert.equal((await deliver('manual-news-event')).r.outcome,'ready');
   assert.equal((await progress(k)).ready,1);assert.equal((await progress(k)).new,0);
   assert.equal((await q("select count(*)::int as n from public.news_public where key='manual-news-event'")).n,0);
   await exec("update league_news.control set mode='automatic';update league_news.items set suppressed=true where key='legacy-news-event';update public.news_public set visible=false where key='legacy-news-event'");
   await save(k,article('legacy-news-event','A newer observation for a withdrawn news item'));assert.equal((await deliver('legacy-news-event')).r.outcome,'ready');
   assert.equal((await q("select visible from public.news_public where key='legacy-news-event'")).visible,false);
   // The previous Manual item becomes pending when Automatic is restored: finish re-verifies it.
   assert.equal((await finish(k)).r.outcome,'incomplete');await deliver('manual-news-event');
   const r=(await finish(k)).r;assert.equal(r.outcome,'finished');assert.equal(r.progress.ready,1);assert.equal(r.progress.publication_complete,false);
  });
  await sub('finish re-verifies payload equality, so a missing or changed public row remains pending',async()=>{
   const k=await start();await allTeams(k);const p=article();await save(k,p);await deliver(p.key);
   await q("update public.news_public set payload=jsonb_set(payload,'{title}','\"Different public content\"') where key=$1",[p.key]);
   assert.equal((await finish(k)).r.outcome,'incomplete');assert.equal((await progress(k)).pending,1);
  });
  await sub('invalid source checks, old evidence, unsafe URLs and foreign clubs fail closed',async()=>{
   const k=await start();
   for(const mutate of [c=>c.pop(),c=>c[2].id='futbolfantasy',c=>c[1].url='https://www.comuniate.com/',c=>c[0].fetched_at='2000-01-01T00:00:00Z']){const c=checks();mutate(c);await rejected(()=>team(k,'real-madrid',c));}
   for(const mutate of [p=>p.team='foreign-club',p=>p.urls=['https://evil.example/article'],p=>p.fetched_at='2000-01-01T00:00:00Z',p=>p.reason='']){const p=audit('invalid-news-event');mutate(p);await rejected(()=>event(k,p));}
   await rejected(()=>save(k,{...article(),sources:[{...article().sources[0],fetched_at:'2000-01-01T00:00:00Z'}]}));
   assert.equal((await progress(k)).pending,0);
  });
  await sub('unfinished runs resume after two hours while each article still requires fresh evidence',async()=>{
   const k=await start();await q("update league_news.runs set started_at=now()-interval '3 hours' where key=$1",[k]);
   assert.equal((await q('select league_news.plan() as p')).p.run_key,k);
   assert.equal((await save(k,article())).r.outcome,'saved');
   await rejected(()=>save(k,{...article('stale-resume-event'),sources:[{...article().sources[0],fetched_at:new Date(Date.now()-3*3600000).toISOString()}]}));
  });
  await sub('expired pending work is transferred with original observation dates and cannot disappear',async()=>{
   const k=await start();await event(k,audit('expired-pending-event'));await event(k,audit('expired-failed-event','failed'));
   const old=(await db.query('select key,fetched_at from league_news.run_events where run_key=$1 order by key',[k])).rows;
   await q("update league_news.runs set started_at=now()-interval '25 hours' where key=$1",[k]);
   const plan=(await q('select league_news.plan() as p')).p;assert.notEqual(plan.run_key,k);assert.ok(plan.run_key);
   await q('select league_news.begin_run($1)',[plan.run_key]);
   const carried=(await db.query('select * from league_news.run_events where run_key=$1 order by key',[plan.run_key])).rows;
   assert.equal(carried.length,2);assert.ok(carried.every(x=>x.status==='pending'));assert.deepEqual(carried.map(x=>({key:x.key,fetched_at:x.fetched_at})),old);
   const original=await q('select superseded_by,finished_at from league_news.runs where key=$1',[k]);assert.equal(original.superseded_by,plan.run_key);assert.equal(original.finished_at,null);
   await rejected(()=>save(k,article()));assert.equal((await progress(plan.run_key)).pending,2);
  });
  await sub('a new scheduled turn takes priority over a failed older turn and carries its pending work',async()=>{
   const k=await start();await event(k,audit('older-failed-article','failed'));
   await exec("create or replace function league_news.slot_at(p_at timestamptz) returns text language sql stable set search_path='' as $$select 'news-local-next-slot'::text$$");
   const p=(await q('select league_news.plan() as p')).p;assert.equal(p.run_key,'news-local-next-slot');
   await q('select league_news.begin_run($1)',[p.run_key]);
   assert.equal((await progress(p.run_key)).pending,1);assert.equal((await progress(p.run_key)).teams_reviewed,0);assert.equal((await progress(p.run_key)).teams_expected,20);
   assert.equal((await q('select superseded_by from league_news.runs where key=$1',[k])).superseded_by,p.run_key);
   await rejected(()=>save(k,article('old-run-late-save')));
  });
  await sub('global source failure is partial even when all club records are reviewed',async()=>{
   const k=await start();await allTeams(k);const c=checks();c[1].status='unavailable';const r=(await finish(k,c)).r;
   assert.equal(r.coverage_complete,false);assert.equal(r.progress.status,'partial');
  });
  await sub('anonymous callers only read the public feed and cannot see or modify collection audits',async()=>{
   await exec('set local role anon');assert.equal((await q('select count(*)::int as n from public.news_public')).n,1);
   await rejected(()=>q('select * from league_news.run_events'));await rejected(()=>q("select league_news.begin_exception('An unauthorized exception request')"));await rejected(()=>q('delete from public.news_public'));
   await exec('reset role');
  });
 }finally{await db.close();}
});
