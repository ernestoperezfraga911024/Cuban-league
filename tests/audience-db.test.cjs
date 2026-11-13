'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('audience: anonymous write-only ingestion, admin-only aggregation, deduplication and immutable past identities',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon; create role authenticated; create schema private;
   create function private.is_league_admin() returns boolean language sql as $$select current_setting('test.admin',true)='yes'$$;`);
  await db.exec(read('SUPABASE-V58-VISITAS-COPIAR-Y-PEGAR.txt'));
  await db.exec(read('docs/audience/upgrade.sql'));
  const visitor='00000000-0000-4000-8000-000000000001',session='00000000-0000-4000-8000-000000000002';
  const track=async(section,profile=1,s=session,v=visitor)=>(await db.query('select public.track_site_activity($1,$2,$3,$4) as ok',[v,s,section,profile])).rows[0].ok;
  const report=async(days=1)=>(await db.query('select public.get_site_audience($1) as data',[days])).rows[0].data;
  await db.exec('set role anon');
  assert.equal(await track('home',0),true);
  assert.equal(await track('news'),true);assert.equal(await track('news'),true);
  assert.equal(await track('forecasts'),true);
  assert.equal(await track('news',8),true); // Change profile, same visit.
  assert.equal(await track('home',0),true); // Forget does not rewrite prior events.
  assert.equal(await track('admin'),false);assert.equal(await track('home',999),false);
  assert.equal(await track('home',null),false);
  assert.equal(await track('home',1,session,'00000000-0000-4000-8000-000000000099'),false);
  await assert.rejects(report,/permission denied/);
  await assert.rejects(db.query('select * from private.site_activity'),/permission denied/);
  await db.exec('reset role;set role authenticated');
  await assert.rejects(report,/Not authorized/); // Null admin flag must fail closed.
  await assert.rejects(db.query('select * from private.site_activity'),/permission denied/);
  await db.exec("reset role;set test.admin='yes';set role authenticated");
  let result=await report();
  assert.equal(result.identifiedProfiles,2);assert.equal(result.identifiedVisits,1);assert.equal(result.unidentifiedVisits,0);
  assert.equal(result.sections.find(x=>x.id==='news').visits,1);
  assert.deepEqual(result.profiles.map(x=>x.id).sort((a,b)=>a-b),[1,8]);
  assert.ok(result.profiles.every(x=>x.visits===1));
  assert.equal(JSON.stringify(result).includes(visitor),false);
  assert.equal(await track('news',1,'00000000-0000-4000-8000-000000000003'),true);
  assert.equal(await track('home',0,'00000000-0000-4000-8000-000000000004'),true);
  result=await report();assert.equal(result.profiles.find(x=>x.id===1).visits,2);assert.equal(result.unidentifiedVisits,1);
  await db.exec('reset role');
  // Fixture data is test-only. Miami calendar grouping, 30-day filtering and retention.
  await db.exec(`update private.site_activity set visit_day=timezone('America/New_York',now())::date-2 where session_id='00000000-0000-4000-8000-000000000003';`);
  assert.equal((await report(1)).profiles.find(x=>x.id===1).visits,1);
  assert.equal((await report(7)).profiles.find(x=>x.id===1).visits,2);
  await db.exec(`update private.site_activity set visit_day=timezone('America/New_York',now())::date-91 where session_id='00000000-0000-4000-8000-000000000003';`);
  await track('rules');assert.equal((await db.query("select count(*)::int n from private.site_activity where visit_day<timezone('America/New_York',now())::date-89")).rows[0].n,0);
  assert.equal((await report(-1)).days,7);
  assert.equal((await db.query('select count(*)::int n from public.site_visits')).rows[0].n,3);
  const gate=(await db.query("select has_function_privilege('anon','public.get_site_audience(integer)','execute') as anon_read,has_function_privilege('authenticated','public.get_site_audience(integer)','execute') as auth_read")).rows[0];
  assert.equal(gate.anon_read,false);assert.equal(gate.auth_read,true);
 }finally{await db.close();}
});
