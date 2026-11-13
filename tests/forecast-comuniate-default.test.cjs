'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const method=require('../forecast-predicted11-method.js'),round=require('../forecast-round-core.js'),history=require('../forecast-history-core.js');
const {publication}=require('./fixtures/forecast-round.cjs');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const refs={futbolfantasy:'https://www.futbolfantasy.com/partidos/test',jornadaperfecta:'https://www.jornadaperfecta.com/partido/test',comuniate:'https://www.comuniate.com/partido/test',predicted11:'https://www.predicted11.com/es/laliga/ranking-global'};
const context=value=>({value,reason:'Synthetic source context.',refs:[refs.futbolfantasy]});
function assessment(version='editorial-v5'){
 return {method:version,confirmed_out:false,sources:[
  {id:'futbolfantasy',prediction:'starter',probability:80},
  {id:'jornadaperfecta',prediction:'starter',probability:60},
  {id:'comuniate',prediction:'starter',probability:null},
  {id:'predicted11',prediction:'consensus',probability:null,votes:3,ballots:4}
 ].map(s=>({...s,reason:'Synthetic source observation.',refs:[refs[s.id]]})),
 availability:context('unknown'),rotation:context('low'),horizon:context('distant'),context:{points:0,reason:'No additional adjustment.',refs:[refs.futbolfantasy]}};
}
const trace=(e,id)=>method.evaluate(e).trace.find(s=>s.id===id);
test('v5 changes only an unnumbered Comuniate starter; legacy results and input evidence stay unchanged',()=>{
 assert.equal(method.METHOD,'editorial-v5');
 const e=assessment(),before=JSON.stringify(e);
 assert.equal(trace(e,'comuniate').signal,50);
 assert.equal(method.evaluate(e).probability,69);
 assert.equal(method.evaluate({...e,method:'editorial-v4'}).probability,77);
 assert.equal(method.evaluate({...e,method:'editorial-v3'}).probability,71);
 assert.equal(JSON.stringify(e),before);
 for(const id of ['futbolfantasy','jornadaperfecta']){
  const q=assessment();q.sources.find(s=>s.id===id).probability=null;
  assert.equal(trace(q,id).signal,90);
 }
 for(const [prediction,expected] of [['alternative',40],['not_listed',25]]){
  const q=assessment();q.sources[2].prediction=prediction;assert.equal(trace(q,'comuniate').signal,expected);
 }
});
test('every explicit Comuniate percentage, including zero, overrides the fallback in all supported methods',()=>{
 for(const version of ['editorial-v3','editorial-v4','editorial-v5'])for(const prediction of ['starter','alternative','not_listed'])for(const percentage of [0,1,40,50,90,100]){
  const e=assessment(version);Object.assign(e.sources[2],{prediction,probability:percentage});
  assert.equal(trace(e,'comuniate').signal,percentage,version+' '+prediction+' '+percentage);
 }
});
test('Lemar stays 38 while Diangana changes from 39 to 31 using the same recorded source signals',()=>{
 const lemar=assessment(),diangana=assessment();
 Object.assign(lemar.sources[0],{probability:50});Object.assign(lemar.sources[1],{prediction:'alternative',probability:40});
 Object.assign(lemar.sources[2],{prediction:'not_listed'});Object.assign(lemar.sources[3],{votes:1,ballots:3});
 Object.assign(diangana.sources[0],{prediction:'alternative',probability:30});Object.assign(diangana.sources[1],{probability:60});Object.assign(diangana.sources[3],{votes:0,ballots:3});
 assert.equal(method.evaluate(lemar).probability,38);assert.equal(method.evaluate({...lemar,method:'editorial-v4'}).probability,38);
 assert.equal(method.evaluate(diangana).probability,31);assert.equal(method.evaluate({...diangana,method:'editorial-v4'}).probability,39);
});
test('missing Predicted11 remains neutral and renormalizes; source weights, rotation, context and limits remain intact',()=>{
 const e=assessment();Object.assign(e.sources[3],{prediction:'not_available',votes:null,ballots:0});
 const result=method.evaluate(e);assert.equal(result.probability,66);assert.equal(result.trace[3].effective_weight,0);
 assert.deepEqual(result.trace.map(s=>s.nominal_weight),[30,20,20,30]);
 assert.ok(Math.abs(result.trace[2].effective_weight-200/7)<1e-10);
 e.rotation.value='possible';assert.equal(method.evaluate(e).probability,63);e.context.points=-5;assert.equal(method.evaluate(e).probability,58);
 const maximum=assessment();maximum.sources.slice(0,3).forEach(s=>s.probability=100);maximum.sources[3].votes=4;assert.equal(method.evaluate(maximum).probability,95);
 const minimum=assessment();minimum.sources.slice(0,3).forEach(s=>s.probability=0);minimum.sources[3].votes=0;assert.equal(method.evaluate(minimum).probability,5);
});
test('v5 rejects malformed percentages, missing context, duplicate sources and confirmed absences',()=>{
 for(const change of [e=>e.sources[2].probability=undefined,e=>e.sources[2].probability='50',e=>e.sources[2].probability=-1,e=>e.sources[2].probability=100.5,e=>e.sources[2].probability=false,e=>e.sources[2].prediction='unknown',e=>e.sources[2].refs=[],e=>e.sources[2].id='futbolfantasy',e=>e.sources.pop(),e=>e.sources[3].votes=5,e=>e.confirmed_out=true,e=>e.availability.refs=[],e=>e.horizon.value='unknown',e=>e.role=context('preferred'),e=>e.method='editorial-v6']){
  const e=assessment();change(e);assert.throws(()=>method.evaluate(e));
 }
});
function publicFixture(version='editorial-v5'){
 const p=publication('real-madrid');p.schema_version=4;p.season='2026-27';p.method_version=version;p.players.forEach(x=>x.method=version);
 p.sources.push({id:'predicted11',url:'https://www.predicted11.com/es/laliga/',status:'read',ballots:3,fetched_at:p.evidence_at,source_updated_at:null});
 p.candidates=[{...p.players[2].alternative,probability:38,reason:'Synthetic candidate with its own probability.',method:version}];
 return p;
}
test('public and historical v4/v5 snapshots retain their stored values and reject mixed player or candidate methods',()=>{
 for(const version of ['editorial-v4','editorial-v5']){
  const p=publicFixture(version),before=JSON.stringify(p);assert.equal(round.validate(p),p);
  const record={team:p.team,fixture_key:p.fixture_key,season:p.season,matchday:p.matchday,home:p.home,away:p.away,kickoff_at:p.kickoff_at,prediction:p,prediction_published_at:'2026-11-11T20:01:00Z',cutoff_at:new Date(Date.parse(p.kickoff_at)-7200000).toISOString(),status:'pending',official_starters:[],correct_ids:[],missed_ids:[],unexpected_starters:[],hits:null,verification_stage:null,verified_at:null,source_url:null,published_at:null};
  assert.equal(history.detail(record),record);assert.equal(JSON.stringify(p),before);
  for(const mixed of ['editorial-v3','editorial-v4','editorial-v5'].filter(x=>x!==version)){
   const player=structuredClone(p);player.players[0].method=mixed;assert.throws(()=>round.validate(player));
   const candidate=structuredClone(p);candidate.candidates[0].method=mixed;assert.throws(()=>round.validate(candidate));
  }
 }
});
test('a newly sub-70 starter still requires an evaluated alternative outside the eleven',()=>{
 const e=assessment();e.sources[0].probability=80;e.sources[1].probability=80;Object.assign(e.sources[3],{votes:2,ballots:4});
 assert.equal(method.evaluate({...e,method:'editorial-v4'}).probability,73);assert.equal(method.evaluate(e).probability,65);
 const p=publicFixture();p.players[0].probability=65;assert.throws(()=>round.validate(p),/alternativa fuera del once/);
 p.players[0].alternative={id:p.players[1].id,name:p.players[1].name};assert.throws(()=>round.validate(p));
 p.players[0].alternative={id:p.candidates[0].id,name:p.candidates[0].name};assert.equal(round.validate(p),p);
 p.candidates=[];assert.throws(()=>round.validate(p),/Alternativa sin evaluación/);
});
test('shared public and admin renderer accepts v5 candidates and keeps the four-source explanation',()=>{
 const dom=new JSDOM('<main id="host"></main>',{runScripts:'outside-only',url:'https://test.invalid/'}),w=dom.window;
 try{
  for(const f of ['forecast-publish-core.js','forecast-round-config.js','forecast-round-core.js','forecast-pitch.js'])w.eval(read(f));
  const host=w.document.getElementById('host');
  for(const version of ['editorial-v4','editorial-v5'])for(const preview of [false,true]){
   const p=publicFixture(version),before=JSON.stringify(p),catalog={players:p.candidates.map(c=>({id:c.id,displayName:c.name,active:true,clubId:p.team,position:'MC'})),playersById:new Map()};w.CubanForecastPitch.render(host,p,catalog,{preview});
   assert.equal(host.querySelectorAll('.fp-player').length,11);assert.match(host.querySelector('.fp-alt-name').textContent,/38%/);
   const reserve=host.querySelector('.fp-reserve[data-player-id="'+p.candidates[0].id+'"]');assert.ok(reserve);reserve.click();
   assert.match(host.querySelector('.fp-detail').textContent,/38% de titularidad/);assert.match(host.querySelector('.fp-detail').textContent,/Predicted11 30%/);
   assert.doesNotMatch(host.querySelector('.fp-detail').textContent,/Revisión editorial manual/);assert.equal(JSON.stringify(p),before);
  }
 }finally{w.close();}
});
