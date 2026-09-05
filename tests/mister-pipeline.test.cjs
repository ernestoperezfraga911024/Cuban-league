const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const core=read('mister-import-core.js');
const league=JSON.parse(read('data.json'));
const roster=league.participants.filter(p=>p.active!==false);
function escape(s){return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');}
async function captureFixture({pending=false,missingStats=false,negative=false}={}) {
  const ids=roster.map((p,i)=>String(100+i));
  const html=`<a class="active" href="https://mister.mundodeportivo.com/action/change?id_community=649733">1ra div Cubanleague</a>
    <button data-tab="gameweek" class="active">Jornada</button><a data-partial class="selected" href="/standings?gw=4044">J3</a>
    ${roster.map((p,i)=>`<a class="btn btn-sw-link user" href="users/${ids[i]}/manager"><div class="info"><div class="name">${escape(p.name)}</div><div class="played">${negative&&i===0?'Saldo negativo, no puntúa':'11 / 11'}</div></div><div class="points">${negative&&i===0?0:pending?10:11}<span> Pts</span></div></a>`).join('')}`;
  const dom=new JSDOM(html,{url:'https://mister.mundodeportivo.com/standings',runScripts:'outside-only'});
  const w=dom.window;
  Object.defineProperty(w.HTMLElement.prototype,'offsetWidth',{get(){return 10;}});
  let listener;let done;const completed=new Promise(resolve=>done=resolve);
  const job={id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',matchday:3,season:'2026/27'};
  w.chrome={runtime:{id:'test-extension',onMessage:{addListener(fn){listener=fn;}},sendMessage:async msg=>{
    if(msg.type==='MISTER_READY')return{ok:true,job};
    if(msg.type==='DISCOVERED') {job.discovery=msg.input.discovery;setTimeout(()=>listener({type:'RUN',job},{id:'test-extension'},()=>{}),0);}
    if(msg.type==='RESULT')done({payload:msg.input.payload});
    if(msg.type==='FAIL')done({error:msg.input.error});
    return{ok:true};
  }}};
  const rawCatalog=JSON.parse(read('catalog/players.json'));
  const counts={DL:3,MC:4,DF:3,PT:1};
  const players=Object.entries(counts).flatMap(([position,count])=>rawCatalog.players.filter(p=>p.position===position&&p.active!==false).slice(0,count));
  w.document.addEventListener('click',event=>{
    const manager=event.target.closest('a.user');
    if(manager){
      w.document.querySelector('.team-lineup')?.remove();
      const id=manager.getAttribute('href').split('/')[1];
      const container=w.document.createElement('div');container.className='team-lineup';
      container.innerHTML='<div class="lineup-starting">'+Object.keys(counts).map(position=>'<div class="line">'+players.filter(p=>p.position===position).map(p=>{
        const index=players.indexOf(p);return `<a class="lineup-player btn-player-gw" data-id_player="${p.mister_id||index+1}" data-id_manager="${id}" data-id_gameweek="4044"><div class="info"><div class="name">${escape(p.display_name)}</div><div class="points ${pending&&index===0?'pending':''}">${pending&&index===0?'':1}</div></div></a>`;
      }).join('')+'</div>').join('')+'</div>';
      w.document.body.append(container);
    }
    const card=event.target.closest('a.lineup-player');
    if(card){
      const overlay=w.document.createElement('div');overlay.id='overlay';overlay.className='show';
      const stats={goals:{value:0},redCard:{value:0},doubleYellowCard:{value:0},minutesPlayed:{value:90},goalsAgainst:{value:0,rating:4}};
      if(missingStats)delete stats.goals;
      overlay.innerHTML=`<button class="popup-close">Cerrar</button><div id="popup-content"><button data-stats="{}" data-id_gameweek="4044" data-marca_stats_rating_detailed_filtered="${escape(JSON.stringify(stats))}" data-name="Player">Ver más estadísticas</button></div>`;
      w.document.body.append(overlay);
    }
    if(event.target.closest('.popup-close')) w.document.querySelector('#overlay')?.remove();
  });
  w.eval(core);w.eval(read('mister-extension/collector.js'));
  const timer=setTimeout(()=>done({error:'fixture timeout'}),4000);
  const result=await completed;clearTimeout(timer);dom.window.close();
  assert.equal(result.error,undefined);return result.payload;
}
async function adminFor(payload) {
  const dom=new JSDOM(read('admin.html'),{url:'https://ernestoperezfraga911024.github.io/Cuban-league/admin.html',runScripts:'outside-only'});
  const w=dom.window;
  w.CUBAN_LEAGUE_SUPABASE={season:'2026/27'};
  w.fetch=async()=>({ok:true,json:async()=>JSON.parse(read('catalog/players.json'))});
  w.eval(core);w.eval(read('player-catalog.js'));
  w.eval(read('admin.js').replace('  boot();','  window.testImport = {state, normalizeMisterPayload, lineupMetrics, displayMisterReview, importedRowData};'));
  const api=w.testImport;api.state.participants=roster;api.state.matchday=3;api.state.catalog=await w.CubanLeaguePlayerCatalog.load();
  return {dom,api,rows:api.normalizeMisterPayload(payload,4044)};
}
test('20 participantes: DOM de Mister → captura → alineaciones válidas del panel',async()=>{
  const payload=await captureFixture({negative:true});assert.equal(payload.managers.length,20);
  const {dom,api,rows}=await adminFor(payload);
  assert.equal(rows.length,20);assert.equal(rows[0].negativeBalanceNoScore,true);assert.equal(rows[0].lineup.length,0);
  for(const row of rows.slice(1)){assert.equal(row.lineup.length,11);assert.equal(row.points,11);assert.equal(row.cleanSheets,1);assert.equal(api.lineupMetrics(row.lineup).complete,true);}
  assert.throws(()=>api.normalizeMisterPayload({...payload,matchday:6},4044),/no corresponde/);
  assert.throws(()=>api.normalizeMisterPayload({...payload,league:{id:'other'}},4044),/no corresponde/);
  dom.window.close();
});
test('jornada en curso conserva avisos; estadística ausente sigue siendo null en borrador',async()=>{
  const payload=await captureFixture({pending:true,missingStats:true});assert.equal(payload.provisional,true);
  assert.equal(payload.managers[0].lineup[0].status,'pending');assert.equal(payload.managers[0].lineup[0].didPlay,null);
  assert.equal(payload.managers[0].goals,null);assert.ok(payload.warnings.length>=20);
  const {dom,rows}=await adminFor(payload);assert.equal(rows[0].goals,null);assert.equal(rows[0].points,10);dom.window.close();
});

test('J6: Carlos y Cristian Romero mantienen identidades y clubes distintos aunque ambos se llamen C. Romero',async()=>{
  const payload=await captureFixture();
  payload.matchday=6;payload.gameweekId=4047;
  const slots=payload.managers[0].lineup;
  Object.assign(slots[3],{playerName:'Koke',misterPlayerId:'42',misterClubId:'2'});
  Object.assign(slots[7],{playerName:'C. Romero',misterPlayerId:'55743',misterClubId:'20'});
  Object.assign(slots[8],{playerName:'C. Romero',misterPlayerId:'1385821',misterClubId:'2'});
  Object.assign(slots[9],{playerName:'P. Cubarsí',misterPlayerId:'fixture-cubarsi',misterClubId:''});
  const copy={...payload,matchday:3,gameweekId:4044};
  const {dom,api}=await adminFor(copy);
  try {
    api.state.matchday=6;
    const rows=api.normalizeMisterPayload(payload,4047);
    const defenders=rows[0].lineup.filter(p=>p.player_name==='C. Romero');
    assert.equal(defenders.length,2);
    assert.deepEqual(Array.from(defenders,p=>p.player_id),['c-romero','c-romero-atletico']);
    assert.deepEqual(Array.from(defenders,p=>p.club_id),['villarreal','atletico-madrid']);
    assert.equal(rows[0].points,11);
    assert.equal(api.lineupMetrics(rows[0].lineup).complete,true);
  } finally { dom.window.close(); }
});

test('guardado real del panel usa exclusivamente RPC de borrador y conserva decisiones al reimportar',async()=>{
  const payload=await captureFixture();
  const dom=new JSDOM(read('admin.html'),{url:'https://ernestoperezfraga911024.github.io/Cuban-league/admin.html',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;w.CUBAN_LEAGUE_SUPABASE={season:'2026/27'};w.matchMedia=()=>({matches:false});
  w.HTMLElement.prototype.scrollIntoView=function(){};
  w.fetch=async()=>({ok:true,json:async()=>JSON.parse(read('catalog/players.json'))});
  w.eval(core);w.eval(read('player-catalog.js'));
  const inject=`
    refreshRestoreState = async () => true;
    extensionCall = async () => ({ok:true});
    window.testImport={state,renderPlayerRows,finishMisterImport,gatherRows,importFingerprint};
  `;
  w.eval(read('admin.js').replace('  boot();',inject));
  const api=w.testImport;const state=api.state;
  Object.assign(state,{participants:roster,leagueParticipants:roster,participantIndex:new Map(roster.map(p=>[p.name,p])),matchday:3,
    matchdayLoadBlocked:false,matchdayRestoreGeneration:'test-generation',serverRestoreGeneration:'test-generation',
    matchdayWriteRevision:'revision-0',restoreStateAvailable:true,lineupParticipantName:roster[0].name});
  state.catalog=await w.CubanLeaguePlayerCatalog.load();
  const calls=[];
  state.client={rpc:async(name,params)=>{calls.push({name,params});assert.equal(name,'save_matchday_draft_v124');return{data:{rows:params.p_rows,writeRevision:'revision-'+calls.length},error:null};}};
  api.renderPlayerRows([]);
  const request={requestId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',matchday:3,season:'2026/27',gameweekId:4044,protectExisting:false,startFingerprint:api.importFingerprint()};
  state.misterImportRequest=request;state.misterImportBusy=true;
  await api.finishMisterImport(payload,request);
  assert.equal(calls.length,1,w.document.getElementById('misterImportStatus').textContent);
  assert.ok(calls[0].params.p_rows.every(row=>row.published===false));
  assert.equal(calls[0].params.p_rows.length,20);
  assert.equal(calls[0].params.p_expected_write_revision,'revision-0');
  assert.equal(state.misterImportRequest,null);
  assert.match(w.document.getElementById('misterImportStatus').textContent,/Borrador guardado/);
  // Simulate one deliberate edit, then a new capture: no replacement until decisions.
  const first=roster[0];
  w.document.querySelector(`.admin-player[data-player-id="${first.id}"] [data-stat="goals"]`).value='5';
  const next={...request,protectExisting:true,startFingerprint:api.importFingerprint()};
  state.misterImportRequest=next;state.misterImportBusy=true;
  await api.finishMisterImport(payload,next);
  assert.equal(calls.length,1);
  assert.equal(w.document.querySelectorAll('[data-mister-use-incoming]').length,1);
  await api.finishMisterImport(payload,next,true); // Unchecked means keep own change.
  assert.equal(calls.length,2);
  assert.equal(calls[1].params.p_rows.find(row=>row.participant_name===first.name).goals,5);
  assert.equal(calls[1].params.p_rows[1].points,11); // Not 22 after a repeated import.
  dom.window.close();
});
