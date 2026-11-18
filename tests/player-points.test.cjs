'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom'),{build,createStore}=require('../player-points.js');
const read=file=>fs.readFileSync(require.resolve('../'+file),'utf8');
const participants=[{id:1,name:'Uno'},{id:2,name:'Dos'}];
const catalog={playersById:new Map(Array.from({length:11},(_,i)=>['p'+i,{id:'p'+i,misterId:String(100+i)}]))};
const app=read('app.js');
const adjustment=app.slice(app.indexOf('function leagueNoBonusCaptainAdjustment('),app.indexOf('\nfunction leagueNoBonusMatchday('));
const context=vm.createContext({matchdayLineupNumericValue:(v,f=0)=>Number.isFinite(Number(v))?Number(v):f});
vm.runInContext(adjustment,context);
const options={catalog,participants,season:'2026/27',captainAdjustment:context.leagueNoBonusCaptainAdjustment,isEmpty:p=>p.player_id?.startsWith('empty-slot-')};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('the shared points module loads before app initialization and every changed asset is available offline',()=>{
 const html=read('index.html'),sw=read('sw.js');
 for(const name of ['app.js','player-points.js','market.js','market.css','market-core.js']){
  const asset=name+'?v='+(name.startsWith('market')?'245-20261118-player-owners':'242-20261117-player-points');assert.ok(html.includes(asset));assert.ok(sw.includes(asset));
 }
 assert.ok(html.indexOf('<script src="player-points.js')<html.indexOf('<script src="app.js'));
 assert.doesNotMatch(html,/<script src="player-points[^>]+defer/);
});
function row(day=1,name='Uno'){
 return {season:'2026/27',published:true,participant_name:name,matchday:day,points:44,updated_at:'2026-11-17T10:00:00Z',
  lineup:Array.from({length:11},(_,i)=>({slot_number:i+1,player_id:'p'+i,player_name:'Jugador '+i,position:'MC',
   displayed_points:i===10?24:2,is_captain:i===10,captain_multiplier:i===10?3:1}))};
}
test('links by stable ID across owners and renames; separates the exact captain bonus and retains every round',()=>{
 const a=row(),b=row(2,'Dos');b.lineup[10].player_name='Otro nombre';b.lineup[10].displayed_points=-6;
 const rows=[a,b],before=JSON.stringify(rows),m=build({...options,rows}),p=m.playersByMisterId.get('110');
 assert.equal(p.playerId,'p10');assert.equal(p.points,6);assert.equal(p.captainBonus,12);assert.equal(p.contributionPoints,18);
 assert.deepEqual(p.matchdays.map(d=>[d.matchday,d.points,d.appearances[0].participantId]),[[1,8,1],[2,-2,2]]);
 assert.equal(JSON.stringify(rows),before);assert.equal(m.playersByMisterId.get('999'),undefined);
});
test('only catalog IDs join to Mister; names, missing identities, homonyms and duplicate provider IDs cannot guess a link',()=>{
 const r=row();r.lineup[0].player_id='legacy';r.lineup[0].player_name='Jugador 1';
 const m=build({...options,rows:[r]});assert.equal(m.playersByMisterId.has('100'),false);assert.equal(m.playersById.get('legacy').points,2);
 const duplicate={playersById:new Map(catalog.playersById)};duplicate.playersById.set('p1',{misterId:'100'});
 const ambiguous=build({...options,catalog:duplicate,rows:[row()]});assert.equal(ambiguous.playersByMisterId.get('100'),null);
});
test('corrected and unpublished rounds replace previous totals instead of adding them again',()=>{
 const old=row(),fixed=row();fixed.updated_at='2026-11-17T11:00:00Z';fixed.lineup[10].displayed_points=30;
 assert.equal(build({...options,rows:[old,fixed,old]}).playersById.get('p10').points,10);
 fixed.published=false;assert.equal(build({...options,rows:[fixed]}).playersById.size,0);
 fixed.published=true;fixed.season='2025/26';assert.equal(build({...options,rows:[fixed]}).playersById.size,0);
 fixed.season='2026/27';fixed.participant_name='No pertenece';assert.equal(build({...options,rows:[fixed]}).playersById.size,0);
});
test('same player in two lineups in one round counts his score once; real contributions remain attributed to both owners',()=>{
 const a=row(),b=row(1,'Dos');b.lineup[10].displayed_points=16;b.lineup[10].captain_multiplier=2;
 const p=build({...options,rows:[a,b]}).playersById.get('p10');assert.equal(p.points,8);assert.equal(p.contributionPoints,40);assert.equal(p.matchdays[0].appearances.length,2);
 b.lineup[10].displayed_points=18;assert.equal(build({...options,rows:[a,b]}).playersById.get('p10').points,null);
});
test('zero, negatives, provisional points and x1.5 are preserved; invalid multipliers do not fabricate base scores',()=>{
 for(const [score,multiplier,expected] of [[0,2,0],[-6,3,-2],[8,1.5,5],[7.5,1.5,5],[7,1.5,null]]){
  const r=row();r.has_postponed_matches=true;Object.assign(r.lineup[10],{displayed_points:score,captain_multiplier:multiplier});
  const p=build({...options,rows:[r]}).playersById.get('p10');assert.equal(p.points,expected);assert.equal(p.provisional,true);
 }
});
test('missing lineups, ambiguous corrections and negative balance are not silently converted to player zeroes',()=>{
 for(const mutate of [r=>r.lineup.pop(),r=>r.lineup[0].displayed_points=null,r=>r.lineup[0].slot_number=2,r=>r.lineup[0].player_id='p1',r=>r.lineup='broken',r=>r.points=null]){
  const r=row();mutate(r);const m=build({...options,rows:[r]});assert.equal(m.playersById.size,0);assert.equal(m.diagnostics.invalidRows,1);
 }
 const a=row(),b=row();b.lineup[0].displayed_points=3;const m=build({...options,rows:[a,b]});assert.equal(m.diagnostics.ambiguousRows,1);assert.equal(m.playersById.size,0);
 const negative=row();negative.negative_balance_no_score=true;negative.points=0;assert.equal(build({...options,rows:[negative]}).playersById.size,0);
 const empty=row();empty.lineup[0].player_id='empty-slot-1';empty.lineup[0].displayed_points=-4;
 assert.equal(build({...options,rows:[empty]}).playersById.has('empty-slot-1'),false);
});
test('shared store coalesces requests, refreshes corrected data, handles unpublishing and retries errors',async()=>{
 const store=createStore();let calls=0,rows=[row()],fail=false;
 store.configure({load:async()=>{calls++;if(fail)throw Error('offline');return structuredClone(rows);},options:()=>options});
 await Promise.all([store.readRows(),store.readRows()]);assert.equal(calls,1);assert.equal(store.snapshot().model.playersById.get('p10').points,8);
 rows[0].lineup[10].displayed_points=30;store.invalidate();await store.readRows();assert.equal(calls,2);assert.equal(store.snapshot().model.playersById.get('p10').points,10);
 rows=[];await store.readRows({force:true});assert.equal(store.snapshot().model.playersById.size,0);
 fail=true;await assert.rejects(store.readRows({force:true}));assert.equal(store.snapshot().status,'error');assert.equal(store.snapshot().model,null);
 fail=false;await store.readRows();assert.equal(store.snapshot().status,'ready');
});
test('an older in-flight fetch cannot replace a new publication; requests before initialization resume on configure',async()=>{
 const store=createStore();await store.readRows();let release,calls=0;
 store.configure({load:()=>{calls++;if(calls===1)return new Promise(resolve=>release=resolve);const r=row();r.lineup[10].displayed_points=30;return [r];},options:()=>options});
 await tick();store.invalidate();await store.readRows();release([row()]);await tick();
 assert.equal(store.snapshot().model.playersById.get('p10').points,10);assert.equal(calls,2);
});
test('market and team panels show the same linked score and update in place without another market capture',async()=>{
 const fixture=require('./helpers/market-fixture.cjs')(),dom=new JSDOM('<body data-section="home"><section id="market"><div id="marketBody"></div></section><div id="team"></div></body>',{runScripts:'outside-only',url:'https://league.test/'});
 const w=dom.window,d=w.document;let marketReads=0;w.fetch=async()=>{marketReads++;return {ok:true,json:async()=>[{payload:fixture}]};};
 w.CUBAN_LEAGUE_SUPABASE={url:'https://db.test',publishableKey:'public'};
 for(const f of ['player-points.js','market-core.js','market.js'])w.eval(read(f));
 const localCatalog={playersById:new Map(catalog.playersById)};localCatalog.playersById.set('p10',{misterId:'1'});
 let rows=[row()];w.CubanLeaguePlayerPoints.store.configure({load:async()=>structuredClone(rows),options:()=>({...options,catalog:localCatalog})});
 try{
  d.body.dataset.section='market';await tick();await tick();
  await w.CubanLeagueMarket.showTeam(d.getElementById('team'),fixture.managers[0].participantId);
  assert.equal(d.querySelector('[data-player-points="1"]').textContent,'8');
  assert.match(d.querySelector('[data-player-points="1"]').getAttribute('aria-label'),/8 puntos en liga.*Bonus de capitán \+16/);
  assert.equal(d.querySelector('#team .market-player-visual [data-player-points="1"]').textContent,'8');
  assert.equal(d.querySelector('#team [data-player-points-detail="1"] .market-captain-bonus').textContent,'Capitán +16');
  const reads=marketReads;rows[0].lineup[10].displayed_points=30;w.CubanLeaguePlayerPoints.store.invalidate();await tick();
  assert.equal(d.querySelector('#team [data-player-points="1"]').textContent,'10');assert.equal(marketReads,reads);
  assert.equal(d.querySelector('#team .market-captain-bonus').textContent,'Capitán +20');
  rows[0].lineup[10].displayed_points=-6;w.CubanLeaguePlayerPoints.store.invalidate();await tick();
  assert.equal(d.querySelector('#team .market-captain-bonus.is-negative').textContent,'Capitán -4');
  assert.equal(d.querySelector('[data-player-points="61"]').textContent,'—');
  assert.match(d.querySelector('[data-player-points="61"]').getAttribute('aria-label'),/Sin puntos registrados/);
 }finally{w.close();}
});
test('the existing publication poll refreshes player points even when a correction leaves the team total unchanged',async()=>{
 const dom=new JSDOM(read('index.html'),{runScripts:'outside-only',url:'https://league.test/'}),w=dom.window;
 w.CUBAN_LEAGUE_SUPABASE={url:'https://db.test',publishableKey:'public',season:'2026/27'};
 w.eval(read('player-points.js'));
 w.eval(app.replace(/init\(\);\s*$/,`window.pointAppTest={syncLiveCurrentStats,ensureLeagueStatsData,fetchPublishedLeagueStatsRows,
  setup(data,catalog){DATA=data;PLAYER_CATALOG=catalog;},getStats(){return LEAGUE_STATS_STATE.data;}};`));
 const data=JSON.parse(read('data.json'));data.participants=structuredClone(participants);
 w.pointAppTest.setup(data,{...catalog,resolve:()=>null,clubsById:new Map(),clubs:[]});
 let rows=[row()],lineupReads=0;
 w.fetch=async url=>{
  const query=new URL(url);assert.equal(query.searchParams.get('published'),'eq.true');assert.equal(query.searchParams.get('season'),'eq.2026/27');
  if(query.searchParams.get('select').includes('lineup')){lineupReads++;return {ok:true,json:async()=>structuredClone(rows)};}
  return {ok:true,json:async()=>rows.map(({lineup,...r})=>r)};
 };
 const store=w.CubanLeaguePlayerPoints.store;store.configure({load:()=>w.pointAppTest.fetchPublishedLeagueStatsRows(),options:()=>options});
 try{
  await w.pointAppTest.syncLiveCurrentStats({render:false});
  await Promise.all([store.readRows(),w.pointAppTest.ensureLeagueStatsData()]);assert.equal(lineupReads,1);
  rows[0].updated_at='2026-11-17T12:00:00Z';rows[0].lineup[10].displayed_points=30;
  const result=await w.pointAppTest.syncLiveCurrentStats({render:false});assert.equal(result.changed,true);
  await store.readRows();assert.equal(lineupReads,2);assert.equal(store.snapshot().model.playersById.get('p10').points,10);
  await w.pointAppTest.syncLiveCurrentStats({render:false});assert.equal(lineupReads,2);
 }finally{w.close();}
});

test('owner contributions include captain bonus, zero and negative rounds, repeated ownership and both owners in one round',()=>{
 const core=require('../market-core.js'),p=require('./helpers/market-fixture.cjs')();
 p.players[0].id='110';p.players[0].ownerId='3';
 p.history.events=p.history.events.filter(e=>e.playerId==='1').map(e=>({...e,playerId:'110'}));
 p.history.events.push({reference:'return',playerId:'110',date:null,from:'2',to:'1',amount:2000});
 const a=row(),b=row(2),c=row(3),d=row(3,'Dos');b.lineup[10].displayed_points=0;c.lineup[10].displayed_points=-6;d.lineup[10].displayed_points=16;d.lineup[10].captain_multiplier=2;
 const model=build({...options,rows:[a,b,c,d]}),before=JSON.stringify(p),player=model.playersByMisterId.get('110');
 const owners=core.playerOwners(p,'110',player),one=owners.find(x=>x.id==='1'),two=owners.find(x=>x.id==='2');
 assert.equal(owners.length,3);assert.equal(owners[0].id,'3');assert.equal(owners[0].current,true);assert.equal(owners[0].points,null);assert.equal(owners[0].average,null);
 assert.deepEqual(one.matchdays,[1,2,3]);assert.equal(one.points,18);assert.equal(one.average,6);
 assert.equal(two.points,16);assert.equal(two.average,16);assert.deepEqual(two.matchdays,[3]);
 assert.equal(owners.reduce((sum,x)=>sum+(x.points||0),0),player.contributionPoints);
 assert.equal(JSON.stringify(p),before);assert.equal(core.playerOwners(p,'2',player).some(x=>x.points!==null),false);
 p.players[0].ownerId=null;assert.equal(core.playerOwners(p,'110',player).some(x=>x.current),false);
 // The XI alone is enough to identify an owner; no clause is required.
 p.history.events=[];assert.deepEqual(core.playerOwners(p,'110',player).map(x=>x.id).sort(),['1','2']);
 const corrected=structuredClone(a);corrected.updated_at='2026-11-18T00:00:00Z';corrected.lineup[10].displayed_points=30;
 const fixed=build({...options,rows:[a,corrected,b,c,d]}).playersByMisterId.get('110');
 assert.equal(core.playerOwners(p,'110',fixed).find(x=>x.id==='1').points,24);
});
test('player disclosure uses existing data, escapes names, keeps prices separate and refreshes owner totals in place',async()=>{
 const fixture=require('./helpers/market-fixture.cjs')(),dom=new JSDOM('<body data-section="home"><section id="market"><button data-market-action="reload">Actualizar</button><div id="marketBody"></div></section></body>',{runScripts:'outside-only',url:'https://league.test/'});
 const w=dom.window,d=w.document;let marketReads=0;
 fixture.players[0].name='Uno <b>especial</b>';fixture.managers[0].name='<img src=x onerror=alert(1)>';
 w.fetch=async()=>{marketReads++;return {ok:true,json:async()=>[{payload:structuredClone(fixture)}]};};
 w.CUBAN_LEAGUE_SUPABASE={url:'https://db.test',publishableKey:'public'};w.DATA={participants:[{id:1,shield:'team-01.png'}]};
 for(const f of ['player-points.js','market-core.js','market.js'])w.eval(read(f));
 const localCatalog={playersById:new Map(catalog.playersById)};localCatalog.playersById.set('p10',{misterId:'1'});
 let rows=[row()];w.CubanLeaguePlayerPoints.store.configure({load:async()=>structuredClone(rows),options:()=>({...options,catalog:localCatalog})});
 try{
  d.body.dataset.section='market';await tick();await tick();
  const search=d.getElementById('marketSearch');search.value='Uno';search.dispatchEvent(new w.Event('input',{bubbles:true}));
  const button=d.querySelector('[data-market-player="1"]');button.click();
  const panel=()=>d.getElementById('marketPlayerOwners1');
  assert.equal(button.getAttribute('aria-expanded'),'true');assert.equal(panel().querySelectorAll('li').length,2);
  assert.equal(panel().querySelector('img').getAttribute('src'),'team-01.png');assert.equal(d.querySelector('[onerror]'),null);
  assert.deepEqual([...panel().querySelector('[data-player-owner="1"]').querySelectorAll('.market-owner-stat')].map(el=>el.textContent),['24','1','24']);
  assert.match(panel().textContent,/Sin XI publicados/);assert.equal(marketReads,1);
  d.querySelector('[data-market-player-row="1"] .market-price summary').click();assert.ok(panel());
  rows[0].lineup[10].displayed_points=30;w.CubanLeaguePlayerPoints.store.invalidate();await tick();
  assert.equal(panel().querySelector('.market-owner-stat').textContent,'30');assert.equal(marketReads,1);assert.equal(d.querySelectorAll('.market-player-detail-row').length,1);
  fixture.players[0].ownerId='2';d.querySelector('[data-market-action="reload"]').click();await tick();await tick();
  assert.equal(panel().querySelector('li').dataset.playerOwner,'2');assert.equal(marketReads,2);
  d.querySelector('[data-market-player="1"]').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(panel(),null);assert.equal(d.activeElement.dataset.marketPlayer,'1');
  d.querySelector('[data-market-player-row="1"] .market-player-visual').click();assert.ok(panel());
  search.value='';d.getElementById('marketSearch').value='';d.getElementById('marketSearch').dispatchEvent(new w.Event('input',{bubbles:true}));
  d.querySelector('[data-market-player="100"]').click();assert.equal(d.querySelectorAll('.market-player-detail-row').length,1);assert.equal(panel(),null);
  assert.match(d.getElementById('marketPlayerOwners100').textContent,/Actualmente libre/);
 }finally{w.close();}
});
