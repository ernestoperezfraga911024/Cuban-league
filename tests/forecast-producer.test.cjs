'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {compile,fixtureOf,jsonbByteLength}=require('../scripts/forecast/editorial-producer.cjs');
const {SeasonGateway,literal,verifyPublication}=require('../scripts/forecast/season-gateway.cjs');
const {runSeason}=require('../scripts/forecast/season-workflow.cjs');
const {example}=require('./fixtures/forecast-producer.cjs');
const produce=x=>compile(x.packet,x.review,x.roster,x.window);
test('producer builds v6 eleven, independent candidate and absent P11 without a zero vote',()=>{
 const x=example(),{payload}=produce(x);
 assert.equal(payload.method_version,'editorial-v6');
 for(const player of [...payload.proposal.players,...payload.proposal.candidates]) {
  assert.equal(player.assessment.method,'editorial-v6');
  assert.deepEqual(Object.keys(player.assessment).sort(),['method','sources']);
 }
 assert.equal(payload.proposal.players[0].probability,79);assert.equal(payload.proposal.candidates[0].probability,40);
 assert.equal(payload.proposal.candidates.length,1);assert.equal(payload.sources[2].player_observations[0].probability,null);
 assert.equal(payload.sources[3].player_observations[0].votes,null);assert.equal(payload.publication_allowed,false);
 assert.equal(payload.proposal.players[0].alternative,null);
 x.packet.observations.comuniate[0].probability=0;
 assert.equal(produce(x).payload.proposal.players[0].probability,64);
 assert.equal(produce(x).payload.proposal.players[0].alternative.id,x.roster[11].id);
});
test('producer rejects official XI, stale body review, stale reads, foreign IDs and incomplete alternatives',()=>{
 for(const mutate of [x=>x.review.sources.comuniate.forecast=false,x=>x.review.sources.futbolfantasy.fixture_sha256='old',x=>x.packet.docs.futbolfantasy.fetched_at='2020-01-01T00:00:00Z',x=>x.review.selection.players[0].id='someone-else',x=>x.review.sources.comuniate.alternatives_complete=false,x=>x.review.sources.comuniate.observed_fixture.matchday=14]) {
  const x=example();mutate(x);assert.throws(()=>produce(x));
 }
 const x=example();x.packet.observations.comuniate[0].probability=0;delete x.review.selection.players[0].alternative_id;assert.throws(()=>produce(x),/alternativa evaluada/);
});
test('starter plus alternative retains the primary signal once without changing evidence',()=>{
 for(const source of ['futbolfantasy','jornadaperfecta','comuniate']){
  const x=example(),baseline=produce(x),alt={name:x.roster[0].name,probability:0};
  x.review.sources[source].alternatives.push(alt);
  if(source==='comuniate')x.packet.comuniate_alternatives.players.push({...alt});
  const before=structuredClone(x),out=produce(x);
  assert.deepEqual(out.payload,baseline.payload);assert.deepEqual(x,before);
  assert.deepEqual(out.source_roles,[{source,player_id:x.roster[0].id,starter_probability:null,alternative_probability:0}]);
  if(source==='comuniate'){x.review.sources[source].alternatives.pop();assert.throws(()=>produce(x),/omitida o modificada/);}
 }
});
test('a selected starter can cover another slot; self and unknown alternatives still fail',()=>{
 const x=example();x.packet.observations.comuniate[1].probability=0;
 x.packet.observations.comuniate[2].probability=0;
 x.review.selection.players[1].alternative_id=x.roster[2].id;
 const out=produce(x);assert.equal(out.payload.proposal.players[1].alternative.id,x.roster[2].id);
 assert.equal(out.payload.proposal.players.length,11);assert.equal(out.payload.proposal.candidates.length,1);
 for(const id of [x.roster[1].id,'unknown']){x.review.selection.players[1].alternative_id=id;assert.throws(()=>produce(x),/alternativa evaluada/);}
});
test('medical and editorial metadata cannot remove players or change proposal, sources or geometry',()=>{
 const x=example();
 // Force a genuine sub-70 starter and keep the observed zero on the candidate.
 // Both used to be vulnerable to confirmed_out exclusions.
 x.packet.observations.comuniate[0].probability=0;
 x.review.sources.futbolfantasy.alternatives[0].probability=0;
 const baseline=produce(x),before=structuredClone(x.packet);
 assert.equal(baseline.payload.proposal.players[0].alternative.id,x.roster[11].id);
 const mutations=[
  r=>{delete r.availability_reviewed;delete r.confirmed_out;delete r.facts;},
  r=>{r.availability_reviewed=false;r.confirmed_out=x.roster.slice(0,12).map(p=>({id:p.id,reason:'Baja médica declarada por el revisor.',refs:[x.packet.docs.futbolfantasy.url]}));},
  r=>{r.availability_reviewed=true;r.confirmed_out=[{id:'not-a-roster-id'}];},
  r=>{r.facts=Object.fromEntries(x.roster.map(p=>[p.id,{reason:'Excluir por lesión y cambiar el suplente.',availability:{value:'concern'},rotation:{value:'high'},context:{points:-10}}]));},
  r=>{r.facts=Object.fromEntries(x.roster.map(p=>[p.id,{reason:'Dar prioridad por alta médica.',availability:{value:'clear'},rotation:{value:'low'},context:{points:10}}]));}
 ];
 for(const mutate of mutations){
  const changed=structuredClone(x);mutate(changed.review);
  assert.deepEqual(produce(changed),baseline);
  assert.deepEqual(changed.packet,before);
 }
 const candidate=x.roster[11].id;
 assert.equal(baseline.payload.sources[0].player_observations.find(o=>o.player_id===candidate).probability,0);
 assert.ok(baseline.payload.proposal.candidates.some(p=>p.id===candidate));
});
test('JSONB byte accounting counts UTF-8 and structural spaces without treating punctuation in strings as separators',()=>{
 const examples=[
  [null,'null'],
  [{},'{}'],
  [[], '[]'],
  [{a:1,b:[true,null,{c:'á, : 😀'}]},'{"a": 1, "b": [true, null, {"c": "á, : 😀"}]}'],
  [{text:'a"b\\c\n,:'},'{"text": "a\\"b\\\\c\\n,:"}']
 ];
 for(const [value,postgresText]of examples)assert.equal(jsonbByteLength(value),Buffer.byteLength(postgresText));
});
test('producer rejects a payload that fits compact JSON but exceeds the PostgreSQL JSONB byte limit',()=>{
 const x=example(),baseline=produce(x).payload,oldUrl=x.packet.docs.futbolfantasy.url;
 const compact=JSON.stringify(baseline),occurrences=compact.split(oldUrl).length-1;
 assert.ok(occurrences>0);
 const padding='x'.repeat(Math.floor((65536-Buffer.byteLength(compact))/occurrences));
 const expanded=JSON.parse(compact.replaceAll(oldUrl,oldUrl+padding));
 // PostgreSQL jsonb::text inserts one space after object colons and container
 // commas. Serialize a test oracle independently of the production byte counter.
 const pgText=v=>Array.isArray(v)?'['+v.map(pgText).join(', ')+']':v&&typeof v==='object'?'{'+Object.entries(v).map(([k,val])=>JSON.stringify(k)+': '+pgText(val)).join(', ')+'}':JSON.stringify(v);
 assert.ok(Buffer.byteLength(JSON.stringify(expanded))<=65536);
 assert.ok(Buffer.byteLength(pgText(expanded))>65536);
 x.packet.docs.futbolfantasy.url=oldUrl+padding;
 assert.throws(()=>produce(x),/64 KiB|65536|JSONB/i);
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
 const candidateBallot=structuredClone(x),candidate=candidateBallot.roster[11];
 candidateBallot.packet.predictions[0].data.participacion[10]={nombre:candidate.name};
 const candidateBaseline=produce(candidateBallot);
 candidateBallot.review.confirmed_out=[{id:candidate.id,reason:'Exclusión médica antigua que no debe borrar votos.',refs:[candidateBallot.packet.docs.futbolfantasy.url]}];
 assert.deepEqual(produce(candidateBallot),candidateBaseline);
 assert.equal(candidateBaseline.payload.sources[3].player_observations.find(o=>o.player_id===candidate.id).votes,1);
 assert.equal(candidateBaseline.payload.proposal.players[10].id,candidate.id);
 assert.equal(candidateBaseline.payload.proposal.players[10].probability,58);
 assert.ok(candidateBaseline.payload.proposal.candidates.some(p=>p.id===x.roster[10].id));
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
test('full preflight delivers all independent issues in the sole correction without recollecting',async()=>{
 const m=mockGateway(),correct=structuredClone(m.x.review),bad=structuredClone(m.x.review);
 m.x.packet.observations.comuniate[0].name='Eric García';
 m.x.packet.observations.comuniate[1].name='Joan García';
 correct.identities={'Eric García':m.x.roster[0].id,'Joan García':m.x.roster[1].id};
 bad.sources.futbolfantasy.alternatives.push({...bad.sources.futbolfantasy.alternatives[0],probability:10});
 bad.selection.layout.rows[1].sha256='not-the-captured-body';
 bad.selection.layout.rows[2].sha256='not-the-captured-body';
 const before=structuredClone(m.x.packet);let reviews=0,reads=0;
 const result=await runSeason({gateway:m.gateway,
   makeCollector:async()=>({reader:{close(){},stats(){return{}}},collector:{collect:async()=>{reads++;return m.x.packet;}}}),
   reviewTeam:async request=>{
     reviews++;assert.deepEqual(request.packet,before);
     if(reviews===1)return bad;
     assert.equal(request.correction.attempt,1);
     const issues=request.correction.issues;
     assert.deepEqual(issues.filter(i=>i.code==='identity_unresolved').map(i=>i.name),['Eric García','Joan García']);
     assert.equal(issues.filter(i=>i.code==='source_duplicate').length,1);
     assert.deepEqual(issues.filter(i=>i.code==='layout_invalid').map(i=>i.row),[1,2]);
     return correct;
   }});
 assert.equal(reviews,2);assert.equal(reads,1);assert.equal(result.publication_complete,true);
 assert.equal(result.metrics.review_corrections,1);assert.deepEqual(m.calls,['validate','save','deliver','finish']);
});
test('malformed review lists still receive one corrective request instead of escaping as TypeError',async()=>{
 for(const breakReview of [r=>r.sources.futbolfantasy.alternatives={},r=>r.exclusions={},r=>r.selection.players=[null],r=>r.sources.futbolfantasy.alternatives=[null]]){
  const m=mockGateway(),bad=structuredClone(m.x.review);breakReview(bad);let reviews=0;
  const result=await runSeason({gateway:m.gateway,makeCollector:async()=>({reader:{close(){},stats(){return{}}},collector:{collect:async()=>m.x.packet}}),reviewTeam:async request=>{
    reviews++;if(reviews===1)return bad;
    assert.equal(request.correction.attempt,1);assert.ok(request.correction.issues.some(i=>i.code==='review_shape_invalid'));return m.x.review;
  }});
  assert.equal(reviews,2);assert.equal(result.publication_complete,true);assert.deepEqual(m.calls,['validate','save','deliver','finish']);
 }
});
test('layout and missing alternative failures get one full correction with unchanged evidence',async()=>{
 for(const type of ['layout','alternative']) for(const corrected of [true,false]) {
  const m=mockGateway(),original=structuredClone(m.x.review);let reviews=0,reads=0;
  if(type==='layout')m.x.review.selection.layout.rows.pop();
  else {m.x.packet.observations.comuniate[0].probability=0;delete m.x.review.selection.players[0].alternative_id;}
  const before=structuredClone(m.x.packet);
  const result=await runSeason({gateway:m.gateway,makeCollector:async()=>({reader:{close(){},stats(){return{}}},collector:{collect:async()=>{reads++;return m.x.packet;}}}),reviewTeam:async request=>{
   reviews++;assert.deepEqual(request.packet,before);assert.deepEqual(m.calls,[]);
   if(reviews===2){assert.equal(request.correction.attempt,1);assert.match(request.correction.reason,type==='layout'?/colocación pendiente/:/alternativa evaluada/);}
   return reviews===2&&corrected?original:m.x.review;
  }});
  assert.equal(reviews,2);assert.equal(reads,1);assert.deepEqual(m.x.packet,before);
  assert.equal(result.publication_complete,corrected);assert.equal(result.metrics.review_corrections,1);
  assert.deepEqual(m.calls,corrected?['validate','save','deliver','finish']:['finish']);
 }
});
test('declared identity failure also receives catalog references and one correction before a block',async()=>{
 const m=mockGateway();let reviews=0;
 const result=await runSeason({gateway:m.gateway,makeCollector:async()=>({reader:{close(){},stats(){return{}}},collector:{collect:async()=>m.x.packet}}),reviewTeam:async request=>{
  reviews++;assert.equal(request.identity_reference.requires_review,true);assert.equal(request.identity_reference.players.length,m.x.roster.length);
  if(reviews===1)return {failure:{source:'comuniate',kind:'identity',detail:'Nombre observado aún pendiente de contraste.',sha256:m.x.packet.docs.comuniate.sha256}};
  assert.match(request.correction.reason,/identity_reference/);return m.x.review;
 }});
 assert.equal(reviews,2);assert.equal(result.publication_complete,true);assert.deepEqual(m.calls,['validate','save','deliver','finish']);
});
test('verified Antony reference is scoped to current roster/catalog and never silently maps an identity',()=>{
 const {identityReference}=require('../scripts/forecast/identity-reference.cjs');
 const roster=[{id:'a-santos',name:'A. Santos',team:'real-betis'}];
 const ref=identityReference('real-betis',roster,['Antony','Anthony']);
 assert.equal(ref.candidates.length,1);assert.equal(ref.candidates[0].observed_name,'Antony');assert.equal(ref.candidates[0].id,'a-santos');
 assert.match(ref.candidates[0].profile_url,/61013\/antony-santos$/);assert.ok(ref.candidates[0].verified_alias.profile_sha256);
 assert.equal(identityReference('real-betis',[],['Antony']).candidates.length,0);
 assert.equal(identityReference('other',roster.map(p=>({...p,team:'other'})),['Antony']).candidates.length,0);
 const x=example();x.packet.observations.comuniate[0].name='Antony';assert.throws(()=>produce(x),/identidad sin resolver/);
});
test('producer canonicalizes UTC offsets in payload and evidence without rounding or shifting the instant',()=>{
 for(const offset of ['+00:00','-05:00']){
  const x=example(),expected=x.review.fixture.kickoff_at;
  const local=new Date(Date.parse(expected)+(offset==='-05:00'?-5:0)*3600000).toISOString().replace('Z',offset);
  x.review.fixture.kickoff_at=local;for(const source of Object.values(x.review.sources))source.observed_fixture.kickoff_at=local;
  const out=produce(x);assert.equal(out.payload.kickoff_at,expected);assert.equal(out.fixture.kickoff_at,expected);
  assert.equal(x.review.fixture.kickoff_at,local);out.payload.sources.forEach(s=>assert.equal(s.observed_fixture.kickoff_at,expected));
 }
 for(const invalid of ['2026-11-21T13:00:00','not-a-date','2026-11-21T13:00:00.123Z','2026-11-21T13:00:00.000001Z','2026-11-21T13:00Z']){
  const x=example();x.review.fixture.kickoff_at=invalid;assert.throws(()=>produce(x),/Fecha del partido inválida/);
 }
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

test('De Jong/Bernal regression: final 55 beats 43 in the same slot, sources and other positions unchanged',()=>{
 const x=require('./fixtures/forecast-producer.cjs').priorityExample(),input=structuredClone(x),out=produce(x);
 const promoted=out.payload.proposal.players[6],demoted=out.payload.proposal.candidates.find(p=>p.id===x.roster[6].id);
 assert.equal(promoted.id,x.roster[11].id);assert.equal(promoted.probability,55);assert.equal(promoted.slot,7);assert.equal(promoted.position,'MF');
 assert.equal(promoted.alternative.id,x.roster[6].id);assert.equal(demoted.probability,43);assert.equal(demoted.slot,undefined);
 assert.deepEqual(out.payload.proposal.players.filter(p=>p.slot!==7).map(p=>p.id),x.roster.slice(0,11).filter((p,i)=>i!==6).map(p=>p.id));
 assert.equal(new Set(out.payload.proposal.players.map(p=>p.id)).size,11);
 assert.equal(out.layout.promotions.length,1);assert.equal(out.layout.rows[2].ids[1],x.roster[11].id);assert.equal(out.layout.rows[2].source_slot_ids[1],x.roster[6].id);
 assert.deepEqual(x,input);
 // Changing only the reviewed initial occupant must not change source evidence
 // or any player's calculated score. Health is equally irrelevant to promotion.
 const score=p=>Object.fromEntries([...p.proposal.players,...p.proposal.candidates].map(x=>[x.id,x.probability]));
 const y=structuredClone(x);y.review.confirmed_out=[{id:x.roster[11].id}];y.review.facts={};assert.deepEqual(produce(y),out);
 assert.equal(score(out.payload)[x.roster[6].id],43);
 for(const s of out.payload.sources.slice(0,3))assert.ok(s.starter_ids.includes(x.roster[6].id));
 assert.deepEqual(promoted.assessment.sources.map(s=>s.probability),[50,40,null,null]);
 assert.equal(promoted.assessment.sources[3].votes,4);assert.equal(demoted.assessment.sources[3].votes,1);
});
test('slot priority handles ties, multiple compatible options, cycles and occupied winners without duplicates',()=>{
 const {prioritizeSlots}=require('../scripts/forecast/selection-priority.cjs');
 const evaluated=new Map(Object.entries({a:43,b:55,c:80,d:55,e:40}).map(([id,probability])=>[id,{probability}]));
 const fail=m=>{throw Error(m);};
 assert.equal(prioritizeSlots([{id:'b',alternative_id:'d'}],evaluated,fail).players[0].id,'b');
 assert.equal(prioritizeSlots([{id:'a',alternative_id:'b',alternative_ids:['c','e']}],evaluated,fail).players[0].id,'c');
 assert.equal(prioritizeSlots([{id:'a',alternative_id:'a'}],evaluated,fail).players[0].alternative_id,null);
 assert.throws(()=>prioritizeSlots([{id:'a',alternative_id:'b'},{id:'b',alternative_id:'e'}],evaluated,fail),/distribución táctica/);
 assert.throws(()=>prioritizeSlots([{id:'a',alternative_id:'b'},{id:'b',alternative_id:'a'}],evaluated,fail),/dos puestos/);
 const valid=prioritizeSlots([{id:'c',alternative_id:'b'},{id:'b',alternative_id:'e'}],evaluated,fail);assert.deepEqual(valid.players.map(p=>p.id),['c','b']);
 assert.throws(()=>prioritizeSlots([{id:'a',alternative_ids:'bad'}],evaluated,fail),/lista/);
});
test('promotion over 70 removes the displayed alternative but preserves the old starter as a candidate',()=>{
 const x=example();for(const source of Object.keys(x.review.sources)){
  x.packet.observations[source][6].probability=30;
  x.review.sources[source].alternatives[0].probability=75;
 }
 x.packet.comuniate_alternatives.players=structuredClone(x.review.sources.comuniate.alternatives);
 const out=produce(x).payload.proposal;assert.equal(out.players[6].probability,75);assert.equal(out.players[6].alternative,null);
 assert.equal(out.candidates.find(p=>p.id===x.roster[6].id).probability,30);
});

test('verified catalog additions refresh the roster in the same review without rereading sources',async()=>{
 for(const change of ['add','rename','remove','foreign','duplicate']){
  const m=mockGateway(),full=structuredClone(m.x.roster),missing=full.filter(p=>p.id!==full[11].id);let reads=0;
  m.gateway.roster=async()=>{
   if(++reads===1)return missing;
   const next=structuredClone(full);
   if(change==='rename')next[0].name='Another person';
   if(change==='remove')next.shift();
   if(change==='foreign')next[11].team='other';
   if(change==='duplicate')next.push({...next[0]});
   return next;
  };
  const before=structuredClone(m.x.packet);
  const result=await runSeason({gateway:m.gateway,makeCollector:async()=>({reader:{close(){},stats(){return{}}},collector:{collect:async()=>m.x.packet}}),reviewTeam:async r=>{assert.equal(r.roster.length,13);return {...m.x.review,catalog_updated:true};}});
  assert.equal(reads,2);assert.deepEqual(m.x.packet,before);
  assert.equal(result.publication_complete,change==='add');
  assert.deepEqual(m.calls,change==='add'?['validate','save','deliver','finish']:['finish']);
 }
});
test('Burcio verified aliases resolve to one Celta identity and never a different Hugo',()=>{
 const {identityReference}=require('../scripts/forecast/identity-reference.cjs');
 const roster=[{id:'mister-68516',name:'H. Burcio',team:'celta-vigo'}];
 const ref=identityReference('celta-vigo',roster,['Burcio','H. Burcio','Hugo Burcio','Hugo Burcio García','Hugo Álvarez']);
 assert.equal(ref.candidates.length,4);assert.ok(ref.candidates.every(p=>p.id==='mister-68516'&&p.verified_alias));
 assert.equal(identityReference('other',roster,['Burcio']).candidates.length,0);
});
