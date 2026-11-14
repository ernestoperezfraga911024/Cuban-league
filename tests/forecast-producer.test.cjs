'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {compile,fixtureOf}=require('../scripts/forecast/editorial-producer.cjs');
const {SeasonGateway,literal,verifyPublication}=require('../scripts/forecast/season-gateway.cjs');
const {runSeason}=require('../scripts/forecast/season-workflow.cjs');
const {example}=require('./fixtures/forecast-producer.cjs');
const produce=x=>compile(x.packet,x.review,x.roster,x.window);
test('producer builds v5 eleven, independent candidate and absent P11 without a zero vote',()=>{
 const x=example(),{payload}=produce(x);
 assert.equal(payload.proposal.players[0].probability,79);assert.equal(payload.proposal.candidates[0].probability,40);
 assert.equal(payload.proposal.candidates.length,1);assert.equal(payload.sources[2].player_observations[0].probability,null);
 assert.equal(payload.sources[3].player_observations[0].votes,null);assert.equal(payload.publication_allowed,false);
 assert.equal(payload.proposal.players[0].alternative,null);
 x.packet.observations.comuniate[0].probability=0;
 assert.equal(produce(x).payload.proposal.players[0].probability,64);
 assert.equal(produce(x).payload.proposal.players[0].alternative.id,x.roster[11].id);
});
test('producer rejects official XI, stale body review, stale reads, foreign IDs and incomplete alternatives',()=>{
 for(const mutate of [x=>x.review.sources.comuniate.forecast=false,x=>x.review.sources.futbolfantasy.fixture_sha256='old',x=>x.packet.docs.futbolfantasy.fetched_at='2020-01-01T00:00:00Z',x=>x.review.selection.players[0].id='someone-else',x=>x.review.sources.comuniate.alternatives_complete=false,x=>x.review.availability_reviewed=false,x=>x.review.sources.comuniate.observed_fixture.matchday=14]) {
  const x=example();mutate(x);assert.throws(()=>produce(x));
 }
 const x=example();x.packet.observations.comuniate[0].probability=0;delete x.review.selection.players[0].alternative_id;assert.throws(()=>produce(x),/alternativa evaluada/);
});
test('confirmed outs keep source evidence but are absent from proposals and candidates',()=>{
 const x=example();x.review.confirmed_out=[{id:x.roster[11].id,reason:'Baja confirmada para este partido de prueba.',refs:[x.packet.docs.futbolfantasy.url]}];
 assert.equal(produce(x).payload.proposal.candidates.length,0);
 x.review.confirmed_out[0].id=x.roster[0].id;assert.throws(()=>produce(x),/baja confirmada/);
});
test('uncertain optional candidate is explicitly excluded; mandatory identity still fails',()=>{
 const x=example();x.review.sources.comuniate.alternatives.push({name:'Unknown optional',probability:null});
 assert.throws(()=>produce(x),/identidad sin resolver/);
 x.review.exclusions=[{source:'comuniate',name:'Unknown optional',reason:'No se puede resolver el homónimo en el catálogo.'}];
 assert.equal(produce(x).payload.proposal.candidates.length,1);
 x.packet.observations.comuniate[0].name='Unknown mandatory';assert.throws(()=>produce(x),/Unknown mandatory/);
});
test('complete P11 votes, missing, failed and incomplete authors have distinct denominators',()=>{
 const x=example(),at=x.window.notBefore;
 const authors=Array.from({length:7},(_,i)=>({id:String(i+1),rank:i+1,url:'https://www.predicted11.com/es/usuario/'+(i===0?'FutbolFantasy':'author'+i)}));
 x.packet.rankings=['club','global'].map(kind=>({kind,url:'https://www.predicted11.com/es/laliga/'+(kind==='club'?'ranking-equipo/test-home':'ranking-global'),fetched_at:at,authors}));
 x.packet.docs.p11match={url:'https://www.predicted11.com/es/laliga/partido/test',fetched_at:at,sha256:'b'.repeat(64)};
 x.review.predicted11={fixture_verified:true,fixture_sha256:'b'.repeat(64),season:'2026-27',observed_fixture:fixtureOf(x.review.fixture)};
 x.packet.predictions=authors.slice(1).map((a,i)=>({author_id:a.id,url:a.url,fetched_at:at,ballot_fetched_at:at,status:i===0?'complete_unvalidated':i===1?'incomplete':i===2?'unavailable':'not_created',data:{participacion:x.roster.slice(0,11).map(p=>({nombre:p.name}))}}));
 const {payload}=produce(x),p11=payload.sources[3];
 assert.equal(p11.predictions.length,6);assert.equal(p11.player_observations[0].ballots,1);assert.equal(p11.player_observations[0].votes,1);
 assert.equal(payload.proposal.players[0].probability,85);assert.equal(p11.player_observations.at(-1).votes,0);
 x.packet.predictions[0].data.participacion[0].nombre='Unknown P11';assert.throws(()=>produce(x),/Unknown P11/);
});
test('SQL gateway pins destination, quotes payload and sets recovery context in every transaction',async()=>{
 const calls=[],g=new SeasonGateway({runKey:'season-test',recoveryRequest:'0a06b96d-430c-43f3-821c-4688125cf697',execute:async args=>calls.push(args)});
 await g.plan();await g.state();await g.save('test-home',{reason:"$forecast$ ' ; DROP TABLE test;"});await g.deliver('test-home');await g.finish();
 for(const c of calls){assert.equal(c.project_id,'pyahosamoisqcbpvzwka');assert.match(c.query,/^BEGIN;/);assert.match(c.query,/set_config\('forecast_season.recovery_request'/);assert.match(c.query,/COMMIT;$/);}
 assert.match(calls[2].query,/FOR UPDATE/);assert.match(calls[2].query,/Overlapping active recovery/);
 assert.equal(literal('$forecast$'),'$forecastx$$forecast$$forecastx$');
});
function mockGateway({mode='automatic',initial=null,deliveryError=false,corrupt=false}={}) {
 const x=example(),team=x.packet.team,key='season-test',calls=[],attempts=initial?[{team,outcome:initial,fixture_key:x.review.fixture.key,published_at:x.window.notBefore}]:[];
 let draft=initial?{run_key:key+'-'+team,payload:{method_version:'editorial-v4'},projection:{...produce(x).payload,method_version:'editorial-v4',team,players:produce(x).payload.proposal.players,evidence_at:x.window.notBefore,fixture_key:x.review.fixture.key}}:null,pub=null;
 const run={key,expected:[team],slot_at:x.window.notBefore,started_at:x.window.notBefore};
 const state=()=>({observed_at:x.window.notBefore,run,attempts:structuredClone(attempts),draft:structuredClone(draft),public:structuredClone(pub),recovery:null});
 const gateway={runKey:key,recoveryRequest:null,state:async()=>state(),plan:async()=>({run_key:key,teams:[{team,fixture:x.review.fixture}]}),roster:async()=>x.roster,
 validate:async(t,f,p)=>{calls.push('validate');return {scores:[...p.proposal.players,...p.proposal.candidates].map(z=>({id:z.id,probability:z.probability})),projection:{...p,players:p.proposal.players,candidates:p.proposal.candidates,evidence_at:p.sources[0].fetched_at}};},
 save:async(t,p)=>{calls.push('save');draft={run_key:key+'-'+team,payload:p,projection:{...p,players:p.proposal.players,candidates:p.proposal.candidates,evidence_at:p.sources[0].fetched_at}};attempts.push({team,outcome:'saved',fixture_key:p.fixture_key});},
 deliver:async()=>{calls.push('deliver');if(deliveryError)throw Error('Connection lost');attempts[0].outcome=mode==='automatic'?'published':'ready';attempts[0].published_at=new Date().toISOString();pub={status:attempts[0].outcome,payload:structuredClone(draft.projection),published_at:attempts[0].published_at};if(corrupt)pub.payload.players.pop();},
 finish:async()=>{calls.push('finish');return {complete:attempts[0]?.outcome==='published',publication_complete:attempts[0]?.outcome==='published'};}};
 return {x,gateway,calls};
}
async function runMock(config,reviewChange) {
 const m=mockGateway(config);let collected=0;
 const result=await runSeason({gateway:m.gateway,makeCollector:async()=>({reader:{close(){},stats(){return{}}},collector:{collect:async()=>{collected++;return m.x.packet;}}}),reviewTeam:async()=>reviewChange?reviewChange(m.x):m.x.review});
 return {...m,result,collected};
}
test('workflow completes validation/save/deliver/public verification; manual never counts as publication',async()=>{
 for(const mode of ['automatic','manual']){const r=await runMock({mode});assert.deepEqual(r.calls,['validate','save','deliver','finish']);assert.equal(r.result.counts[mode==='automatic'?'published':'ready'],1);assert.equal(r.result.publication_complete,mode==='automatic');}
});
test('saved draft delivers unchanged without collecting or re-evaluating legacy method',async()=>{
 const r=await runMock({initial:'saved'});assert.equal(r.collected,0);assert.deepEqual(r.calls,['deliver','finish']);assert.equal((await r.gateway.state()).draft.payload.method_version,'editorial-v4');
});
test('unfinished review stays missing, lost delivery stays saved, corrupt public row cannot count as verified',async()=>{
 const m=await runMock({},()=>({deferred:true,reason:'Falta terminar la revisión editorial.'}));assert.equal(m.result.counts.missing,1);assert.deepEqual(m.calls,['finish']);
 const s=await runMock({deliveryError:true});assert.equal(s.result.counts.saved,1);assert.equal(s.result.publication_complete,false);
 const p=await runMock({corrupt:true});assert.equal(p.result.counts.published,1);assert.equal(p.result.verified_publications,0);assert.equal(p.result.publication_complete,false);
});
module.exports={example,produce,mockGateway};
test('closed empty run tolerates SQL null aggregate and never claims a publication or starts collection',async()=>{
 const at=new Date().toISOString();
 const gateway={runKey:'season-empty-test',recoveryRequest:null,state:async()=>({run:{expected:[],slot_at:at,started_at:at,finished_at:at},observed_at:at,attempts:[]}),audit:async()=>({observed_at:at,teams:null}),finish:()=>assert.fail('Closed run must not finish again')};
 const result=await runSeason({gateway,makeCollector:()=>assert.fail('No source reading for an empty run'),reviewTeam:()=>assert.fail('No editorial review for an empty run')});
 assert.equal(result.no_eligible_teams,true);assert.equal(result.publication_complete,false);assert.equal(result.verified_publications,0);assert.equal(result.finish,null);
 gateway.state=async()=>({run:{expected:['test-home'],slot_at:at,started_at:at,finished_at:at},observed_at:at,attempts:[{team:'test-home',outcome:'ready'}]});
 await assert.rejects(runSeason({gateway}),/Final audit did not return/);
});
test('concrete block needs club/source evidence; unfinished work cannot masquerade as a source failure',()=>{
 const {concreteBlock}=require('../scripts/forecast/editorial-producer.cjs'),x=example();
 assert.throws(()=>concreteBlock(x.packet,{kind:'timeout',source:'comuniate',detail:'No terminó a tiempo el trabajo.'}));
 assert.throws(()=>concreteBlock(x.packet,{kind:'lineup',source:'comuniate',detail:'Solo aparecen nueve titulares.',sha256:'old'}));
 const b=concreteBlock(x.packet,{kind:'official',source:'comuniate',detail:'El cuerpo marca explícitamente once oficial.',sha256:'a'.repeat(64)});
 assert.match(b.reason,/test-home, comuniate: Once oficial disponible/);assert.equal(b.checks.length,3);
});
test('run refuses early/expired windows and mismatched recovery context before any reading',async()=>{
 for(const scenario of ['early','expired','context']) {
  const m=mockGateway(),original=m.gateway.state;
  m.gateway.state=async()=>{const s=await original();if(scenario==='early')s.run.slot_at=new Date(Date.now()+60000).toISOString();if(scenario==='expired')s.run.slot_at=new Date(Date.now()-10800000).toISOString();if(scenario==='context')s.recovery={request_id:'another'};return s;};
  await assert.rejects(runSeason({gateway:m.gateway,makeCollector:()=>{throw Error('Must not collect');},reviewTeam:()=>{}}),/window|context/);
  assert.deepEqual(m.calls,[]);
 }
});
test('late concurrent attempt prevents save; terminal attempts are not recollected or redelivered',async()=>{
 const r=await runMock({initial:'ready'});assert.equal(r.collected,0);assert.deepEqual(r.calls,['finish']);
 const m=mockGateway(),state=m.gateway.state;let changed=false;
 m.gateway.state=async()=>{const s=await state();if(changed)s.attempts=[{team:m.x.packet.team,outcome:'ready'}];return s;};
 const result=await runSeason({gateway:m.gateway,makeCollector:async()=>({reader:{close(){},stats(){return{}}},collector:{collect:async()=>m.x.packet}}),reviewTeam:async()=>{changed=true;return m.x.review;}});
 assert.deepEqual(m.calls,['finish']);assert.equal(result.teams[0].verified,false);
});
test('final per-team audit detects a public row changed after delivery',async()=>{
 const m=mockGateway();m.gateway.audit=async()=>({observed_at:m.x.window.observedAt,teams:[{team:m.x.packet.team,outcome:'published',public_matches:false}]});
 const result=await runSeason({gateway:m.gateway,makeCollector:async()=>({reader:{close(){},stats(){return{}}},collector:{collect:async()=>m.x.packet}}),reviewTeam:async()=>m.x.review});
 assert.equal(result.counts.published,1);assert.equal(result.verified_publications,0);assert.equal(result.publication_complete,false);
});
test('fixture comparison normalizes equivalent UTC offsets without changing the instant',()=>{
 const {fixtureOf}=require('../scripts/forecast/editorial-producer.cjs');
 const a={key:'test',home:'a',away:'b',matchday:13,kickoff_at:'2026-11-21T13:00:00+00:00'};
 assert.deepEqual(fixtureOf(a),fixtureOf({...a,kickoff_at:'2026-11-21T13:00:00Z'}));
 assert.notDeepEqual(fixtureOf(a),fixtureOf({...a,kickoff_at:'2026-11-21T14:00:00Z'}));
});

test('missing identity is corrected once against the same evidence before any save',async()=>{
 const m=mockGateway();m.x.packet.observations.futbolfantasy[0].name='Observed full name';let reads=0,reviews=0;const packet=m.x.packet;
 const result=await runSeason({gateway:m.gateway,makeCollector:async()=>({reader:{close(){},stats(){return{}}},collector:{collect:async()=>{reads++;return packet;}}}),reviewTeam:async request=>{
  reviews++;assert.strictEqual(request.packet,packet);assert.ok(request.identity_names.includes('Observed full name'));assert.deepEqual(m.calls,[]);
  if(reviews===1){assert.equal(request.correction,null);return m.x.review;}
  assert.equal(request.correction.attempt,1);assert.match(request.correction.reason,/Observed full name/);
  return {...m.x.review,identities:{'Observed full name':m.x.roster[0].id}};
 }});
 assert.equal(reads,1);assert.equal(reviews,2);assert.equal(result.publication_complete,true);assert.equal(result.metrics.review_corrections,1);
 for(const key of ['wall_ms','read_ms','review_ms','sql_ms','sql_calls'])assert.ok(Number.isInteger(result.metrics[key])&&result.metrics[key]>=0);
});
test('second identity failure stays missing without saving or blocking',async()=>{
 const m=mockGateway();m.x.packet.observations.futbolfantasy[0].name='Unknown player';let reviews=0;
 const result=await runSeason({gateway:m.gateway,makeCollector:async()=>({reader:{close(){},stats(){return{}}},collector:{collect:async()=>m.x.packet}}),reviewTeam:async()=>{reviews++;return m.x.review;}});
 assert.equal(reviews,2);assert.equal(result.counts.missing,1);assert.deepEqual(m.calls,['finish']);assert.equal(result.publication_complete,false);
});
test('lost error inspection gets one read retry; persistent loss returns unknown and never finishes the run',async()=>{
 for(const failures of [1,2]){
  const m=mockGateway(),state=m.gateway.state;let failed=false,inspections=0,closed=false;const checkpoints=[];
  m.gateway.state=async()=>{if(failed&&inspections++<failures)throw Error('Connection unavailable');return state();};
  const result=await runSeason({gateway:m.gateway,makeCollector:async()=>({reader:{close(){closed=true;},stats(){return{}}},collector:{collect:async()=>{failed=true;throw Error('Read unavailable');}}}),reviewTeam:()=>assert.fail(),onEvent:async e=>checkpoints.push(e)});
  assert.equal(closed,true);assert.equal(checkpoints.length,1);assert.equal(result.publication_complete,false);
  if(failures===2){assert.equal(result.interrupted,true);assert.equal(result.counts.unknown,1);assert.equal(result.counts.missing,0);assert.deepEqual(m.calls,[]);assert.equal(inspections,2);}
  else{assert.equal(result.counts.missing,1);assert.deepEqual(m.calls,['finish']);}
 }
});
