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
async function captureFixture({mobile=false,officialView=null,pending=false,missingStats=false,negative=false,sourceLineup=null,matchday=3,gameweekId=4044}={}) {
  const ids=roster.map((p,i)=>String(100+i));
  const html=`<a class="active" href="https://mister.mundodeportivo.com/action/change?id_community=649733">1ra div Cubanleague</a>
    <button data-tab="gameweek" class="active">Jornada</button><a data-partial class="selected" href="/standings?gw=${gameweekId}">J${matchday}</a>
    ${roster.map((p,i)=>`<a class="btn btn-sw-link user" href="users/${ids[i]}/manager"><div class="info"><div class="name">${escape(p.name)}</div><div class="played">${negative&&i===0?'Saldo negativo, no puntúa':'11 / 11'}</div></div><div class="points">${negative&&i===0?0:sourceLineup&&p.name===sourceLineup.name?sourceLineup.points:pending?10:11}<span> Pts</span></div></a>`).join('')}`;
  const dom=new JSDOM(html,{url:'https://mister.mundodeportivo.com/standings',runScripts:'outside-only'});
  const w=dom.window;
  Object.defineProperty(w.HTMLElement.prototype,'offsetWidth',{get(){return 10;}});
  let listener;let done;const completed=new Promise(resolve=>done=resolve);
  const job={id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',matchday,season:'2026/27',readOfficialXi:officialView!==null};
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
      event.preventDefault();
      w.document.querySelector('.team-lineup')?.remove();
      const id=manager.getAttribute('href').split('/')[1];
      const container=w.document.createElement('div');container.className='team-lineup';
      container.innerHTML='<div class="lineup-starting">'+Object.keys(counts).map(position=>'<div class="line">'+players.filter(p=>p.position===position).map(p=>{
        const index=players.indexOf(p);const club=rawCatalog.clubs.find(c=>c.id===p.club_id);
        return `<a class="lineup-player btn-player-gw" data-id_player="${p.mister_id||500000000+index}" data-id_manager="${id}" data-id_gameweek="${gameweekId}"><img class="team-logo" src="https://cdn-mister.mundodeportivo.com/file/cdn-common/teams/${club.mister_id}.png"><div class="info"><div class="name">${escape(p.display_name)}</div><div class="points ${pending&&index===0?'pending':''}">${pending&&index===0?'':1}</div></div></a>`;
      }).join('')+'</div>').join('')+'</div>';
      if(sourceLineup&&manager.querySelector('.name').textContent===sourceLineup.name) {
        container.innerHTML=sourceLineup.html.replaceAll(`data-id_manager="${sourceLineup.managerId}"`,`data-id_manager="${id}"`);
      }
      w.document.body.append(container);
    }
    const card=event.target.closest('a.lineup-player');
    if(card){
      if(card.querySelector('.points.not-played')) { done({error:'No debe abrir estadísticas de quien no jugó'});return; }
      const overlay=w.document.createElement('div');overlay.id='overlay';overlay.className='show';
      const stats={goals:{value:0},redCard:{value:0},doubleYellowCard:{value:0},minutesPlayed:{value:90},goalsAgainst:{value:0,rating:4}};
      if(missingStats)delete stats.goals;
      overlay.innerHTML=`<button class="popup-close">Cerrar</button><div id="popup-content"><button data-stats="{}" data-id_gameweek="${gameweekId}" data-marca_stats_rating_detailed_filtered="${escape(JSON.stringify(stats))}" data-name="Player">Ver más estadísticas</button></div>`;
      w.document.body.append(overlay);
    }
    if(event.target.closest('.popup-close')) w.document.querySelector('#overlay')?.remove();
  });
  if(officialView!==null){
    w.addEventListener('hashchange',()=>{
      w.document.body.insertAdjacentHTML('beforeend',officialView);
      // Keep the production polling semantics without a six-second wait for a rejected panel.
      const time=Date.now();
      w.Date.now=()=>time+(Date.now()-time)*12;
    });
  }
  if (mobile) {
    const answers = [String(matchday),'2026/27']; w.prompt = () => answers.shift();
    w.alert = message => done({error:message});
    delete w.chrome;
    w.URL.createObjectURL = file => {
      const reader = new w.FileReader(); reader.onload = () => done({payload:JSON.parse(reader.result)}); reader.readAsText(file);
      return 'blob:test';
    };
    w.URL.revokeObjectURL = () => {};
    w.eval(decodeURIComponent(read('mister-mobile-bookmarklet.txt').slice('javascript:'.length)));
  } else { w.eval(core);w.eval(read('mister-extension/collector.js')); }
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
  w.eval(read('admin.js').replace('  boot();','  window.testImport = {state, normalizeMisterPayload, lineupMetrics, displayMisterReview, importedRowData, officialXiForDraft, playerGoalsForDraft};'));
  const api=w.testImport;api.state.participants=roster;api.state.matchday=payload.matchday;api.state.catalog=await w.CubanLeaguePlayerCatalog.load();
  return {dom,api,rows:api.normalizeMisterPayload(payload,payload.gameweekId)};
}
test('J5: el icono real de G. Jesus permite terminar los 20 participantes y conserva los 74 de Yovany',async()=>{
  const payload=await captureFixture({sourceLineup:{name:'Yovany R9',managerId:'7070670',points:74,html:read('tests/fixtures/mister-j5-yovany-lineup-20260917.html')},matchday:5,gameweekId:4046});
  assert.equal(payload.managers.length,20);
  assert.equal(payload.provisional,false);
  const manager=payload.managers.find(m=>m.name==='Yovany R9');
  const jesus=manager.lineup.find(p=>p.misterPlayerId==='4764213');
  assert.equal(jesus.status,'did-not-play');assert.equal(jesus.didPlay,false);
  for(const key of ['displayedPoints','goals','cleanSheet','redCard'])assert.equal(jesus[key],0);
  assert.equal(manager.points,74);
  assert.equal(manager.lineup.reduce((sum,p)=>sum+p.displayedPoints,0),74);
  const {dom,api,rows}=await adminFor(payload);
  try {
    const row=rows.find(r=>r.participant.name==='Yovany R9');
    assert.equal(row.lineup.length,11);assert.equal(row.points,74);
    assert.equal(api.lineupMetrics(row.lineup).complete,true);
    assert.equal(row.lineup.find(p=>p.player_id==='mister-4764213').displayed_points,0);
    const captain=row.lineup.find(p=>p.is_captain);
    assert.equal(captain.captain_multiplier,3);assert.equal(captain.displayed_points,6);
  } finally {dom.window.close();}
});
test('J5: la alineación real de Arian incluye a D. Otorbi sin bloquear el catálogo',async()=>{
  const payload=await captureFixture({sourceLineup:{name:'Arian Mirandez Li',managerId:'5003988',points:67,html:read('tests/fixtures/mister-j5-arian-lineup-20260917.html')},matchday:5,gameweekId:4046});
  const manager=payload.managers.find(m=>m.name==='Arian Mirandez Li');
  const otorbi=manager.lineup.find(p=>p.misterPlayerId==='59534');
  assert.equal(otorbi.playerName,'D. Otorbi');assert.equal(otorbi.misterClubId,'19');
  assert.equal(otorbi.position,'DL');assert.equal(otorbi.displayedPoints,9);
  assert.equal(manager.lineup.reduce((sum,p)=>sum+p.displayedPoints,0),67);
  const {dom,api,rows}=await adminFor(payload);
  try {
    const row=rows.find(r=>r.participant.name===manager.name);
    assert.equal(row.lineup.length,11);assert.equal(row.points,67);
    assert.equal(api.lineupMetrics(row.lineup).complete,true);
    const player=row.lineup.find(p=>p.player_id==='mister-59534');
    assert.equal(player.club_id,'valencia');assert.equal(player.displayed_points,9);
    assert.equal(row.lineup.find(p=>p.player_name==='P. Barrios').displayed_points,0);
  } finally {dom.window.close();}
});
test('20 participantes: DOM de Mister → captura → alineaciones válidas del panel',async()=>{
  const payload=await captureFixture({negative:true});assert.equal(payload.managers.length,20);
  const {dom,api,rows}=await adminFor(payload);
  assert.equal(rows.length,20);assert.equal(rows[0].negativeBalanceNoScore,true);assert.equal(rows[0].lineup.length,0);
  rows.forEach(row=>assert.equal(row.misterRank,payload.managers.findIndex(m=>m.name===row.participant.name)+1));
  for(const row of rows.slice(1)){assert.equal(row.lineup.length,11);assert.equal(row.points,11);assert.equal(row.cleanSheets,1);assert.equal(api.lineupMetrics(row.lineup).complete,true);}
  assert.throws(()=>api.normalizeMisterPayload({...payload,matchday:6},4044),/no corresponde/);
  assert.throws(()=>api.normalizeMisterPayload({...payload,league:{id:'other'}},4044),/no corresponde/);
  dom.window.close();
});
test('jornada en curso conserva avisos; estadística ausente sigue siendo null en borrador',async()=>{
  const payload=await captureFixture({pending:true,missingStats:true,officialView:officialJ11Html()});assert.equal(payload.provisional,true);assert.equal(payload.officialXi,undefined);
  assert.equal(payload.managers[0].lineup[0].status,'pending');assert.equal(payload.managers[0].lineup[0].didPlay,null);
  assert.equal(payload.managers[0].goals,null);assert.ok(payload.warnings.length>=20);
  const {dom,rows}=await adminFor(payload);assert.equal(rows[0].goals,null);assert.equal(rows[0].points,10);dom.window.close();
});

