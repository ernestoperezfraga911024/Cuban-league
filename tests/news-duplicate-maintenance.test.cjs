'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const keys=['atletico-lookman-molestias-nigeria-20261113','atletico-lookman-nigeria-molestias-20261113','atletico-sorloth-juventus-rumor-20261112','atletico-sorloth-juventus-20261112'];
const hashes=['f8f1e422c5458fe24ba7aa9814892b66','d99a5920dc563cba9bbeaa77ff2966c3','bfeed4a55a9b5e233e171e221523bf59','a305f4639d352710f711f4f2a3dfc04a'];
async function setup(){
 const db=new PGlite();await db.exec(`create schema league_news;create table league_news.control(singleton boolean primary key,mode text,version bigint);insert into league_news.control values(true,'automatic',248);
 create table league_news.items(key text primary key,payload jsonb,version bigint,outcome text,suppressed boolean,checked_at timestamptz default now());
 create table public.news_public(key text primary key,payload jsonb,published_at timestamptz default now(),updated_at timestamptz default now(),visible boolean);
 create table league_news.commands(id uuid primary key,result jsonb,request jsonb);
 create table league_news.run_events(key text primary key,status text);insert into league_news.run_events values('historical-proof','published');`);
 let sql=fs.readFileSync('docs/news/duplicate-maintenance-20261116.sql','utf8');
 for(let n=0;n<keys.length;n++){
  const p=JSON.stringify({key:keys[n],protected:['history','payload',n]});
  await db.query("insert into league_news.items values($1,$2::jsonb,$3,'published',false,now());",[keys[n],p,n===0?4:1]);
  await db.query('insert into public.news_public(key,payload,visible) values($1,$2::jsonb,true);',[keys[n],p]);
  const hash=(await db.query('select md5($1::jsonb::text) h',[p])).rows[0].h;sql=sql.replace(hashes[n],hash);
 }
 return {db,sql};
}
test('confirmed duplicate maintenance preserves payloads/timestamps/ledger, snapshots all four, and is idempotent',async()=>{
 const {db,sql}=await setup();try{
  const before=(await db.query('select * from league_news.items order by key')).rows,pubBefore=(await db.query('select * from public.news_public order by key')).rows;
  await db.exec(sql);const after=(await db.query('select * from league_news.items order by key')).rows,pubAfter=(await db.query('select * from public.news_public order by key')).rows;
  assert.deepEqual(after.map(x=>({...x,suppressed:false})),before);assert.deepEqual(pubAfter.map(x=>({...x,visible:true})),pubBefore);
  assert.equal(after.filter(x=>x.suppressed).length,2);assert.equal(pubAfter.filter(x=>!x.visible).length,2);
  const saved=(await db.query('select * from league_news.commands')).rows[0];assert.equal(saved.request.origin,'owner-maintenance');assert.equal(saved.result.before.items.length,4);assert.equal(saved.result.after.public.length,4);
  assert.equal((await db.query('select version from league_news.control')).rows[0].version,250);assert.equal((await db.query('select status from league_news.run_events')).rows[0].status,'published');
  await db.exec(sql);assert.equal((await db.query('select count(*) n from league_news.commands')).rows[0].n,1);assert.equal((await db.query('select version from league_news.control')).rows[0].version,250);
 }finally{await db.close();}
});
test('stale payload or control aborts before any withdrawal',async()=>{
 for(const change of ["update league_news.control set version=249","update league_news.items set payload=payload||'{\"new\":true}'::jsonb where key='atletico-lookman-molestias-nigeria-20261113'"]){
  const {db,sql}=await setup();try{await db.exec(change);await assert.rejects(db.exec(sql));await db.exec('rollback');assert.equal((await db.query('select count(*) n from public.news_public where visible')).rows[0].n,4);assert.equal((await db.query('select count(*) n from league_news.commands')).rows[0].n,0);}finally{await db.close();}
 }
});
