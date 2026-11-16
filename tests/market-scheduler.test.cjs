'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite'),{gzipSync}=require('node:zlib'),{createHash}=require('node:crypto');
const fixture=require('./helpers/market-fixture.cjs');
const migrations=path.join(__dirname,'../supabase/migrations');
async function setup(){
 const db=new PGlite();
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 await db.exec(`create role anon;create role authenticated;create role service_role;
  create schema vault;create table vault.decrypted_secrets(id uuid,name text,decrypted_secret text);
  insert into vault.decrypted_secrets values('00000000-0000-0000-0000-000000000001','session','private-test');
  create schema net;create table net._http_response(id bigint,status_code integer,timed_out boolean,error_msg text,content text);
  create table net.sent(id bigserial primary key,url text,body jsonb,headers jsonb);
  create function net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer) returns bigint language sql as $$
   insert into net.sent(url,body,headers) values(url,body,headers) returning id $$;
  create schema cron;create table cron.job(jobname text,schedule text,command text);
  create function cron.schedule(jobname text,schedule text,command text) returns bigint language sql as $$
   insert into cron.job values(jobname,schedule,command);select 1::bigint $$;
  create table public.sporting_results(id int,points int);insert into public.sporting_results values(1,77);`);
 for(const suffix of ['archive','automation','scheduler']){
  const file=fs.readdirSync(migrations).find(x=>x.endsWith(`_mister_market_${suffix}.sql`));
  await db.exec(fs.readFileSync(path.join(migrations,file),'utf8').replace(/^create extension .*;$/gm,''));
 }
 const raw=Buffer.from('{"test":true}'),compressed=gzipSync(raw),hash=b=>createHash('sha256').update(b).digest('hex');
 const archive={sha256:hash(compressed),rawSha256:hash(raw),rawBytes:raw.length,compressedBase64:compressed.toString('base64')};
 const payload=fixture();payload.capturedAt=new Date().toISOString();
 const first=(await q('select mister_market.stage($1,$2,$3,$4) r',[compressed,archive.rawSha256,raw.length,JSON.stringify(payload)])).r;
 await q('select mister_market.publish($1)',[first.revision]);
 await db.query("update mister_market.worker_config set enabled=true,latest_archive=$1,public_key='public-test',vault_key='00000000-0000-0000-0000-000000000001',sealed_session='{}'",[archive.sha256]);
 const rpc=async(action,run,data={})=>(await q('select public.mister_market_worker($1,$2,$3,$4) r',[action,run,'a'.repeat(40),JSON.stringify(data)])).r;
 const tick=async()=>(await q('select mister_market.scheduler_tick() r')).r;
 const finish={archive,payload:{...payload,schemaVersion:2,history:{...payload.history,source:'reconciled',reconciliation:'minimum_confirmed'}},expectedRevision:first.revision,sealedSession:{version:1,algorithm:'RSA-OAEP-256+A256GCM'},metrics:{aiCalls:0}};
 // Test-only clock substitution after independent calendar tests; no production
 // function accepts a caller-supplied timestamp for scheduling mutations.
 const dueNow=()=>db.exec("create or replace function mister_market.latest_slot(p_now timestamptz) returns timestamptz language sql stable strict set search_path='' as $$ select date_trunc('hour',p_now) $$");
 const enable=async(mode='sync')=>{await dueNow();await q('update mister_market.scheduler_config set enabled=true,dispatch_mode=$1',[mode]);await db.exec("insert into vault.decrypted_secrets values(gen_random_uuid(),'mister_market_github_dispatch_token','fake-test-token-not-a-real-credential')");};
 return {db,q,rpc,tick,finish,enable,dueNow};
}

test('Calendar preserves all five Miami hours, winter/summer, DST and day rollover',async()=>{
 const {db,q}=await setup();try{
  for(const [input,expected] of [
   ['2026-11-16T08:59:59Z','2026-11-16T02:00:00.000Z'],
   ['2026-11-16T09:00:00Z','2026-11-16T09:00:00.000Z'],
   ['2026-11-16T14:00:00Z','2026-11-16T14:00:00.000Z'],
   ['2026-11-16T18:00:00Z','2026-11-16T18:00:00.000Z'],
   ['2026-11-16T22:00:00Z','2026-11-16T22:00:00.000Z'],
   ['2026-11-17T02:00:00Z','2026-11-17T02:00:00.000Z'],
   ['2026-07-16T08:00:00Z','2026-07-16T08:00:00.000Z'],
   ['2026-07-16T13:00:00Z','2026-07-16T13:00:00.000Z'],
   ['2026-03-08T08:00:00Z','2026-03-08T08:00:00.000Z'],
   ['2026-11-01T09:00:00Z','2026-11-01T09:00:00.000Z']
  ])assert.equal((await q('select mister_market.latest_slot($1) t',[input])).t.toISOString(),expected);
 }finally{await db.close();}
});