test('goals follow the resolved slot and never multiply for a captain or turn pending into zero',async()=>{
  const payload=await captureFixture();
  const {dom,api,rows}=await adminFor(payload);
  try {
    const row=rows[0],raw=payload.managers[row.misterRank-1].lineup;
    const captain=0;
    Object.assign(raw[captain],{isCaptain:true,captainMultiplier:3});
    const others=raw.map((p,i)=>i).filter(i=>i!==captain);
    Object.assign(raw[captain],{goals:2,status:'scored'});
    Object.assign(raw[others[0]],{goals:0,status:'pending'});
    Object.assign(raw[others[1]],{goals:null,status:'scored'});
    Object.assign(raw[others[2]],{goals:0,status:'did-not-play'});
    const map=api.playerGoalsForDraft(payload,[row]).players;
    assert.equal(map[row.lineup[captain].player_id],2);
    assert.equal(map[row.lineup[others[0]].player_id],undefined);
    assert.equal(map[row.lineup[others[1]].player_id],undefined);
    assert.equal(map[row.lineup[others[2]].player_id],0);
  } finally {dom.window.close();}
});

test('J6: Carlos y Cristian Romero mantienen identidades y clubes distintos aunque ambos se llamen C. Romero',async()=>{
  const payload=await captureFixture();
  payload.matchday=6;payload.gameweekId=4047;
  const slots=payload.managers[0].lineup;
  Object.assign(slots[3],{playerName:'Koke',misterPlayerId:'42',misterClubId:'2'});
  Object.assign(slots[7],{playerName:'C. Romero',misterPlayerId:'55743',misterClubId:'20'});
  Object.assign(slots[8],{playerName:'C. Romero',misterPlayerId:'1385821',misterClubId:'2'});
  const cubarsi=JSON.parse(read('catalog/players.json')).players.find(p=>p.id==='p-cubarsi');
  Object.assign(slots[9],{playerName:'P. Cubarsí',misterPlayerId:cubarsi.mister_id,misterClubId:'3'});
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

test('un club desactualizado de otro jugador no rechaza a Cárdenas ni contamina al Rayo',async()=>{
  const payload=await captureFixture();
  const {dom,api}=await adminFor(payload);
  try {
    const pedrosa=api.state.catalog.playersById.get('a-pedrosa');
    pedrosa.clubId='sevilla';pedrosa.clubName='Sevilla FC';
    Object.assign(payload.managers[0].lineup[7],{playerName:'A. Pedrosa',fullName:'',misterPlayerId:'14691',misterClubId:'14'});
    Object.assign(payload.managers[0].lineup[10],{playerName:'D. Cárdenas',fullName:'',misterPlayerId:'24742',misterClubId:'14'});
    const rows=api.normalizeMisterPayload(payload,4044);
    assert.equal(rows[0].lineup[10].player_id,'d-cardenas');
    assert.equal(rows[0].lineup[10].club_id,'rayo-vallecano');
    assert.equal(rows[0].lineup[10].position,'PT');
    assert.equal(rows[0].lineup[7].club_id,'rayo-vallecano');
    const reversed=api.normalizeMisterPayload({...payload,managers:[...payload.managers].reverse()},4044);
    const withoutRank=list=>JSON.parse(JSON.stringify(list.map(({misterRank,...row})=>row)));
    assert.deepEqual(withoutRank(reversed),withoutRank(rows));
    reversed.forEach(row=>assert.equal(row.misterRank,21-rows.find(r=>r.participant.name===row.participant.name).misterRank));
    Object.assign(payload.managers[0].lineup[10],{misterClubId:'999999'});
    assert.throws(()=>api.normalizeMisterPayload(payload,4044),/club de Mister.*999999/i);
  } finally {dom.window.close();}
});

test('N. Gudelj de ANDOBA en J6 se importa como MC de Getafe con puntos provisionales',async()=>{
  const payload=await captureFixture({pending:true});
  const {dom,api}=await adminFor(payload);
  try {
    payload.matchday=6;payload.gameweekId=4047;api.state.matchday=6;
    const manager=payload.managers.find(p=>p.name==='ANDOBA THE BEST');
    Object.assign(manager.lineup[3],{playerName:'N. Gudelj',fullName:'',misterPlayerId:'19168',misterClubId:'9',position:'MC',displayedPoints:0,didPlay:null,status:'pending'});
    const row=api.normalizeMisterPayload(payload,4047).find(r=>r.participant.name===manager.name);
    assert.equal(row.lineup[3].player_id,'mister-19168');
    assert.equal(row.lineup[3].club_id,'getafe');
    assert.equal(row.lineup[3].position,'MC');
    assert.equal(row.lineup[3].displayed_points,0);
  } finally {dom.window.close();}
});

test('la revisión previa reúne todos los futbolistas desconocidos sin modificar la captura',async()=>{
  const payload=await captureFixture();
  const {dom,api}=await adminFor(payload);
  try {
    Object.assign(payload.managers[0].lineup[3],{playerName:'Ausente Uno',fullName:'',misterPlayerId:'999999991'});
    Object.assign(payload.managers[1].lineup[3],{playerName:'Ausente Dos',fullName:'',misterPlayerId:'999999992'});
    const before=JSON.stringify(payload);
    assert.throws(()=>api.normalizeMisterPayload(payload,4044),error=>{
      assert.match(error.message,/2 incidencias/);
      assert.match(error.message,/Ausente Uno/);
      assert.match(error.message,/Ausente Dos/);
      return true;
    });
    assert.equal(JSON.stringify(payload),before);
  } finally {dom.window.close();}
});

test('J8 con Mayol y Olaiz: guardado usa exclusivamente RPC de borrador y conserva decisiones al reimportar',async()=>{
  // Synthetic 20-team capture with the two identities reported in the J8 error.
  const payload=await captureFixture({matchday:8,gameweekId:8008});
  for(const [name,playerName,misterPlayerId,misterClubId,position] of [
    ['Juventus','A. Mayol','5340038','19','MC'],
    ['Esteban Dominguez','X. Olaiz','5235247','48','DF']
  ])Object.assign(payload.managers.find(m=>m.name===name).lineup.find(p=>p.position===position),
    {playerName,fullName:'',misterPlayerId,misterClubId});
  const dom=new JSDOM(read('admin.html'),{url:'https://ernestoperezfraga911024.github.io/Cuban-league/admin.html',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;w.CUBAN_LEAGUE_SUPABASE={season:'2026/27'};w.matchMedia=()=>({matches:false});
  w.HTMLElement.prototype.scrollIntoView=function(){};
  w.fetch=async()=>({ok:true,json:async()=>JSON.parse(read('catalog/players.json'))});
  w.eval(core);w.eval(read('player-catalog.js'));
  const inject=`
    refreshRestoreState = async () => true;
    extensionCall = async () => ({ok:true});
    window.testImport={state,renderPlayerRows,finishMisterImport,loadMobileMisterFile,gatherRows,importFingerprint};
  `;
  w.eval(read('admin.js').replace('  boot();',inject));
  const api=w.testImport;const state=api.state;
  Object.assign(state,{participants:roster,leagueParticipants:roster,participantIndex:new Map(roster.map(p=>[p.name,p])),matchday:8,
    matchdayLoadBlocked:false,matchdayRestoreGeneration:'test-generation',serverRestoreGeneration:'test-generation',
    matchdayWriteRevision:'revision-0',restoreStateAvailable:true,lineupParticipantName:roster[0].name});
  state.catalog=await w.CubanLeaguePlayerCatalog.load();
  const calls=[];
  state.client={rpc:async(name,params)=>{calls.push({name,params});assert.equal(name,'save_matchday_draft_with_player_goals');return{data:{rows:params.p_rows,writeRevision:'revision-'+calls.length},error:null};}};
  api.renderPlayerRows([]);
  const request={requestId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',matchday:8,season:'2026/27',gameweekId:8008,protectExisting:false,startFingerprint:api.importFingerprint()};
  w.eval(read('mister-mobile.js'));
  state.lineupSchemaReady = true; state.catalogSchemaReady = true;
  const initial = api.importFingerprint();
  for (const invalid of [{...payload,matchday:7},{...payload,league:{id:'978196'}},{...payload,season:'2025/26'}, {...payload,gameweekId:null}]) {
    await api.loadMobileMisterFile({size:100,text:async()=>JSON.stringify(invalid)});
    assert.equal(calls.length,0,'invalid files never write data');
    assert.equal(api.importFingerprint(),initial);
  }
  // File import must enter the exact same conflict / revision-checked draft pipeline.
  await api.loadMobileMisterFile({size:JSON.stringify(payload).length,text:async()=>JSON.stringify(payload)});
  assert.equal(calls.length,1,w.document.getElementById('misterImportStatus').textContent);
  assert.equal(calls[0].params.p_player_goals.matchday,8);
  assert.equal(calls[0].params.p_player_goals.players['mister-5340038'],0);
  assert.ok(calls[0].params.p_rows.every(row=>row.published===false));
  assert.equal(calls[0].params.p_rows.length,20);
  for(const [name,playerId,clubId] of [['Juventus','mister-5340038','valencia'],['Esteban Dominguez','mister-5235247','alaves']]){
    const saved=calls[0].params.p_rows.find(row=>row.participant_name===name);
    assert.equal(saved.lineup.length,11);
    assert.equal(saved.lineup.find(player=>player.player_id===playerId).club_id,clubId);
    assert.equal(saved.points,11);
  }
  calls[0].params.p_rows.forEach(row=>assert.equal(row.mister_rank,payload.managers.findIndex(m=>m.name===row.participant_name)+1));
  api.renderPlayerRows(calls[0].params.p_rows);
  assert.deepEqual(api.gatherRows(false,true).map(row=>row.mister_rank),calls[0].params.p_rows.map(row=>row.mister_rank));
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
  // A subsequent source ranking replaces the previous imported ranking, without
  // losing a deliberately edited position or silently publishing the matchday.
  const rankInput=w.document.querySelector(`.admin-player[data-player-id="${roster[1].id}"] [data-mister-rank]`);
  rankInput.value='7';
  const changedOrder={...payload,managers:[...payload.managers].reverse()};
  const rankRequest={...request,protectExisting:true,startFingerprint:api.importFingerprint()};
  state.misterImportRequest=rankRequest;state.misterImportBusy=true;
  await api.finishMisterImport(changedOrder,rankRequest);
  assert.equal(calls.length,2);
  assert.ok([...w.document.querySelectorAll('[data-mister-use-incoming]')].some(el=>el.dataset.misterUseIncoming===roster[1].name));
  w.document.querySelectorAll('[data-mister-use-incoming]').forEach(el=>{el.checked=true;});
  await api.finishMisterImport(changedOrder,rankRequest,true);
  assert.equal(calls.length,3);
  assert.equal(calls[2].params.p_rows.find(row=>row.participant_name===roster[1].name).mister_rank,19);
  const incomplete=JSON.parse(JSON.stringify(payload));
  Object.assign(incomplete.managers[0].lineup[3],{playerName:'Ausente Uno',fullName:'',misterPlayerId:'999999991'});
  Object.assign(incomplete.managers[1].lineup[3],{playerName:'Ausente Dos',fullName:'',misterPlayerId:'999999992'});
  const retry={...request,startFingerprint:api.importFingerprint()};
  const beforeFailedImport=api.importFingerprint();
  state.misterImportRequest=retry;state.misterImportBusy=true;
  await api.finishMisterImport(incomplete,retry);
  assert.equal(calls.length,3); // No partial draft write.
  assert.equal(api.importFingerprint(),beforeFailedImport);
  assert.equal(state.misterImportRequest.requestId,retry.requestId);
  assert.match(w.document.getElementById('misterImportStatus').textContent,/2 incidencias/);
  assert.equal(w.document.getElementById('retryMisterImportButton').hidden,false);

  // The optional snapshot uses a single protected draft write, even if only the XI changes.
  const positions=['PT','DF','DF','DF','MC','MC','MC','MC','MC','DL','DL'];
  const officialXi={matchday:8,gameweekId:8008,players:positions.map((position,i)=>({
    position,misterPlayerId:String(9000+i),playerName:'Prueba '+i,points:i
  }))};
  const expectedRows=JSON.stringify(api.gatherRows(false,true));
  state.client.rpc=async(name,params)=>{
    assert.equal(name,'save_matchday_draft_with_player_goals');
    assert.equal(params.p_official_xi.players.length,11);
    assert.equal(JSON.stringify(params.p_rows),expectedRows);
    calls.push({name,params});
    return {data:{rows:params.p_rows,writeRevision:'revision-4'}};
  };
  await api.finishMisterImport({...changedOrder,officialXi},retry);
  assert.equal(calls.length,4,w.document.getElementById('misterImportStatus').textContent);
  assert.match(w.document.getElementById('misterImportStatus').textContent,/Once ideal guardado/);
  dom.window.close();
});

test('J10: D. Carvajal de ANDOBA resuelve por Mister 328 y conserva la captura',async()=>{
  // Synthetic capture: identity and club come from the admin error screenshot.
  const payload=await captureFixture({matchday:10,gameweekId:9000010});
  const manager=payload.managers.find(p=>p.name==='ANDOBA THE BEST');
  Object.assign(manager.lineup[7],{playerName:'D. Carvajal',fullName:'',misterPlayerId:'328',misterClubId:'9',position:'DF'});
  const original=JSON.stringify(payload);
  const {dom,api,rows}=await adminFor(payload);
  try {
    assert.equal(rows.length,20);
    const row=rows.find(r=>r.participant.name===manager.name);
    const player=row.lineup[7];
    assert.equal(player.player_id,'mister-328');
    assert.equal(player.player_name,'D. Carvajal');
    assert.equal(player.club_id,'getafe');
    assert.equal(player.position,'DF');
    assert.equal(player.displayed_points,manager.lineup[7].displayedPoints);
    assert.equal(row.points,manager.points);
    assert.equal(api.lineupMetrics(row.lineup).complete,true);
    assert.equal(JSON.stringify(payload),original);
    assert.equal(api.state.catalog.players.filter(p=>p.misterId==='328').length,1);
    assert.equal(api.state.catalog.resolveMister({misterPlayerId:'999999999',playerName:'D. Carvajal',clubId:'getafe',position:'DF'}),null);
  } finally {dom.window.close();}
});

test('A. Santiago de Yovany resuelve por Mister 5521760 sin confundir a Y. Santiago',async()=>{
  // Synthetic sporting values; identity and club are from the reported import error.
  const payload=await captureFixture({matchday:12,gameweekId:9000012});
  const manager=payload.managers.find(p=>p.name==='Yovany R9');
  Object.assign(manager.lineup[3],{playerName:'A. Santiago',fullName:'',misterPlayerId:'5521760',misterClubId:'8',position:'MC'});
  const original=JSON.stringify(payload);
  const {dom,api,rows}=await adminFor(payload);
  try {
    assert.equal(rows.length,20);
    const row=rows.find(r=>r.participant.name===manager.name);
    const player=row.lineup[3];
    assert.equal(player.player_id,'mister-5521760');
    assert.equal(player.player_name,'A. Santiago');
    assert.equal(player.club_id,'espanyol');
    assert.equal(player.position,'MC');
    assert.equal(player.displayed_points,manager.lineup[3].displayedPoints);
    assert.equal(row.points,manager.points);
    assert.equal(api.lineupMetrics(row.lineup).complete,true);
    assert.equal(JSON.stringify(payload),original);
    assert.equal(api.state.catalog.players.filter(p=>p.misterId==='5521760').length,1);
    assert.equal(api.state.catalog.resolveMister({misterPlayerId:'63867',playerName:'Y. Santiago',clubId:'elche',position:'MC'}).id,'y-santiago');
    assert.equal(api.state.catalog.resolveMister({misterPlayerId:'999999999',playerName:'A. Santiago',clubId:'espanyol',position:'MC'}),null);
    // The stored matchday position always comes from the capture.
    manager.lineup[3].position='DL';
    const changed=api.normalizeMisterPayload(payload,payload.gameweekId).find(r=>r.participant.name===manager.name);
    assert.equal(changed.lineup[3].player_id,'mister-5521760');
    assert.equal(changed.lineup[3].position,'DL');
    assert.equal(changed.points,manager.points);
  } finally {dom.window.close();}
});

// Verified team, IDs, positions and provider points in Mister's closed J11 (4052).
function officialJ11Html(){
  const lines=[
    [4,[[52375,'L. Yamal',18],[48657,'Raphinha',15]]],
    [3,[[17989,'J. de Frutos',19],[55009,'F. López',16],[53114,'J. Bellingham',14],[557,'P. Fornals',14],[29223,'M. Soriano',14]]],
    [2,[[71021,'A. Grimaldo',15],[11472,'L. Cabrera',15],[63,'M. Bartra',14]]],
    [1,[[17615,'S. Herrera',11]]]
  ];
  const cards=lines.map(([pos,players])=>players.map(([id,label,pts])=>
    `<a class="lineup-player best-xi" data-id_player="${id}" data-id_gameweek="4052" data-position="${pos}">
      <span class="info"><span class="name">${label}</span><b class="points">${pts}</b></span></a>`).join('')).join('');
  return `<div class="sw"><div class="sw-gameweek"><button data-id="4052" class="selected">J11</button>
    <h3>Finalizada</h3><div class="gameweek-lineup"><h3>Equipo de la jornada</h3>${cards}</div>
    <div class="gameweek-lineup"><h3>1º con 91 pts</h3>${cards}</div></div></div>`;
}
test('J11 reads the eleven official cards, distinct from the matchday winner; numbers stay independent of captains',async()=>{
  const payload=await captureFixture({matchday:11,gameweekId:4052,officialView:officialJ11Html()});
  assert.equal(payload.officialXi.players.length,11);
  assert.equal(payload.officialXi.players.find(p=>p.misterPlayerId==='52375').points,18);
  assert.equal(payload.officialXi.players.find(p=>p.misterPlayerId==='17989').position,'MC');
  const {dom,api,rows}=await adminFor(payload);
  try{
    const xi=api.officialXiForDraft(payload,rows);
    const yamal=xi.players.find(p=>p.misterPlayerId==='52375');
    assert.equal(yamal.playerId,api.state.catalog.resolve({misterPlayerId:'52375'}).id);
    assert.equal(xi.season,payload.season);
    assert.equal(api.officialXiForDraft({...payload,provisional:true},rows),null);
    assert.equal(api.officialXiForDraft({...payload,officialXi:{...payload.officialXi,matchday:12}},rows),null);
  }finally{dom.window.close();}
});
for(const [name,change] of [
  ['another day selected',s=>s.replace('>J11<','>J12<')],
  ['live gameweek',s=>s.replace('Finalizada','En juego')],
  ['duplicate identity',s=>s.replaceAll('48657','52375')],
  ['wrong source day on one card',s=>s.replace('data-id_gameweek="4052"','data-id_gameweek="4053"')],
  ['incomplete XI with adjacent winning eleven',s=>s.replace('lineup-player best-xi','lineup-player')],
]){
  test('optional XI preserves all 20 scores with '+name,async()=>{
    const payload=await captureFixture({matchday:11,gameweekId:4052,officialView:change(officialJ11Html())});
    assert.equal(payload.officialXi,undefined);
    assert.equal(payload.managers.length,20);
    assert.ok(payload.managers.every(m=>m.points===11));
    assert.match(payload.warnings.join(' '),/Once ideal pendiente/);
  });
}

test('mobile bookmark runs the unchanged reader without Chrome, preserving the desktop capture',async()=>{
  const desktop=await captureFixture({pending:true}), mobile=await captureFixture({pending:true,mobile:true});
  for(const payload of [desktop,mobile]) { delete payload.capturedAt; delete payload.capturedStartedAt; }
  assert.deepEqual(mobile,JSON.parse(JSON.stringify(desktop)));
  const {dom,rows}=await adminFor(mobile);
  try { assert.equal(rows.length,20); assert.ok(rows.every(row=>row.lineup.length===11)); }
  finally { dom.window.close(); }
});
