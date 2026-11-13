'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
test('news 15:00 Miami schedule preserves morning windows, existing runs and DST',async()=>{
 const db=new PGlite();try{
  await db.exec("create schema league_news; create role anon;create role authenticated; create table league_news.runs(key text primary key,finished_at timestamptz); insert into league_news.runs values('news-20261113-14',null);");
  await db.exec(fs.readFileSync(path.join(__dirname,'../docs/news/schedule-1500.sql'),'utf8'));
  const slot=async t=>(await db.query('select league_news.slot_at($1) s',[t])).rows[0].s;
  for(const [time,expected] of [['12:59:59',null],['13:00:00','08'],['14:59:59','08'],['15:00:00',null],['16:00:00','11'],['17:59:59','11'],['18:00:00',null],['19:00:00',null],['19:59:59',null],['20:00:00','15'],['21:59:59','15'],['22:00:00',null]])assert.equal(await slot('2026-11-13T'+time+'Z'),expected&&'news-20261113-'+expected,time);
  assert.equal(await slot('2027-03-14T18:59:59Z'),null);assert.equal(await slot('2027-03-14T19:00Z'),'news-20270314-15');
  assert.equal(await slot('2027-07-01T19:00Z'),null);
  assert.deepEqual((await db.query('select * from league_news.runs')).rows,[{key:'news-20261113-14',finished_at:null}]);
  assert.equal((await db.query("select has_function_privilege('anon','league_news.slot_at(timestamptz)','EXECUTE') p")).rows[0].p,false);
 }finally{await db.close();}
});
