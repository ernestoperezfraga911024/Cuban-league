const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom'),core=require('../market-core.js'),fixture=require('./helpers/market-fixture.cjs');
const read=file=>fs.readFileSync(require.resolve('../'+file),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('all participants, incoming purchases, repeat buys and unknown dates remain separate and immutable',()=>{
 const p=fixture();p.history.events.push({reference:'repeat',playerId:'1',from:'3',to:'2',amount:7000,date:null});
 const before=JSON.stringify(p),rows=core.performance(p),buyer=rows.find(m=>m.id==='2');
 assert.equal(rows.length,20);assert.equal(buyer.events.length,2);assert.equal(buyer.spent,8000);
 assert.deepEqual(buyer.events.map(e=>e.reference),['1:row:0','repeat']);assert.equal(buyer.events[0].purchases,2);
 assert.equal(buyer.events[0].operationPoints,null);assert.equal(buyer.events[0].ownerPoints,null);
 assert.equal(rows.find(m=>m.id==='20').events.length,0);assert.equal(JSON.stringify(p),before);
});
test('owner points are explicitly contextual, include negatives and captain once, and never become purchase returns',()=>{
 const p=fixture(),model={partial:true,playersByMisterId:new Map([['1',{matchdays:[
  {matchday:1,appearances:[{participantId:2,points:8,captainBonus:8,contributionPoints:16,provisional:false}]},
  {matchday:2,appearances:[{participantId:2,points:-2,captainBonus:-4,contributionPoints:-6,provisional:true},{participantId:3,points:9,captainBonus:0,contributionPoints:9}]}
 ]}]])};
 const e=core.performance(p,model).find(m=>m.id==='2').events[0];
 assert.equal(e.ownerPoints,10);assert.equal(e.ownerBase,6);assert.equal(e.ownerBonus,4);assert.equal(e.operationPoints,null);
 assert.equal(e.appearances.length,2);assert.equal(e.provisional,true);assert.equal(e.partial,true);
 model.playersByMisterId.get('1').matchdays[0].appearances[0].captainBonus=null;
 assert.equal(core.performance(p,model).find(m=>m.id==='2').events[0].ownerBonus,null);
});
test('three-level UI, all 20, repeat purchases, modal close, empty owner, escaping and refreshed shared data',async()=>{
 const p=fixture();p.schemaVersion=2;p.history.source='reconciled';p.history.reconciliation='minimum_confirmed';p.players[0].name='<img onerror=alert(1)>';p.history.events.push({reference:'repeat',playerId:'1',from:'3',to:'2',amount:7000,date:null});
 const dom=new JSDOM('<body data-section="home"><section id="market"><button data-market-action="reload">Actualizar</button><button data-market-view="history">Clausulazos</button><div id="marketBody"></div></section></body>',{runScripts:'outside-only',url:'https://example.test'});
 const w=dom.window,d=w.document;let reads=0;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.CUBAN_LEAGUE_SUPABASE={url:'https://db.example',publishableKey:'test'};w.DATA={participants:[{id:2,shield:'team-02.png'}]};
 w.fetch=async()=>{reads++;return {ok:true,json:async()=>[{payload:structuredClone(p)}]};};
 for(const file of ['market-core.js','market.js'])w.eval(read(file));
 try{
  d.body.dataset.section='market';await tick();await tick();d.querySelector('[data-market-view="history"]').click();d.querySelector('[data-market-history="performance"]').click();
  assert.equal(d.querySelectorAll('[data-performance-person]').length,20);
  d.querySelector('[data-performance-person="2"]').click();assert.equal(d.activeElement.id,'performanceHeading');
  assert.equal(d.querySelectorAll('[data-performance-operation]').length,2);
  d.querySelector('[data-performance-operation="repeat"]').click();
  assert.equal(d.getElementById('performanceDialog').open,true);assert.match(d.getElementById('performanceDialogBody').textContent,/7000/);
  assert.match(d.getElementById('performanceDialogBody').textContent,/Consultando puntos/);assert.equal(d.querySelector('[onerror]'),null);
  d.querySelector('[data-performance-close]').click();assert.equal(d.getElementById('performanceDialog').open,false);
  d.querySelector('[data-performance-back]').click();assert.equal(d.activeElement.dataset.performancePerson,'2');
  d.querySelector('[data-performance-person="20"]').click();assert.match(d.getElementById('marketPerformance').textContent,/no tiene compras/);
  assert.equal(reads,1);
  p.history.events.push({reference:'new',playerId:'5',from:'3',to:'20',amount:0,date:'2026-11-19'});
  d.querySelector('[data-market-action="reload"]').click();await tick();await tick();
  assert.equal(d.querySelectorAll('[data-performance-operation]').length,1);assert.equal(reads,2);
 }finally{w.close();}
});

const transfer=(reference,from,to,date='2026-08-15',playerId='1')=>({reference,from,to,date,playerId,amount:1000});
const appearance=(participantId,points,bonus=0)=>({participantId,points,captainBonus:bonus,contributionPoints:points+bonus,provisional:false});
function modelFor(days){return {partial:false,playersByMisterId:new Map([['1',{matchdays:days.map(([matchday,...appearances])=>({matchday,appearances}))}]])};}
const eventsFor=(p,model,id='2')=>core.performance(p,model).find(m=>m.id===id).events;
test('single purchase uses its XI stage, ignores bench gaps and other owners, and separates captain without calendar dates',()=>{
 const p=fixture();p.history.events=[transfer('buy','1','2',null)];
 const model=modelFor([[1,appearance(1,8)],[2,appearance(2,10,20)],[5,appearance(2,-2)],[6,appearance(3,9)]]);
 const before=JSON.stringify(p),e=eventsFor(p,model)[0];
 assert.equal(e.attribution,'lineup_sequence');assert.equal(e.operationPoints,28);assert.equal(e.operationBase,8);assert.equal(e.operationBonus,20);
 assert.deepEqual(e.operationAppearances.map(a=>a.matchday),[2,5]);assert.equal(JSON.stringify(p),before);
});
test('return to the same participant splits two dated purchases into disjoint XI stages',()=>{
 const p=fixture();p.history.events=[transfer('first','1','2','2026-08-15'),transfer('out','2','3','2026-09-01'),transfer('second','3','2','2026-10-01')];
 const model=modelFor([[1,appearance(1,5)],[2,appearance(2,4,4)],[4,appearance(2,0)],[5,appearance(3,2)],[6,appearance(2,10,20)],[9,appearance(2,-1)]]);
 const result=eventsFor(p,model),first=result.find(e=>e.reference==='first'),second=result.find(e=>e.reference==='second');
 assert.equal(first.operationPoints,8);assert.equal(second.operationPoints,29);assert.equal(result[0].reference,'second');
 assert.deepEqual(first.operationAppearances.map(a=>a.matchday),[2,4]);assert.deepEqual(second.operationAppearances.map(a=>a.matchday),[6,9]);
 assert.equal(first.operationPoints+second.operationPoints,first.ownerPoints);
 assert.equal(eventsFor(p,model,'3')[0].operationPoints,2);
});
test('unknown/tied rebuy dates or extra purchases never duplicate the owner total',()=>{
 for(const date of [null,'2026-08-15']){
  const p=fixture();p.history.events=[transfer('first','1','2'),transfer('second','3','2',date)];
  const model=modelFor([[1,appearance(1,1)],[2,appearance(2,5)],[3,appearance(3,4)],[4,appearance(2,9)]]);
  for(const e of eventsFor(p,model)){assert.equal(e.operationPoints,null);assert.equal(e.reason,'purchase_order');assert.equal(e.ownerPoints,14);}
 }
 const p=fixture();p.history.events=[transfer('first','1','2'),transfer('second','1','2','2026-09-01')];
 assert.equal(eventsFor(p,modelFor([[1,appearance(2,5)]]))[0].reason,'stage_count');
 p.history.events.pop();assert.equal(eventsFor(p,modelFor([[1,appearance(2,5)],[2,appearance(1,2)],[3,appearance(2,9)]]))[0].reason,'stage_count');
});
test('seller mismatch, contradictory purchase chronology and simultaneous owners stay pending',()=>{
 const p=fixture();p.history.events=[transfer('buy','3','2')];
 assert.equal(eventsFor(p,modelFor([[1,appearance(1,5)],[2,appearance(2,9)]]))[0].reason,'seller_mismatch');
 p.history.events=[transfer('buy','1','2')];
 assert.equal(eventsFor(p,modelFor([[1,appearance(1,5),appearance(2,9)]]))[0].reason,'shared_round');
 p.history.events=[transfer('late','1','2','2026-10-01'),transfer('early','2','3','2026-09-01')];
 const m=modelFor([[1,appearance(1,1)],[2,appearance(2,5)],[3,appearance(3,9)]]);
 assert.equal(eventsFor(p,m)[0].reason,'movement_order');assert.equal(eventsFor(p,m,'3')[0].reason,'movement_order');
});
test('known zero and negative contributions precede pending rows; missing evidence is not zero',()=>{
 const p=fixture();p.history.events=[transfer('zero','1','2'),transfer('negative','1','2',null,'2'),transfer('missing','1','2',null,'3')];
 const model=modelFor([[1,appearance(2,0)]]);model.playersByMisterId.set('2',{matchdays:[{matchday:2,appearances:[appearance(2,-2,-4)]}]});
 assert.deepEqual(eventsFor(p,model).map(e=>[e.reference,e.operationPoints]),[['zero',0],['negative',-6],['missing',null]]);
 const e=eventsFor(p,model)[1];assert.equal(e.operationBase,-2);assert.equal(e.operationBonus,-4);
});
test('provisional and unknown captain base stay explicit without losing the actual contribution',()=>{
 const p=fixture();p.history.events=[transfer('buy','1','2')];
 const model=modelFor([[1,{...appearance(2,5),points:null,captainBonus:null,provisional:true}]]);model.partial=true;
 const e=eventsFor(p,model)[0];assert.equal(e.operationPoints,5);assert.equal(e.operationBase,null);assert.equal(e.operationBonus,null);assert.equal(e.operationProvisional,true);assert.equal(e.partial,true);
});
test('an asynchronous points refresh reorders the list and updates an open detail without another network read',async()=>{
 const p=fixture();p.schemaVersion=2;p.history.source='reconciled';p.history.reconciliation='minimum_confirmed';p.history.events=[transfer('first','1','2'),transfer('other','1','2',null,'2')];
 const dom=new JSDOM('<body data-section="home"><section id="market"><button data-market-view="history">Clausulazos</button><div id="marketBody"></div></section></body>',{runScripts:'outside-only',url:'https://example.test'});
 const w=dom.window,d=w.document;let callback,model=null,reads=0,status='loading';
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.CubanLeaguePlayerPoints={store:{snapshot:()=>({model,status}),subscribe:fn=>callback=fn,readRows:()=>Promise.resolve([])}};
 w.CUBAN_LEAGUE_SUPABASE={url:'https://db.example',publishableKey:'test'};w.fetch=async()=>{reads++;return {ok:true,json:async()=>[{payload:structuredClone(p)}]};};
 for(const file of ['market-core.js','market.js'])w.eval(read(file));
 try{
  d.body.dataset.section='market';await tick();await tick();d.querySelector('[data-market-view="history"]').click();d.querySelector('[data-market-history="performance"]').click();d.querySelector('[data-performance-person="2"]').click();
  const button=d.querySelector('[data-performance-operation="first"]');button.focus();
  model=modelFor([[1,appearance(2,6,6)]]);model.playersByMisterId.set('2',{matchdays:[{matchday:2,appearances:[appearance(2,15)]}]});status='ready';callback();
  assert.equal(d.querySelector('[data-performance-operation]').dataset.performanceOperation,'other');assert.equal(d.activeElement.dataset.performanceOperation,'first');
  d.querySelector('[data-performance-operation="first"]').click();assert.match(d.getElementById('performanceDialogBody').textContent,/Aporte en esta etapa/);
  const details=d.querySelector('[data-performance-rounds]');details.open=true;details.querySelector('summary').focus();
  model=modelFor([[1,appearance(2,20,20)]]);callback();
  assert.equal(d.querySelector('[data-performance-operation]').dataset.performanceOperation,'first');assert.equal(d.querySelector('[data-performance-rounds]').open,true);assert.equal(d.activeElement.tagName,'SUMMARY');
  assert.match(d.querySelector('.market-performance-scores').textContent,/40/);assert.equal(reads,1);
  model=null;status='error';callback();assert.match(d.getElementById('marketPerformance').textContent,/No se pudieron cargar/);assert.equal(d.querySelector('.market-performance-scores'),null);
 }finally{w.close();}
});
