'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8'),clone=x=>JSON.parse(JSON.stringify(x));
const migration=read('docs/forecast-publish/editorial-v6.sql');
const assess=async(db,e)=>(await db.query('select forecast_publish.assess($1::jsonb) n',[JSON.stringify(e)])).rows[0].n;
const build=async(db,p)=>(await db.query('select forecast_season.build_team($1::jsonb) p',[JSON.stringify(p)])).rows[0].p;
const metadata=async db=>(await db.query("select oid,oid::regprocedure::text signature,proacl::text acl,proowner,prosecdef,proconfig,provolatile from pg_proc where oid in('forecast_publish.assess(jsonb)'::regprocedure,'forecast_season.build_team(jsonb,interval)'::regprocedure) order by oid")).rows;
const hashes=async db=>(await db.query("select md5(pg_get_functiondef('forecast_publish.assess(jsonb)'::regprocedure)) assess,md5(pg_get_functiondef('forecast_season.build_team(jsonb,interval)'::regprocedure)) builder")).rows[0];
async function setup(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema forecast_league;create schema forecast_season;create schema forecast_publish;create schema forecast_health;
 create table forecast_league.teams(team text primary key,source_urls jsonb);
 create table forecast_league.roster(id text primary key,team text,name text);
 create table forecast_season.fixtures(key text primary key,matchday int,home text,away text,kickoff_at timestamptz,source_urls jsonb);
 create table forecast_season.drafts(team text primary key,payload jsonb,projection jsonb,checked_at timestamptz);
 create table public.forecast_season_public(team text primary key,payload jsonb,published_at timestamptz);
 create table forecast_season.archive(key text primary key,projection jsonb,published_at timestamptz);
 create table forecast_season.control(mode text,version int);insert into forecast_season.control values('Manual',17);
 create table forecast_season.attempts(team text,outcome text);insert into forecast_season.attempts values('test-withdrawn','withdrawn');
 create table forecast_health.drafts(team text,player_id text,payload jsonb);
 create table public.forecast_health_public(team text,player_id text,payload jsonb);
 insert into forecast_health.drafts values('test-home','test-1','{"status":"injured","source_label":"Lesionado"}');
 insert into public.forecast_health_public select * from forecast_health.drafts;
 alter table public.forecast_season_public enable row level security;
 grant select on public.forecast_season_public to anon;
 insert into forecast_league.roster select 'test-'||i,'test-home','Test player '||i from generate_series(1,25)i;`);
 const v4=read('docs/forecast-publish/editorial-v4.sql');await db.exec(v4.slice(v4.indexOf('CREATE OR REPLACE FUNCTION'),v4.indexOf('-- Arithmetic/evidence')));
 const previous=read('docs/forecast-publish/candidates-rollback.sql');await db.exec(previous.slice(previous.indexOf('CREATE OR REPLACE FUNCTION')));
 await db.exec(read('docs/forecast-publish/candidates.sql'));
 await db.exec(read('docs/forecast-publish/editorial-v5.sql'));
 await db.exec(read('docs/forecast-publish/source-summary.sql'));
 await db.exec('revoke all on all functions in schema forecast_publish,forecast_season from public,anon,authenticated,service_role;');
 const now=(await db.query('select now() at')).rows[0].at,fetched=new Date(now).toISOString(),start=new Date(+now+86400000);start.setUTCMilliseconds(0);
 const fixture={key:'laliga-2026-27-j13-test-home-test-away',home:'test-home',away:'test-away',matchday:13,kickoff_at:start.toISOString().replace('.000Z','Z')};
 const urls={futbolfantasy:'https://www.futbolfantasy.com/partidos/test',jornadaperfecta:'https://www.jornadaperfecta.com/partido/test',comuniate:'https://www.comuniate.com/partidos/test'};
 await db.query('insert into forecast_league.teams values($1,$2)',[fixture.home,JSON.stringify(urls)]);
 await db.query('insert into forecast_season.fixtures values($1,13,$2,$3,$4,$5)',[fixture.key,fixture.home,fixture.away,fixture.kickoff_at,JSON.stringify(urls)]);
 const sources=Object.entries(urls).map(([id,url])=>({id,url,status:'read',fetched_at:fetched,source_updated_at:null,fixture_verified:true,observed_fixture:fixture,starters:Array.from({length:11},(_,i)=>'Test player '+(i+1)),starter_ids:Array.from({length:11},(_,i)=>'test-'+(i+1)),player_observations:Array.from({length:12},(_,i)=>({player_id:'test-'+(i+1),prediction:i<11?'starter':'alternative',probability:null}))}));
 sources.push({id:'predicted11',url:'https://www.predicted11.com/es/laliga/',status:'unavailable',fetched_at:fetched,source_updated_at:null,fixture_verified:false,rankings:[],predictions:[],player_observations:Array.from({length:12},(_,i)=>({player_id:'test-'+(i+1),prediction:'not_available',probability:null,votes:null,ballots:0}))});
 const e=i=>({method:'editorial-v5',confirmed_out:false,sources:sources.map(s=>{const {player_id,...ob}=s.player_observations[i-1];return{id:s.id,...ob,reason:'Synthetic source evidence.',refs:[s.url]};}),availability:{value:'concern',reason:'Synthetic availability context.',refs:[urls.futbolfantasy]},rotation:{value:'low',reason:'Synthetic rotation context.',refs:[urls.futbolfantasy]},horizon:{value:'near',reason:'Fixture within 48 hours.',refs:[urls.futbolfantasy]},context:{points:0,reason:'No additional adjustment.',refs:[urls.futbolfantasy]}});
 const p={schema_version:4,season:'2026-27',...fixture,fixture_key:fixture.key,team:fixture.home,opponent:fixture.away,probability_kind:'editorial_uncalibrated',publication_allowed:false,status:'draft',method_version:'editorial-v5',limitations:['Synthetic local test, never publish.'],sources,proposal:{formation:'4-2-3-1',players:Array.from({length:11},(_,i)=>({id:'test-'+(i+1),name:'Test player '+(i+1),slot:i+1,position:i===0?'GK':i<5?'DF':i<10?'MF':'FW',probability:79,alternative:null,reason:'Synthetic starter assessment.',assessment:e(i+1)})),candidates:[{id:'test-12',name:'Test player 12',probability:40,reason:'Synthetic candidate assessment.',assessment:e(12)}]}};
 return{db,p};
}
async function asV6(db,p){const q=clone(p);q.method_version='editorial-v6';for(const x of [...q.proposal.players,...q.proposal.candidates]){x.assessment={method:'editorial-v6',sources:x.assessment.sources};x.probability=await assess(db,x.assessment);}return q;}
const snapshot=async db=>(await db.query(`select
 (select jsonb_agg(to_jsonb(x) order by team) from forecast_season.drafts x) drafts,
 (select jsonb_agg(to_jsonb(x) order by team) from public.forecast_season_public x) public,
 (select jsonb_agg(to_jsonb(x) order by key) from forecast_season.archive x) archive,
 (select jsonb_agg(to_jsonb(x) order by id) from forecast_league.roster x) roster,
 (select jsonb_agg(to_jsonb(x)) from forecast_season.control x) control,
 (select jsonb_agg(to_jsonb(x)) from forecast_season.attempts x) attempts,
 (select jsonb_agg(to_jsonb(x)) from forecast_health.drafts x) health,
 (select jsonb_agg(to_jsonb(x)) from public.forecast_health_public x) public_health,
 (select jsonb_agg(jsonb_build_object('oid',c.oid,'acl',c.relacl,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity) order by c.oid) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in('forecast_league','forecast_season','forecast_health','public')) tables`)).rows[0];
const variants=[{}, {confirmed_out:true}, {confirmed_out:null,availability:{value:'injured'}}, {confirmed_out:false,availability:{value:'doubt',refs:[]}}, {availability:'unavailable',rotation:{value:'high'},context:{points:-10},horizon:{value:'distant'}}, {availability:{value:'available',reason:'A different medical report.'},rotation:null,context:{points:9999},horizon:null}, {health:{status:'injured',source:'external'},role:{value:0},confirmed_out:['test-1']}];

test('starter alternatives apply only to v6 and preserve all rows, percentages and function metadata',async()=>{
 const{db,p}=await setup();try{
  await db.exec(migration);const q=await asV6(db,p),before=await build(db,q),legacy=await build(db,p);
  await db.query('insert into forecast_season.drafts values($1,$2,$3,now())',[q.team,JSON.stringify(q),JSON.stringify(before)]);
  const rows=await snapshot(db),meta=await metadata(db),oldHashes=await hashes(db);
  const low=x=>{for(const s of x.sources.slice(0,3))s.player_observations[1].probability=50;for(const s of x.proposal.players[1].assessment.sources.slice(0,3))s.probability=50;Object.assign(x.proposal.players[1],{probability:50,alternative:{id:'test-3',name:'Test player 3'}});};
  low(q);await assert.rejects(build(db,q),/Falta alternativa fuera del once/);
  await db.exec(read('docs/forecast-publish/starter-alternatives.sql'));
  assert.deepEqual(await snapshot(db),rows);assert.deepEqual(await metadata(db),meta);assert.equal((await hashes(db)).assess,oldHashes.assess);
  assert.deepEqual(await build(db,p),legacy);
  const out=await build(db,q);assert.equal(out.players.length,11);assert.equal(out.candidates.length,1);
  assert.equal(out.players[1].alternative.id,'test-3');assert.equal(out.players[1].probability,50);assert.equal(out.players[2].probability,79);
  for(const metadata of variants){const x=clone(q);Object.assign(x.proposal.players[1].assessment,metadata);assert.deepEqual(await build(db,x),out);}
  const old=clone(p);low(old);await assert.rejects(build(db,old),/Falta alternativa/);
  for(const id of ['test-2','unknown','test-24']){const x=clone(q);x.proposal.players[1].alternative.id=id;await assert.rejects(build(db,x));}
  const duplicate=clone(q);duplicate.sources[0].player_observations.push({...duplicate.sources[0].player_observations[1]});await assert.rejects(build(db,duplicate),/Identidades de fuente/);
  const changed=clone(q);changed.proposal.players[2].probability=50;await assert.rejects(build(db,changed));
  const final=await hashes(db);assert.equal(final.builder,'105206b17439613a07159868f261bc9e');await assert.rejects(db.exec(read('docs/forecast-publish/starter-alternatives.sql')),/changed since starter-alternative review/);await db.exec('rollback');assert.deepEqual(await hashes(db),final);
  await db.exec(read('docs/forecast-publish/starter-alternatives-rollback.sql'));assert.deepEqual(await hashes(db),oldHashes);assert.deepEqual(await snapshot(db),rows);assert.deepEqual(await metadata(db),meta);await assert.rejects(build(db,q),/Falta alternativa fuera del once/);
 }finally{await db.close();}
});

test('source-only v6 preserves older methods and makes forecasts invariant to external metadata',async t=>{
 const{db,p}=await setup();try{
  assert.deepEqual(await hashes(db),{assess:'1e3dae90e7f37624d6b5ca686835cefe',builder:'f30f730355203b835804b2f6c08b7188'});
  const oldProjection=await build(db,p),legacy=[];
  for(const method of ['editorial-v3','editorial-v4','editorial-v5'])for(const availability of ['clear','concern','unknown'])for(const rotation of ['low','possible','high'])for(const points of [-10,0,10]){const e=clone(p.proposal.players[0].assessment);e.method=method;e.availability.value=availability;e.rotation.value=rotation;e.context.points=points;legacy.push({e,n:await assess(db,e)});}
  const v2=clone(p.proposal.players[0].assessment);v2.method='editorial-v2';v2.sources.pop();v2.role={value:90,reason:'Synthetic role evidence.',refs:v2.context.refs};legacy.push({e:v2,n:await assess(db,v2)});
  const v1={method:'editorial-v1',confirmed_out:false};for(const[key,value]of Object.entries({role:'preferred',availability:'concern',rotation:'possible',agreement:'disputed',quality:'secondary',horizon:'distant'}))v1[key]={value,reason:'Synthetic legacy assessment.',refs:v2.context.refs};legacy.push({e:v1,n:await assess(db,v1)});
  await db.query('insert into forecast_season.drafts values($1,$2,$3,now())',[p.team,JSON.stringify(p),JSON.stringify(oldProjection)]);
  await db.query('insert into public.forecast_season_public values($1,$2,now())',[p.team,JSON.stringify(oldProjection)]);
  await db.query('insert into forecast_season.archive values($1,$2,now())',['saved-history',JSON.stringify(oldProjection)]);
  const beforeRows=await snapshot(db),beforeMeta=await metadata(db);
  await db.exec(migration);
  await t.test('v1-v5 arithmetic and v5 projection, saved rows, dates, modes, withdrawals and catalog remain exact',async()=>{for(const {e,n}of legacy)assert.equal(await assess(db,e),n);assert.deepEqual(await build(db,p),oldProjection);assert.deepEqual(await snapshot(db),beforeRows);});
  await t.test('function identity, ACL/RLS, invoker and volatility metadata remain unchanged',async()=>{assert.deepEqual(await metadata(db),beforeMeta);for(const signature of ['forecast_publish.assess(jsonb)','forecast_season.build_team(jsonb,interval)'])for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,signature])).rows[0].allowed,false);});
  await t.test('minimal v6 input and every medical or editorial metadata variant yield the same percentage',async()=>{const e={method:'editorial-v6',sources:clone(p.proposal.players[0].assessment.sources)};assert.equal(await assess(db,e),79);for(const metadata of variants)assert.equal(await assess(db,{...e,...metadata}),79);});
  await t.test('30/20/20/30 weighting, explicit zero, Comuniate fallback and missing-P11 normalization are retained',async()=>{
   const e={method:'editorial-v6',sources:clone(p.proposal.players[0].assessment.sources)};
   Object.assign(e.sources[0],{probability:80});Object.assign(e.sources[1],{probability:60});Object.assign(e.sources[3],{prediction:'consensus',votes:3,ballots:4});
   assert.equal(await assess(db,e),69);
   for(let pct=0;pct<=100;pct++){e.sources[2].probability=pct;assert.equal(await assess(db,e),Math.max(5,Math.min(95,Math.round(58.5+pct*.2))));}
   e.sources[2].probability=null;Object.assign(e.sources[3],{prediction:'not_available',votes:null,ballots:0});assert.equal(await assess(db,e),66);
   for(const [index,weight]of [[0,30],[1,20],[2,20]])for(const prediction of ['starter','alternative','not_listed']){const q=clone(e);q.sources.slice(0,3).forEach(s=>s.probability=50);Object.assign(q.sources[index],{prediction,probability:null});const signal=prediction==='starter'?(index===2?50:90):prediction==='alternative'?40:25;assert.equal(await assess(db,q),Math.round((50*(70-weight)+signal*weight)/70));}
   for(const value of [0,100]){const q=clone(e);q.sources.slice(0,3).forEach(s=>s.probability=value);assert.equal(await assess(db,q),value?95:5);}
  });
  await t.test('valid P11 vote counts retain their exact consensus fraction and invalid counts fail',async()=>{const e={method:'editorial-v6',sources:clone(p.proposal.players[0].assessment.sources)};e.sources.slice(0,3).forEach(s=>s.probability=50);for(let ballots=1;ballots<=14;ballots++)for(let votes=0;votes<=ballots;votes++){Object.assign(e.sources[3],{prediction:'consensus',votes,ballots});assert.equal(await assess(db,e),Math.max(5,Math.min(95,Math.round(35+30*votes/ballots))));}e.sources[3].votes=15;await assert.rejects(assess(db,e),x=>x.code==='22023');});
  await t.test('complete v6 projection keeps XI, candidates, slots, alternatives and source summary unchanged across health variations',async()=>{
   const q=await asV6(db,p);for(const source of q.sources.slice(0,3))source.player_observations[0].probability=50;for(const source of q.proposal.players[0].assessment.sources.slice(0,3))source.probability=50;
   q.proposal.players[0].probability=50;q.proposal.players[0].alternative={id:'test-12',name:'Test player 12'};
   const baseline=await build(db,q);assert.equal(baseline.players[0].method,'editorial-v6');assert.equal(baseline.players[0].probability,50);assert.equal(baseline.players[0].alternative.id,'test-12');assert.equal(baseline.candidates[0].method,'editorial-v6');assert.equal(baseline.players[0].assessment,undefined);
   for(const metadata of variants){const variant=clone(q);for(const x of [...variant.proposal.players,...variant.proposal.candidates])Object.assign(x.assessment,metadata);assert.deepEqual(await build(db,variant),baseline);}
   for(const status of ['injured','doubt','available']){await db.query('update forecast_health.drafts set payload=$1',[JSON.stringify({status,source_label:'Synthetic changed physical label'})]);await db.query('update public.forecast_health_public set payload=$1',[JSON.stringify({status,source_label:'Synthetic changed physical label'})]);assert.deepEqual(await build(db,q),baseline);}
   await db.exec('delete from forecast_health.drafts;delete from public.forecast_health_public');assert.deepEqual(await build(db,q),baseline);
   const missing=clone(q);missing.proposal.players[0].alternative=null;await assert.rejects(build(db,missing),x=>x.code==='22023');
  });
  await t.test('bad sources, mixed versions, stale evidence, changed observations and missing players still fail closed',async()=>{
   const e={method:'editorial-v6',sources:clone(p.proposal.players[0].assessment.sources)};
   for(const mutate of [e=>e.sources.pop(),e=>e.sources[0].id='unknown',e=>e.sources[0].refs=[],e=>e.sources[0].probability=50.5,e=>e.sources[0].probability='50',e=>delete e.sources[0].probability,e=>e.sources[0].prediction='injured',e=>e.sources[3].votes=0]){const bad=clone(e);mutate(bad);await assert.rejects(assess(db,bad),x=>x.code==='22023');}
   for(const mutate of [q=>q.proposal.players[0].assessment.method='editorial-v5',q=>q.proposal.candidates[0].assessment.method='editorial-v5',q=>q.sources[0].fetched_at='2020-01-01T00:00:00Z',q=>q.proposal.players[0].probability=90,q=>q.proposal.players[0].id='foreign',q=>q.proposal.players.pop(),q=>q.sources[0].player_observations[0].probability=20,q=>q.proposal.players[0].position='FW',q=>q.kickoff_at='2020-01-01T00:00:00Z']){const bad=await asV6(db,p);mutate(bad);await assert.rejects(build(db,bad),x=>x.code==='22023');}
   const old=clone(p);old.proposal.players[0].assessment.confirmed_out=true;await assert.rejects(build(db,old),x=>x.code==='22023');
  });
  await t.test('reinstall guard aborts without changing any function or protected row',async()=>{const before=await hashes(db),rows=await snapshot(db);await assert.rejects(db.exec(migration),/changed since v6 review/);await db.exec('rollback');assert.deepEqual(await hashes(db),before);assert.deepEqual(await snapshot(db),rows);});
 }finally{await db.close();}
});

test('v6 passes the existing save/deliver path and preserves saved v5, delivery modes and idempotence',async t=>{
 const {db,p}=await setup();try{
  // Use the production table and mutation definitions; only the scheduler is
  // controlled here, so this local test is independent of the wall-clock slot.
  const season=read('docs/forecast-publish/season.sql'),v3=read('docs/forecast-publish/predicted11-v3.sql');
  await db.exec(`drop table forecast_season.control,forecast_season.drafts,forecast_season.attempts,forecast_season.archive,public.forecast_season_public;
   alter table forecast_season.fixtures add column verified_at timestamptz default now();`);
  for(const name of ['forecast_season.control','forecast_season.runs','forecast_season.drafts','forecast_season.attempts','forecast_season.archive','public.forecast_season_public']){
   const start=season.indexOf('create table '+name+'(');assert.ok(start>=0,name);
   await db.exec(season.slice(start,season.indexOf(';',start)+1));
  }
  await db.exec(`insert into forecast_season.control(singleton,mode) values(true,'automatic');
   insert into forecast_season.drafts(team) values('test-home');
   insert into public.forecast_season_public(team,status) values('test-home','pending');
   create function forecast_season.plan() returns jsonb language sql stable set search_path='' as $$
    select jsonb_build_object('run_key',(select key from forecast_season.runs order by slot_at desc limit 1)) $$;
   alter table public.forecast_season_public enable row level security;
   grant select on public.forecast_season_public to anon;
   create policy published_season_read on public.forecast_season_public for select to anon using(true);`);
  for(const [source,head,tail]of [
   [v3,'CREATE OR REPLACE FUNCTION forecast_season.check_attempt','$function$;'],
   [season,'create function forecast_season.save_draft','$body$;'],
   [v3,'CREATE OR REPLACE FUNCTION forecast_season.publish_team','$function$;'],
   [season,'create function forecast_season.deliver','$body$;']
  ]){const start=source.indexOf(head);assert.ok(start>=0,head);await db.exec(source.slice(start,source.indexOf(tail,start)+tail.length));}
  await db.exec('revoke all on all functions in schema forecast_season from public,anon,authenticated,service_role;');
  const startRun=async key=>db.query("insert into forecast_season.runs(key,slot_at,expected) values($1,clock_timestamp(),'[\"test-home\"]')",[key]);
  const save=async(key,payload)=>(await db.query('select forecast_season.save_draft($1,$2::jsonb) result',[key,JSON.stringify(payload)])).rows[0].result;
  const deliver=async key=>(await db.query('select forecast_season.deliver($1) result',[key+'-test-home'])).rows[0].result;
  const publicRow=async()=>(await db.query("select to_jsonb(p) row from public.forecast_season_public p where team='test-home'")).rows[0].row;
  const draft=async()=>(await db.query("select to_jsonb(d) row from forecast_season.drafts d where team='test-home'")).rows[0].row;
  const oldProjection=await build(db,p);await startRun('test-saved-v5');await save('test-saved-v5',p);
  const savedBefore=await draft();await db.exec(migration);
  await t.test('an already-saved v5 draft is delivered without relabeling or changing its payload',async()=>{
   assert.deepEqual(await draft(),savedBefore);
   assert.equal((await deliver('test-saved-v5')).outcome,'published');
   assert.deepEqual((await publicRow()).payload,oldProjection);assert.deepEqual((await draft()).payload,p);
  });
  const q=await asV6(db,p),expected=await build(db,q);await startRun('test-new-v6');
  for(const player of [...q.proposal.players,...q.proposal.candidates])Object.assign(player.assessment,{confirmed_out:true,availability:{value:'injured'},rotation:{value:'high'},context:{points:-10}});
  await t.test('v6 saves and publishes exact source-only XI and candidates despite injuries and conflicting metadata',async()=>{
   assert.equal((await save('test-new-v6',q)).outcome,'saved');
   await db.exec(`update forecast_health.drafts set payload='{"status":"doubt"}';update public.forecast_health_public set payload='{"status":"injured"}';`);
   assert.equal((await deliver('test-new-v6')).outcome,'published');
   assert.deepEqual((await publicRow()).payload,expected);assert.deepEqual((await draft()).projection,expected);
   assert.equal((await publicRow()).payload.players.length,11);assert.equal((await publicRow()).payload.candidates.length,1);
   const archive=(await db.query("select projection from forecast_season.archive where team='test-home'")).rows[0].projection;assert.deepEqual(archive,expected);
   await db.exec('set role anon');try{assert.deepEqual((await publicRow()).payload,expected);}finally{await db.exec('reset role');}
  });
  await t.test('response-loss retries leave the saved payload, public timestamps and archive unchanged',async()=>{
   const beforePublic=await publicRow(),beforeDraft=await draft(),beforeArchive=(await db.query('select to_jsonb(a) row from forecast_season.archive a')).rows;
   assert.equal((await save('test-new-v6',q)).already_saved,true);assert.equal((await deliver('test-new-v6')).already_delivered,true);
   assert.deepEqual(await publicRow(),beforePublic);assert.deepEqual(await draft(),beforeDraft);assert.deepEqual((await db.query('select to_jsonb(a) row from forecast_season.archive a')).rows,beforeArchive);
  });
  await t.test('manual and withdrawn teams remain private ready instead of publishing v6 automatically',async()=>{
   const previous=(await publicRow()).payload;
   for(const [key,mode,paused]of [['test-manual-v6','manual',false],['test-paused-v6','automatic',true]]){
    await db.query('update forecast_season.control set mode=$1',[mode]);await db.query('update forecast_season.drafts set paused=$1',[paused]);
    if(paused)await db.exec("update public.forecast_season_public set status='withdrawn'");
    await startRun(key);await save(key,q);assert.equal((await deliver(key)).outcome,'ready');
    assert.deepEqual((await publicRow()).payload,previous);assert.equal((await publicRow()).status,paused?'withdrawn':'ready');assert.equal((await draft()).outcome,'ready');
   }
  });
 }finally{await db.close();}
});

test('priority guard rejects inversions independently, preserves legacy/data/metadata and rolls back exactly',async()=>{
 const {db,p}=await setup();try{
  await db.exec(migration);await db.exec(read('docs/forecast-publish/starter-alternatives.sql'));
  const q=await asV6(db,p),legacy=await build(db,p),baseline=await build(db,q),rows=await snapshot(db),meta=await metadata(db),prior=await hashes(db);
  for(const s of q.sources.slice(0,3))s.player_observations[1].probability=50;
  for(const s of q.proposal.players[1].assessment.sources.slice(0,3))s.probability=50;
  Object.assign(q.proposal.players[1],{probability:50,alternative:{id:'test-3',name:'Test player 3'}});
  assert.equal((await build(db,q)).players[1].probability,50);
  await db.exec(read('docs/forecast-publish/selection-priority.sql'));
  assert.equal((await hashes(db)).builder,'12773c40d7f05de2ba5b01b824204f9d');
  assert.deepEqual(await snapshot(db),rows);assert.deepEqual(await metadata(db),meta);assert.deepEqual(await build(db,p),legacy);
  await assert.rejects(build(db,q),/alternativa supera al titular/);
  // Another starter remains a valid alternative at equal or lower probability.
  for(const s of q.sources.slice(0,3))s.player_observations[2].probability=50;
  for(const s of q.proposal.players[2].assessment.sources.slice(0,3))s.probability=50;
  Object.assign(q.proposal.players[2],{probability:50,alternative:{id:'test-12',name:'Test player 12'}});
  assert.equal((await build(db,q)).players[1].alternative.id,'test-3');
  const missing=clone(q);delete missing.proposal.candidates;await assert.rejects(build(db,missing),/alternativa supera al titular/);
  await db.exec(read('docs/forecast-publish/selection-priority-rollback.sql'));
  assert.deepEqual(await hashes(db),prior);assert.deepEqual(await snapshot(db),rows);assert.deepEqual(await metadata(db),meta);
  assert.equal(baseline.players.length,11);
 }finally{await db.close();}
});

test('interactive correction changes only reviewed current pairs and keeps evidence, timestamps, archive and original attempts',async()=>{
 const {db,p}=await setup();try{
  await db.exec(migration);await db.exec(read('docs/forecast-publish/starter-alternatives.sql'));
  const q=await asV6(db,p);
  for(const s of q.sources.slice(0,3)){s.player_observations[6].probability=43;s.player_observations[11].probability=55;}
  for(const s of q.proposal.players[6].assessment.sources.slice(0,3))s.probability=43;
  for(const s of q.proposal.candidates[0].assessment.sources.slice(0,3))s.probability=55;
  Object.assign(q.proposal.players[6],{probability:43,alternative:{id:'test-12',name:'Test player 12'}});q.proposal.candidates[0].probability=55;
  const original=await build(db,q);
  await db.exec("alter table forecast_season.drafts add paused boolean default false,add outcome text default 'published';alter table public.forecast_season_public add status text default 'published';create schema automation_ops;create table automation_ops.receipts(payload jsonb);create function automation_ops.record_run(p jsonb) returns jsonb language plpgsql as $$begin insert into automation_ops.receipts values(p);return p;end$$;");
  await db.query('insert into forecast_season.drafts(team,payload,projection,checked_at) values($1,$2,$3,now())',[q.team,JSON.stringify(q),JSON.stringify(original)]);
  await db.query('insert into public.forecast_season_public(team,payload,published_at) values($1,$2,now())',[q.team,JSON.stringify(original)]);
  await db.query('insert into forecast_season.archive values($1,$2,now())',['unchanged-history',JSON.stringify(original)]);
  const before=await snapshot(db);
  const t=(await db.query("select d.team,md5(to_jsonb(d)::text) draft_hash,md5(to_jsonb(p)::text) public_hash from forecast_season.drafts d join public.forecast_season_public p using(team)")).rows[0];
  t.pairs=[{from:'test-7',to:'test-12'}];
  await db.exec(read('docs/forecast-publish/selection-priority.sql'));
  const {repairSql}=require('../scripts/forecast/priority-repair.cjs');
  const sql=repairSql({targets:[t],codeSha:'a'.repeat(40),executionKey:'cuban-league-20261117t150000z'});
  const stale=repairSql({targets:[{...t,public_hash:'0'.repeat(32)}],codeSha:'a'.repeat(40),executionKey:'cuban-league-20261117t150000z'});
  await assert.rejects(db.exec(stale),/Current publication changed/);await db.exec('rollback');assert.deepEqual(await snapshot(db),before);
  await db.exec(sql);
  const after=await snapshot(db),current=after.public[0].payload;
  assert.equal(current.players[6].id,'test-12');assert.equal(current.players[6].probability,55);assert.equal(current.players[6].alternative.id,'test-7');assert.equal(current.candidates[0].probability,43);
  assert.deepEqual(current.sources,original.sources);assert.equal(current.evidence_at,original.evidence_at);
  assert.equal(after.public[0].published_at,before.public[0].published_at);assert.equal(after.drafts[0].checked_at,before.drafts[0].checked_at);
  assert.deepEqual(after.drafts[0].payload.sources,before.drafts[0].payload.sources);
  for(const key of Object.keys(before).filter(k=>!['drafts','public'].includes(k)))assert.deepEqual(after[key],before[key]);
  assert.deepEqual(after.drafts[0].projection,current);
  const audit=(await db.query('select payload from automation_ops.receipts')).rows[0].payload;
  assert.equal(audit.status,'maintenance');assert.equal(audit.report.checks.length,5);assert.ok(audit.report.checks.every(x=>typeof x==='string'&&x.length<=180));
  await assert.rejects(db.exec(sql),/Current publication changed/);await db.exec('rollback');assert.deepEqual(await snapshot(db),after);
 }finally{await db.close();}
});
