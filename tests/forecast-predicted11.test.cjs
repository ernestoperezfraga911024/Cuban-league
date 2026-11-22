const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const method=require('../forecast-predicted11-method.js'),round=require('../forecast-round-core.js');
const {publication:roundPublication}=require('./fixtures/forecast-round.cjs');
const publication=()=>roundPublication('real-madrid');
const ref='https://www.futbolfantasy.com/partidos/test';
const evidence=value=>({value,reason:'Dato sintético para comprobar el cálculo.',refs:[ref]});
function assessment(){return {method:'editorial-v3',confirmed_out:false,sources:[
{id:'futbolfantasy',prediction:'starter',probability:80,reason:'Porcentaje de prueba.',refs:[ref]},
{id:'jornadaperfecta',prediction:'starter',probability:60,reason:'Porcentaje de prueba.',refs:['https://www.jornadaperfecta.com/partido/test']},
{id:'comuniate',prediction:'starter',probability:40,reason:'Porcentaje de prueba.',refs:['https://www.comuniate.com/equipos/test']},
{id:'predicted11',prediction:'consensus',probability:null,votes:3,ballots:4,reason:'Tres de cuatro onces completos.',refs:['https://www.predicted11.com/es/laliga/ranking-global']}],
availability:evidence('clear'),rotation:evidence('low'),horizon:evidence('near'),context:{points:0,reason:'Sin ajuste adicional.',refs:[ref]}};}
test('weights 30/30/20/20; no role; exact rounding',()=>{assert.equal(method.evaluate(assessment()).probability,67);const e=assessment();e.horizon.value='distant';assert.equal(method.evaluate(e).probability,65);e.role=evidence(100);assert.throws(()=>method.evaluate(e));});
test('missing P11 is omitted and weights renormalize; zero votes is different',()=>{const e=assessment(),s=e.sources[3];s.prediction='not_available';s.votes=null;s.ballots=0;const r=method.evaluate(e);assert.equal(r.probability,63);assert.equal(r.trace[3].effective_weight,0);assert.ok(Math.abs(r.trace[0].effective_weight-300/7)<1e-10);s.prediction='consensus';s.ballots=4;s.votes=0;assert.equal(method.evaluate(e).probability,44);});
test('invalid evidence, foreign references, duplicate sources and confirmed absences fail closed',()=>{for(const change of [e=>e.confirmed_out=true,e=>e.sources.pop(),e=>e.sources[0].id='comuniate',e=>e.sources[3].votes=5,e=>e.sources[3].ballots=0,e=>e.sources[3].probability=75,e=>e.sources[0].probability=3.5,e=>e.sources[1].refs=['https://www.jornadaperfecta.com.evil.test/'],e=>e.sources[3].refs=['https://user@www.predicted11.com/es/laliga/'],e=>e.rotation.refs=[],e=>e.context.points=11]){const e=assessment();change(e);assert.throws(()=>method.evaluate(e));}});
test('horizon caps stay provisional',()=>{const e=assessment();for(const s of e.sources.slice(0,3))s.probability=100;e.sources[3].votes=4;assert.equal(method.evaluate(e).probability,95);e.horizon.value='distant';assert.equal(method.evaluate(e).probability,90);});
const author=(id,rank)=>({id:String(id),rank,url:'https://www.predicted11.com/es/usuario/'+(id===7?'FutbolFantasy':'author'+id)+'?campeonato=laliga'});
test('club top3 plus global top3 deduplicate IDs and exclude FF without refill',()=>{
 const club=[author(1,1),author(2,2),author(7,3)],global=[author(2,1),author(3,2),author(4,3)];
 assert.deepEqual(method.selectAuthors(club,global).map(a=>a.id),['1','2','3','4']);
 for(const bad of [club.slice(0,2),[...club,author(5,4)],[club[0],club[1],author(5,4)],[club[0],club[0],club[2]]])assert.throws(()=>method.selectAuthors(bad,global));
});
test('pending/incomplete ballots do not penalize players; duplicated authors rejected',()=>{const roster=new Set(Array.from({length:11},(_,i)=>'p'+i)),authors=[author(1,1),author(2,2),author(3,3)];const predictions=[{author_id:'1',status:'read',starter_ids:[...roster]},{author_id:'2',status:'not_created',starter_ids:[]},{author_id:'3',status:'incomplete',starter_ids:[]}];const r=method.aggregate(authors,predictions,roster);assert.equal(r.ballots,1);assert.ok([...r.counts.values()].every(x=>x===1));assert.throws(()=>method.aggregate(authors,[...predictions,predictions[0]],roster));assert.throws(()=>method.aggregate(authors,[{...predictions[0],starter_ids:[...roster].slice(0,10)},...predictions.slice(1)],roster));});
function v3(){const p=publication();p.schema_version=4;p.season='2026-27';p.method_version='editorial-v3';p.players.forEach(x=>x.method='editorial-v3');p.sources.push({id:'predicted11',url:'https://www.predicted11.com/es/laliga/ranking-global',status:'read',fetched_at:p.sources[0].fetched_at,source_updated_at:null,ballots:6});return p;}
test('public validation accepts v3 and old publications; rejects mixed methods or foreign sources',()=>{assert.equal(round.validate(publication()).schema_version,2);assert.equal(round.validate(v3()).schema_version,4);for(const change of [p=>p.players[0].method='editorial-v2',p=>p.sources[3].ballots=0,p=>p.sources[3].url='https://www.predicted11.com.evil.test/es/laliga/',p=>p.sources[3].id='other',p=>p.method_version='editorial-v2']){const p=v3();change(p);assert.throws(()=>round.validate(p));}const p=v3();p.sources[3].status='pending';p.sources[3].ballots=0;assert.equal(round.validate(p),p);});
test('shared public/admin renderer shows 11 players, correct weights and P11 participation',()=>{
 const {JSDOM}=require('jsdom'),dom=new JSDOM('<main></main>',{runScripts:'outside-only'}),w=dom.window;
 try{
  w.CubanForecastPublishCore=require('../forecast-publish-core.js');w.CubanForecastRoundCore=round;w.eval(fs.readFileSync(require.resolve('../forecast-pitch.js'),'utf8'));
  const host=w.document.querySelector('main'),p=v3();w.CubanForecastPitch.render(host,p,null);
  assert.equal(host.querySelectorAll('.fp-player').length,11);assert.equal(host.querySelector('.fp-detail').hidden,true);host.querySelector('.fp-player').click();
  assert.match(host.textContent,/Predicted11 30%/);assert.match(host.textContent,/6 onces completos/);assert.doesNotMatch(host.textContent,/Rol 20%/);
  p.sources[3].status='pending';p.sources[3].ballots=0;w.CubanForecastPitch.render(host,p,null);host.querySelector('.fp-player').click();
  assert.match(host.textContent,/42,86%/);assert.match(host.textContent,/no aporta al cálculo/);
 }finally{dom.window.close();}
});
module.exports={assessment,v3};


