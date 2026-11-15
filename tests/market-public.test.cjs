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
function setup(fetch){
 const dom=new JSDOM('<body data-section="home"><section id="market"><button data-market-action="reload">Actualizar</button><button data-market-view="players"></button><button data-market-view="history"></button><div id="marketBody"></div></section><div id="team"></div></body>',{runScripts:'outside-only',url:'https://league.example/'});
 dom.window.fetch=fetch;dom.window.CUBAN_LEAGUE_SUPABASE={url:'https://db.example',publishableKey:'public-test'};
 for(const file of ['market-core.js','market.js'])dom.window.eval(fs.readFileSync(path.join(__dirname,'..',file),'utf8'));
 return dom;
}
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
