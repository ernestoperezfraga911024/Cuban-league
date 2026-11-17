'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=f=>fs.readFileSync(path.join(__dirname,'../docs/forecast-publish',f),'utf8');
const original=read('recovery-resume-rollback.sql'),migration=read('recovery-resume.sql');
const old='season-20261116-1400',latest='season-20261116-1800';
const signatures=['begin_recovery(uuid,text,jsonb,text,boolean)','recovery_pending(text)','resume_incomplete()'];
async function setup(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema forecast_season;
 create table public.test_clock(at timestamptz);insert into public.test_clock values('2026-11-17T03:00Z');
 create function public.test_now() returns timestamptz language sql stable as $$select at from public.test_clock$$;
 create table forecast_season.control(singleton boolean);insert into forecast_season.control values(true);
 create table forecast_season.runs(key text primary key,slot_at timestamptz,started_at timestamptz default now(),finished_at timestamptz,expected jsonb);
 create table forecast_season.attempts(key text primary key,run_key text,team text,outcome text,checked_at timestamptz);
 create table forecast_season.drafts(team text primary key,run_key text,projection jsonb,checked_at timestamptz);
 create table forecast_season.recovery_requests(request_id uuid primary key,run_key text,source_run_key text,reason text,automatic boolean,created_at timestamptz,expires_at timestamptz,closed_at timestamptz);
 create table forecast_season.commands(request_id uuid primary key,request jsonb,result jsonb);
 create table public.forecast_season_public(team text primary key,payload jsonb,published_at timestamptz);
 alter table public.forecast_season_public enable row level security;
 create table public.test_plan(value jsonb);insert into public.test_plan values('{"run_key":null}');
 create function forecast_season.plan_scheduled() returns jsonb language sql as $$select value from public.test_plan$$;
 create function forecast_season.begin_run() returns jsonb language sql as $$select jsonb_build_object('outcome','started','request_id',request_id,'run_key',run_key,'source',source_run_key,'teams',(select expected from forecast_season.runs where key=q.run_key)) from forecast_season.recovery_requests q where request_id::text=current_setting('forecast_season.recovery_request',true)$$;
 insert into forecast_season.drafts(team) values('a'),('b'),('c');
 insert into public.forecast_season_public values('a','{"method_version":"editorial-v6","players":[{"id":"unchanged"}]}','2026-11-16T20:00Z');`);
 await db.exec(original.replaceAll('now()','public.test_now()'));
 await db.exec('revoke all on all functions in schema forecast_season from public,anon,authenticated,service_role');
 await db.query('insert into forecast_season.runs(key,slot_at,expected) values($1,$2,$3),($4,$5,$6)',[old,'2026-11-16T19:00Z','["a","b"]',latest,'2026-11-16T23:00Z','[]']);
 return db;
}
async function install(db){
 let sql=migration.replaceAll('now()','public.test_now()');
 for(const signature of signatures){const hash=(await db.query('select md5(pg_get_functiondef($1::regprocedure)) hash',['forecast_season.'+signature])).rows[0].hash;const name=signature.split('(')[0];sql=sql.replace(new RegExp("(md5\\(pg_get_functiondef\\('forecast_season\\."+name+"[^\\n]+<> ')[a-f0-9]{32}"),'$1'+hash);}
 await db.exec(sql);
}
const resume=async db=>(await db.query('select forecast_season.resume_incomplete() result')).rows[0].result;
const pending=async(db,key)=>(await db.query('select forecast_season.recovery_pending($1) result',[key])).rows[0].result;
const rows=async(db,table)=>(await db.query('select to_jsonb(t) row from '+table+' t order by 1')).rows;
const metadata=async db=>(await db.query("select oid,proacl,proowner,prosecdef,proconfig from pg_proc where pronamespace='forecast_season'::regnamespace order by oid")).rows;
test('empty later run no longer masks an incomplete run; migration and rollback preserve rows and ACL',async()=>{
 const db=await setup();try{
  assert.equal((await resume(db)).outcome,'complete');
  const tables=['forecast_season.runs','forecast_season.attempts','forecast_season.drafts','forecast_season.commands','public.forecast_season_public'];
  const before=await Promise.all(tables.map(t=>rows(db,t))),acl=await metadata(db);
  await install(db);assert.deepEqual(await Promise.all(tables.map(t=>rows(db,t))),before);assert.deepEqual(await metadata(db),acl);
  const r=await resume(db);assert.equal(r.source,old);assert.deepEqual(r.teams,['a','b']);
  assert.equal((await resume(db)).request_id,r.request_id);assert.equal((await rows(db,'forecast_season.recovery_requests')).length,1);
  assert.deepEqual(await rows(db,'public.forecast_season_public'),before[4]);
  await db.exec(original.replaceAll('now()','public.test_now()'));assert.deepEqual(await metadata(db),acl);
 }finally{await db.close();}
});
test('later overlapping work owns its teams, while disjoint older work remains recoverable',async()=>{
 const db=await setup();try{await install(db);
  await db.query('update forecast_season.runs set expected=$1 where key=$2',['["a"]',latest]);
  assert.deepEqual(await pending(db,old),['b']);assert.equal((await resume(db)).source,latest);
  await db.query("insert into forecast_season.attempts values('terminal',$1,'a','published',public.test_now())",[latest]);
  assert.equal((await resume(db)).source,old);
 }finally{await db.close();}
});
test('saved delivery, expiry, active interactive recovery and scheduled window remain guarded',async t=>{
 for(const scenario of ['fresh-saved','expired-saved','active-manual','scheduled'])await t.test(scenario,async()=>{
  const db=await setup();try{await install(db);
   if(scenario==='scheduled'){await db.exec("update public.test_plan set value='{\"run_key\":\"actual-slot\"}'");assert.equal((await resume(db)).outcome,'scheduled_window');return;}
   const expired=scenario==='expired-saved',manual=scenario==='active-manual';
   await db.query("insert into forecast_season.runs(key,slot_at,expected) values('recovery',public.test_now()-interval '1 hour','[\"a\",\"b\"]')");
   await db.query("insert into forecast_season.recovery_requests values('11111111-1111-4111-8111-111111111111','recovery',$1,'Synthetic recovery',false,public.test_now()-interval '1 hour',public.test_now()+$2::interval,null)",[old,expired?'-1 minute':'1 hour']);
   if(!manual){await db.query("insert into forecast_season.attempts values('saved','recovery','b','saved',public.test_now())");await db.query("update forecast_season.drafts set run_key='saved',projection=jsonb_build_object('evidence_at',public.test_now()-interval '30 minutes') where team='b'");}
   const r=await resume(db);assert.equal(r.outcome,manual?'recovery_in_progress':expired?'started':'awaiting_delivery');
   assert.equal((await rows(db,'forecast_season.attempts')).length,manual?0:1);
  }finally{await db.close();}
 });
});
test('terminal work, old runs, future runs and invalid automatic targets are not reopened',async()=>{
 const db=await setup();try{await install(db);
  await db.query("insert into forecast_season.attempts values('done',$1,'a','blocked',public.test_now())",[old]);
  assert.deepEqual(await pending(db,old),['b']);
  await assert.rejects(db.query('select forecast_season.begin_recovery(gen_random_uuid(),$1,$2,\'Synthetic invalid request\',true)',[old,'["a"]']),/último turno incompleto/);
  await db.query("update forecast_season.runs set slot_at=public.test_now()-interval '25 hours' where key=$1",[old]);assert.equal((await resume(db)).outcome,'complete');
  await db.query("update forecast_season.runs set slot_at=public.test_now()+interval '1 hour' where key=$1",[old]);assert.equal((await resume(db)).outcome,'complete');
  await db.query('delete from forecast_season.runs where key=$1',[latest]);assert.equal((await resume(db)).outcome,'no_recent_run');
 }finally{await db.close();}
});
