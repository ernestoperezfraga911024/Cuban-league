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
  assert.match(d.getElementById('performanceDialogBody').textContent,/pendientes de atribuir/);assert.equal(d.querySelector('[onerror]'),null);
  d.querySelector('[data-performance-close]').click();assert.equal(d.getElementById('performanceDialog').open,false);
  d.querySelector('[data-performance-back]').click();assert.equal(d.activeElement.dataset.performancePerson,'2');
  d.querySelector('[data-performance-person="20"]').click();assert.match(d.getElementById('marketPerformance').textContent,/no tiene compras/);
  assert.equal(reads,1);
  p.history.events.push({reference:'new',playerId:'5',from:'3',to:'20',amount:0,date:'2026-11-19'});
  d.querySelector('[data-market-action="reload"]').click();await tick();await tick();
  assert.equal(d.querySelectorAll('[data-performance-operation]').length,1);assert.equal(reads,2);
 }finally{w.close();}
});
