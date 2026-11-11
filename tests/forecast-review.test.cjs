const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const core=require('../forecast-review-core.js');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const tick=()=>new Promise(r=>setTimeout(r,25));
const item=value=>({value,reason:'Evidencia revisada para esta prueba',refs:['https://example.test/evidence']});
const evidence=()=>({method:core.METHOD,confirmed_out:false,role:item('established'),availability:item('clear'),rotation:item('low'),agreement:item('consistent'),quality:item('primary'),horizon:item('near')});
const payload=(probability=65)=>({team:'real-madrid',fixture_key:'fixture',matchday:13,kickoff_at:'2026-11-21T20:00:00Z',status:'draft',limitations:['Datos sintéticos de prueba'],sources:[{id:'test',url:'https://example.test/',status:'read',fetched_at:'2026-11-11T16:00:00Z',source_updated_at:null,starters:['Ejemplo']}],proposal:{formation:'4-2-3-1',players:Array.from({length:11},(_,i)=>({id:'player-'+i,name:'Jugador '+i,position:i===0?'GK':i<5?'DF':i<10?'MF':'FW',probability:i===5?probability:80,alternative:i===5&&probability<70?{id:'reserve',name:'Reserva'}:null,reason:'Motivo '+i}))}});
const row=(key='pilot-new',p=payload(),created='2026-11-11T17:00:00Z')=>({run_key:key,created_at:created,status:p.status,team:p.team,fixture_key:p.fixture_key,payload:p});
function setup(handler){
 const dom=new JSDOM(read('admin.html'),{url:'https://example.test/admin.html',runScripts:'outside-only'}),w=dom.window,calls=[];
 w.eval(read('forecast-review-core.js'));w.eval(read('forecast-review.js'));
 w.CubanForecastReview.init({client:{rpc:async(name,args)=>{calls.push({name,args});return handler(args.p_run_key);}}});
 const $=id=>w.document.getElementById(id);
 const open=()=>{$('forecastTool').open=true;$('forecastTool').dispatchEvent(new w.Event('toggle'));};
 return {dom,w,calls,$,open};
}
test('editorial method is deterministic, traceable and never silently fills missing evidence',()=>{
 const e=evidence(),original=JSON.stringify(e);
 assert.equal(core.evaluate(e).probability,85);assert.deepEqual(core.evaluate(e),core.evaluate(e));assert.equal(JSON.stringify(e),original);
 e.horizon=item('distant');assert.equal(core.evaluate(e).probability,75);
 e.availability=item('concern');assert.equal(core.evaluate(e).probability,60);
 e.confirmed_out=true;assert.throws(()=>core.evaluate(e));
 delete e.role;assert.throws(()=>core.evaluate(e));assert.throws(()=>core.evaluate({...e,method:'unrecognized'}));
 assert.match(core.assessment(payload().proposal.players[0]).label,/original/);
});
test('69 requires alternative; 70 does not; method mismatch is visible without changing recorded probability',()=>{
 const p=payload(69).proposal.players[5];assert.equal(p.alternative.name,'Reserva');
 const assessed={...p,probability:1,assessment:evidence()};assert.match(core.assessment(assessed).label,/inconsistente/);assert.equal(assessed.probability,1);
});
test('comparison reports entries, exits, alternative changes and refuses different fixtures or blocked attempts',()=>{
 const old=payload(65),p=payload(70);p.proposal.players[0]={...p.proposal.players[0],id:'new',name:'Nuevo'};
 const d=core.comparison(p,old);assert.equal(d.changes.length,3);assert.match(d.changes[1].change,/65% → 70%.*Reserva → —/);
 assert.equal(core.comparison({...p,fixture_key:'other'},old).changes.length,0);
 assert.equal(core.comparison({...p,status:'blocked'},old).changes.length,0);
 assert.match(core.comparison(p,null).message,/Primera/);
});
test('preparation applies the versioned method, preserves inputs and refuses legacy guesses or missing alternatives',()=>{
 const p={...payload(),publication_allowed:false};for(const player of p.proposal.players)player.assessment=evidence();
 const before=JSON.stringify(p),next=core.applyMethod(p);assert.equal(next.method_version,core.METHOD);assert.equal(next.proposal.players[5].probability,85);assert.equal(next.proposal.players[5].alternative,null);assert.equal(JSON.stringify(p),before);
 p.proposal.players[0].assessment.availability=item('concern');p.proposal.players[0].assessment.horizon=item('distant');assert.throws(()=>core.applyMethod(p),/alternativa/);
 assert.throws(()=>core.applyMethod({...payload(),publication_allowed:false}),/Método/);
 assert.throws(()=>core.applyMethod({...p,publication_allowed:true}));
});
test('UI loads only when authorized and opened, makes read RPCs, renders XI safely and resets on logout',async()=>{
 const p=payload(69);p.proposal.players[0].name='<img src=x onerror=alert(1)>';p.sources[0].url='javascript:alert(1)';
 const data=row('pilot-new',p),previous=row('pilot-old',payload(70),'2026-11-11T16:00:00Z');
 const page=setup(key=>({data:key?(key==='pilot-new'?data:previous):[data,previous]}));
 const {w,$,calls,dom,open}=page;
 try{
  open();await tick();assert.equal(calls.length,0);$('forecastTool').open=false;
  w.CubanForecastReview.authorize();open();await tick();await tick();
  assert.equal(calls.length,3);assert.ok(calls.every(c=>c.name==='get_forecast_pilot_drafts'));
  assert.equal($('forecastContent').querySelectorAll('.forecast-player').length,11);
  assert.equal($('forecastContent').querySelectorAll('img').length,0);
  assert.equal($('forecastContent').querySelectorAll('a[href^="javascript:"]').length,0);
  assert.match($('forecastContent').textContent,/No consta/);
  assert.equal($('forecastContent').querySelectorAll('.uncertain small').length,1);
  $('forecastContent').querySelector('.forecast-player').click();assert.match($('forecastPlayerDetail').textContent,/Motivo 10/);
  $('forecastTool').open=false;open();await tick();assert.equal(calls.length,3);
  w.CubanForecastReview.reset();assert.equal($('forecastContent').textContent,'');assert.equal($('forecastVersions').options.length,0);
 }finally{dom.window.close();}
});
test('blocked newest attempt does not masquerade as current XI; older draft remains selectable',async()=>{
 const blocked=row('pilot-blocked',{...payload(),status:'blocked',proposal:null});const old=row('pilot-old',payload(),'2026-11-11T16:00:00Z');
 const page=setup(key=>({data:key?(key==='pilot-blocked'?blocked:old):[blocked,old]}));
 try{page.w.CubanForecastReview.authorize();page.open();await tick();await tick();
 assert.equal(page.$('forecastContent').querySelectorAll('.forecast-player').length,0);
 page.$('forecastVersions').value='pilot-old';page.$('forecastVersions').dispatchEvent(new page.w.Event('change'));await tick();
 assert.equal(page.$('forecastContent').querySelectorAll('.forecast-player').length,11);
 }finally{page.dom.window.close();}
});
test('late network response after reset is discarded; retry works after unavailable migration',async()=>{
 let resolve;const page=setup(()=>new Promise(r=>{resolve=r;}));
 try{page.w.CubanForecastReview.authorize();page.open();await tick();page.w.CubanForecastReview.reset();resolve({data:[row()]});await tick();assert.equal(page.$('forecastContent').textContent,'');assert.equal(page.$('forecastVersions').options.length,0);}finally{page.dom.window.close();}
 let fail=true;const retry=setup(key=>fail?{error:{code:'PGRST202'}}:{data:key?row():[row()]});
 try{retry.w.CubanForecastReview.authorize();retry.open();await tick();assert.match(retry.$('forecastStatus').textContent,/no está habilitada/);fail=false;retry.$('forecastReload').click();await tick();await tick();assert.equal(retry.$('forecastContent').querySelectorAll('.forecast-player').length,11);}finally{retry.dom.window.close();}
});
test('permission loss clears already rendered private data',async()=>{
 let denied=false;const page=setup(key=>denied?{error:{code:'42501'}}:{data:key?row():[row()]});
 try{page.w.CubanForecastReview.authorize();page.open();await tick();await tick();denied=true;page.$('forecastReload').click();await tick();assert.equal(page.$('forecastContent').textContent,'');assert.match(page.$('forecastStatus').textContent,/denegado/);}finally{page.dom.window.close();}
});
test('public page does not load the private module; shared auth integration resets it',()=>{
 assert.doesNotMatch(read('index.html'),/forecast-review/);
 assert.match(read('admin.js'),/window.CubanForecastReview\?\.reset\(\)/);
 assert.match(read('admin.js'),/window.CubanForecastReview\?\.authorize\(\)/);
 assert.doesNotMatch(read('forecast-review.js'),/localStorage|sessionStorage|\.from\(|\.insert\(|\.update\(/);
});
test('removing only four forecast auth hooks restores the complete main admin byte contract',()=>{
 const normalized=read('admin.js')
  .replace("    if (viewId !== 'panelView') {\n      window.CubanSecondAdmin?.reset();\n      window.CubanForecastReview?.reset();\n    }", "    if (viewId !== 'panelView') window.CubanSecondAdmin?.reset();")
  .replace("      window.CubanForecastReview?.authorize();\n", '')
  .replace("      window.CubanForecastReview?.init({ client: state.client });\n", '')
  .replace("    window.CubanForecastReview?.reset();\n", '');
 assert.equal(require('node:crypto').createHash('sha256').update(normalized).digest('hex'),'0a3133578c36615963a7832cdc18c906e2c672d645e5877fa5ae4f2dadcecdfa');
});
