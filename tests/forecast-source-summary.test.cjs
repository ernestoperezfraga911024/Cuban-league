'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const {publication}=require('./fixtures/forecast-round.cjs');
function fixture(){
 const p=publication('real-madrid');p.schema_version=4;p.season='2026-27';p.method_version='editorial-v5';
 p.players.forEach(x=>{x.method=p.method_version;x.reason='Estimación de titularidad según las fuentes y votos observados.';});
 p.sources.push({id:'predicted11',url:'https://www.predicted11.com/es/laliga/',status:'read',ballots:6,fetched_at:p.evidence_at,source_updated_at:null});
 p.players[0].source_summary=[{id:'futbolfantasy',prediction:'starter',probability:50},{id:'comuniate',prediction:'starter',probability:null},{id:'jornadaperfecta',prediction:'starter',probability:60},{id:'predicted11',prediction:'consensus',probability:null,votes:4,ballots:6}];
 return p;
}
function browser(){const dom=new JSDOM('<main></main>',{runScripts:'outside-only',url:'https://test.invalid/'}),w=dom.window;for(const file of ['forecast-publish-core.js','forecast-round-config.js','forecast-round-core.js','forecast-pitch.js'])w.eval(fs.readFileSync(file,'utf8'));return {dom,w,host:w.document.querySelector('main')};}
function open(b,p){b.w.CubanForecastPitch.render(b.host,p,null);b.host.querySelector('.fp-player[data-player-id="'+p.players[0].id+'"]').click();return b.host.querySelector('.fp-detail');}
test('player detail displays exact source percentages, null signal and complete author count',()=>{
 const b=browser();try{const p=fixture(),before=JSON.stringify(p),d=open(b,p);
 assert.deepEqual([...d.querySelectorAll('.fp-source-list li')].map(x=>x.textContent),['FutbolFantasy: 50% de titularidad. Lo incluye en el once.','Comuniate: Lo incluye en el once.','Jornada Perfecta: 60% de titularidad. Lo incluye en el once.','Predicted11: Aparece en 4 de 6 onces completos.']);
 assert.doesNotMatch(d.textContent,/según las fuentes y votos observados/);assert.match(d.textContent,/Peso en el cálculo: Predicted11 30%/);
 assert.equal(d.querySelector('.fp-detail-prob').textContent,'80% de titularidad estimada');assert.equal(JSON.stringify(p),before);
 assert.ok(d.querySelector('.fp-source-list'));assert.equal(b.host.querySelectorAll('.fp-player').length,11);
 }finally{b.dom.window.close();}
});
test('zero, alternatives, not listed and unavailable are described without invented percentages',()=>{
 const b=browser();try{const p=fixture();Object.assign(p.players[0].source_summary[0],{prediction:'alternative',probability:0});p.players[0].source_summary[1].prediction='not_listed';Object.assign(p.players[0].source_summary[3],{prediction:'not_available',votes:null,ballots:0});Object.assign(p.sources[3],{status:'unavailable',ballots:0});
 const d=open(b,p);assert.match(d.textContent,/FutbolFantasy: 0% de titularidad\. Lo propone como alternativa/);assert.match(d.textContent,/Comuniate: No figura en su propuesta\./);assert.match(d.textContent,/Sin onces completos disponibles en esta lectura/);assert.doesNotMatch(d.querySelector('.fp-source-summary').textContent,/0 de 0|Comuniate: 0%|Comuniate: 50%/);
 }finally{b.dom.window.close();}
});
test('legacy publications and malformed optional summaries keep a working detail with the original reason',()=>{
 const b=browser();try{for(const value of [undefined,null,{},[],[{id:'comuniate',prediction:'starter',probability:'50'}],[{id:'predicted11',prediction:'consensus',probability:null,votes:7,ballots:6}],[{id:'predicted11',prediction:'consensus',probability:null,votes:4,ballots:5}],[null,null]]){
 const p=fixture();p.players[0].source_summary=value;const d=open(b,p);assert.equal(d.querySelector('.fp-source-summary'),null);assert.match(d.textContent,/Estimación de titularidad según las fuentes y votos observados/);assert.equal(b.host.querySelectorAll('.fp-player').length,11);
 }}finally{b.dom.window.close();}
});
test('candidates receive their own evidence, and editorial context remains visible as safe text',()=>{
 const b=browser();try{const p=fixture(),alt=p.players[2].alternative;
 p.candidates=[{...alt,probability:30,reason:'Contexto editorial <img src=x onerror=alert(1)>',method:'editorial-v5',source_summary:p.players[0].source_summary.map(s=>({...s,...(s.id==='predicted11'?{votes:0}:{prediction:'alternative',probability:30})}))}];
 const catalog={players:[{id:alt.id,displayName:alt.name,position:'DL',active:true,clubId:p.team}]};
 b.w.CubanForecastPitch.render(b.host,p,catalog);b.host.querySelector('.fp-reserve').click();const d=b.host.querySelector('.fp-detail');
 assert.match(d.textContent,/30% de titularidad estimada/);assert.match(d.textContent,/Aparece en 0 de 6 onces completos/);assert.match(d.textContent,/Lo propone como alternativa/);assert.match(d.textContent,/<img src=x/);assert.equal(d.querySelector('img[src=x]'),null);
 }finally{b.dom.window.close();}
});
