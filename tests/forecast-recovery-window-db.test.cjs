'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=f=>fs.readFileSync(path.join(__dirname,'../docs/forecast-publish',f),'utf8');
const migration=read('recovery-window.sql');
const source='season-20261113-0600',request='36edfef2-bb7e-4d17-9b32-a37cf63caf19';
const reason='Recover incomplete clubs with newly read evidence.';
async function setup(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema forecast_league;create schema forecast_season;
 create table forecast_league.teams(team text primary key,source_urls jsonb);
 create table forecast_season.control(singleton boolean primary key,mode text,version bigint);
 create table forecast_season.runs(key text primary key,slot_at timestamptz unique,started_at timestamptz default now(),finished_at timestamptz,expected jsonb);
 create table forecast_season.fixtures(key text primary key,season text,matchday int,home text,away text,kickoff_at timestamptz,source_urls jsonb,checks jsonb,verified_at timestamptz);
 create table forecast_season.drafts(team text primary key,paused boolean default false,run_key text,fixture_key text,payload jsonb,projection jsonb,checked_at timestamptz,outcome text,reason text);
 create table forecast_season.attempts(key text primary key,run_key text,team text,fixture_key text,checked_at timestamptz default now(),input_hash text,outcome text,reason text,published_at timestamptz,unique(run_key,team));
 create table forecast_season.commands(request_id uuid primary key,request jsonb,result jsonb,created_at timestamptz default now());
 create table public.forecast_season_public(team text primary key,payload jsonb,published_at timestamptz,checked_at timestamptz,status text,attempted_fixture_key text);
 insert into forecast_season.control values(true,'automatic',200);
 insert into forecast_league.teams values('a','{}'),('b','{}'),('c','{}');
 insert into forecast_season.drafts(team,outcome) values('a','pending'),('b','pending'),('c','pending');
 insert into public.forecast_season_public(team,payload,status) values('a','{"old":true}','published'),('b','{"old":true}','blocked'),('c','{"old":true}','blocked');
 create function forecast_season.publish_team(text,interval) returns jsonb language sql as $$select jsonb_build_object('outcome','published')$$;
 create function forecast_season.build_team(p jsonb) returns jsonb language sql as $$select jsonb_build_object('evidence_at',p->>'evidence_at')$$;`);
 const season=read('season.sql');
 for(const name of ['begin_run','register_fixture','save_draft','deliver','finish_run']){
  const f=season.match(new RegExp('create function forecast_season\\.'+name+'\\([\\s\\S]*?\\$body\\$;'))[0];await db.exec(f);
 }
 await db.exec(read('health-and-two-daily.sql').match(/execute \$after\$(CREATE OR REPLACE FUNCTION forecast_season\.plan\(\)[\s\S]*?)\$after\$;/)[1]);
 await db.exec(read('predicted11-v3.sql').match(/CREATE OR REPLACE FUNCTION forecast_season\.check_attempt\([\s\S]*?\$function\$;/)[0]);
 await db.query('insert into forecast_season.runs(key,slot_at,expected) values($1,now()-interval \'4 hours\',$2)',[source,JSON.stringify(['a','b','c'])]);
 await db.query("insert into forecast_season.attempts(key,run_key,team,outcome,input_hash) values($1,$2,'a','published','old')",[source+'-a',source]);
 await db.exec(migration);
 return db;
}
const value=async(db,sql,args=[])=>(await db.query(sql,args)).rows[0].result;
const begin=(db,teams=['b','c'],automatic=false,id=request)=>value(db,'select forecast_season.begin_recovery($1,$2,$3,$4,$5) result',[id,source,JSON.stringify(teams),reason,automatic]);
const context=(db,id=request)=>db.query("select set_config('forecast_season.recovery_request',$1,true)",[id]);
test('recovery keeps schedule, public data and original attempts unchanged; private ACLs remain closed',async()=>{
 const db=await setup();try{
 const before=(await db.query('select * from public.forecast_season_public order by team')).rows;
 const scheduled=await value(db,'select forecast_season.plan_scheduled() result');
 await db.exec('begin');const p=await begin(db,['a','b','c']);
 assert.equal(p.teams.length,3);assert.equal(p.existing_attempts.length,0);assert.equal(p.mode,'automatic');
 assert.equal(await value(db,"select forecast_season.check_attempt($1,'b') result",[p.run_key]),p.run_key+'-b');
 assert.deepEqual(await begin(db,['c','b','a']),p);
 await assert.rejects(begin(db,['b','c']),e=>e.code==='23505');await db.exec('rollback');
 // Retry in a clean transaction and commit to inspect isolation after context reset.
 await db.exec('begin');const saved=await begin(db);await db.exec('commit');
 assert.equal(await value(db,'select forecast_season.plan()=forecast_season.plan_scheduled() result'),true);
 assert.equal(scheduled.run_key,(await value(db,'select forecast_season.plan() result')).run_key);
 await assert.rejects(value(db,"select forecast_season.check_attempt($1,'b') result",[saved.run_key]),e=>e.code==='22023');
 assert.deepEqual((await db.query('select * from public.forecast_season_public order by team')).rows,before);
 assert.equal((await db.query('select count(*) n from forecast_season.attempts')).rows[0].n,1);
 assert.equal((await db.query("select count(*) n from forecast_season.commands where request->>'action'='begin_recovery'")).rows[0].n,1);
 const acl=(await db.query("select has_table_privilege('anon','forecast_season.recovery_requests','SELECT') table_read,has_function_privilege('anon','forecast_season.begin_recovery(uuid,text,jsonb,text,boolean)','EXECUTE') call,relrowsecurity from pg_class where oid='forecast_season.recovery_requests'::regclass")).rows[0];
 assert.deepEqual(acl,{table_read:false,call:false,relrowsecurity:true});
 }finally{await db.close();}
});
test('scope, invalid request, stale source, automatic correction and expired recovery are rejected',async()=>{
 const db=await setup();try{
 for(const teams of [[],['b','b'],['unknown'],[null]])await assert.rejects(begin(db,teams),e=>e.code==='22023');
 await assert.rejects(begin(db,['a','b','c'],true),e=>e.code==='22023');
 await db.exec('begin');const p=await begin(db,['b','c'],true);await db.exec('commit');
 await db.query("update forecast_season.recovery_requests set created_at=now()-interval '3 hours',expires_at=now()-interval '1 hour' where request_id=$1",[request]);
 await db.exec('begin');await context(db);await assert.rejects(value(db,'select forecast_season.plan() result'),e=>e.code==='22023');await db.exec('rollback');
 await db.query("update forecast_season.runs set slot_at=now()-interval '25 hours' where key=$1",[source]);
 await assert.rejects(begin(db),e=>e.code==='22023');
 assert.ok(p.run_key.startsWith('season-recovery-'));
 }finally{await db.close();}
});
test('missing teams keep run open, terminal blocks are not successful publication, lineage prevents repeats',async()=>{
 const db=await setup();try{
 assert.deepEqual(await value(db,'select forecast_season.recovery_pending($1) result',[source]),['b','c']);
 let result=await value(db,'select forecast_season.finish_run($1) result',[source]);
 assert.equal(result.complete,false);assert.equal(result.missing,2);assert.equal(result.publication_complete,false);
 assert.equal((await db.query('select finished_at from forecast_season.runs where key=$1',[source])).rows[0].finished_at,null);
 const p=await begin(db,['b','c']);
 await db.query("insert into forecast_season.attempts(key,run_key,team,outcome,input_hash) values($1,$2,'b','published','new'),($3,$2,'c','blocked','new')",[p.run_key+'-b',p.run_key,p.run_key+'-c']);
 result=await value(db,'select forecast_season.finish_run($1) result',[p.run_key]);
 assert.equal(result.complete,true);assert.equal(result.publication_complete,false);assert.equal(result.blocked,1);
 assert.deepEqual(await value(db,'select forecast_season.recovery_pending($1) result',[source]),[]);
 assert.ok((await db.query('select closed_at from forecast_season.recovery_requests where request_id=$1',[request])).rows[0].closed_at);
 }finally{await db.close();}
});
test('manual mode and paused teams stay ready; delivery requires active recovery context',async()=>{
 const db=await setup();try{
 const p=await begin(db);
 for(const team of ['b','c']){
  await db.query("insert into forecast_season.attempts(key,run_key,team,outcome,input_hash) values($1,$2,$3,'saved','new')",[p.run_key+'-'+team,p.run_key,team]);
  await db.query("update forecast_season.drafts set run_key=$1,outcome='saved',paused=$2 where team=$3",[p.run_key+'-'+team,team==='c',team]);
 }
 await assert.rejects(value(db,'select forecast_season.deliver($1) result',[p.run_key+'-b']),e=>e.code==='22023');
 await db.exec('begin');await context(db);await db.exec("update forecast_season.control set mode='manual'");
 assert.equal((await value(db,'select forecast_season.deliver($1) result',[p.run_key+'-b'])).outcome,'ready');
 await db.exec("update forecast_season.control set mode='automatic'");
 assert.equal((await value(db,'select forecast_season.deliver($1) result',[p.run_key+'-c'])).outcome,'ready');
 await db.exec('commit');
 assert.equal((await db.query("select status from public.forecast_season_public where team='c'")).rows[0].status,'withdrawn');
 }finally{await db.close();}
});
test('hourly resume reuses its active request, skips manual recovery, and stops after terminal results',async()=>{
 const db=await setup();try{
 // Replace only the preserved schedule in this isolated test, to model a closed window.
 await db.exec("create or replace function forecast_season.plan_scheduled() returns jsonb language sql stable as $$select '{\"run_key\":null,\"slot\":null}'::jsonb$$");
 const p=await value(db,'select forecast_season.resume_incomplete() result');
 assert.deepEqual(p.teams.map(x=>x.team),['b','c']);
 const resumed=await value(db,'select forecast_season.resume_incomplete() result');assert.equal(resumed.run_key,p.run_key);
 await db.query("update forecast_season.recovery_requests set automatic=false where run_key=$1",[p.run_key]);
 assert.equal((await value(db,'select forecast_season.resume_incomplete() result')).outcome,'recovery_in_progress');
 await db.query("insert into forecast_season.attempts(key,run_key,team,outcome,input_hash) values($1,$2,'b','published','new'),($3,$2,'c','ready','new')",[p.run_key+'-b',p.run_key,p.run_key+'-c']);
 assert.equal((await value(db,'select forecast_season.resume_incomplete() result')).outcome,'complete');
 }finally{await db.close();}
});
test('saved attempts require delivery instead of replacement, and recovery audit retains previous payloads',async()=>{
 const db=await setup();try{
 await db.exec("create or replace function forecast_season.plan_scheduled() returns jsonb language sql stable as $$select '{\"run_key\":null,\"slot\":null}'::jsonb$$");
 await db.query("insert into forecast_season.attempts(key,run_key,team,outcome,input_hash) values($1,$2,'b','saved','keep')",[source+'-b',source]);
 await db.query("update forecast_season.drafts set run_key=$1,projection=jsonb_build_object('evidence_at',now()) where team='b'",[source+'-b']);
 const result=await value(db,'select forecast_season.resume_incomplete() result');
 assert.equal(result.outcome,'awaiting_delivery');assert.equal(result.saved_attempts[0].key,source+'-b');
 await assert.rejects(begin(db,['b','c'],true),e=>e.code==='40001');
 await begin(db,['a','b']);
 const audit=(await db.query('select result from forecast_season.commands where request_id=$1',[request])).rows[0].result;
 assert.equal(audit.previous_drafts.length,2);assert.equal(audit.previous_public.length,2);
 assert.ok(audit.previous_public.every(p=>p.payload.old));
 }finally{await db.close();}
});
test('expired saved recovery stays audited and permits a fresh automatic continuation',async()=>{
 const db=await setup();try{
 await db.exec("create or replace function forecast_season.plan_scheduled() returns jsonb language sql stable as $$select '{\"run_key\":null,\"slot\":null}'::jsonb$$");
 const p=await value(db,'select forecast_season.resume_incomplete() result');
 await db.query("insert into forecast_season.attempts(key,run_key,team,outcome,input_hash) values($1,$2,'b','saved','original')",[p.run_key+'-b',p.run_key]);
 await db.query("update forecast_season.drafts set run_key=$1,projection=jsonb_build_object('evidence_at',now()) where team='b'",[p.run_key+'-b']);
 assert.equal((await value(db,'select forecast_season.resume_incomplete() result')).outcome,'awaiting_delivery');
 await db.query("update forecast_season.recovery_requests set created_at=now()-interval '3 hours',expires_at=now()-interval '1 hour' where run_key=$1",[p.run_key]);
 const next=await value(db,'select forecast_season.resume_incomplete() result');
 assert.notEqual(next.run_key,p.run_key);assert.deepEqual(next.teams.map(x=>x.team),['b','c']);
 assert.equal((await db.query('select input_hash from forecast_season.attempts where key=$1',[p.run_key+'-b'])).rows[0].input_hash,'original');
 assert.equal((await db.query('select count(*) n from forecast_season.commands')).rows[0].n,2);
 }finally{await db.close();}
});
test('active recovery with stale saved evidence opens a new request without altering original attempt',async()=>{
 const db=await setup();try{
 await db.exec("create or replace function forecast_season.plan_scheduled() returns jsonb language sql stable as $$select '{\"run_key\":null,\"slot\":null}'::jsonb$$");
 const p=await value(db,'select forecast_season.resume_incomplete() result');
 await db.query("insert into forecast_season.attempts(key,run_key,team,outcome,input_hash) values($1,$2,'b','saved','stale-original')",[p.run_key+'-b',p.run_key]);
 await db.query("update forecast_season.drafts set run_key=$1,projection=jsonb_build_object('evidence_at',now()-interval '3 hours') where team='b'",[p.run_key+'-b']);
 const next=await value(db,'select forecast_season.resume_incomplete() result');
 assert.notEqual(next.run_key,p.run_key);
 assert.ok((await db.query('select closed_at from forecast_season.recovery_requests where run_key=$1',[p.run_key])).rows[0].closed_at);
 assert.equal((await db.query('select input_hash from forecast_season.attempts where key=$1',[p.run_key+'-b'])).rows[0].input_hash,'stale-original');
 }finally{await db.close();}
});
test('active automatic recovery superseded before save restarts and preserves the newer publication',async()=>{
 const db=await setup();try{
 await db.exec("create or replace function forecast_season.plan_scheduled() returns jsonb language sql stable as $$select '{\"run_key\":null,\"slot\":null}'::jsonb$$");
 const p=await value(db,'select forecast_season.resume_incomplete() result');
 await db.query("update public.forecast_season_public set payload='{\"newer\":true}',published_at=now() where team='b'");
 const next=await value(db,'select forecast_season.resume_incomplete() result');
 assert.notEqual(next.run_key,p.run_key);
 assert.deepEqual((await db.query("select payload from public.forecast_season_public where team='b'")).rows[0].payload,{newer:true});
 assert.ok((await db.query('select closed_at from forecast_season.recovery_requests where run_key=$1',[p.run_key])).rows[0].closed_at);
 }finally{await db.close();}
});
test('newer draft/public work and newer evidence cannot be overwritten by recovery',async()=>{
 const db=await setup();try{
 const p=await begin(db,['b','c']);
 const now=(await db.query('select now() at')).rows[0].at;
 await db.query("insert into forecast_season.fixtures(key,home,away,kickoff_at,verified_at) values('fixture','b','c',now()+interval '1 day',now())");
 const payload={team:'b',status:'draft',fixture_key:'fixture',kickoff_at:new Date(+now+86400000).toISOString(),evidence_at:new Date(+now-600000).toISOString()};
 await db.query("update forecast_season.drafts set run_key='newer-b',checked_at=now()+interval '1 second' where team='b'");
 await db.exec('begin');await context(db);
 await assert.rejects(value(db,'select forecast_season.save_draft($1,$2) result',[p.run_key,JSON.stringify(payload)]),e=>e.code==='40001');await db.exec('rollback');
 await db.query("update forecast_season.drafts set checked_at=null,projection=jsonb_build_object('evidence_at',now()) where team='b'");
 await db.exec('begin');await context(db);
 await assert.rejects(value(db,'select forecast_season.save_draft($1,$2) result',[p.run_key,JSON.stringify(payload)]),e=>e.code==='40001');await db.exec('rollback');
 await db.query("update forecast_season.drafts set projection=null where team='b'");
 await db.query("update public.forecast_season_public set payload=jsonb_build_object('evidence_at',now()) where team='b'");
 await db.exec('begin');await context(db);
 await assert.rejects(value(db,'select forecast_season.save_draft($1,$2) result',[p.run_key,JSON.stringify(payload)]),e=>e.code==='40001');await db.exec('rollback');
 await db.query("update public.forecast_season_public set payload='{}',published_at=now()+interval '1 second' where team='b'");
 await db.exec('begin');await context(db);
 await assert.rejects(value(db,"select forecast_season.check_attempt($1,'b') result",[p.run_key]),e=>e.code==='40001');await db.exec('rollback');
 await db.query("insert into forecast_season.runs(key,slot_at,expected) values('season-20261113-1400',now()+interval '1 second','[\"b\"]')");
 await db.exec("create or replace function forecast_season.plan_scheduled() returns jsonb language sql stable as $$select '{\"run_key\":\"season-20261113-1400\"}'::jsonb$$");
 await db.query("update public.forecast_season_public set payload=jsonb_build_object('evidence_at',now()) where team='b'");
 await assert.rejects(value(db,'select forecast_season.save_draft($1,$2) result',['season-20261113-1400',JSON.stringify(payload)]),e=>e.code==='40001');
 assert.equal((await db.query('select count(*) n from forecast_season.attempts')).rows[0].n,1);
 }finally{await db.close();}
});
