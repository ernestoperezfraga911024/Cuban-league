'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {compile}=require('../scripts/forecast/editorial-producer.cjs');
const {SeasonGateway}=require('../scripts/forecast/season-gateway.cjs');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
// Import shared synthetic data without importing another test module.
const {example}=require('./fixtures/forecast-producer.cjs');
test('producer and gateway run against PostgreSQL assess/build_team with the installed v5 hashes',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema forecast_league;create schema forecast_season;create schema forecast_publish;
 create table forecast_league.teams(team text primary key,source_urls jsonb);
 create table forecast_league.roster(id text primary key,team text,name text);
 create table forecast_season.fixtures(key text primary key,matchday int,home text,away text,kickoff_at timestamptz,source_urls jsonb);
 create table forecast_season.control(singleton boolean primary key,mode text);insert into forecast_season.control values(true,'automatic');
 create table forecast_season.attempts(key text,run_key text,team text,outcome text);
 create table forecast_season.runs(key text,expected jsonb);
 create table forecast_season.recovery_requests(run_key text,expires_at timestamptz,closed_at timestamptz);
 create function forecast_season.check_attempt(text,text) returns text language sql as $$select $1||'-'||$2$$;
 create function forecast_season.register_fixture(jsonb) returns jsonb language sql as $$select $1$$;`);
 const sql=read('docs/forecast-publish/editorial-v4.sql');await db.exec(sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION'),sql.indexOf('-- Arithmetic/evidence')));
 const rollback=read('docs/forecast-publish/candidates-rollback.sql');await db.exec(rollback.slice(rollback.indexOf('CREATE OR REPLACE FUNCTION')));
 await db.exec(read('docs/forecast-publish/candidates.sql'));await db.exec(read('docs/forecast-publish/editorial-v5.sql'));
 const hashes=(await db.query("select md5(pg_get_functiondef('forecast_publish.assess(jsonb)'::regprocedure)) assess,md5(pg_get_functiondef('forecast_season.build_team(jsonb,interval)'::regprocedure)) builder")).rows[0];
 assert.deepEqual(hashes,{assess:'1e3dae90e7f37624d6b5ca686835cefe',builder:'cfd66a978f1a98fc7ccdaf501d36d541'});
 const x=example(),f=x.review.fixture,urls=Object.fromEntries(Object.entries(x.packet.docs).filter(([k])=>k!=='comuniate_team').map(([id,d])=>[id,d.url]));
 await db.query('insert into forecast_league.teams values($1,$2)',[x.packet.team,JSON.stringify(urls)]);
 await db.query('insert into forecast_season.fixtures values($1,$2,$3,$4,$5,$6)',[f.key,f.matchday,f.home,f.away,f.kickoff_at,JSON.stringify(urls)]);
 for(const p of x.roster)await db.query('insert into forecast_league.roster values($1,$2,$3)',[p.id,p.team,p.name]);
 let captured;
 const gateway=new SeasonGateway({runKey:'season-test',execute:async({query})=>{captured=query;try{const rs=await db.exec(query);return rs.find(r=>r.rows[0]?.result)?.rows[0].result;}catch(error){await db.exec('rollback');throw error;}}});
 for(const pct of [null,0,60,100]) {
  x.packet.observations.comuniate[0].probability=pct;
  const {payload,fixture}=compile(x.packet,x.review,x.roster,x.window),r=await gateway.validate(x.packet.team,fixture,payload);
  assert.equal(r.projection.players.length,11);assert.equal(r.projection.candidates.length,1);
  assert.equal(r.scores.length,12);assert.equal(r.projection.method_version,'editorial-v5');
  assert.equal(r.projection.players[0].probability,payload.proposal.players[0].probability);
 }
 assert.match(captured,/set_config/);
 await db.exec("insert into forecast_season.runs values('season-other','[\"test-home\"]');insert into forecast_season.recovery_requests values('season-other',now()+interval '1 hour',null);");
 const built=compile(x.packet,x.review,x.roster,x.window);
 await assert.rejects(gateway.validate(x.packet.team,built.fixture,built.payload),/Overlapping active recovery/);
 }finally{await db.close();}
});
