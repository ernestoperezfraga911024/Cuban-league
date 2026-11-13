'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync(path.join(__dirname,'../docs/forecast-publish/recover-20261113.sql'),'utf8');
const diagnostic='No se completó la resolución segura de todos los candidatos observados contra el catálogo; no se fabricó la propuesta.';
const target='season-20261113-0600';
async function setup(){
 const db=new PGlite();
 await db.exec(`create schema forecast_season;
 create table forecast_season.control(singleton boolean primary key,mode text,version bigint);
 create table forecast_season.runs(key text primary key,slot_at timestamptz,started_at timestamptz,finished_at timestamptz,expected jsonb);
 create table forecast_season.attempts(key text primary key,run_key text,team text,fixture_key text,checked_at timestamptz,input_hash text,outcome text,reason text,published_at timestamptz);
 create table forecast_season.drafts(team text primary key,paused boolean,run_key text,fixture_key text,payload jsonb,projection jsonb,checked_at timestamptz,outcome text,reason text);
 create table forecast_season.commands(request_id uuid primary key,request jsonb,result jsonb,created_at timestamptz default now());
 create table public.forecast_season_public(team text primary key,payload jsonb,published_at timestamptz,checked_at timestamptz,status text,attempted_fixture_key text);
 create function forecast_season.plan() returns jsonb language sql as $$select '{"run_key":"season-20261113-0600"}'::jsonb$$;
 insert into forecast_season.control values(true,'automatic',183);`);
 const teams=Array.from({length:20},(_,i)=>'test-'+i);
 await db.query('insert into forecast_season.runs values($1,now(),now(),$2,$3)',[target,'2026-11-13T11:22:11.846308Z',JSON.stringify(teams)]);
 for(const team of teams){
  await db.query('insert into forecast_season.attempts values($1,$2,$3,null,$4,$5,$6,$7,null)',[target+'-'+team,target,team,'2026-11-13T11:22:07.976329Z','synthetic','blocked',diagnostic]);
  await db.query('insert into forecast_season.drafts values($1,false,$2,null,$3,null,$4,$5,$6)',[team,target+'-'+team,JSON.stringify({reason:diagnostic,sources:[]}), '2026-11-13T11:22:07.976329Z','blocked',diagnostic]);
  await db.query("insert into public.forecast_season_public values($1,$2,'2026-11-12T16:00Z','2026-11-13T11:22Z','blocked','test-fixture')",[team,JSON.stringify({players:[{id:'synthetic-only'}]})]);
 }
 return db;
}
const rows=(db,table)=>db.query('select * from '+table+' order by 1').then(r=>r.rows);
test('recovery preserves public payloads and archives every original private record',async()=>{
 const db=await setup();try{
 const pub=await rows(db,'public.forecast_season_public'), attempts=await rows(db,'forecast_season.attempts'), drafts=await rows(db,'forecast_season.drafts');
 await db.exec(sql);
 assert.deepEqual(await rows(db,'public.forecast_season_public'),pub);
 assert.equal((await rows(db,'forecast_season.attempts')).length,0);
 const audit=(await rows(db,'forecast_season.commands'))[0].result;
 assert.equal(audit.before.attempts.length,attempts.length);assert.equal(audit.before.drafts.length,drafts.length);
 assert.deepEqual(audit.before.attempts.map(x=>x.input_hash),attempts.map(x=>x.input_hash));
 assert.deepEqual(audit.before.drafts.map(x=>x.payload),drafts.map(x=>x.payload));
 assert.ok((await rows(db,'forecast_season.drafts')).every(d=>d.outcome==='pending'&&!d.payload&&!d.run_key&&!d.paused));
 assert.equal((await rows(db,'forecast_season.control'))[0].version,184);
 assert.equal((await rows(db,'forecast_season.runs'))[0].finished_at,null);
 await assert.rejects(db.exec(sql),/Recovery preconditions changed/);await db.exec('rollback');
 assert.equal((await rows(db,'forecast_season.commands')).length,1);
 }finally{await db.close();}
});
test('changed, deliverable or expired work aborts without removing evidence',async t=>{
 for(const [name,mutation] of Object.entries({saved:"update forecast_season.attempts set outcome='saved' where team='test-0'",published:"update forecast_season.attempts set published_at=now() where team='test-0'",paused:"update forecast_season.drafts set paused=true where team='test-0'",changedReason:"update forecast_season.attempts set reason='A real distinct evidence failure' where team='test-0'",expired:"create or replace function forecast_season.plan() returns jsonb language sql as $$select '{\"run_key\":null}'::jsonb$$"}))await t.test(name,async()=>{
  const db=await setup();try{await db.exec(mutation);const before=await rows(db,'forecast_season.attempts');
   await assert.rejects(db.exec(sql),/Recovery/);await db.exec('rollback');
   assert.deepEqual(await rows(db,'forecast_season.attempts'),before);assert.equal((await rows(db,'forecast_season.commands')).length,0);
   assert.equal((await rows(db,'forecast_season.control'))[0].version,183);
  }finally{await db.close();}
 });
});
