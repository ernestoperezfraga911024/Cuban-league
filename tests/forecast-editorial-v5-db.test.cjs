'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8'),clone=x=>JSON.parse(JSON.stringify(x));
const migration=read('docs/forecast-publish/editorial-v5.sql');
async function setup(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema forecast_league;create schema forecast_season;create schema forecast_publish;
 create table forecast_league.teams(team text primary key,source_urls jsonb);
 create table forecast_league.roster(id text primary key,team text,name text);
 create table forecast_season.fixtures(key text primary key,matchday int,home text,away text,kickoff_at timestamptz,source_urls jsonb);
 create table forecast_season.drafts(team text primary key,payload jsonb,projection jsonb,checked_at timestamptz);
 create table public.forecast_season_public(team text primary key,payload jsonb,published_at timestamptz);
 create table forecast_season.archive(key text primary key,projection jsonb,published_at timestamptz);
 insert into forecast_league.roster select 'test-'||i,'test-home','Test player '||i from generate_series(1,25)i;`);
 const sql=read('docs/forecast-publish/editorial-v4.sql');
 await db.exec(sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION'),sql.indexOf('-- Arithmetic/evidence')));
 const rollback=read('docs/forecast-publish/candidates-rollback.sql');
 await db.exec(rollback.slice(rollback.indexOf('CREATE OR REPLACE FUNCTION')));
 await db.exec(read('docs/forecast-publish/candidates.sql'));
 await db.exec('revoke all on all functions in schema forecast_publish,forecast_season from public,anon,authenticated,service_role;');
 const now=(await db.query('select now() at')).rows[0].at,fetched=new Date(now).toISOString(),start=new Date(+now+86400000);start.setUTCMilliseconds(0);
 const fixture={key:'laliga-2026-27-j13-test-home-test-away',home:'test-home',away:'test-away',matchday:13,kickoff_at:start.toISOString().replace('.000Z','Z')};
 const urls={futbolfantasy:'https://www.futbolfantasy.com/partidos/test',jornadaperfecta:'https://www.jornadaperfecta.com/partido/test',comuniate:'https://www.comuniate.com/partidos/test'};
 await db.query('insert into forecast_league.teams values($1,$2)',[fixture.home,JSON.stringify(urls)]);
 await db.query('insert into forecast_season.fixtures values($1,13,$2,$3,$4,$5)',[fixture.key,fixture.home,fixture.away,fixture.kickoff_at,JSON.stringify(urls)]);
 const sources=Object.entries(urls).map(([id,url])=>({id,url,status:'read',fetched_at:fetched,source_updated_at:null,fixture_verified:true,observed_fixture:fixture,starters:Array.from({length:11},(_,i)=>'Test player '+(i+1)),starter_ids:Array.from({length:11},(_,i)=>'test-'+(i+1)),player_observations:Array.from({length:12},(_,i)=>({player_id:'test-'+(i+1),prediction:i<11?'starter':'alternative',probability:null}))}));
 sources.push({id:'predicted11',url:'https://www.predicted11.com/es/laliga/',status:'unavailable',fetched_at:fetched,source_updated_at:null,fixture_verified:false,rankings:[],predictions:[],player_observations:Array.from({length:12},(_,i)=>({player_id:'test-'+(i+1),prediction:'not_available',probability:null,votes:null,ballots:0}))});
 const e=i=>({method:'editorial-v4',confirmed_out:false,sources:sources.map(s=>{const {player_id,...ob}=s.player_observations[i-1];return{id:s.id,...ob,reason:'Synthetic source evidence.',refs:[s.url]};}),availability:{value:'concern',reason:'Synthetic availability context.',refs:[urls.futbolfantasy]},rotation:{value:'low',reason:'Synthetic rotation context.',refs:[urls.futbolfantasy]},horizon:{value:'near',reason:'Fixture within 48 hours.',refs:[urls.futbolfantasy]},context:{points:0,reason:'No additional adjustment.',refs:[urls.futbolfantasy]}});
 const p={schema_version:4,season:'2026-27',...fixture,fixture_key:fixture.key,team:fixture.home,opponent:fixture.away,probability_kind:'editorial_uncalibrated',publication_allowed:false,status:'draft',method_version:'editorial-v4',limitations:['Synthetic local test, never publish.'],sources,proposal:{formation:'4-2-3-1',players:Array.from({length:11},(_,i)=>({id:'test-'+(i+1),name:'Test player '+(i+1),slot:i+1,position:i===0?'GK':i<5?'DF':i<10?'MF':'FW',probability:90,alternative:null,reason:'Synthetic starter assessment.',assessment:e(i+1)})),candidates:[{id:'test-12',name:'Test player 12',probability:40,reason:'Synthetic candidate assessment.',assessment:e(12)}]}};
 return{db,p};
}
const assess=async(db,e)=>(await db.query('select forecast_publish.assess($1::jsonb) n',[JSON.stringify(e)])).rows[0].n;
const build=async(db,p)=>(await db.query('select forecast_season.build_team($1::jsonb) p',[JSON.stringify(p)])).rows[0].p;
async function version(db,p,v){const q=clone(p);q.method_version=v;for(const x of [...q.proposal.players,...q.proposal.candidates]){x.assessment.method=v;x.probability=await assess(db,x.assessment);}return q;}
function contest(p,who,method='editorial-v5'){
 const e=clone(p.proposal.players[0].assessment);e.method=method;
 for(const [i,prediction,probability] of who==='Lemar'?[[0,'starter',50],[1,'alternative',40],[2,'not_listed',null]]:[[0,'alternative',30],[1,'starter',60],[2,'starter',null]])Object.assign(e.sources[i],{prediction,probability});
 Object.assign(e.sources[3],{prediction:'consensus',probability:null,votes:who==='Lemar'?1:0,ballots:3});return e;
}
test('editorial v5 changes only the missing Comuniate starter percentage and preserves existing contracts',async t=>{
 const{db,p}=await setup();try{
 const previous=await build(db,p),legacy=[];
 for(const method of ['editorial-v3','editorial-v4'])for(const prediction of ['starter','alternative','not_listed'])for(const probability of [null,0,50,100]){const e=clone(p.proposal.players[0].assessment);e.method=method;Object.assign(e.sources[2],{prediction,probability});legacy.push({e,n:await assess(db,e)});}
 const v2=clone(p.proposal.players[0].assessment);v2.method='editorial-v2';v2.sources.pop();v2.role={value:90,reason:'Synthetic established role.',refs:v2.context.refs};legacy.push({e:v2,n:await assess(db,v2)});
 await db.query('insert into forecast_season.drafts values($1,$2,$3,now())',[p.team,JSON.stringify(p),JSON.stringify(previous)]);
 await db.query('insert into public.forecast_season_public values($1,$2,now())',[p.team,JSON.stringify(previous)]);
 await db.query('insert into forecast_season.archive values($1,$2,now())',['saved-history',JSON.stringify(previous)]);
 const snapshots=await db.query("select (select jsonb_agg(to_jsonb(x)) from forecast_season.drafts x) drafts,(select jsonb_agg(to_jsonb(x)) from public.forecast_season_public x) public,(select jsonb_agg(to_jsonb(x)) from forecast_season.archive x) archive");
 const metadata=()=>db.query("select oid,oid::regprocedure::text signature,proacl::text acl,prosecdef,proconfig from pg_proc where oid in('forecast_publish.assess(jsonb)'::regprocedure,'forecast_season.build_team(jsonb,interval)'::regprocedure) order by oid");const beforeMeta=(await metadata()).rows;
 await db.exec(migration);
 await t.test('v2/v3/v4 calculations, v4 projections, dates and saved rows stay identical',async()=>{
  for(const {e,n}of legacy)assert.equal(await assess(db,e),n);
  assert.deepEqual(await build(db,p),previous);
  assert.deepEqual((await db.query("select (select jsonb_agg(to_jsonb(x)) from forecast_season.drafts x) drafts,(select jsonb_agg(to_jsonb(x)) from public.forecast_season_public x) public,(select jsonb_agg(to_jsonb(x)) from forecast_season.archive x) archive")).rows,snapshots.rows);
 });
 await t.test('function identity, ACL, invoker security and empty search path are retained',async()=>{assert.deepEqual((await metadata()).rows,beforeMeta);for(const signature of ['forecast_publish.assess(jsonb)','forecast_season.build_team(jsonb,interval)'])for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,signature])).rows[0].allowed,false);});
 await t.test('Lemar remains 38 while Diangana changes 39 to 31 from the exact same observations',async()=>{assert.equal(await assess(db,contest(p,'Lemar','editorial-v4')),38);assert.equal(await assess(db,contest(p,'Lemar')),38);assert.equal(await assess(db,contest(p,'Diangana','editorial-v4')),39);assert.equal(await assess(db,contest(p,'Diangana')),31);});
 await t.test('all explicit Comuniate percentages, including 0 and 100, take precedence',async()=>{for(let pct=0;pct<=100;pct++){const e=contest(p,'Diangana');e.sources[2].probability=pct;assert.equal(await assess(db,e),Math.max(5,Math.min(95,Math.round(21+pct*.2))));}});
 await t.test('50 replaces 90 only for Comuniate starter with null percentage',async()=>{for(const index of [0,1,2])for(const prediction of ['starter','alternative','not_listed']){const e=contest(p,'Diangana');e.sources.forEach((s,i)=>{if(i<3)s.probability=50;});Object.assign(e.sources[index],{prediction,probability:null});const old=await assess(db,{...e,method:'editorial-v4'}),value=await assess(db,e);assert.equal(value,old-(index===2&&prediction==='starter'?8:0));}});
 await t.test('missing Predicted11 is omitted and the three source weights are renormalized',async()=>{const e=contest(p,'Diangana');Object.assign(e.sources[3],{prediction:'not_available',probability:null,votes:null,ballots:0});assert.equal(await assess(db,e),44);});
 await t.test('v5 main players and candidates project as v5 through the existing eleven validator',async()=>{const q=await version(db,p,'editorial-v5'),out=await build(db,q);assert.equal(out.players.length,11);assert.equal(out.players[0].probability,79);assert.equal(out.players[0].method,'editorial-v5');assert.equal(out.candidates[0].probability,40);assert.equal(out.candidates[0].method,'editorial-v5');assert.equal(out.candidates[0].assessment,undefined);assert.equal(out.evidence_at,previous.evidence_at);});
 await t.test('a Comuniate starter outside our XI gets the same v5 fallback in its candidate assessment',async()=>{const q=await version(db,p,'editorial-v5'),cm=q.sources[2];cm.starter_ids[10]='test-12';cm.starters[10]='Test player 12';cm.player_observations[10].prediction='not_listed';cm.player_observations[11].prediction='starter';q.proposal.players[10].assessment.sources[2].prediction='not_listed';q.proposal.candidates[0].assessment.sources[2].prediction='starter';for(const x of [q.proposal.players[10],q.proposal.candidates[0]])x.probability=await assess(db,x.assessment);const out=await build(db,q);assert.equal(out.players[10].probability,71);assert.equal(out.candidates[0].probability,43);});
 await t.test('crossing below 70 requires an evaluated alternative outside the eleven',async()=>{
  const old=clone(p);for(const [i,pct] of [[0,70],[1,50]]){old.sources[i].player_observations[0].probability=pct;old.proposal.players[0].assessment.sources[i].probability=pct;}old.proposal.players[0].probability=70;assert.equal((await build(db,old)).players[0].probability,70);
  const q=await version(db,old,'editorial-v5');assert.equal(q.proposal.players[0].probability,59);await assert.rejects(build(db,q),e=>e.code==='22023');q.proposal.players[0].alternative={id:'test-12',name:'Test player 12'};assert.equal((await build(db,q)).players[0].alternative.id,'test-12');q.proposal.candidates=[];await assert.rejects(build(db,q),e=>e.code==='22023');
 });
 await t.test('rotation/context, clamps, health and horizon rules remain v4-compatible',async()=>{for(const rotation of ['low','possible','high'])for(const horizon of ['near','medium','distant']){const e=contest(p,'Lemar');e.rotation.value=rotation;e.horizon.value=horizon;e.context.points=-2;assert.equal(await assess(db,e),await assess(db,{...e,method:'editorial-v4'}));}for(const pct of [0,100]){const e=contest(p,'Lemar');e.sources.slice(0,3).forEach(s=>s.probability=pct);e.sources[3].votes=pct?3:0;assert.equal(await assess(db,e),pct?95:5);}});
 await t.test('invalid v5 evidence and mixed assessment versions still fail closed',async()=>{
  for(const mutate of [e=>e.confirmed_out=true,e=>e.sources[2].probability=50.5,e=>delete e.sources[2].probability,e=>e.sources[2].probability='50',e=>e.sources[2].probability=101,e=>e.sources[2].prediction='unknown',e=>e.sources[2].id='unknown',e=>e.sources[2].refs=[],e=>e.sources[3].votes=4,e=>e.method='editorial-v6']){const e=contest(p,'Diangana');mutate(e);await assert.rejects(assess(db,e),e=>e.code==='22023');}
  for(const mutate of [q=>q.proposal.players[0].assessment.method='editorial-v4',q=>q.proposal.candidates[0].assessment.method='editorial-v4',q=>q.proposal.players[0].probability=90,q=>q.proposal.players[0].assessment.confirmed_out=true,q=>q.sources[0].player_observations[0].probability=10,q=>q.proposal.players.pop(),q=>q.sources[0].fetched_at='2020-01-01T00:00:00Z']){const q=await version(db,p,'editorial-v5');mutate(q);await assert.rejects(build(db,q),e=>e.code==='22023');}
 });
 await t.test('guard refuses repeat or unrelated function versions',async()=>{const hashes=(await db.query("select md5(pg_get_functiondef('forecast_publish.assess(jsonb)'::regprocedure)) assess,md5(pg_get_functiondef('forecast_season.build_team(jsonb,interval)'::regprocedure)) builder")).rows[0];await assert.rejects(db.exec(migration),/changed since review/);assert.deepEqual((await db.query("select md5(pg_get_functiondef('forecast_publish.assess(jsonb)'::regprocedure)) assess,md5(pg_get_functiondef('forecast_season.build_team(jsonb,interval)'::regprocedure)) builder")).rows[0],hashes);});
 }finally{await db.close();}
});
