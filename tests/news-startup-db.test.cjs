'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const migration='supabase/migrations/20261117213744_news_startup_1600.sql';
test('news initializes empty plans before deciding work and moves only the afternoon window',async t=>{
 const db=new PGlite(),q=async(s,a=[])=>(await db.query(s,a)).rows[0];
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;create schema forecast_league;
   create function auth.uid() returns uuid language sql as $$select null::uuid$$;
   create function private.is_league_admin() returns boolean language sql as $$select false$$;
   create table forecast_league.teams(team text primary key);
   create table forecast_league.roster(id text primary key,team text,name text);
   insert into forecast_league.teams select 'club-'||n from generate_series(1,20)n;`);
  await db.exec(read('docs/news/migration.sql'));await db.exec(read('docs/news/coverage.sql'));await db.exec(read('docs/news/schedule-1500.sql'));
  await db.exec("insert into league_news.runs(key,contract_version,finished_at) values('news-20261116-15',2,now());");
  const before=(await db.query('select * from league_news.runs')).rows;
  const oldAcl=await q("select oid,proacl::text,prosecdef from pg_proc where oid='league_news.slot_at(timestamptz)'::regprocedure");
  await db.exec(read(migration));
  const sub=(name,fn)=>t.test(name,async()=>{await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}});
  const clock=key=>db.exec(`create or replace function league_news.slot_at(p_at timestamptz) returns text language sql stable as $$select ${key===null?'null':"'"+key+"'"}::text$$;`);
  const prepare=async()=>(await q('select league_news.prepare_run() p')).p;
  await sub('installation preserves stored runs and function privileges',async()=>{
   assert.deepEqual((await db.query('select * from league_news.runs')).rows,before);
   assert.deepEqual(await q("select oid,proacl::text,prosecdef from pg_proc where oid='league_news.slot_at(timestamptz)'::regprocedure"),oldAcl);
   assert.deepEqual(await q("select prosecdef,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') authenticated,has_function_privilege('service_role',oid,'execute') service_role from pg_proc where oid='league_news.prepare_run()'::regprocedure"),{prosecdef:false,anon:false,authenticated:false,service_role:false});
  });
  await sub('08/11/16 Miami boundaries and daylight saving time are exact',async()=>{
   for(const [instant,expected] of [['2026-11-17T12:59:59Z',null],['2026-11-17T13:00Z','08'],['2026-11-17T14:59:59Z','08'],['2026-11-17T15:00Z',null],['2026-11-17T16:00Z','11'],['2026-11-17T17:59:59Z','11'],['2026-11-17T18:00Z',null],['2026-11-17T20:00Z',null],['2026-11-17T20:59:59Z',null],['2026-11-17T21:00Z','16'],['2026-11-17T22:59:59Z','16'],['2026-11-17T23:00Z',null]])assert.equal((await q('select league_news.slot_at($1) k',[instant])).k,expected&&'news-20261117-'+expected,instant);
   assert.equal((await q("select league_news.slot_at('2027-03-14T19:59:59Z') k")).k,null);
   assert.equal((await q("select league_news.slot_at('2027-03-14T20:00:00Z') k")).k,'news-20270314-16');
   assert.equal((await q("select league_news.slot_at('2027-07-01T20:00:00Z') k")).k,null);
  });
  await sub('a new run with zero teams becomes twenty pending clubs, without publishing',async()=>{
   await clock('news-20261117-16');const pre=(await q('select league_news.plan() p')).p;
   assert.equal(pre.completed,false);assert.deepEqual(pre.teams,[]);
   const p=await prepare();assert.equal(p.has_work,true);assert.equal(p.action,'review');assert.equal(p.teams.length,20);assert.equal(p.progress.teams_reviewed,0);assert.equal(p.progress.publication_complete,false);assert.equal('recent' in p,false);
   assert.equal((await q('select count(*)::int n from public.news_public')).n,0);
   const again=await prepare();assert.equal(again.run_key,p.run_key);assert.equal(again.progress.started_at,p.progress.started_at);assert.equal(again.teams.length,20);
  });
  await sub('completed turns are not reopened and no-slot plans remain idle',async()=>{
   await clock('news-20261116-15');assert.equal((await prepare()).action,'completed');
   await clock(null);const p=await prepare();assert.equal(p.has_work,false);assert.equal(p.action,'not_due');assert.equal((await q('select count(*)::int n from league_news.runs')).n,1);
  });
  await sub('old pending 15:00 runs remain resumable outside a new window',async()=>{
   await clock('news-20261117-15');const p=await prepare();await clock(null);
   const resumed=await prepare();assert.equal(resumed.run_key,p.run_key);assert.equal(resumed.has_work,true);assert.equal(resumed.teams.length,20);
  });
  await sub('manual mode is preserved and initialization does not deliver',async()=>{
   await clock('news-20261117-16');await db.exec("update league_news.control set mode='manual'");
   const p=await prepare();assert.equal(p.mode,'manual');assert.equal(p.action,'review');assert.equal((await q('select count(*)::int n from public.news_public')).n,0);
  });
  await sub('a broken team registry is an error, never a false no-work result',async()=>{
   await clock('news-20261117-16');await db.exec("delete from forecast_league.teams where team='club-20'");
   await assert.rejects(prepare,/complete authorized club set/);
  });
 }finally{await db.close();}
});