function v4Assessment(){const e=assessment();e.method='editorial-v4';return e;}
test('v4 retains physical and horizon evidence without deductions in every state',()=>{
 for(const availability of ['clear','concern','unknown'])for(const horizon of ['near','medium','distant']){const e=v4Assessment();e.availability.value=availability;e.horizon.value=horizon;assert.equal(method.evaluate(e).probability,67);}
 const e=v4Assessment();e.sources.slice(0,3).forEach(s=>s.probability=100);e.sources[3].votes=4;
 for(const horizon of ['near','medium','distant']){e.horizon.value=horizon;assert.equal(method.evaluate(e).probability,95);}
});
test('v4 same inputs give 53 instead of legacy 43; earlier evidence is not changed',()=>{
 const e=assessment();e.sources[0].probability=50;e.sources[1].probability=40;e.sources[2].probability=50;e.sources[3].votes=4;e.sources[3].ballots=6;e.availability.value='concern';e.horizon.value='distant';
 const before=JSON.stringify(e);assert.equal(method.evaluate(e).probability,43);assert.equal(method.evaluate({...e,method:'editorial-v4'}).probability,53);assert.equal(JSON.stringify(e),before);
});
test('v4 keeps missing P11 neutral, sporting rotation and context unchanged',()=>{
 const e=v4Assessment();e.availability.value='concern';e.horizon.value='distant';e.rotation.value='possible';assert.equal(method.evaluate(e).probability,64);e.rotation.value='high';assert.equal(method.evaluate(e).probability,59);
 e.rotation.value='low';e.context.points=-5;assert.equal(method.evaluate(e).probability,62);e.context.points=0;Object.assign(e.sources[3],{prediction:'not_available',ballots:0,votes:null});assert.equal(method.evaluate(e).probability,63);
});
test('v4 still rejects confirmed absences and incomplete or misleading evidence',()=>{
 for(const change of [e=>e.confirmed_out=true,e=>e.availability.refs=[],e=>e.horizon.value='invalid',e=>e.horizon.reason='',e=>e.role=evidence(90),e=>e.sources[3].probability=75,e=>e.sources[3].votes=5,e=>e.sources[0].id='comuniate']){const e=v4Assessment();change(e);assert.throws(()=>method.evaluate(e));}
});
test('v4 public payload is accepted without accepting mixed player methods',()=>{
 const p=v3();p.method_version='editorial-v4';p.players.forEach(x=>x.method='editorial-v4');assert.equal(round.validate(p),p);p.players[0].method='editorial-v3';assert.throws(()=>round.validate(p));
});

