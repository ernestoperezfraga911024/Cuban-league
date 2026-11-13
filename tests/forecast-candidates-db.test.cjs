'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
test('candidate migration validates real PostgreSQL arithmetic and evidence without changing existing projections',async t=>{
 const db=new PGlite();try{
 await db.exec(`create schema forecast_league;create schema forecast_season;create schema forecast_publish;
 create table forecast_league.teams(team text primary key,source_urls jsonb);
 create table forecast_league.roster(id text primary key,team text,name text);
 create table forecast_season.fixtures(key text primary key,matchday int,home text,away text,kickoff_at timestamptz,source_urls jsonb);
 insert into forecast_league.roster select 'test-'||i,'test-home','Test player '||i from generate_series(1,25)i;`);
 const sql=read('docs/forecast-publish/editorial-v4.sql');
 const funcs=sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION'),sql.indexOf('-- Arithmetic/evidence'));
 await db.exec(funcs);
 const rollback=read('docs/forecast-publish/candidates-rollback.sql');
 await db.exec(rollback.slice(rollback.indexOf('CREATE OR REPLACE FUNCTION')));
 const now=(await db.query('select now() as at')).rows[0].at, fetched=new Date(now).toISOString(),kickoff=new Date(+now+86400000).toISOString().replace('.000Z','Z');
 // Canonical second precision, exactly as the production validator expects.
 const start=new Date(kickoff);start.setUTCMilliseconds(0);const at=start.toISOString().replace('.000Z','Z');
 const fixture={key:'laliga-2026-27-j13-test-home-test-away',home:'test-home',away:'test-away',matchday:13,kickoff_at:at};
 const urls={futbolfantasy:'https://www.futbolfantasy.com/partidos/test',jornadaperfecta:'https://www.jornadaperfecta.com/partido/test',comuniate:'https://www.comuniate.com/partidos/test'};
 await db.query('insert into forecast_league.teams values ($1,$2)', ['test-home',JSON.stringify(urls)]);
 await db.query('insert into forecast_season.fixtures values ($1,13,$2,$3,$4,$5)',[fixture.key,fixture.home,fixture.away,at,JSON.stringify(urls)]);
 const obs=(i)=>({player_id:'test-'+i,prediction:i<=11?'starter':'alternative',probability:null});
 const sources=Object.entries(urls).map(([id,url])=>({id,url,status:'read',fetched_at:fetched,source_updated_at:null,fixture_verified:true,observed_fixture:fixture,starters:Array.from({length:11},(_,i)=>'Test player '+(i+1)),starter_ids:Array.from({length:11},(_,i)=>'test-'+(i+1)),player_observations:Array.from({length:12},(_,i)=>obs(i+1))}));
 sources.push({id:'predicted11',url:'https://www.predicted11.com/es/laliga/',status:'unavailable',fetched_at:fetched,source_updated_at:null,fixture_verified:false,rankings:[],predictions:[],player_observations:Array.from({length:12},(_,i)=>({player_id:'test-'+(i+1),prediction:'not_available',probability:null,votes:null,ballots:0}))});
 const evidence=(i)=>({method:'editorial-v4',confirmed_out:false,sources:sources.map(s=>{const o=s.player_observations[i-1];return {id:s.id,...Object.fromEntries(Object.entries(o).filter(([k])=>k!=='player_id')),reason:'Synthetic source observation.',refs:[s.url]};}),availability:{value:'concern',reason:'Synthetic availability observation.',refs:[urls.futbolfantasy]},rotation:{value:'low',reason:'Synthetic rotation observation.',refs:[urls.futbolfantasy]},horizon:{value:'near',reason:'Fixture within 48 hours.',refs:[urls.futbolfantasy]},context:{points:0,reason:'No additional adjustment.',refs:[urls.futbolfantasy]}});
 const p={schema_version:4,season:'2026-27',...fixture,fixture_key:fixture.key,team:fixture.home,opponent:fixture.away,probability_kind:'editorial_uncalibrated',publication_allowed:false,status:'draft',method_version:'editorial-v4',limitations:['Synthetic local test; never publish.'],sources,proposal:{formation:'4-2-3-1',players:Array.from({length:11},(_,i)=>({id:'test-'+(i+1),name:'Test player '+(i+1),slot:i+1,position:i===0?'GK':i<5?'DF':i<10?'MF':'FW',probability:90,alternative:null,reason:'Synthetic starter assessment.',assessment:evidence(i+1)}))}};
 const build=async input=>(await db.query('select forecast_season.build_team($1::jsonb) as p',[JSON.stringify(input)])).rows[0].p;
 const before=await build(p);
 const migration=read('docs/forecast-publish/candidates.sql');await db.exec(migration);
 const checksum=(await db.query("select md5(pg_get_functiondef('forecast_season.build_team(jsonb,interval)'::regprocedure)) as hash")).rows[0].hash;
 assert.equal(checksum,'6ae8dd0d18f6a80788d42b526b9faee5');
 assert.deepEqual(await build(p),before);
 p.proposal.candidates=[{id:'test-12',name:'Test player 12',probability:40,reason:'Synthetic candidate assessment.',assessment:evidence(12)}];
 const projected=await build(p);assert.equal(projected.players.length,11);assert.deepEqual(projected.players,before.players);assert.equal(projected.candidates[0].probability,40);assert.equal(projected.evidence_at,before.evidence_at);assert.equal(projected.candidates[0].assessment,undefined);
 const changes={duplicate:q=>q.proposal.candidates.push(q.proposal.candidates[0]),starter:q=>q.proposal.candidates[0].id='test-1',foreign:q=>q.proposal.candidates[0].id='foreign',name:q=>q.proposal.candidates[0].name='Other',out:q=>q.proposal.candidates[0].assessment.confirmed_out=true,score:q=>q.proposal.candidates[0].probability=60,fraction:q=>q.proposal.candidates[0].probability=40.5,observation:q=>q.proposal.candidates[0].assessment.sources[0].probability=100,missing:q=>q.sources[0].player_observations.pop(),votes:q=>q.proposal.candidates[0].assessment.sources[3].votes=1,refs:q=>q.proposal.candidates[0].assessment.sources[0].refs=['https://www.futbolfantasy.com/not-read'],slot:q=>q.proposal.candidates[0].slot=12,horizon:q=>q.proposal.candidates[0].assessment.horizon.value='distant',method:q=>q.proposal.candidates[0].assessment.method='editorial-v3',allNotListed:q=>{for(const s of q.sources.slice(0,3))s.player_observations[11].prediction='not_listed';for(const s of q.proposal.candidates[0].assessment.sources.slice(0,3))s.prediction='not_listed';q.proposal.candidates[0].probability=25;}};
 for(const [name,change] of Object.entries(changes))await t.test(name,async()=>{const bad=clone(p);change(bad);await assert.rejects(build(bad),e=>e.code==='22023');});
 await t.test('an alternative must have its own candidate assessment',async()=>{const q=clone(p);for(const s of q.sources.slice(0,3))s.player_observations[0].probability=60;const x=q.proposal.players[0];for(const s of x.assessment.sources.slice(0,3))s.probability=60;x.probability=60;x.alternative={id:'test-12',name:'Test player 12'};assert.equal((await build(q)).candidates[0].probability,40);q.proposal.candidates=[];await assert.rejects(build(q),e=>e.code==='22023');});
 await t.test('a starter in one source outside our XI receives its own weighted estimate',async()=>{
 const q=clone(p),ff=q.sources[0];ff.starter_ids[10]='test-12';ff.starters[10]='Test player 12';ff.player_observations[10].prediction='not_listed';ff.player_observations[11].prediction='starter';
 const starter=q.proposal.players[10],candidate=q.proposal.candidates[0];starter.assessment.sources[0].prediction='not_listed';candidate.assessment.sources[0].prediction='starter';
 for(const x of [starter,candidate])x.probability=(await db.query('select forecast_publish.assess($1::jsonb) as n',[JSON.stringify(x.assessment)])).rows[0].n;
 starter.alternative={id:candidate.id,name:candidate.name};const result=await build(q);assert.equal(result.candidates[0].probability,61);assert.equal(result.players[10].probability,62);assert.equal(result.players.length,11);
 });
 await t.test('Predicted11 votes use complete author ballots for each candidate',async()=>{
 const q=clone(p),p11=q.sources[3],names=q.sources[0].starters.slice(),ids=q.sources[0].starter_ids.slice();ids[10]='test-12';names[10]='Test player 12';
 const authors=Array.from({length:7},(_,i)=>({id:String(i+1),rank:i+1,url:'https://www.predicted11.com/es/usuario/Test'+(i+1)}));
 Object.assign(p11,{status:'read',fixture_verified:true,observed_fixture:fixture,rankings:[{kind:'club',url:'https://www.predicted11.com/es/laliga/ranking-equipo/test-home',fetched_at:fetched,authors},{kind:'global',url:'https://www.predicted11.com/es/laliga/ranking-global',fetched_at:fetched,authors}],predictions:authors.map((a,i)=>({author_id:a.id,url:a.url,fetched_at:fetched,status:i===0?'read':'not_created',source_updated_at:null,observed_fixture:fixture,starters:i===0?names:[],starter_ids:i===0?ids:[]}))});
 p11.player_observations.forEach(o=>Object.assign(o,{prediction:'consensus',ballots:1,votes:ids.includes(o.player_id)?1:0}));
 for(const x of [...q.proposal.players,...q.proposal.candidates]){Object.assign(x.assessment.sources[3],p11.player_observations.find(o=>o.player_id===x.id));delete x.assessment.sources[3].player_id;x.probability=(await db.query('select forecast_publish.assess($1::jsonb) as n',[JSON.stringify(x.assessment)])).rows[0].n;if(x.slot&&x.probability<70)x.alternative={id:'test-12',name:'Test player 12'};}
 assert.equal((await build(q)).candidates[0].probability,58);
 q.proposal.candidates[0].assessment.sources[3].votes=0;q.proposal.candidates[0].probability=28;await assert.rejects(build(q),e=>e.code==='22023');
 });
 await t.test('guarded rollback restores the exact original and refuses unrelated versions',async()=>{await db.exec(rollback);assert.deepEqual(await build({...p,proposal:{formation:p.proposal.formation,players:p.proposal.players}}),before);await assert.rejects(db.exec(rollback),/changed since review/);});
 }finally{await db.close();}
});
