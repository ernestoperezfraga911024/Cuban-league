'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync(path.join(__dirname,'../docs/forecast-publish/dispatch-clock.sql'),'utf8');
test('dispatch guard waits for the real boundary and preserves independent flows',async t=>{
 const db=new PGlite();
 try{
  await db.exec('create schema forecast_season; create role anon; create role authenticated;');await db.exec(migration);
  const gate=async(s,o)=>(await db.query('select forecast_season.dispatch_gate_at($1,$2) as g',[s,o])).rows[0].g;
  await t.test('incident: 13:55 cannot be mistaken for completed 14:00 work',async()=>{
   const g=await gate('2026-11-13T19:00Z','2026-11-13T18:55:05.395621Z');assert.equal(g.state,'wait');assert.equal(g.wait_seconds,295);assert.equal(g.poll_seconds,45);
   assert.equal((await gate(g.scheduled_for,'2026-11-13T19:00Z')).state,'ready');
   const last=await gate(g.scheduled_for,'2026-11-13T18:59:59.5Z');assert.equal(last.wait_seconds,1);
  });
  await t.test('missing context infers and pins the upcoming boundary',async()=>{
   const g=await gate(null,'2026-11-13T18:55Z');assert.equal(g.state,'wait');assert.equal(Date.parse(g.scheduled_for),Date.parse('2026-11-13T19:00Z'));assert.equal(g.inferred,true);
   assert.equal((await gate(null,'2026-11-13T19:20Z')).state,'ready');
  });
  await t.test('late delivery goes through recovery without pretending freshness',async()=>{
   assert.equal((await gate('2026-11-13T19:00Z','2026-11-13T21:05Z')).state,'late');
   assert.equal((await gate('2026-11-13T19:00Z','2026-11-13T19:10Z')).wait_seconds,0);
  });
  await t.test('Miami spring offset and season end remain correct',async()=>{
   assert.equal((await gate('2027-03-14T10:00Z','2027-03-14T09:55Z')).state,'wait');
   assert.equal((await gate('2027-07-01T04:00Z','2027-07-01T03:55Z')).state,'invalid');
   assert.equal((await gate('2026-11-13T10:00Z','2026-11-13T09:55Z')).state,'invalid');
  });
  await t.test('invalid future contexts cannot create unbounded waits',async()=>{
   for(const target of ['2026-11-14T19:00Z','2026-11-13T19:01Z','infinity'])assert.equal((await gate(target,'2026-11-13T18:55Z')).state,'invalid');
  });
  await t.test('wrapper uses live clock and stays private with invoker privileges',async()=>{
   const p=(await db.query("select prosecdef,provolatile,proconfig,pg_get_functiondef(oid) def from pg_proc where pronamespace='forecast_season'::regnamespace and proname='dispatch_gate'")).rows[0];
   assert.equal(p.prosecdef,false);assert.equal(p.provolatile,'v');assert.match(p.def,/clock_timestamp\(\)/);
   for(const role of ['anon','authenticated'])for(const fn of ['dispatch_gate(timestamp with time zone)','dispatch_gate_at(timestamp with time zone,timestamp with time zone)'])assert.equal((await db.query('select has_function_privilege($1,$2,$3) p',[role,'forecast_season.'+fn,'EXECUTE'])).rows[0].p,false);
   assert.equal((await db.query("select count(*)::int n from information_schema.tables where table_schema='forecast_season'")).rows[0].n,0);
  });
 }finally{await db.close();}
});