function v6Assessment(){return {method:'editorial-v6',sources:assessment().sources};}
test('v6 computes from minimal source evidence with the same weights and Comuniate fallback',()=>{
 const e=v6Assessment(),before=structuredClone(e),result=method.evaluate(e);
 assert.equal(result.method,'editorial-v6');assert.equal(result.probability,67);
 assert.deepEqual(result.trace.map(t=>t.nominal_weight),[30,20,20,30]);
 assert.deepEqual(e,before);
 e.sources[2].probability=null;
 assert.equal(method.evaluate(e).probability,69);
 assert.equal(method.evaluate(e).trace.find(t=>t.id==='comuniate').signal,50);
 for(const [id,prediction,signal]of [['futbolfantasy','starter',90],['jornadaperfecta','starter',90],['comuniate','alternative',40],['comuniate','not_listed',25]]){
  const q=v6Assessment(),source=q.sources.find(s=>s.id===id);Object.assign(source,{prediction,probability:null});
  assert.equal(method.evaluate(q).trace.find(t=>t.id===id).signal,signal);
 }
});
test('v6 is invariant to health, confirmed exclusions, horizon, rotation and context metadata',()=>{
 const baseline=v6Assessment(),expected=method.evaluate(baseline);
 for(const availability of ['clear','concern','unknown'])for(const rotation of ['low','possible','high'])for(const points of [-10,0,10]){
  const e={...structuredClone(baseline),confirmed_out:true,availability:evidence(availability),rotation:evidence(rotation),horizon:evidence('distant'),context:{points,reason:'Un ajuste que no debe afectar al método nuevo.',refs:[ref]}};
  const before=structuredClone(e);assert.deepEqual(method.evaluate(e),expected);assert.deepEqual(e,before);
 }
 // Legacy metadata is not a prerequisite for evaluating source-only evidence.
 assert.deepEqual(method.evaluate({...baseline,confirmed_out:true,availability:null,rotation:null,horizon:null,context:null}),expected);
});
test('v6 distinguishes missing P11 from zero votes and retains explicit zero percentages',()=>{
 const e=v6Assessment();Object.assign(e.sources[3],{prediction:'not_available',votes:null,ballots:0});
 let result=method.evaluate(e);assert.equal(result.probability,63);assert.equal(result.trace[3].effective_weight,0);
 assert.ok(Math.abs(result.trace[0].effective_weight-300/7)<1e-10);
 Object.assign(e.sources[3],{prediction:'consensus',votes:0,ballots:4});assert.equal(method.evaluate(e).probability,44);
 for(const id of ['futbolfantasy','jornadaperfecta','comuniate'])for(const prediction of ['starter','alternative','not_listed']){
  const q=v6Assessment();Object.assign(q.sources.find(s=>s.id===id),{prediction,probability:0});
  assert.equal(method.evaluate(q).trace.find(t=>t.id===id).signal,0);
 }
 for(const [signal,votes,expected]of [[0,0,5],[100,4,95]]){
  const q=v6Assessment();q.sources.slice(0,3).forEach(s=>s.probability=signal);q.sources[3].votes=votes;
  assert.equal(method.evaluate(q).probability,expected);
 }
});
test('v6 still rejects incomplete sources, invalid identities of sources, misleading references and bad vote counts',()=>{
 for(const change of [e=>e.sources.pop(),e=>e.sources[0].id='comuniate',e=>e.sources[3].votes=5,e=>e.sources[3].ballots=0,e=>e.sources[3].probability=75,e=>e.sources[0].probability=3.5,e=>e.sources[2].probability=undefined,e=>e.sources[1].refs=['https://www.jornadaperfecta.com.evil.test/'],e=>e.sources[3].refs=['https://user@www.predicted11.com/es/laliga/'],e=>e.sources[0].refs=[],e=>e.sources[0].prediction='healthy']){
  const e=v6Assessment();change(e);assert.throws(()=>method.evaluate(e));
 }
});