test('Installation is disabled, private, and leaves existing reader and real dates intact',async()=>{
 const {db,q,rpc,tick,finish}=await setup();try{
  assert.equal((await tick()).outcome,'disabled');assert.equal((await q('select count(*)::int n from net.sent')).n,0);
  for(const role of ['anon','authenticated','service_role']){
   await db.exec('set role '+role);
   for(const sql of ['select mister_market.scheduler_tick()', 'select * from mister_market.scheduler_config','select * from mister_market.scheduler_slots',"select mister_market.worker_core('begin','1:1',repeat('a',40),'{}')"])
    await assert.rejects(q(sql));
   if(role!=='service_role')await assert.rejects(rpc('begin','1:1',{mode:'sync'}));
   await db.exec('reset role');
  }
  const before=(await q('select payload from public.mister_market_public')).payload.history.events;
  await db.exec('set role service_role');await rpc('begin','1:1',{mode:'sync'});await rpc('finish','1:1',finish);await db.exec('reset role');
  assert.deepEqual((await q('select payload from public.mister_market_public')).payload.history.events,before);
  assert.equal((await q('select points from public.sporting_results')).points,77);
  const cron=await q('select * from cron.job');assert.equal(cron.schedule,'* * * * *');assert.equal(cron.command,'select mister_market.scheduler_tick();');
 }finally{await db.close();}
});

test('Missing token blocks safely; requests are fixed, spaced and capped at three',async()=>{
 const {db,q,tick,dueNow,enable}=await setup();try{
  await dueNow();await db.exec("update mister_market.scheduler_config set enabled=true,dispatch_mode='sync'");
  assert.equal((await tick()).reason,'github_credential_missing');assert.equal((await q('select count(*)::int n from net.sent')).n,0);
  await enable();const first=await tick();assert.equal(first.outcome,'requested');assert.equal(first.number,1);
  const sent=await q('select * from net.sent');assert.equal(sent.body.ref,'main');assert.equal(sent.body.inputs.mode,'sync');assert.equal(sent.body.inputs.dispatch_id,first.attempt);
  assert.match(sent.url,/^https:\/\/api\.github\.com\/repos\/ernestoperezfraga911024\/Cuban-league\/actions\/workflows\/mister-market-sync\.yml\/dispatches$/);
  assert.equal((await tick()).outcome,'awaiting_start');
  await db.query('insert into net._http_response values($1,200,false,null,$2)',[sent.id,JSON.stringify({workflow_run_id:123456})]);
  await tick();const ack=await q('select http_status,github_run_id from mister_market.scheduler_attempts');assert.deepEqual(ack,{http_status:200,github_run_id:'123456'});
  assert.equal((await q('select status from mister_market.scheduler_slots')).status,'requested'); // HTTP acceptance is not execution.
  for(const number of [2,3]){await db.exec("update mister_market.scheduler_attempts set requested_at=now()-interval '11 minutes'");assert.equal((await tick()).number,number);}
  await db.exec("update mister_market.scheduler_attempts set requested_at=now()-interval '11 minutes'");assert.equal((await tick()).outcome,'exhausted');
  assert.equal((await q('select count(*)::int n from net.sent')).n,3);
 }finally{await db.close();}
});

test('Duplicate/lost responses and late native schedules publish a slot only once',async()=>{
 const {db,q,tick,rpc,finish,enable}=await setup();try{
  await enable();const a=await tick();
  await db.exec("update mister_market.scheduler_attempts set requested_at=now()-interval '11 minutes'");const b=await tick();
  const args=id=>({mode:'sync',event:'workflow_dispatch',dispatchId:id});
  await assert.rejects(rpc('begin','20:1',args('00000000-0000-0000-0000-000000000000')),/invalid_dispatch/);
  await assert.rejects(rpc('begin','20:1',{...args(a.attempt),mode:'test'}),/invalid_dispatch/);
  await assert.rejects(rpc('begin','20:1',{mode:'sync'}),/invalid_worker_origin/);
  await rpc('begin','20:1',args(a.attempt));assert.equal((await tick()).outcome,'worker_running');
  assert.equal((await rpc('begin','21:1',args(b.attempt))).reason,'worker_busy');
  assert.equal((await rpc('begin','22:1',{mode:'sync',event:'schedule'})).reason,'worker_busy');
  const dates=finish.payload.history.events.map(e=>e.date);
  const result=await rpc('finish','20:1',finish);assert.equal(result.outcome,'published');
  // Simulate losing the finish response: database completion, not HTTP, wins.
  assert.equal((await tick()).outcome,'published');assert.equal((await rpc('begin','21:1',args(b.attempt))).reason,'slot_complete');
  assert.equal((await rpc('begin','22:1',{mode:'sync',event:'schedule'})).reason,'slot_complete');
  assert.deepEqual((await q('select payload from public.mister_market_public')).payload.history.events.map(e=>e.date),dates);
  assert.equal((await q('select count(*)::int n from mister_market.worker_runs')).n,1);
 }finally{await db.close();}
});

