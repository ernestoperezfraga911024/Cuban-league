'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{gzipSync}=require('node:zlib'),{createHash}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite'),fixture=require('./helpers/market-fixture.cjs');
test('Market DB: immutable archive, private staging, atomic revisions, read-only publication',async()=>{
 const db=new PGlite(),q=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 try{
  await db.exec('create role anon;create role authenticated;create role service_role;create table public.sporting_results(id int primary key,points int);insert into public.sporting_results values(1,77)');
  const migration=fs.readdirSync(path.join(__dirname,'../supabase/migrations')).find(x=>x.endsWith('_mister_market_archive.sql'));
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',migration),'utf8'));
  const raw=Buffer.from('{"test":"archive"}'),compressed=gzipSync(raw),sha=createHash('sha256').update(raw).digest('hex');
  const stage=(p,expected=null)=>q('select mister_market.stage($1,$2,$3,$4::jsonb,$5) r',[compressed,sha,raw.length,JSON.stringify(p),expected]);
  const p=fixture(),first=(await stage(p)).r;assert.equal(first.visible,false);
  assert.equal((await stage(p)).r.outcome,'unchanged');assert.equal((await q('select count(*)::int n from mister_market.archives')).n,1);
  await assert.rejects(q('update mister_market.archives set raw_bytes=raw_bytes'));await assert.rejects(q('delete from mister_market.archives'));
  for(const role of ['anon','authenticated','service_role']){
   await db.exec('set role '+role);
   await assert.rejects(q('select * from mister_market.archives'));await assert.rejects(stage(p));await assert.rejects(q('select mister_market.publish($1)',[first.revision]));await assert.rejects(q('delete from public.mister_market_public'));
   if(role!=='service_role')assert.equal((await q('select count(*)::int n from public.mister_market_public')).n,0);
   await db.exec('reset role');
  }
  await assert.rejects(q('select mister_market.publish($1)',['wrong']));await q('select mister_market.publish($1)',[first.revision]);
  await db.exec('set role anon');assert.equal((await q('select count(*)::int n from public.mister_market_public')).n,1);await db.exec('reset role');
  const changed=fixture();changed.players[0].value++;
  await assert.rejects(stage(changed));assert.equal((await q('select visible from public.mister_market_public')).visible,true);
  for(const mutate of [x=>x.players[0].ownerId='unknown',x=>x.players.push(x.players[0]),x=>x.managers[1].participantId=1,x=>x.players[0].value=null,x=>x.history.events.push(x.history.events[0]),x=>x.history.completeSeason=true,x=>x.capturedAt='2020-01-01T00:00:00Z']){const x=fixture();mutate(x);await assert.rejects(stage(x,first.revision));}
  const second=(await stage(changed,first.revision)).r;assert.equal(second.visible,false);assert.notEqual(second.revision,first.revision);
  assert.equal((await q('select points from public.sporting_results where id=1')).points,77);
  assert.ok((await db.query("select prosecdef from pg_proc where pronamespace='mister_market'::regnamespace")).rows.every(x=>x.prosecdef===false));
 }finally{await db.close();}
});
