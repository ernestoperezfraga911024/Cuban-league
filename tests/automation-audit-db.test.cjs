'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
test('private audit persists resumable metadata, preserves incidents and rejects invalid/privileged input',async()=>{
 const db=new PGlite();try{
 await db.exec('create role anon;create role authenticated;create role service_role;');await db.exec(fs.readFileSync('docs/automation/audit.sql','utf8'));
 const p={execution_key:'cuban-league-test',scheduled_for:null,methodology_version:'ops-v1',code_sha:'a'.repeat(40),status:'running',report:{flows:{},metrics:{chatgpt_tokens:null},incidents:[],checks:[]}};
 const record=async p=>(await db.query('select automation_ops.record_run($1::jsonb) result',[JSON.stringify(p)])).rows[0].result;
 assert.equal((await record(p)).status,'running');const before=(await db.query('select * from automation_ops.run_log')).rows[0];
 p.status='partial';p.report.flows.forecasts={status:'partial',run_key:'season-real',expected:20,published:19,missing:1,verified:19};p.report.incidents=[{code:'review-incomplete',flow:'forecasts',summary:'Falta terminar una revisión; no es fallo de una fuente.'}];p.report.metrics.downloads=42;
 await record(p);await record(p);assert.equal((await db.query('select count(*) n from automation_ops.run_log')).rows[0].n,1);
 p.status='completed';p.report.flows.forecasts={status:'completed',expected:20,published:20,missing:0,verified:20};p.report.incidents=[];await record(p);
 const after=(await db.query('select * from automation_ops.run_log')).rows[0];assert.equal(+after.first_recorded_at,+before.first_recorded_at);assert.equal(after.report.incidents.length,1);assert.equal(after.report.metrics.chatgpt_tokens,null);
 for(const mutate of [x=>x.status='running',x=>x.code_sha='b'.repeat(40),x=>x.methodology_version='ops-v2',x=>x.report.secret='no',x=>x.report.metrics.downloads=-1,x=>x.report.metrics.chatgpt_tokens='unknown',x=>x.report.flows.forecasts.published=1.2,x=>x.report.incidents=[{code:'bad',flow:'forecasts',summary:'Too short'}],x=>x.report.checks=[{not:'text'}],x=>x.scheduled_for='2099-01-01T00:00:00Z',x=>x.report.flows.unknown={status:'completed'}]){const bad=structuredClone(p);mutate(bad);await assert.rejects(record(bad));}
 for(const role of ['anon','authenticated','service_role']){
  assert.equal((await db.query("select has_schema_privilege($1,'automation_ops','USAGE') allowed",[role])).rows[0].allowed,false);
  assert.equal((await db.query("select has_function_privilege($1,'automation_ops.record_run(jsonb)','EXECUTE') allowed",[role])).rows[0].allowed,false);
  assert.equal((await db.query("select has_table_privilege($1,'automation_ops.run_log','SELECT') allowed",[role])).rows[0].allowed,false);
 }
 assert.equal((await db.query("select relrowsecurity as enabled from pg_class where oid='automation_ops.run_log'::regclass")).rows[0].enabled,true);
 }finally{await db.close();}
});