test('Native fallback shares the slot, and test mode never counts as a publication',async()=>{
 const {db,q,tick,rpc,finish,enable}=await setup();try{
  await enable('test');const a=await tick();
  await rpc('begin','30:1',{mode:'test',event:'workflow_dispatch',dispatchId:a.attempt});await rpc('finish','30:1',finish);
  assert.equal((await tick()).outcome,'tested');assert.equal((await q('select payload from public.mister_market_public')).payload.schemaVersion,1);
  await db.exec("update mister_market.scheduler_config set dispatch_mode='sync'");
  await rpc('begin','31:1',{mode:'sync',event:'schedule'});await rpc('finish','31:1',finish);
  assert.equal((await tick()).outcome,'published');assert.equal((await q('select count(*)::int n from net.sent')).n,1);
  assert.equal((await q('select count(*)::int n from mister_market.scheduler_slots')).n,2);
 }finally{await db.close();}
});

test('Failed and expired workers may retry, but old jobs cannot overwrite newer data',async()=>{
 const {db,q,tick,rpc,finish,enable}=await setup();try{
  await enable();const a=await tick(),args=id=>({mode:'sync',event:'workflow_dispatch',dispatchId:id});
  await rpc('begin','40:1',args(a.attempt));await rpc('fail','40:1',{code:'page_not_settled'});
  assert.equal((await q('select visible from public.mister_market_public')).visible,true);
  await db.exec("update mister_market.scheduler_attempts set requested_at=now()-interval '11 minutes'");const b=await tick();
  await rpc('begin','41:1',args(b.attempt));
  await db.exec("update mister_market.worker_config set lease_until=now()-interval '1 minute';update mister_market.scheduler_attempts set requested_at=now()-interval '11 minutes'");
  const c=await tick();await rpc('begin','42:1',args(c.attempt));
  await assert.rejects(rpc('finish','41:1',finish),/worker_fence/);await rpc('finish','42:1',finish);
  assert.equal((await q("select status from mister_market.worker_runs where run_id='41:1'")).status,'expired');
  assert.equal((await q('select status from mister_market.scheduler_slots')).status,'published');
 }finally{await db.close();}
});

test('A stale dispatch cannot run outside its window; disabling is reversible',async()=>{
 const {db,q,tick,rpc,enable}=await setup();try{
  await enable();const a=await tick();
  await db.exec("update mister_market.scheduler_slots set scheduled_for=now()-interval '2 hours'");
  assert.equal((await rpc('begin','50:1',{mode:'sync',event:'workflow_dispatch',dispatchId:a.attempt})).reason,'outside_slot');
  await db.exec('update mister_market.scheduler_config set enabled=false');
  assert.equal((await rpc('begin','50:1',{mode:'sync',event:'workflow_dispatch',dispatchId:a.attempt})).reason,'scheduler_disabled');
  assert.equal((await tick()).outcome,'disabled');
  await rpc('begin','51:1',{mode:'test',event:'workflow_dispatch'});await rpc('fail','51:1',{code:'test_stop'});
  assert.equal((await q('select count(*)::int n from net.sent')).n,1);
 }finally{await db.close();}
});

test('Enqueue failures and non-JSON/unauthorized HTTP responses stay bounded and private',async()=>{
 const {db,q,tick,enable}=await setup();try{
  await enable();await db.exec("create or replace function net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$ begin raise exception 'fake sensitive transport details';end $$");
  assert.equal((await tick()).reason,'dispatch_enqueue_failed');
  assert.equal((await q('select count(*)::int n from mister_market.scheduler_attempts')).n,1);
  assert.equal((await tick()).outcome,'awaiting_start');
  await db.exec("insert into net._http_response values(100,401,false,null,'fake sensitive response');update mister_market.scheduler_attempts set request_id=100,response_at=null");
  await tick();assert.equal((await q('select error_code from mister_market.scheduler_attempts')).error_code,'dispatch_http_error');
  await db.exec("update net._http_response set status_code=200,content='invalid-json';update mister_market.scheduler_attempts set response_at=null");
  await tick();assert.equal((await q('select github_run_id from mister_market.scheduler_attempts')).github_run_id,null);
  assert.ok(!JSON.stringify((await db.query('select * from mister_market.scheduler_attempts')).rows).includes('sensitive'));
 }finally{await db.close();}
});

test('Worker carries dispatch identity to the gate and skips before touching Mister',async()=>{
 const {run}=require('../scripts/mister-market/worker.cjs');const calls=[];
 const result=await run({mode:'sync',dispatchId:'test-id',request:async(action,data)=>{calls.push({action,data});return {skipped:true,reason:'slot_complete'};}});
 assert.equal(result.reason,'slot_complete');assert.deepEqual(calls,[{action:'begin',data:{mode:'sync',dispatchId:'test-id'}}]);
 const edge=fs.readFileSync(path.join(__dirname,'../supabase/functions/mister-market-sync/index.ts'),'utf8');
 assert.match(edge,/data\.event=claims\.event_name/); // Identity is verified server-side, never trusted from the worker.
});
