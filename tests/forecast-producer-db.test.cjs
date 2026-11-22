'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {compile}=require('../scripts/forecast/editorial-producer.cjs');
const {SeasonGateway}=require('../scripts/forecast/season-gateway.cjs');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
// Import shared synthetic data without importing another test module.
const {example}=require('./fixtures/forecast-producer.cjs');
test('producer and gateway run against PostgreSQL v6 with the installed legacy hashes preserved',async()=>{
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
 await db.exec(read('docs/forecast-publish/candidates.sql'));await db.exec(read('docs/forecast-publish/editorial-v5.sql'));await db.exec(read('docs/forecast-publish/source-summary.sql'));
 const hashes=(await db.query("select md5(pg_get_functiondef('forecast_publish.assess(jsonb)'::regprocedure)) assess,md5(pg_get_functiondef('forecast_season.build_team(jsonb,interval)'::regprocedure)) builder")).rows[0];
 assert.deepEqual(hashes,{assess:'1e3dae90e7f37624d6b5ca686835cefe',builder:'f30f730355203b835804b2f6c08b7188'});
 await db.exec(read('docs/forecast-publish/editorial-v6.sql'));
 const x=example(),f=x.review.fixture,urls=Object.fromEntries(Object.entries(x.packet.docs).filter(([k])=>k!=='comuniate_team').map(([id,d])=>[id,d.url]));
 await db.query('insert into forecast_league.teams values($1,$2)',[x.packet.team,JSON.stringify(urls)]);
 await db.query('insert into forecast_season.fixtures values($1,$2,$3,$4,$5,$6)',[f.key,f.matchday,f.home,f.away,f.kickoff_at,JSON.stringify(urls)]);
 for(const p of x.roster)await db.query('insert into forecast_league.roster values($1,$2,$3)',[p.id,p.team,p.name]);
 let captured;
 const gateway=new SeasonGateway({runKey:'season-test',execute:async({query})=>{captured=query;try{const rs=await db.exec(query);return rs.find(r=>r.rows[0]?.result)?.rows[0].result;}catch(error){await db.exec('rollback');throw error;}}});
 // Reproduce Valencia's real failure: JS accepted +00:00 but SQL requires UTC Z.
 x.review.fixture.kickoff_at=x.review.fixture.kickoff_at.replace('Z','+00:00');
 for(const pct of [null,0,60,100]) {
  x.packet.observations.comuniate[0].probability=pct;
  const {payload,fixture}=compile(x.packet,x.review,x.roster,x.window),r=await gateway.validate(x.packet.team,fixture,payload);
  assert.equal(r.projection.players.length,11);assert.equal(r.projection.candidates.length,1);
  assert.equal(r.scores.length,12);assert.equal(r.projection.method_version,'editorial-v6');
  assert.equal(r.projection.players[0].probability,payload.proposal.players[0].probability);
 }
 assert.match(captured,/set_config/);
 await db.exec(read('docs/forecast-publish/starter-alternatives.sql'));
 x.packet.observations.comuniate[1].probability=0;
 x.packet.observations.comuniate[2].probability=0;
 x.review.selection.players[1].alternative_id=x.roster[2].id;
 x.review.sources.comuniate.alternatives.push({...x.packet.observations.comuniate[2],probability:0});
 x.packet.comuniate_alternatives.players.push({...x.packet.observations.comuniate[2],probability:0});
 const roles=compile(x.packet,x.review,x.roster,x.window),verified=await gateway.validate(x.packet.team,roles.fixture,roles.payload);
 assert.equal(roles.source_roles.length,1);assert.equal(verified.projection.players[1].alternative.id,x.roster[2].id);
 assert.equal(verified.projection.players[2].probability,64);assert.equal(verified.projection.candidates.length,1);
 await db.exec(read('docs/forecast-publish/selection-priority.sql'));
 const season=read('docs/forecast-publish/season.sql'),saveStart=season.indexOf('create function forecast_season.save_draft');
 await db.exec(season.slice(saveStart,season.indexOf('$body$;',saveStart)+8));
 await db.exec(read('docs/forecast-publish/predicted11-top3.sql'));
 const regression=require('./fixtures/forecast-producer.cjs').priorityExample();
 // Use the already registered fixture with the same instant (test creation can cross a second).
 regression.review.fixture=structuredClone(x.review.fixture);
 regression.packet.expected_fixture=structuredClone(x.packet.expected_fixture);
 for(const source of Object.values(regression.review.sources))source.observed_fixture=structuredClone(x.review.sources.futbolfantasy.observed_fixture);
 regression.review.predicted11.observed_fixture=structuredClone(x.review.sources.futbolfantasy.observed_fixture);
 const prioritized=compile(regression.packet,regression.review,regression.roster,regression.window);
 const proof=await gateway.validate(regression.packet.team,prioritized.fixture,prioritized.payload);
 assert.equal(proof.projection.players[6].probability,55);assert.equal(proof.projection.players[6].alternative.id,x.roster[6].id);
 // SQL enforces the declared policy but can still read old 7+7 evidence.
 const build=async p=>(await db.query('select forecast_season.build_team($1::jsonb) p',[JSON.stringify(p)])).rows[0].p;
 const legacy=structuredClone(prioritized.payload),ls=legacy.sources[3];delete ls.selection_policy;
 const seven=[...ls.rankings[0].authors,...ls.rankings[1].authors,{id:'7',url:'https://www.predicted11.com/es/usuario/author6'}].map((a,i)=>({...a,rank:i+1}));
 ls.rankings.forEach(r=>r.authors=structuredClone(seven));
 ls.predictions.push({...ls.predictions[0],author_id:'7',url:seven[6].url,status:'not_created',starters:[],starter_ids:[]});
 assert.deepEqual(await build(legacy),proof.projection);
 for(const change of [p=>p.sources[3].selection_policy='unknown',p=>p.sources[3].rankings[0].authors[2].rank=4,p=>p.sources[3].rankings[0].authors.push(seven[3]),p=>p.sources[3].predictions.push(p.sources[3].predictions[0])]){
  const bad=structuredClone(prioritized.payload);change(bad);await assert.rejects(build(bad),e=>e.code==='22023');
 }
 const wrongPolicy=structuredClone(legacy);wrongPolicy.sources[3].selection_policy='top3-global-top3-club-v1';
 await assert.rejects(build(wrongPolicy),/Ranking/);
 await db.exec('alter table forecast_season.attempts add column input_hash text;');
 await assert.rejects(db.query('select forecast_season.save_draft($1,$2::jsonb)',['season-test',JSON.stringify(legacy)]),/nuevas lecturas requieren Predicted11 top3/);
 await db.query("insert into forecast_season.attempts(key,run_key,team,outcome,input_hash) values('season-test-test-home','season-test','test-home','saved',md5($1::jsonb::text))",[JSON.stringify(legacy)]);
 const saved=(await db.query('select forecast_season.save_draft($1,$2::jsonb) result',['season-test',JSON.stringify(legacy)])).rows[0].result;
 assert.equal(saved.already_saved,true);assert.deepEqual(await build(legacy),proof.projection);
 await db.exec('delete from forecast_season.attempts');
 await db.exec(`alter table forecast_season.fixtures add column verified_at timestamptz default now();
 alter table forecast_season.control add column version int default 0;
 alter table forecast_season.attempts add column fixture_key text;
 create table forecast_season.drafts(team text primary key,run_key text,fixture_key text,payload jsonb,projection jsonb,checked_at timestamptz,outcome text,reason text);
 create table public.forecast_season_public(team text primary key,payload jsonb,checked_at timestamptz,status text,attempted_fixture_key text);
 insert into forecast_season.drafts(team) values('test-home');insert into public.forecast_season_public(team,status) values('test-home','pending');`);
 const newSaved=(await db.query('select forecast_season.save_draft($1,$2::jsonb) result',['season-test',JSON.stringify(prioritized.payload)])).rows[0].result;
 assert.equal(newSaved.outcome,'saved');assert.deepEqual((await db.query('select payload from forecast_season.drafts')).rows[0].payload,prioritized.payload);
 await db.exec('delete from forecast_season.attempts');
 // The gateway picks only a verified link from the exact fixture, even if a newer
 // unavailable snapshot has replaced it. It returns no ballots or old bodies.
 await db.exec(`create schema forecast_history;create table forecast_history.snapshots(id int,fixture_key text,team text,published_at timestamptz,projection jsonb);
 create function forecast_season.plan() returns jsonb language sql as $$select jsonb_build_object('run_key','season-test','teams',jsonb_build_array(jsonb_build_object('team',t.team,'fixture',to_jsonb(f)))) from forecast_league.teams t join forecast_season.fixtures f on t.team=f.home$$;`);
 const matchUrl='https://www.predicted11.com/es/laliga/partido/999-test';
 for(const [id,key,team,status,url]of [[1,f.key,f.away,'read',matchUrl],[2,f.key,f.home,'unavailable','https://www.predicted11.com/es/laliga/'],[3,'other-fixture',f.home,'read',matchUrl+'-wrong'],[4,f.key,'other-team','read',matchUrl+'-wrong']])await db.query('insert into forecast_history.snapshots values($1,$2,$3,now()+$4*interval \'1 minute\',$5)',[id,key,team,id,JSON.stringify({sources:[{id:'predicted11',status,url}],players:['must-not-be-copied']})]);
 const plan=await gateway.plan(f.home);assert.equal(plan.teams[0].predicted11_locator.url,matchUrl);assert.equal(plan.teams[0].predicted11_locator.fixture_key,f.key);
 assert.deepEqual(Object.keys(plan.teams[0].predicted11_locator).sort(),['fixture_key','published_at','team','url']);
 // Restore the old inverted selection without changing any percentage or observation.
 const inverted=structuredClone(prioritized.payload),winner=inverted.proposal.players[6],loser=inverted.proposal.candidates[0];
 inverted.proposal.players[6]={...loser,slot:7,position:'MF',alternative:{id:winner.id,name:winner.name}};
 const {slot,position,alternative,...candidate}=winner;inverted.proposal.candidates=[candidate];
 await assert.rejects(gateway.validate(x.packet.team,prioritized.fixture,inverted),/alternativa supera al titular/);
 await db.exec("insert into forecast_season.runs values('season-other','[\"test-home\"]');insert into forecast_season.recovery_requests values('season-other',now()+interval '1 hour',null);");
 const built=compile(x.packet,x.review,x.roster,x.window);
 await assert.rejects(gateway.validate(x.packet.team,built.fixture,built.payload),/Overlapping active recovery/);
 }finally{await db.close();}
});
