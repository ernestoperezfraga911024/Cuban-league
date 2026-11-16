'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const round=require('../forecast-round-core.js'),{publication}=require('./fixtures/forecast-round.cjs');
function fixture(ballots=6){
 const p=publication('real-madrid');p.schema_version=4;p.season='2026-27';p.method_version='editorial-v6';
 p.players.forEach(x=>{x.method=p.method_version;x.reason='Estimación de titularidad según las fuentes y votos observados.';});
 p.sources.push({id:'predicted11',url:'https://www.predicted11.com/es/laliga/',status:ballots?'read':'pending',ballots,fetched_at:p.evidence_at,source_updated_at:null});
 p.players[0].source_summary=[{id:'futbolfantasy',prediction:'starter',probability:80},{id:'jornadaperfecta',prediction:'starter',probability:80},{id:'comuniate',prediction:'starter',probability:80},{id:'predicted11',prediction:ballots?'consensus':'not_available',probability:null,votes:ballots?5:null,ballots}];
 const alternative=p.players[2].alternative;
 p.candidates=[{...alternative,probability:40,reason:'Estimación del candidato según las fuentes observadas.',method:'editorial-v6'}];
 return p;
}
function browser(){const dom=new JSDOM('<main></main>',{runScripts:'outside-only',url:'https://test.invalid/'}),w=dom.window;for(const file of ['forecast-publish-core.js','forecast-round-config.js','forecast-round-core.js','forecast-pitch.js','forecast-context.js'])w.eval(fs.readFileSync(file,'utf8'));return {dom,w,host:w.document.querySelector('main')};}
test('v6 public projections accept source summaries and candidates without private health assessments',()=>{
 const p=fixture(),before=JSON.stringify(p);assert.equal(round.validate(p),p);assert.equal(JSON.stringify(p),before);
 assert.equal(p.players[0].assessment,undefined);
 const previous=fixture();previous.method_version='editorial-v5';[...previous.players,...previous.candidates].forEach(x=>x.method='editorial-v5');assert.equal(round.validate(previous),previous);
 for(const change of [p=>p.method_version='editorial-v7',p=>p.players[0].method='editorial-v5',p=>p.candidates[0].method='editorial-v5',p=>p.candidates=[]]){const bad=fixture();change(bad);assert.throws(()=>round.validate(bad));}
});
test('v6 renders FF icons without changing any selection, percentage, alternative or position',()=>{
 const b=browser();try{
  for(const ballots of [0,6])for(const status of ['injured','doubt','available']){
   const p=fixture(ballots),before=JSON.stringify(p),id=p.players[0].id;
   b.w.Date.now=()=>Date.parse(p.evidence_at);
   const direct={team:p.team,player_id:id,published_at:p.evidence_at,payload:{season:'2026-27',team:p.team,matchday:13,id,name:p.players[0].name,status,detail:'Estado físico observado directamente en FutbolFantasy.',source:{id:'futbolfantasy',url:'https://www.futbolfantasy.com/laliga/equipos/real-madrid',fetched_at:p.evidence_at}}};
   const context=b.w.CubanForecastContext.create(p.team,[],null,false,[direct]);
   b.w.CubanForecastPitch.render(b.host,p,null,{playerContext:context});
   const buttons=[...b.host.querySelectorAll('.fp-player')];assert.equal(buttons.length,11);
   assert.deepEqual(buttons.map(x=>x.dataset.playerId),round.lines(p.formation).reverse().flat().map(slot=>p.players.find(x=>x.slot===slot).id));
   for(const player of p.players){const node=buttons.find(x=>x.dataset.playerId===player.id);assert.equal(node.querySelector('.fp-prob').textContent,player.probability+'%');if(player.alternative)assert.match(node.querySelector('.fp-alt-name').textContent,new RegExp(player.alternative.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));}
   const selected=buttons.find(x=>x.dataset.playerId===id);assert.equal(selected.querySelector('.fc-health')?.textContent??null,status==='available'?null:status==='injured'?'+':'?');
   selected.click();const detail=b.host.querySelector('.fp-detail');assert.ok(detail.querySelector('.fp-source-summary'));
   assert.match(detail.textContent,ballots?/Predicted11 30% · FutbolFantasy 30%/:/FutbolFantasy 42,86%/);
   assert.match(detail.textContent,/Calculado solo con las fuentes/);assert.doesNotMatch(detail.textContent,/Revisión editorial manual/);
   assert.equal(JSON.stringify(p),before);
  }
 }finally{b.dom.window.close();}
});
