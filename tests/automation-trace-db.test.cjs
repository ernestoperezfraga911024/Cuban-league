'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
test('private trace stores every event, idempotent replay, strict metadata, immutable identities and no public privilege',async()=>{
 const db=new PGlite();try{
  await db.exec('create role anon;create role authenticated;create role service_role;create schema automation_ops;revoke all on schema automation_ops from public,anon,authenticated,service_role;');
  await db.exec(fs.readFileSync('docs/automation/trace-events.sql','utf8'));
  const p={execution_key:'cuban-league-trace-test',process_id:'a0000000-0000-4000-a000-000000000001',run_key:'season-test',code_sha:'a'.repeat(40),events:[{seq:1,occurred_at:'2026-01-01T12:00:00.000Z',phase:'review',status:'started',team:'getafe',request_id:'4',body_sha256:'b'.repeat(64),event_sha256:'c'.repeat(64)}]};
  const record=async value=>(await db.query('select automation_ops.record_trace($1::jsonb) result',[JSON.stringify(value)])).rows[0].result;
  assert.deepEqual(await record(p),{accepted:true,events:1});const first=(await db.query('select * from automation_ops.trace_events')).rows[0];
  await record(p);assert.equal((await db.query('select count(*) n from automation_ops.trace_events')).rows[0].n,1);
  p.events.push({seq:2,occurred_at:'2026-01-01T12:00:01.000Z',phase:'review',status:'error',duration_ms:1000,error_code:'layout_invalid',event_sha256:'d'.repeat(64)});await record(p);
  assert.equal((await db.query('select count(*) n from automation_ops.trace_events')).rows[0].n,2);assert.equal(+(await db.query('select recorded_at from automation_ops.trace_events where seq=1')).rows[0].recorded_at,+first.recorded_at);
  for(const mutate of [x=>x.secret='token',x=>x.events[0].sql='select secret',x=>x.events[0].status='unknown-status',x=>x.events[0].phase='https://private',x=>x.events[0].duration_ms=-1,x=>x.events[0].occurred_at='2099-01-01T00:00:00.000Z',x=>x.code_sha='b'.repeat(40),x=>x.run_key='season-different',x=>x.events[0].status='completed',x=>x.events=[]]){const bad=structuredClone(p);mutate(bad);await assert.rejects(record(bad));}
  const conflict=structuredClone(p);conflict.events=[{...p.events[1],seq:3},{...p.events[0],status:'completed'}];await assert.rejects(record(conflict));assert.equal((await db.query('select count(*) n from automation_ops.trace_events')).rows[0].n,2);
  for(const role of ['anon','authenticated','service_role']){
   assert.equal((await db.query("select has_table_privilege($1,'automation_ops.trace_events','SELECT,INSERT,UPDATE,DELETE') allowed",[role])).rows[0].allowed,false);
   assert.equal((await db.query("select has_function_privilege($1,'automation_ops.record_trace(jsonb)','EXECUTE') allowed",[role])).rows[0].allowed,false);
  }
  assert.equal((await db.query("select relrowsecurity enabled from pg_class where oid='automation_ops.trace_events'::regclass")).rows[0].enabled,true);
  assert.equal((await db.query("select prosecdef from pg_proc where oid='automation_ops.record_trace(jsonb)'::regprocedure")).rows[0].prosecdef,false);
  // Failure of the optional private sink cannot roll back independent sporting work.
  await db.exec("create table sport_probe(value integer);BEGIN;DO $trace$ BEGIN PERFORM automation_ops.record_trace('{}');EXCEPTION WHEN OTHERS THEN NULL;END $trace$;COMMIT;BEGIN;INSERT INTO sport_probe VALUES(1);COMMIT;");
  assert.equal((await db.query('select count(*) n from sport_probe')).rows[0].n,1);
 }finally{await db.close();}
});
