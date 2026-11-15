'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),core=require('../market-core.js'),fixture=require('./helpers/market-fixture.cjs');
const {bindManagers}=require('../scripts/mister-market/publication.cjs');
const {prepare}=require('../scripts/mister-market/publication.cjs'),{restoreArchive}=require('../scripts/mister-market/restore-archive.cjs'),{hash}=require('../scripts/mister-market/core.cjs'),{clauseReport}=require('../scripts/mister-market/clause-stats.cjs');
test('Market publication: verified squads, immutable evidence, lossless restore and no cross-source sum',()=>{
 const p=fixture(),s={schemaVersion:1,leagueId:p.leagueId,season:p.season,catalogComplete:true,publicationReady:false,startedAt:'2026-11-15T19:00:00Z',completedAt:p.capturedAt,
  managers:p.managers.map(m=>({id:m.id,name:m.name})),clubs:[{id:'1',name:'Club'}],movements:[],players:p.players.map(x=>({playerId:x.id,name:x.name,position:x.position,clubId:'1',photoUrl:null,marketValue:x.value,clauseValue:x.clause,ownerId:x.ownerId}))};s.snapshotHash=hash(s);
 const ledger={schemaVersion:1,leagueId:p.leagueId,season:p.season,publicationReady:false,completedAt:p.capturedAt,events:[],headEventIds:[]};ledger.ledgerHash=hash(ledger);
 const v={leagueId:p.leagueId,snapshotHash:s.snapshotHash,completedAt:p.capturedAt,teams:p.managers.map(m=>({managerId:m.id,verified:true,playerCount:p.players.filter(x=>x.ownerId===m.id).length})),
  histories:p.players.map(x=>({playerId:x.id,movements:p.history.events.filter(e=>e.playerId===x.id).map(e=>({type:'clause',amount:e.amount,occurredOn:e.date,from:{managerId:e.from,name:'Participante '+e.from},to:{managerId:e.to,name:'Participante '+e.to}}))}))};
 const backup={schemaVersion:1,leagueId:p.leagueId,season:p.season,exportedAt:p.capturedAt,completeSeason:false,captures:[s],verification:v,feedLedger:ledger,clauseStatistics:clauseReport(s,ledger,v)};
 const participants=p.managers.map(m=>({id:m.participantId,name:m.name}));
 const prepared=prepare(backup,participants);assert.equal(prepared.payload.history.events.length,3);assert.equal(prepared.review.visible,false);assert.deepEqual(restoreArchive(prepared.archive),backup);
 assert.throws(()=>restoreArchive({...prepared.archive,rawBytes:1}));assert.throws(()=>restoreArchive({...prepared.archive,compressedBase64:'invalid'}));
 const missing=structuredClone(backup);missing.verification.teams.pop();assert.throws(()=>prepare(missing,participants));
 const later=structuredClone(s);later.startedAt='2026-11-15T20:00:00Z';later.completedAt='2026-11-15T20:01:00Z';delete later.snapshotHash;later.snapshotHash=hash(later);
 const same=structuredClone(backup);same.captures.push(later);assert.equal(prepare(same,participants).payload.snapshotHash,later.snapshotHash);
 later.players[0].marketValue++;delete later.snapshotHash;later.snapshotHash=hash(later);assert.throws(()=>prepare(same,participants),/unverified_market_changes/);
 assert.throws(()=>prepare({...backup,auth:{}},participants),/unexpected_backup_field/);
});
test('Market: exact identities, prices, filters, historical totals and ties',()=>{
 const p=core.validate(fixture());
 assert.equal(core.select(p,{owner:'free'}).length,20);
 assert.equal(core.select(p,{owner:'1'}).length,4);
 assert.equal(core.select(p,{search:'azul',position:'DF'}).length,25);
 assert.equal(core.select(p,{sort:'value'})[0].id,'100');
 assert.equal(core.select(p,{sort:'clause'})[0].id,'80');
 const stats=core.stats(p);assert.equal(stats.reduce((sum,x)=>sum+x.spent,0),11000);assert.equal(stats.reduce((sum,x)=>sum+x.collected,0),11000);
 assert.equal(stats.reduce((sum,x)=>sum+x.made,0),3);assert.equal(stats.reduce((sum,x)=>sum+x.received,0),3);
 assert.deepEqual(core.rank(p,'spent').slice(0,3).map(x=>x.rank),[1,1,3]);
 assert.equal(stats[0].spent,5000);assert.equal(stats[0].collected,1000);
 for(const mutate of [x=>x.players.push(x.players[0]),x=>x.managers[1].participantId=1,x=>x.players[0].ownerId='unknown',x=>x.players[0].value=null,x=>x.players[80].clause=0,x=>x.history.completeSeason=true,x=>x.history.events.push(x.history.events[0]),x=>x.players[0].photo='javascript:alert(1)']){const x=fixture();mutate(x);assert.throws(()=>core.validate(x));}
 assert.deepEqual(bindManagers([{id:'1',name:'Álvaro 🇨🇺'}],[{id:2,name:'Alvaro'}]),[{id:'1',participantId:2,name:'Alvaro'}]);
 assert.throws(()=>bindManagers([{id:'1',name:'Alvaro'}],[{id:1,name:'Álvaro'},{id:2,name:'Alvaro'}]));
 assert.throws(()=>bindManagers([{id:'1',name:'Alvaro Jr'}],[{id:1,name:'Alvaro'}]));
});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('Market rivals: incoming direction, all 20, top three by count, alphabetical ties and repeated footballers',()=>{
 const p=fixture();p.schemaVersion=2;p.history.source='reconciled';p.history.reconciliation='minimum_confirmed';
 ['Receptor','Líder','Zeta','Beta','Alfa'].forEach((name,i)=>p.managers[i].name=name);
 p.history.events=[2,2,2,3,3,4,4,5,5].map((to,i)=>({reference:'clause-'+i,playerId:'1',date:i===0?null:'2026-08-16',from:'1',to:String(to),amount:to===3?999999:1000}));
 p.history.events.push({reference:'reverse',playerId:'2',date:'2026-08-17',from:'2',to:'1',amount:9000000});
 core.validate(p);const before=JSON.stringify(p),rows=core.clauseRivals(p),target=rows.find(row=>row.id==='1');
 assert.equal(rows.length,20);assert.equal(target.received,9);assert.equal(target.rivalCount,4);
 assert.deepEqual(target.top.map(row=>[row.name,row.count]),[['Líder',3],['Alfa',2],['Beta',2]]);
 assert.equal(target.top[0].events.length,3);assert.equal(target.top[0].events.at(-1).date,null);
 assert.equal(target.top[0].events.filter(event=>event.playerId==='1').length,3);
 assert.equal(rows.find(row=>row.id==='2').top[0].id,'1');
 assert.deepEqual(rows.find(row=>row.id==='20').top,[]);
 assert.equal(rows.reduce((sum,row)=>sum+row.received,0),core.stats(p).reduce((sum,row)=>sum+row.received,0));
 assert.equal(JSON.stringify(p),before);
});
function setup(fetch){
 const dom=new JSDOM('<body data-section="home"><section id="market"><button data-market-action="reload">Actualizar</button><button data-market-view="players"></button><button data-market-view="history"></button><div id="marketBody"></div></section><div id="team"></div></body>',{runScripts:'outside-only',url:'https://league.example/'});
 dom.window.fetch=fetch;dom.window.CUBAN_LEAGUE_SUPABASE={url:'https://db.example',publishableKey:'public-test'};
 for(const file of ['market-core.js','market.js'])dom.window.eval(fs.readFileSync(path.join(__dirname,'..',file),'utf8'));
 return dom;
}
test('Market rivals: lazy accessible details, safe names and fresh history after Actualizar without extra reads',async()=>{
 let p=fixture(),reads=0;p.schemaVersion=2;p.history.source='reconciled';p.history.reconciliation='minimum_confirmed';
 p.history.events[0].date=null;p.managers[1].name='<img src=x onerror=alert(1)>';p.players[0].name='<b>Futbolista</b>';
 const dom=setup(async()=>{reads++;return {ok:true,json:async()=>[{payload:structuredClone(p)}]};}),w=dom.window,d=w.document;
 w.DATA={participants:[{id:1,shield:'team-01.png'}]};
 const openTarget=id=>{const detail=d.querySelector(`[data-market-target="${id}"]`);detail.open=true;detail.dispatchEvent(new w.Event('toggle'));return detail;};
 try{
  d.body.dataset.section='market';await tick();await tick();d.querySelector('[data-market-view="history"]').click();
  d.querySelector('[data-market-history="participants"]').click();
  assert.equal(d.activeElement.dataset.marketHistory,'participants');assert.equal(d.querySelectorAll('.market-target').length,20);
  assert.equal(d.querySelectorAll('.market-rival').length,0);
  const detail=openTarget('1');assert.equal(detail.querySelector('summary img').getAttribute('src'),'team-01.png');
  assert.equal(detail.querySelector('.market-rival-heading strong').textContent,p.managers[1].name);
  assert.equal(detail.querySelector('.market-rival-players strong').textContent,p.players[0].name);
  assert.match(detail.textContent,/Fecha no disponible/);assert.equal(detail.querySelector('.market-price-exact').textContent,'1000 €');
  assert.equal(d.querySelector('[onerror]'),null);assert.match(openTarget('20').textContent,/Sin clausulazos recibidos/);
  assert.equal(reads,1);
  p.history.events.push({reference:'new-1',playerId:'2',date:'2026-08-18',from:'1',to:'3',amount:12345000},{reference:'new-2',playerId:'3',date:'2026-08-19',from:'1',to:'3',amount:2000});
  d.querySelector('[data-market-action="reload"]').click();await tick();await tick();
  const refreshed=openTarget('1');assert.equal(refreshed.querySelector('.market-target-total b').textContent,'3');
  assert.equal(refreshed.querySelector('.market-rival-heading strong').textContent,'Participante 3');assert.equal(refreshed.querySelectorAll('.market-rival').length,2);
  assert.equal(refreshed.querySelectorAll('.market-rival-players li').length,3);assert.equal(reads,2);
  d.querySelector('[data-market-history="events"]').click();assert.equal(d.activeElement.dataset.marketHistory,'ranking');assert.equal(d.querySelectorAll('.market-events li').length,5);
  d.querySelector('[data-market-history="ranking"]').click();assert.equal(d.querySelectorAll('.market-ranking li').length,20);
 }finally{w.close();}
});
test('Market: lazy fetch, same capture for concurrent team/page, text escaping and filters',async()=>{
 const p=fixture();p.players[0].name='<img src=x onerror=alert(1)>';
 let count=0,resolve;const dom=setup(async()=>{count++;return new Promise(r=>resolve=r);}),w=dom.window,d=w.document;
 try{
  assert.equal(count,0);d.body.dataset.section='market';await tick();
  const team=w.CubanLeagueMarket.showTeam(d.getElementById('team'),1);assert.equal(count,1);
  resolve({ok:true,json:async()=>[{payload:p}]});await team;await tick();
  assert.equal(count,1);assert.match(d.getElementById('team').textContent,/4Futbolistas/);assert.equal(d.querySelectorAll('[onerror]').length,0);
  const search=d.getElementById('marketSearch');search.value='Futbolista 100';search.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(d.querySelectorAll('#marketResults tbody tr').length,1);
  d.querySelector('[data-market-view="history"]').click();assert.match(d.getElementById('marketBody').textContent,/Cobertura parcial/);assert.equal(d.querySelectorAll('.market-ranking li').length,20);
 }finally{w.close();}
});
test('Market: transport failure is not an empty squad, retry succeeds and removed hosts stay untouched',async()=>{
 let fail=true,resolve;const dom=setup(async()=>fail?{ok:false}:new Promise(r=>resolve=r)),w=dom.window,d=w.document,target=d.getElementById('team');
 try{
  await w.CubanLeagueMarket.showTeam(target,1);assert.match(target.textContent,/No se pudo cargar/);assert.ok(target.querySelector('button'));
  fail=false;const result=w.CubanLeagueMarket.showTeam(target,1,true);target.remove();const before=target.innerHTML;resolve({ok:true,json:async()=>[{payload:fixture()}]});await result;assert.equal(target.innerHTML,before);
  const next=d.createElement('div');d.body.append(next);await w.CubanLeagueMarket.showTeam(next,1);assert.match(next.textContent,/4Futbolistas/);
 }finally{w.close();}
});
test('Market editorial: stable participant logos, archive navigation, exact prices and preserved filters',async()=>{
 const p=fixture();p.players[99].value=25136000;p.players[79].clause=121200000;
 p.history.events=Array.from({length:45},(_,i)=>({...p.history.events[i%3],reference:'event-'+i,date:i===44?null:p.history.events[i%3].date}));
 p.schemaVersion=2;p.history.source='reconciled';p.history.reconciliation='minimum_confirmed';
 const original=JSON.stringify(p);let reads=0;
 const dom=setup(async()=>{reads++;return {ok:true,json:async()=>[{payload:p}]};}),w=dom.window,d=w.document;
 w.DATA={participants:[{id:4,shield:'team-04.png'},{id:1,shield:'team-01.png'},{id:2,shield:'javascript:alert(1)'}]};
 try{
  d.body.dataset.section='market';await tick();await tick();
  assert.equal(d.querySelector('#marketResults .market-price summary').textContent,'25,14 M €');
  assert.equal(d.querySelector('#marketResults .market-price-exact').textContent,'25.136.000 €');
  assert.equal(d.querySelector('#marketResults .market-price summary').getAttribute('aria-label'),'25.136.000 €. Ver importe exacto');
  const search=d.getElementById('marketSearch');search.value='Futbolista 100';search.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(d.querySelector('.market-result-count').textContent,'1 futbolista');
  d.querySelector('[data-market-view="history"]').click();
  assert.equal(d.querySelector('#marketHistoryInfo').hidden,true);
  assert.equal(d.querySelector('.market-events'),null);
  assert.equal(d.querySelector('.market-updated'),null);
  const rows=[...d.querySelectorAll('.market-ranking li')];
  assert.equal(rows.find(row=>row.querySelector('strong').textContent==='Participante 1').querySelector('img').getAttribute('src'),'team-01.png');
  assert.equal(rows.find(row=>row.querySelector('strong').textContent==='Participante 4').querySelector('img').getAttribute('src'),'team-04.png');
  assert.ok(rows.find(row=>row.querySelector('strong').textContent==='Participante 2').querySelector('.market-participant-fallback'));
  d.querySelector('[data-market-action="info"]').click();assert.equal(d.querySelector('#marketHistoryInfo').hidden,false);
  d.querySelector('[data-market-action="info"]').click();assert.equal(d.querySelector('#marketHistoryInfo').hidden,true);
  d.querySelector('[data-market-metric="spent"]').click();
  assert.equal(d.querySelector('.market-ranking-value .market-price-exact').textContent,'75.000 €');
  d.querySelector('[data-market-history="events"]').click();
  assert.equal(d.querySelector('.market-ranking'),null);assert.equal(d.querySelectorAll('.market-events li').length,20);
  d.querySelector('[data-market-action="events"]').click();assert.equal(d.querySelectorAll('.market-events li').length,40);
  d.querySelector('[data-market-action="events"]').click();assert.equal(d.querySelectorAll('.market-events li').length,45);
  assert.match(d.querySelector('.market-events li:last-child').textContent,/Fecha no disponible/);
  d.querySelector('[data-market-history="ranking"]').click();assert.equal(d.querySelector('[data-market-metric="spent"]').getAttribute('aria-pressed'),'true');
  d.querySelector('[data-market-view="players"]').click();assert.equal(d.getElementById('marketSearch').value,'Futbolista 100');assert.equal(d.querySelectorAll('#marketResults tbody tr').length,1);
  const details=d.querySelector('.market-price');details.open=true;details.querySelector('summary').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(details.open,false);
  assert.equal(reads,1);assert.equal(JSON.stringify(p),original);
 }finally{w.close();}
});
