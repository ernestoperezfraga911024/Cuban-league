const APP_VERSION='110-20260805';
const OWNER_VISIT_EXCLUSION_KEY='cuban-league-owner-browser';
const ACHIEVEMENT_SEEN_KEY='cuban-league-seen-achievements-v1';
let DATA;
let LIVE_MATCHDAY_ROWS=[];
let PUBLISHED_MATCHDAYS=[];
let MATCHDAY_MILESTONES=[];
let SELECTED_MATCHDAY=null;
let SELECTED_CLASSIFICATION_MATCHDAY=null;
const CUP_START_MATCHDAY=4;
const CUP_FINAL_MATCHDAY=22;
let SELECTED_CUP_MATCHDAY=null;
let CUP_SELECTION_MANUAL=false;
const CHAMPIONS_MATCHDAY_COUNT=8;
let CHAMPIONS_MATCHDAY_ROWS=[];
let CHAMPIONS_PUBLISHED_MATCHDAYS=[];
let SHARE_CARD_TYPE='podium';
let SHARE_CARD_GROUP_INDEX=0;
let SHARE_CARD_RENDER_TOKEN=0;
let SHARE_CARD_READY=false;
let SECTION_TRANSITION_TOKEN=0;
let KNOWN_ACHIEVEMENT_KEYS=null;
let ACHIEVEMENT_UNLOCK_TIMER=null;
let ACHIEVEMENT_UNLOCK_HIDE_TIMER=null;
const $=id=>document.getElementById(id);const imageMap=()=>Object.fromEntries(DATA.participants.map(p=>[p.name,p.shield]));const statMap=()=>Object.fromEntries(DATA.general.map(p=>[p.name,p]));
const uiIcon=(name,className='ui-icon')=>`<svg class="${className}" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
const profileAttr=name=>String(name).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function profileTriggerAttrs(name){const safe=profileAttr(name);return `data-profile-player="${safe}" role="button" tabindex="0" aria-label="Ver perfil completo de ${safe}"`}
function teamCell(name){return `<div class="team team-profile-link" ${profileTriggerAttrs(name)}><img src="${imageMap()[name]||''}" alt="Foto de ${name}"><span class="name">${name}</span></div>`}

function randomAnonymousId(){
  if(window.crypto?.randomUUID)return window.crypto.randomUUID();
  const bytes=new Uint8Array(16);
  window.crypto?.getRandomValues?.(bytes);
  bytes[6]=(bytes[6]&15)|64;
  bytes[8]=(bytes[8]&63)|128;
  const hex=[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function anonymousId(storageName,key){
  try{
    const storage=window[storageName];
    const existing=storage.getItem(key);
    if(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing||''))return existing;
    const created=randomAnonymousId();
    storage.setItem(key,created);
    return created;
  }catch{
    return randomAnonymousId();
  }
}

async function trackSiteVisit(){
  try{
    if(localStorage.getItem(OWNER_VISIT_EXCLUSION_KEY)==='1')return false;
  }catch{}
  const config=window.CUBAN_LEAGUE_SUPABASE;
  if(!config?.url||!config?.publishableKey)return false;
  try{
    const endpoint=`${config.url.replace(/\/$/,'')}/rest/v1/rpc/track_site_visit`;
    const response=await fetch(endpoint,{
      method:'POST',
      cache:'no-store',
      keepalive:true,
      headers:{
        apikey:config.publishableKey,
        Authorization:`Bearer ${config.publishableKey}`,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({
        p_visitor_id:anonymousId('localStorage','cuban-league-visitor-id'),
        p_session_id:anonymousId('sessionStorage','cuban-league-session-id'),
        p_path:location.pathname||'/'
      })
    });
    return response.ok;
  }catch{
    return false;
  }
}

function activeParticipants(){
  return DATA.participants.filter(participant=>participant.active!==false);
}

function sortStandings(a,b){
  return b.points-a.points
    ||(b.goals||0)-(a.goals||0)
    ||(b.cleanSheets||0)-(a.cleanSheets||0)
    ||a.id-b.id;
}

function normalizeMatchdayRows(rows){
  const validNames=new Set(activeParticipants().map(participant=>participant.name));
  return rows.map(row=>({
    participantName:String(row.participant_name||'').trim(),
    matchday:Number(row.matchday),
    points:Math.max(0,Number(row.points)||0),
    goals:Math.max(0,Number(row.goals)||0),
    cleanSheets:Math.max(0,Number(row.clean_sheets)||0),
    redCards:Math.max(0,Number(row.red_cards)||0),
    updatedAt:row.updated_at||null
  })).filter(row=>validNames.has(row.participantName)&&Number.isInteger(row.matchday)&&row.matchday>0);
}

function championsSeasonKey(){
  const season=window.CUBAN_LEAGUE_SUPABASE?.season||DATA?.currentSeason||'2026/27';
  return `${season}-CHAMPIONS`;
}

function championsParticipantNames(){
  return new Set((DATA?.champions?.groups||[]).flatMap(group=>group.teams));
}

function normalizeChampionsMatchdayRows(rows){
  const validNames=championsParticipantNames();
  return rows.map(row=>({
    participantName:String(row.participant_name||'').trim(),
    matchday:Number(row.matchday),
    points:Number(row.points)||0,
    goals:Math.max(0,Number(row.goals)||0),
    cleanSheets:Math.max(0,Number(row.clean_sheets)||0),
    redCards:Math.max(0,Number(row.red_cards)||0),
    updatedAt:row.updated_at||null
  })).filter(row=>
    validNames.has(row.participantName)
    &&Number.isInteger(row.matchday)
    &&row.matchday>=1
    &&row.matchday<=CHAMPIONS_MATCHDAY_COUNT
  );
}

async function fetchPublishedStatsRows(season,{minimumMatchday=null,maximumMatchday=null}={}){
  const config=window.CUBAN_LEAGUE_SUPABASE;
  const request=async includeRedCards=>{
    const endpoint=new URL(`${config.url.replace(/\/$/,'')}/rest/v1/matchday_stats`);
    endpoint.searchParams.set(
      'select',
      `participant_name,matchday,points,goals,clean_sheets,${includeRedCards?'red_cards,':''}updated_at`
    );
    endpoint.searchParams.set('season',`eq.${season}`);
    endpoint.searchParams.set('published','eq.true');
    if(minimumMatchday!=null)endpoint.searchParams.append('matchday',`gte.${minimumMatchday}`);
    if(maximumMatchday!=null)endpoint.searchParams.append('matchday',`lte.${maximumMatchday}`);
    endpoint.searchParams.set('order','matchday.asc');
    return fetch(endpoint,{
      cache:'no-store',
      headers:{
        apikey:config.publishableKey,
        Authorization:`Bearer ${config.publishableKey}`,
        Accept:'application/json'
      }
    });
  };

  let response=await request(true);
  if(!response.ok)response=await request(false);
  if(!response.ok)throw new Error('No se pudieron actualizar las estadísticas');
  const rows=await response.json();
  if(!Array.isArray(rows))throw new Error('Respuesta de estadísticas no válida');
  return rows;
}

async function syncChampionsStats({render=true}={}){
  const config=window.CUBAN_LEAGUE_SUPABASE;
  if(!DATA||!config?.url||!config?.publishableKey)return false;
  try{
    const rows=await fetchPublishedStatsRows(championsSeasonKey(),{
      minimumMatchday:1,
      maximumMatchday:CHAMPIONS_MATCHDAY_COUNT
    });
    CHAMPIONS_MATCHDAY_ROWS=normalizeChampionsMatchdayRows(rows);
    CHAMPIONS_PUBLISHED_MATCHDAYS=[...new Set(CHAMPIONS_MATCHDAY_ROWS.map(row=>row.matchday))].sort((a,b)=>a-b);
    if(render){
      renderChampions();
      if(SHARE_CARD_BOUND)renderShareCardStudio();
    }
    return true;
  }catch{
    return false;
  }
}

function weeklyStandings(matchday){
  const rowMap=new Map(
    LIVE_MATCHDAY_ROWS
      .filter(row=>row.matchday===matchday)
      .map(row=>[row.participantName,row])
  );
  return activeParticipants().map(participant=>{
    const row=rowMap.get(participant.name);
    return {
      ...participant,
      points:row?.points||0,
      goals:row?.goals||0,
      cleanSheets:row?.cleanSheets||0,
      redCards:row?.redCards||0,
      played:row?1:0
    };
  }).sort(sortStandings).map((participant,index)=>({...participant,position:index+1}));
}

function cumulativeStandings(matchday){
  const totals=new Map(activeParticipants().map(participant=>[
    participant.name,
    {points:0,goals:0,cleanSheets:0,redCards:0,matchdays:new Set()}
  ]));
  LIVE_MATCHDAY_ROWS.forEach(row=>{
    if(row.matchday>matchday||!totals.has(row.participantName))return;
    const total=totals.get(row.participantName);
    total.points+=row.points;
    total.goals+=row.goals;
    total.cleanSheets+=row.cleanSheets;
    total.redCards+=row.redCards;
    total.matchdays.add(row.matchday);
  });
  return activeParticipants().map(participant=>{
    const total=totals.get(participant.name);
    return {
      ...participant,
      points:total.points,
      goals:total.goals,
      cleanSheets:total.cleanSheets,
      redCards:total.redCards,
      played:total.matchdays.size
    };
  }).sort(sortStandings).map((participant,index)=>({...participant,position:index+1}));
}

function cupMatchdays(){
  return Array.from(
    {length:CUP_FINAL_MATCHDAY-CUP_START_MATCHDAY+1},
    (_,index)=>CUP_START_MATCHDAY+index
  );
}

function cupRoundStandings(matchday,eligibleNames,{includeStats=true,leagueMatchday=matchday}={}){
  const rowMap=new Map(
    (includeStats?LIVE_MATCHDAY_ROWS:[])
      .filter(row=>row.matchday===matchday)
      .map(row=>[row.participantName,row])
  );
  const leaguePositions=new Map(
    cumulativeStandings(leagueMatchday).map(participant=>[participant.name,participant.position])
  );
  return activeParticipants()
    .filter(participant=>eligibleNames.has(participant.name))
    .map(participant=>{
      const row=rowMap.get(participant.name);
      return {
        ...participant,
        points:row?.points||0,
        goals:row?.goals||0,
        cleanSheets:row?.cleanSheets||0,
        leaguePosition:leaguePositions.get(participant.name)||activeParticipants().length
      };
    })
    .sort((a,b)=>
      b.points-a.points
      ||b.goals-a.goals
      ||b.cleanSheets-a.cleanSheets
      ||a.leaguePosition-b.leaguePosition
      ||a.id-b.id
    )
    .map((participant,index)=>({...participant,position:index+1}));
}

function buildCupTournament(){
  const survivors=new Set(activeParticipants().map(participant=>participant.name));
  let sequenceOpen=true;
  let latestLeagueMatchday=Math.max(
    0,
    ...PUBLISHED_MATCHDAYS.filter(matchday=>matchday<CUP_START_MATCHDAY)
  );
  const rounds=cupMatchdays().map(matchday=>{
    const hasPublishedStats=PUBLISHED_MATCHDAYS.includes(matchday);
    const published=sequenceOpen&&hasPublishedStats;
    if(!hasPublishedStats)sequenceOpen=false;
    if(published)latestLeagueMatchday=matchday;
    const entrants=[...survivors];
    const rows=cupRoundStandings(matchday,survivors,{
      includeStats:published,
      leagueMatchday:published?matchday:latestLeagueMatchday
    });
    let eliminated=null;
    if(published&&survivors.size>1){
      eliminated=rows.at(-1)||null;
      if(eliminated)survivors.delete(eliminated.name);
    }
    return {
      matchday,
      published,
      rows,
      eliminated,
      entrants,
      survivorsAfter:[...survivors]
    };
  });
  const lastCompleted=rounds.filter(round=>round.published).at(-1)||null;
  const champion=lastCompleted?.matchday===CUP_FINAL_MATCHDAY&&survivors.size===1
    ?activeParticipants().find(participant=>survivors.has(participant.name))||null
    :null;
  return {rounds,survivors:[...survivors],champion};
}

function defaultCupMatchday(tournament){
  const lastCompleted=tournament.rounds.filter(round=>round.published).at(-1);
  if(!lastCompleted)return CUP_START_MATCHDAY;
  return Math.min(lastCompleted.matchday+1,CUP_FINAL_MATCHDAY);
}

function previousPublishedMatchday(matchday){
  const index=PUBLISHED_MATCHDAYS.indexOf(matchday);
  return index>0?PUBLISHED_MATCHDAYS[index-1]:null;
}

function movementForMatchday(matchday){
  const previous=previousPublishedMatchday(matchday);
  if(previous==null)return new Map(activeParticipants().map(participant=>[participant.name,null]));
  const current=cumulativeStandings(matchday);
  const oldPositions=new Map(cumulativeStandings(previous).map(participant=>[participant.name,participant.position]));
  return new Map(current.map(participant=>[
    participant.name,
    (oldPositions.get(participant.name)||participant.position)-participant.position
  ]));
}

function movementBadge(delta){
  if(delta==null)return '<span class="movement movement-new" title="Primera jornada publicada" aria-label="Sin jornada anterior">—</span>';
  if(delta>0)return `<span class="movement movement-up" title="Subió ${delta} ${delta===1?'posición':'posiciones'}" aria-label="Subió ${delta} ${delta===1?'posición':'posiciones'}"><span aria-hidden="true">↑</span><b>+${delta}</b></span>`;
  if(delta<0)return `<span class="movement movement-down" title="Bajó ${Math.abs(delta)} ${Math.abs(delta)===1?'posición':'posiciones'}" aria-label="Bajó ${Math.abs(delta)} ${Math.abs(delta)===1?'posición':'posiciones'}"><span aria-hidden="true">↓</span><b>${delta}</b></span>`;
  return '<span class="movement movement-same" title="Mantiene su posición" aria-label="Sin cambio de posición"><span aria-hidden="true">•</span><b>0</b></span>';
}

function formClass(position){
  if(position<=3)return 'form-podium';
  if(position<=7)return 'form-strong';
  if(position<=14)return 'form-mid';
  return 'form-low';
}

function recentForm(name,throughMatchday){
  if(throughMatchday==null)return '<span class="form-empty" aria-label="Sin jornadas publicadas">—</span>';
  const days=PUBLISHED_MATCHDAYS.filter(day=>day<=throughMatchday).slice(-5);
  return days.map(day=>{
    const player=weeklyStandings(day).find(entry=>entry.name===name);
    if(!player)return '';
    return `<span class="form-chip ${formClass(player.position)}" title="Jornada ${day}: ${player.position}º · ${player.points.toLocaleString('es')} puntos" aria-label="Jornada ${day}: puesto ${player.position}">${player.position}º</span>`;
  }).join('');
}

async function syncLiveCurrentStats({render=true}={}){
  const config=window.CUBAN_LEAGUE_SUPABASE;
  if(!DATA||!config?.url||!config?.publishableKey)return false;
  try{
    const rows=await fetchPublishedStatsRows(config.season||DATA.currentSeason);
    LIVE_MATCHDAY_ROWS=normalizeMatchdayRows(rows);
    PUBLISHED_MATCHDAYS=[...new Set(LIVE_MATCHDAY_ROWS.map(row=>row.matchday))].sort((a,b)=>a-b);
    if(!PUBLISHED_MATCHDAYS.includes(SELECTED_MATCHDAY)){
      SELECTED_MATCHDAY=PUBLISHED_MATCHDAYS.length?PUBLISHED_MATCHDAYS[PUBLISHED_MATCHDAYS.length-1]:null;
    }

    const latestMatchday=PUBLISHED_MATCHDAYS.length?PUBLISHED_MATCHDAYS[PUBLISHED_MATCHDAYS.length-1]:null;
    const liveTotals=latestMatchday==null?new Map():new Map(cumulativeStandings(latestMatchday).map(participant=>[participant.name,participant]));
    activeParticipants().forEach(participant=>{
      const total=liveTotals.get(participant.name);
      participant.points=total?.points||0;
      participant.goals=total?.goals||0;
      participant.cleanSheets=total?.cleanSheets||0;
      participant.redCards=total?.redCards||0;
      participant.played=total?.played||0;
    });

    if(LIVE_MATCHDAY_ROWS.length){
      const dates=LIVE_MATCHDAY_ROWS.map(row=>new Date(row.updatedAt)).filter(date=>!Number.isNaN(date.getTime()));
      const latest=dates.length?new Date(Math.max(...dates.map(date=>date.getTime()))):null;
      DATA.lastUpdated=latest
        ?new Intl.DateTimeFormat('es',{dateStyle:'medium',timeStyle:'short'}).format(latest)
        :'Datos publicados';
    }else{
      DATA.lastUpdated='Sin jornadas publicadas';
    }
    if(render){
      renderCurrent();
      renderMatchdayCenter();
      renderHomeLive();
      renderCup();
      renderPlayers($('playerSearch')?.value||'');
      if(SHARE_CARD_BOUND)renderShareCardStudio();
    }
    return true;
  }catch{
    return false;
  }
}

function normalizeMatchdayMilestones(rows){
  const published=new Set(PUBLISHED_MATCHDAYS);
  return rows.map(row=>({
    matchday:Number(row.matchday),
    matchdayDate:String(row.matchday_date||''),
    isMonthEnd:row.is_month_end===true,
    isYearEnd:row.is_year_end===true
  })).filter(row=>
    Number.isInteger(row.matchday)
    &&published.has(row.matchday)
    &&/^\d{4}-\d{2}-\d{2}$/.test(row.matchdayDate)
  ).sort((a,b)=>a.matchday-b.matchday);
}

async function syncAchievementMilestones({render=true}={}){
  const config=window.CUBAN_LEAGUE_SUPABASE;
  if(!DATA||!config?.url||!config?.publishableKey)return false;
  try{
    const endpoint=new URL(`${config.url.replace(/\/$/,'')}/rest/v1/matchday_milestones`);
    endpoint.searchParams.set('select','matchday,matchday_date,is_month_end,is_year_end');
    endpoint.searchParams.set('season',`eq.${config.season||DATA.currentSeason}`);
    endpoint.searchParams.set('order','matchday.asc');
    const response=await fetch(endpoint,{
      cache:'no-store',
      headers:{
        apikey:config.publishableKey,
        Authorization:`Bearer ${config.publishableKey}`,
        Accept:'application/json'
      }
    });
    if(!response.ok)throw new Error('No se pudieron actualizar las insignias');
    const rows=await response.json();
    if(!Array.isArray(rows))throw new Error('Respuesta de insignias no válida');
    MATCHDAY_MILESTONES=normalizeMatchdayMilestones(rows);
    if(render)renderPlayers($('playerSearch')?.value||'');
    return true;
  }catch{
    MATCHDAY_MILESTONES=[];
    if(render)renderPlayers($('playerSearch')?.value||'');
    return false;
  }
}

function resolveParticipantNames(label){
  if(!label)return [];
  const exact=DATA.participants.find(p=>p.name.toLowerCase()===String(label).trim().toLowerCase());
  if(exact)return [exact.name];

  const aliases={
    'ANDOBA':'ANDOBA THE BEST',
    'ARIAN':'Arian Mirandez Li',
    'GNT':'GNT D ZONA',
    'JUVE':'Juventus',
    'RIVALDO':'Rivaldo'
  };
  return String(label).split(/\s*\/\s*|\s*&\s*|\s*,\s*/).map(x=>{
    const key=x.trim();
    const aliased=aliases[key.toUpperCase()]||key;
    const p=DATA.participants.find(p=>p.name.toLowerCase()===aliased.toLowerCase());
    return p?.name;
  }).filter(Boolean);
}
function playerInline(name,opts={}){
  const names=resolveParticipantNames(name);
  if(!names.length)return `<span class="player-inline-name">${name||'—'}</span>`;
  const compact=opts.compact?' compact':'';
  const people=names.map(n=>DATA.participants.find(p=>p.name===n)).filter(Boolean);
  return `<span class="player-inline-set${people.length>1?' multiple':''}">${people.map(p=>`
    <span class="player-inline${compact} team-profile-link" ${profileTriggerAttrs(p.name)}>
      <span class="player-inline-photos"><img src="${p.shield}" alt="Foto de ${p.name}" title="${p.name}"></span>
      <span>${p.name}</span>
    </span>`).join('')}</span>`;
}

function prefersReducedMotion(){
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;
}

function animateProfileAchievementUnlocks(){
  if(prefersReducedMotion())return;
  const section=document.querySelector('.profile-achievements-section');
  const cards=[...document.querySelectorAll('.profile-achievement-card.is-earned')];
  section?.classList.add('is-unlock-revealing');
  cards.forEach((card,index)=>{
    card.style.setProperty('--unlock-delay',`${Math.min(index,7)*75}ms`);
    card.classList.remove('is-unlock-reveal');
  });
  requestAnimationFrame(()=>cards.forEach(card=>card.classList.add('is-unlock-reveal')));
}

function currentAchievementKeys(snapshot){
  const unlocked=[];
  snapshot.players.forEach((achievements,playerName)=>{
    achievements.forEach(item=>{
      if(item.earned)unlocked.push({
        key:`${encodeURIComponent(playerName)}::${item.id}`,
        playerName,
        item
      });
    });
  });
  return unlocked;
}

function dismissAchievementToast(){
  const toast=$('achievementUnlockToast');
  if(!toast)return;
  clearTimeout(ACHIEVEMENT_UNLOCK_TIMER);
  clearTimeout(ACHIEVEMENT_UNLOCK_HIDE_TIMER);
  toast.classList.remove('is-visible');
  ACHIEVEMENT_UNLOCK_HIDE_TIMER=setTimeout(()=>{toast.hidden=true},320);
}

function showAchievementUnlockToast(unlocks){
  const toast=$('achievementUnlockToast');
  const first=unlocks[0];
  if(!toast||!first)return;
  clearTimeout(ACHIEVEMENT_UNLOCK_TIMER);
  clearTimeout(ACHIEVEMENT_UNLOCK_HIDE_TIMER);
  $('achievementUnlockIcon').textContent=first.item.icon;
  $('achievementUnlockTitle').textContent='Insignia desbloqueada';
  $('achievementUnlockCopy').textContent=unlocks.length===1
    ?`${first.playerName} consiguió “${first.item.name}”.`
    :`${first.playerName} consiguió “${first.item.name}” y hay ${unlocks.length-1} premio${unlocks.length===2?'':'s'} más.`;
  toast.dataset.profilePlayer=first.playerName;
  toast.hidden=false;
  requestAnimationFrame(()=>toast.classList.add('is-visible'));
  ACHIEVEMENT_UNLOCK_TIMER=setTimeout(dismissAchievementToast,5600);
}

function checkForNewAchievementUnlocks(snapshot=buildAchievementSnapshot()){
  const current=currentAchievementKeys(snapshot);
  const currentKeys=new Set(current.map(entry=>entry.key));
  if(KNOWN_ACHIEVEMENT_KEYS==null){
    try{
      const stored=JSON.parse(localStorage.getItem(ACHIEVEMENT_SEEN_KEY)||'null');
      if(Array.isArray(stored))KNOWN_ACHIEVEMENT_KEYS=new Set(stored);
    }catch{}
  }
  if(KNOWN_ACHIEVEMENT_KEYS==null){
    KNOWN_ACHIEVEMENT_KEYS=currentKeys;
    try{localStorage.setItem(ACHIEVEMENT_SEEN_KEY,JSON.stringify([...KNOWN_ACHIEVEMENT_KEYS]))}catch{}
    return;
  }
  const newUnlocks=current.filter(entry=>!KNOWN_ACHIEVEMENT_KEYS.has(entry.key));
  currentKeys.forEach(key=>KNOWN_ACHIEVEMENT_KEYS.add(key));
  try{localStorage.setItem(ACHIEVEMENT_SEEN_KEY,JSON.stringify([...KNOWN_ACHIEVEMENT_KEYS]))}catch{}
  if(newUnlocks.length)showAchievementUnlockToast(newUnlocks);
}

function setHistoryHubView(view='historical'){
  const allowed=['seasons','historical','records'];
  const selected=allowed.includes(view)?view:'historical';
  document.querySelectorAll('.history-hub-tab[data-history-view]').forEach(button=>{
    const active=button.dataset.historyView===selected;
    button.classList.toggle('active',active);
    button.setAttribute('aria-selected',String(active));
  });
  document.querySelectorAll('[data-history-panel]').forEach(panel=>{
    const active=panel.dataset.historyPanel===selected;
    panel.classList.toggle('active',active);
    panel.hidden=!active;
  });
}

function applySectionChange(target,selectedHistoryView){
  const isHome=target==='home';
  document.querySelectorAll('.page').forEach(page=>page.classList.remove('active'));
  document.querySelectorAll('.navtab').forEach(tab=>tab.classList.remove('active'));
  $(target)?.classList.add('active');
  document.querySelector(`.navtab[data-section="${target}"]`)?.classList.add('active');
  document.body.dataset.section=target;
  const hero=document.querySelector('.hero-photo');
  if(hero){
    hero.setAttribute('aria-hidden',String(!isHome));
    hero.inert=!isHome;
  }
  if(target==='history'&&selectedHistoryView)setHistoryHubView(selectedHistoryView);
}

function scrollToSectionStart(){
  window.scrollTo({top:0,behavior:'auto'});
}

function go(id,historyView){
  let target=id;
  let selectedHistoryView=historyView;
  if(id==='seasons'){
    target='history';
    selectedHistoryView='seasons';
  }else if(id==='records'){
    target='history';
    selectedHistoryView='records';
  }
  const next=$(target);
  if(!next)return;
  const current=document.querySelector('.page.active');
  if(current===next){
    if(target==='history'&&selectedHistoryView)setHistoryHubView(selectedHistoryView);
    scrollToSectionStart();
    return;
  }

  const token=++SECTION_TRANSITION_TOKEN;
  document.querySelectorAll('.page-entering,.page-leaving').forEach(page=>page.classList.remove('page-entering','page-leaving'));
  const change=()=>{
    applySectionChange(target,selectedHistoryView);
    scrollToSectionStart();
  };
  const finish=()=>{
    if(token!==SECTION_TRANSITION_TOKEN)return;
    document.documentElement.classList.remove('section-transition-active');
    next.classList.remove('page-entering');
  };

  if(document.startViewTransition&&!prefersReducedMotion()){
    document.documentElement.classList.add('section-transition-active');
    try{
      const transition=document.startViewTransition(change);
      transition.finished.then(finish).catch(finish);
      return;
    }catch{}
  }

  if(prefersReducedMotion()){
    change();
    finish();
    return;
  }
  current?.classList.add('page-leaving');
  setTimeout(()=>{
    if(token!==SECTION_TRANSITION_TOKEN)return;
    current?.classList.remove('page-leaving');
    change();
    next.classList.add('page-entering');
    setTimeout(finish,470);
  },130);
}
function setRegulationView(view='league'){
  const selected=view==='champions'?'champions':'league';
  document.querySelectorAll('[data-regulation-view]').forEach(button=>{
    const active=button.dataset.regulationView===selected;
    button.classList.toggle('active',active);
    button.setAttribute('aria-selected',String(active));
    button.tabIndex=active?0:-1;
  });
  document.querySelectorAll('[data-regulation-panel]').forEach(panel=>{
    panel.hidden=panel.dataset.regulationPanel!==selected;
  });
}
function renderCurrent(){
  const latest=PUBLISHED_MATCHDAYS.length?PUBLISHED_MATCHDAYS[PUBLISHED_MATCHDAYS.length-1]:null;
  const rows=latest==null
    ?activeParticipants().sort(sortStandings).map((participant,index)=>({...participant,position:index+1}))
    :cumulativeStandings(latest);
  const movements=latest==null?new Map():movementForMatchday(latest);
  const achievementSnapshot=buildAchievementSnapshot();
  $('updated').textContent=DATA.lastUpdated;
  $('currentRows').innerHTML=rows.map(p=>{
    const isRelegation=p.position>=16&&p.position<=20;
    return `<div class="row current-row${isRelegation?' is-relegation':''}">
    <span class="pos"${isRelegation?` aria-label="Puesto ${p.position}, zona de descenso"`:''}>${p.position}</span>
    ${standingsTeamCell(p.name,achievementSnapshot)}
    <span class="center">${p.played}</span>
    <span class="num">${p.points.toLocaleString('es')}</span>
    <span class="current-stat current-goals" aria-label="${p.goals??0} goles">${p.goals??0}</span>
    <span class="current-stat current-clean-sheets" aria-label="${p.cleanSheets??0} clean sheets">${p.cleanSheets??0}</span>
    <span class="current-stat current-red-cards" aria-label="${p.redCards??0} tarjetas rojas">${p.redCards??0}</span>
    <span class="current-movement">${movementBadge(latest==null?null:movements.get(p.name))}</span>
    <span class="current-form" aria-label="Forma de las últimas jornadas">${recentForm(p.name,latest)}</span>
  </div>`;
  }).join('');
  renderSeasonStatRanking(rows,latest,{
    metric:'goals',
    label:'Líder goleador',
    unit:'goles',
    icon:'ball',
    tone:'goals',
    heroId:'currentGoalsHero',
    rowsId:'currentGoalsRows'
  });
  renderSeasonStatRanking(rows,latest,{
    metric:'cleanSheets',
    label:'Líder de clean sheets',
    unit:'clean sheets',
    icon:'shield',
    tone:'clean-sheets',
    heroId:'currentCleanSheetsHero',
    rowsId:'currentCleanSheetsRows'
  });
  renderSeasonStatRanking(rows,latest,{
    metric:'redCards',
    label:'Más tarjetas rojas',
    unit:'tarjetas rojas',
    icon:'red-card',
    tone:'red-cards',
    heroId:'currentRedCardsHero',
    rowsId:'currentRedCardsRows'
  });
  renderClassificationMatchday();
}

function renderClassificationMatchday(){
  const select=$('classificationMatchdaySelect');
  const title=$('classificationMatchdayTitle');
  const empty=$('classificationMatchdayEmpty');
  const content=$('classificationMatchdayContent');
  const summary=$('classificationMatchdaySummary');
  const rowsHost=$('classificationMatchdayRows');
  if(!select||!title||!empty||!content||!summary||!rowsHost)return;

  if(!PUBLISHED_MATCHDAYS.length){
    SELECTED_CLASSIFICATION_MATCHDAY=null;
    select.innerHTML='<option value="">Sin jornadas publicadas</option>';
    select.disabled=true;
    title.textContent='Jornada';
    empty.hidden=false;
    content.hidden=true;
    return;
  }

  if(!PUBLISHED_MATCHDAYS.includes(SELECTED_CLASSIFICATION_MATCHDAY)){
    SELECTED_CLASSIFICATION_MATCHDAY=PUBLISHED_MATCHDAYS[PUBLISHED_MATCHDAYS.length-1];
  }
  select.disabled=false;
  select.innerHTML=PUBLISHED_MATCHDAYS.map(matchday=>
    `<option value="${matchday}"${matchday===SELECTED_CLASSIFICATION_MATCHDAY?' selected':''}>Jornada ${matchday}</option>`
  ).join('');
  select.value=String(SELECTED_CLASSIFICATION_MATCHDAY);
  title.textContent=`Jornada ${SELECTED_CLASSIFICATION_MATCHDAY}`;
  empty.hidden=true;
  content.hidden=false;

  const standings=weeklyStandings(SELECTED_CLASSIFICATION_MATCHDAY);
  const bestPoints=standings[0]?.points||0;
  const winners=bestPoints
    ?standings.filter(player=>player.points===bestPoints).map(player=>player.name)
    :[];
  const average=standings.length
    ?standings.reduce((total,player)=>total+player.points,0)/standings.length
    :0;
  const totalGoals=standings.reduce((total,player)=>total+player.goals,0);
  const totalCleanSheets=standings.reduce((total,player)=>total+player.cleanSheets,0);
  const totalRedCards=standings.reduce((total,player)=>total+player.redCards,0);

  summary.innerHTML=`<article class="classification-matchday-winner">
      <span class="classification-matchday-summary-icon">${uiIcon('trophy')}</span>
      <div><small>${winners.length>1?'Ganadores empatados':'Ganador de la jornada'}</small>
      ${winners.length?playerInline(winners.join(' / '),{compact:true}):'<strong>Sin puntos registrados</strong>'}</div>
      <b>${bestPoints.toLocaleString('es')}<span>PTS</span></b>
    </article>
    <article><small>Promedio</small><strong>${average.toLocaleString('es',{minimumFractionDigits:1,maximumFractionDigits:1})}</strong><span>PTS / jugador</span></article>
    <article><small>Estadísticas</small><strong>${totalGoals.toLocaleString('es')} GOL · ${totalRedCards.toLocaleString('es')} TR</strong><span>${totalCleanSheets.toLocaleString('es')} clean sheets</span></article>`;

  rowsHost.innerHTML=standings.map((player,index)=>`<div class="classification-matchday-row classification-matchday-grid${index<3?' is-weekly-podium':''}">
    <span class="classification-matchday-rank">${player.position}</span>
    ${teamCell(player.name)}
    <strong class="classification-matchday-points">${player.points.toLocaleString('es')}</strong>
    <span class="current-stat current-goals" aria-label="${player.goals} goles">${player.goals}</span>
    <span class="current-stat current-clean-sheets" aria-label="${player.cleanSheets} clean sheets">${player.cleanSheets}</span>
    <span class="current-stat current-red-cards" aria-label="${player.redCards} tarjetas rojas">${player.redCards}</span>
  </div>`).join('');
}

function renderSeasonStatRanking(rows,latest,{metric,label,unit,icon,tone,heroId,rowsId}){
  const secondaryMetric=metric==='goals'?'cleanSheets':metric==='cleanSheets'?'goals':'points';
  const ranked=[...rows].sort((a,b)=>
    (b[metric]||0)-(a[metric]||0)
    ||(b[secondaryMetric]||0)-(a[secondaryMetric]||0)
    ||(b.points||0)-(a.points||0)
    ||a.id-b.id
  );
  const leaders=pulseLeaders(ranked,metric);
  const hasLeader=latest!=null&&leaders.value>0;
  const hero=$(heroId);
  const tableRows=$(rowsId);
  if(!hero||!tableRows)return;

  hero.className=`season-leader-hero ${tone}${hasLeader?' has-leader':' is-empty'}`;
  if(hasLeader){
    const tied=leaders.names.length>1;
    hero.innerHTML=`<article class="season-leader-card">
      <span class="season-leader-icon">${uiIcon(icon)}</span>
      <div class="season-leader-copy">
        <small>${tied?`${leaders.names.length} líderes empatados`:label}</small>
        ${playerInline(leaders.names.join(' / '),{compact:true})}
        <p>Datos acumulados hasta la Jornada ${latest}.</p>
      </div>
      <strong class="season-leader-number">${leaders.value.toLocaleString('es')}<span>${unit}</span></strong>
    </article>`;
  }else{
    const emptyTitle=latest==null?'Por definir':'Aún sin registros';
    const emptyCopy=latest==null
      ?'Este liderato se activará automáticamente después de la Jornada 1.'
      :`Después de la Jornada ${latest} todavía no se ha registrado esta estadística.`;
    hero.innerHTML=`<article class="season-leader-card">
      <span class="season-leader-icon">${uiIcon(icon)}</span>
      <div class="season-leader-copy">
        <small>${label}</small>
        <strong>${emptyTitle}</strong>
        <p>${emptyCopy}</p>
      </div>
      <strong class="season-leader-number">—</strong>
    </article>`;
  }

  let previousValue=null;
  let competitionRank=0;
  tableRows.innerHTML=ranked.map((player,index)=>{
    const value=player[metric]||0;
    if(value!==previousValue){
      competitionRank=index+1;
      previousValue=value;
    }
    const displayedRank=leaders.value>0?competitionRank:'—';
    const isLeader=leaders.value>0&&value===leaders.value;
    return `<div class="season-stat-row season-stat-grid${isLeader?' is-stat-leader':''}">
      <span class="season-stat-rank">${displayedRank}</span>
      ${teamCell(player.name)}
      <strong class="season-stat-value ${tone}" aria-label="${value} ${unit}">${value.toLocaleString('es')}</strong>
      <span class="center">${player.played||0}</span>
      <span class="num">${(player.points||0).toLocaleString('es')}</span>
    </div>`;
  }).join('');
}

function setStandingsView(view,{focus=false}={}){
  const tabs=[...document.querySelectorAll('[data-standings-view]')];
  const validView=tabs.some(tab=>tab.dataset.standingsView===view)?view:'general';
  tabs.forEach(tab=>{
    const selected=tab.dataset.standingsView===validView;
    tab.classList.toggle('active',selected);
    tab.setAttribute('aria-selected',String(selected));
    tab.tabIndex=selected?0:-1;
    if(selected&&focus)tab.focus();
  });
  document.querySelectorAll('[data-standings-panel]').forEach(panel=>{
    panel.hidden=panel.dataset.standingsPanel!==validView;
  });
  document.querySelector('.relegation-legend')?.toggleAttribute('hidden',validView!=='general');
}

function setupStandingsSwitcher(){
  const tabs=[...document.querySelectorAll('[data-standings-view]')];
  tabs.forEach((tab,index)=>{
    tab.onclick=()=>setStandingsView(tab.dataset.standingsView);
    tab.onkeydown=event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      let nextIndex=index;
      if(event.key==='ArrowLeft')nextIndex=(index-1+tabs.length)%tabs.length;
      if(event.key==='ArrowRight')nextIndex=(index+1)%tabs.length;
      if(event.key==='Home')nextIndex=0;
      if(event.key==='End')nextIndex=tabs.length-1;
      setStandingsView(tabs[nextIndex].dataset.standingsView,{focus:true});
    };
  });
  const matchdaySelect=$('classificationMatchdaySelect');
  if(matchdaySelect){
    matchdaySelect.onchange=()=>{
      SELECTED_CLASSIFICATION_MATCHDAY=Number(matchdaySelect.value)||null;
      renderClassificationMatchday();
    };
  }
  setStandingsView('general');
}

function previousSeasonPodium(){
  const archive=DATA.historicalTables?.seasonArchive||[];
  const previous=[...archive].reverse().find(entry=>
    entry.season!==DATA.currentSeason
    &&entry.results?.filter(result=>result.division===1&&Number.isInteger(result.position)).length>=3
  );
  if(!previous)return {season:'Temporada anterior',players:[]};
  const players=previous.results
    .filter(result=>result.division===1&&result.position>=1&&result.position<=3)
    .sort((a,b)=>a.position-b.position)
    .map(result=>{
      const participant=DATA.participants.find(player=>player.name===result.name);
      return participant?{...participant,finalPoints:result.points}:null;
    })
    .filter(Boolean);
  return {season:previous.season,players};
}

function heroKpiPreseasonCards(){
  const podium=previousSeasonPodium();
  const podiumCards=podium.players.map((player,index)=>heroKpiPlayerCard({
    label:`${['Primer','Segundo','Tercer'][index]} lugar · ${podium.season}`,
    player,
    detail:`${player.finalPoints.toLocaleString('es')} puntos · Clasificación final`,
    marker:{text:String(index+1)},
    tone:['first','second','third'][index]
  }));
  while(podiumCards.length<3){
    const index=podiumCards.length;
    podiumCards.push(`<article class="hero-kpi-placeholder">
      <span class="kpi-icon">${uiIcon(index===0?'trophy':'medal')}</span>
      <div><span>${['Primer','Segundo','Tercer'][index]} lugar</span><b>Por definir</b><small>Temporada anterior</small></div>
    </article>`);
  }
  return heroKpiLayout({
    eyebrow:'CLASIFICACIÓN FINAL',
    title:`Podio ${podium.season}`,
    subtitle:'Los tres mejores de la última temporada.',
    badge:'',
    podiumCards,
    leaderCards:[
      heroLeaderMetricCard({
        label:'Líder goleador',
        icon:'ball',
        tone:'goals',
        value:'—',
        detail:'Comienza en la Jornada 1'
      }),
      heroLeaderMetricCard({
        label:'Líder clean sheets',
        icon:'shield',
        tone:'clean-sheets',
        value:'—',
        detail:'Comienza en la Jornada 1'
      })
    ]
  });
}

function heroKpiPlayerCard({label,player,name=player.name,detail,marker,tone}){
  const markerContent=marker.icon?uiIcon(marker.icon):marker.text;
  return `<article class="hero-kpi-live hero-kpi-${tone} team-profile-link" ${profileTriggerAttrs(player.name)}>
    <span class="kpi-marker" aria-hidden="true">${markerContent}</span>
    <span class="kpi-icon kpi-player-photo"><img src="${player.shield}" alt="Foto de ${profileAttr(player.name)}"></span>
    <div><span>${label}</span><b>${name}</b>${heroKpiScoreMarkup(detail)}</div>
  </article>`;
}

function heroKpiScoreMarkup(detail){
  const sections=String(detail).split('·').map(section=>section.trim()).filter(Boolean);
  const score=sections.shift()||'';
  const match=score.match(/^([\d.,]+)\s+puntos?\s*(.*)$/i);
  if(!match)return `<small>${detail}</small>`;
  const caption=[match[2].trim(),...sections].filter(Boolean).join(' · ');
  return `<small class="hero-kpi-score"><strong><span class="hero-kpi-score-value">${match[1]}</span><span class="hero-kpi-score-unit">puntos</span></strong>${caption?`<em>${caption}</em>`:''}</small>`;
}

function heroLeaderMetricCard({label,icon,tone,names=[],value,detail}){
  const player=names.length?DATA.participants.find(entry=>entry.name===names[0]):null;
  const extra=Math.max(0,names.length-1);
  const displayName=player?(extra?`${player.name} +${extra}`:player.name):'Por definir';
  const attrs=player?profileTriggerAttrs(player.name):'';
  return `<article class="hero-leader-metric hero-leader-${tone}${player?' team-profile-link':' hero-kpi-placeholder'}" ${attrs}>
    <span class="hero-leader-icon">${uiIcon(icon)}</span>
    <span class="hero-leader-label">${label}</span>
    <b>${displayName}</b>
    <strong>${value}</strong>
    <small>${detail}</small>
  </article>`;
}

function heroKpiLayout({eyebrow,title,subtitle,badge,podiumCards,leaderCards}){
  const visualPodium=[podiumCards[1],podiumCards[0],podiumCards[2]].filter(Boolean);
  const badgeMarkup=badge?`<span class="hero-kpis-badge">${badge}</span>`:'';
  return `<div class="hero-kpis-heading">
    <div><span>${eyebrow}</span><strong>${title}</strong><small>${subtitle}</small></div>
    ${badgeMarkup}
  </div>
  <div class="hero-podium-grid">${visualPodium.join('')}</div>
  <div class="hero-leaders-row">${leaderCards.join('')}</div>`;
}

function renderHeroKpis(latest){
  const host=$('heroKpis');
  if(!host)return;
  if(latest==null){
    host.innerHTML=heroKpiPreseasonCards();
    return;
  }

  const standings=cumulativeStandings(latest);
  const goals=pulseLeaders(standings,'goals');
  const cleanSheets=pulseLeaders(standings,'cleanSheets');
  const podiumCards=standings.slice(0,3).map((player,index)=>heroKpiPlayerCard({
      label:['Primer lugar','Segundo lugar','Tercer lugar'][index],
      player,
      detail:`${player.points.toLocaleString('es')} puntos acumulados`,
      marker:{text:String(index+1)},
      tone:['first','second','third'][index]
    }));
  host.innerHTML=heroKpiLayout({
    eyebrow:`TEMPORADA ${DATA.currentSeason}`,
    title:'Podio actual',
    subtitle:'Los tres primeros de la clasificación acumulada.',
    badge:`JORNADA ${latest}`,
    podiumCards,
    leaderCards:[
      heroLeaderMetricCard({
        label:'Líder goleador',
        icon:'ball',
        tone:'goals',
        names:goals.names,
        value:goals.value?`${goals.value} ${goals.value===1?'GOL':'GOLES'}`:'SIN GOLES',
        detail:`Acumulado hasta la Jornada ${latest}`
      }),
      heroLeaderMetricCard({
        label:'Líder clean sheets',
        icon:'shield',
        tone:'clean-sheets',
        names:cleanSheets.names,
        value:cleanSheets.value?`${cleanSheets.value} ${cleanSheets.value===1?'CLEAN SHEET':'CLEAN SHEETS'}`:'SIN CLEAN SHEETS',
        detail:`Acumulado hasta la Jornada ${latest}`
      })
    ]
  });
}

function renderHomeLive(){
  if(!$('homeLiveTitle'))return;
  const latest=PUBLISHED_MATCHDAYS.length?PUBLISHED_MATCHDAYS[PUBLISHED_MATCHDAYS.length-1]:null;
  renderHeroKpis(latest);
  if(latest==null){
    $('homeLiveBadge').textContent='POR COMENZAR';
    $('homeLiveTitle').textContent='Todo preparado para el comienzo.';
    $('homeLiveCopy').textContent='La clasificación está lista. Cuando se publique la primera jornada, este resumen cobrará vida automáticamente.';
    $('homeLatestRound').textContent='—';
    $('homeLatestWinner').textContent='Esperando la primera publicación';
    $('homeCurrentLeader').textContent='Sin comenzar';
    $('homeLeaderPoints').textContent='0 puntos';
    renderSeasonPulse();
    return;
  }
  const weekly=weeklyStandings(latest);
  const cumulative=cumulativeStandings(latest);
  const weeklyLeader=weekly[0];
  const currentLeader=cumulative[0];
  $('homeLiveBadge').textContent=`JORNADA ${latest}`;
  $('homeLiveTitle').textContent=`La jornada ${latest} ya forma parte de la historia.`;
  $('homeLiveCopy').textContent=`${weeklyLeader.name} lideró la fecha con ${weeklyLeader.points.toLocaleString('es')} puntos. Consulta el resumen completo, los goles, clean sheets, tarjetas rojas y movimientos.`;
  $('homeLatestRound').textContent=`J${latest}`;
  $('homeLatestWinner').textContent=`${weeklyLeader.name} · ${weeklyLeader.points.toLocaleString('es')} pts`;
  $('homeCurrentLeader').textContent=currentLeader.name;
  $('homeLeaderPoints').textContent=`${currentLeader.points.toLocaleString('es')} puntos acumulados`;
  renderSeasonPulse();
}

function defendingChampion(){
  const archive=DATA.historicalTables?.seasonArchive||[];
  const completed=archive.filter(entry=>
    entry.season!==DATA.currentSeason
    &&entry.results?.some(result=>result.division===1&&result.position===1)
  );
  const latest=completed[completed.length-1];
  if(!latest)return null;
  const champion=latest.results.find(result=>result.division===1&&result.position===1);
  return champion?{...champion,season:latest.season}:null;
}

function pulsePerson(names){
  if(!names.length)return '';
  const participant=DATA.participants.find(player=>player.name===names[0]);
  if(!participant)return '';
  const extra=names.length-1;
  return `<span class="pulse-person team-profile-link" ${profileTriggerAttrs(participant.name)}>
    <img src="${participant.shield}" alt="Foto de ${participant.name}">
    <span><b>${participant.name}</b>${extra?`<small>y ${extra} ${extra===1?'más':'más'}</small>`:''}</span>
  </span>`;
}

function pulseHighlightCard({tone,icon,label,names=[],value,emptyCopy}){
  return `<article class="pulse-highlight-card ${tone}">
    <span class="pulse-highlight-icon">${uiIcon(icon)}</span>
    <span class="pulse-highlight-label">${label}</span>
    ${names.length?pulsePerson(names):`<strong class="pulse-highlight-empty">${emptyCopy}</strong>`}
    <strong class="pulse-highlight-value">${value}</strong>
  </article>`;
}

function pulseLeaders(standings,key){
  const best=Math.max(0,...standings.map(player=>player[key]||0));
  return {
    value:best,
    names:best?standings.filter(player=>(player[key]||0)===best).map(player=>player.name):[]
  };
}

function renderSeasonPulse(){
  const host=$('seasonPulse');
  const badge=$('seasonPulseBadge');
  if(!host||!badge)return;
  const latest=PUBLISHED_MATCHDAYS.length?PUBLISHED_MATCHDAYS[PUBLISHED_MATCHDAYS.length-1]:null;

  if(latest==null){
    const champion=defendingChampion();
    const participantCount=activeParticipants().length;
    badge.textContent='POR COMENZAR';
    host.className='season-pulse is-preseason';
    host.innerHTML=`
      <article class="pulse-preseason-main">
        <span class="pulse-main-icon">${uiIcon('ball')}</span>
        <span class="eyebrow">TEMPORADA ${DATA.currentSeason}</span>
        <h3>Esperando la Jornada 1.</h3>
        <p>En cuanto publiques la primera jornada desde el panel privado, este espacio mostrará automáticamente el Top 5, el MVP y todos los líderes.</p>
        <span class="pulse-ready-status"><i aria-hidden="true"></i>Clasificación preparada</span>
        <button type="button" class="pulse-primary-action" data-go="matchdays"><span>Abrir Centro de Jornada</span><span aria-hidden="true">→</span></button>
      </article>
      <div class="pulse-preseason-facts">
        <article class="pulse-fact-card">
          <span class="pulse-fact-icon">${uiIcon('users')}</span>
          <span>Participantes confirmados</span>
          <b>${participantCount}</b>
          <small>Listos para competir en ${DATA.currentSeason}</small>
        </article>
        <article class="pulse-fact-card pulse-defender-card">
          <span class="pulse-fact-icon trophy">${uiIcon('trophy')}</span>
          <span>Campeón defensor</span>
          ${champion?pulsePerson([champion.name]):'<b>—</b>'}
          <small>${champion?`${champion.season} · ${champion.points.toLocaleString('es')} puntos`:'Pendiente de confirmar'}</small>
        </article>
      </div>`;
  }else{
    const standings=cumulativeStandings(latest);
    const weekly=weeklyStandings(latest);
    const movements=movementForMatchday(latest);
    const goals=pulseLeaders(standings,'goals');
    const cleanSheets=pulseLeaders(standings,'cleanSheets');
    const redCards=pulseLeaders(standings,'redCards');
    const movementEntries=[...movements.entries()].filter(([,delta])=>Number.isFinite(delta)&&delta>0);
    const biggestRise=movementEntries.length?Math.max(...movementEntries.map(([,delta])=>delta)):0;
    const risers=biggestRise?movementEntries.filter(([,delta])=>delta===biggestRise).map(([name])=>name):[];
    const weeklyMvp=weekly[0];
    badge.textContent=`JORNADA ${latest}`;
    host.className='season-pulse is-live';
    host.innerHTML=`
      <article class="pulse-standings-card">
        <div class="pulse-card-head">
          <div><span class="eyebrow">CLASIFICACIÓN RÁPIDA</span><h3>Top 5 actual</h3></div>
          <small>Actualizado: ${DATA.lastUpdated}</small>
        </div>
        <div class="pulse-standings-list">
          ${standings.slice(0,5).map(player=>`<div class="pulse-standing-row">
            <span class="pulse-rank">${player.position}</span>
            ${teamCell(player.name)}
            <span class="pulse-row-points"><b>${player.points.toLocaleString('es')}</b><small>PTS</small></span>
            <span class="pulse-row-movement">${movementBadge(movements.get(player.name))}</span>
          </div>`).join('')}
        </div>
        <button type="button" class="pulse-primary-action" data-go="current"><span>Ver clasificación completa</span><span aria-hidden="true">→</span></button>
      </article>
      <div class="pulse-highlight-grid">
        ${pulseHighlightCard({
          tone:'pulse-mvp',
          icon:'star',
          label:`MVP · Jornada ${latest}`,
          names:weeklyMvp?[weeklyMvp.name]:[],
          value:weeklyMvp?`${weeklyMvp.points.toLocaleString('es')} pts`:'—',
          emptyCopy:'Sin resultados'
        })}
        ${pulseHighlightCard({
          tone:'pulse-goals',
          icon:'ball',
          label:'Líder de goles',
          names:goals.names,
          value:`${goals.value} ${goals.value===1?'gol':'goles'}`,
          emptyCopy:'Sin goles registrados'
        })}
        ${pulseHighlightCard({
          tone:'pulse-clean-sheets',
          icon:'shield',
          label:'Líder de clean sheets',
          names:cleanSheets.names,
          value:`${cleanSheets.value} CS`,
          emptyCopy:'Sin clean sheets'
        })}
        ${pulseHighlightCard({
          tone:'pulse-red-cards',
          icon:'red-card',
          label:'Más tarjetas rojas',
          names:redCards.names,
          value:`${redCards.value} ${redCards.value===1?'roja':'rojas'}`,
          emptyCopy:'Sin tarjetas rojas'
        })}
        ${pulseHighlightCard({
          tone:'pulse-rise',
          icon:'chart',
          label:'Mayor subida',
          names:risers,
          value:biggestRise?`+${biggestRise} ${biggestRise===1?'posición':'posiciones'}`:'Sin cambios',
          emptyCopy:previousPublishedMatchday(latest)==null?'Primera jornada':'Nadie subió'
        })}
      </div>`;
  }

}

function matchdayPlayerLinks(names,limit=3){
  if(!names.length)return '<span class="matchday-no-result">Sin registro</span>';
  const visible=names.slice(0,limit);
  const remaining=names.length-visible.length;
  return `<div class="matchday-player-links">${visible.map(name=>playerInline(name,{compact:true})).join('')}${remaining?`<span class="matchday-more">y ${remaining} más</span>`:''}</div>`;
}

function featureCard({tone,icon,eyebrow,title,value,names=[],description=''}) {
  return `<article class="matchday-feature-card ${tone}">
    <span class="matchday-feature-icon"><svg class="ui-icon" aria-hidden="true"><use href="#icon-${icon}"></use></svg></span>
    <div class="matchday-feature-copy">
      <span class="eyebrow">${eyebrow}</span>
      <h3>${title}</h3>
      <strong>${value}</strong>
      ${names.length?matchdayPlayerLinks(names):`<p>${description}</p>`}
    </div>
  </article>`;
}

function renderMatchdayArchive(){
  const host=$('matchdayArchive');
  if(!host)return;
  if(!PUBLISHED_MATCHDAYS.length){
    host.innerHTML='<div class="matchday-archive-empty">El archivo se abrirá automáticamente cuando publiques la primera jornada.</div>';
    return;
  }
  host.innerHTML=[...PUBLISHED_MATCHDAYS].reverse().map(day=>{
    const weekly=weeklyStandings(day);
    const winner=weekly[0];
    const totalGoals=weekly.reduce((sum,player)=>sum+player.goals,0);
    const totalRedCards=weekly.reduce((sum,player)=>sum+player.redCards,0);
    return `<button type="button" class="matchday-archive-card ${day===SELECTED_MATCHDAY?'active':''}" data-matchday-open="${day}" aria-label="Ver resumen de la jornada ${day}">
      <span class="matchday-archive-number">J${day}</span>
      <span class="matchday-archive-copy"><small>Jornada ${day}</small><b>${winner.name}</b><span>${winner.points.toLocaleString('es')} pts · ${totalGoals} ${totalGoals===1?'gol':'goles'} · ${totalRedCards} TR</span></span>
      <span class="matchday-archive-arrow" aria-hidden="true">→</span>
    </button>`;
  }).join('');
  host.querySelectorAll('[data-matchday-open]').forEach(button=>button.onclick=()=>{
    SELECTED_MATCHDAY=Number(button.dataset.matchdayOpen);
    $('publicMatchdaySelect').value=String(SELECTED_MATCHDAY);
    renderMatchdayDetails();
    renderMatchdayArchive();
    document.querySelector('.matchday-section-head')?.scrollIntoView({behavior:'smooth',block:'start'});
  });
}

function renderMatchdayDetails(){
  const matchday=SELECTED_MATCHDAY;
  if(matchday==null)return;
  const weekly=weeklyStandings(matchday);
  const movements=movementForMatchday(matchday);
  const previous=previousPublishedMatchday(matchday);
  const totalPoints=weekly.reduce((sum,player)=>sum+player.points,0);
  const average=weekly.length?totalPoints/weekly.length:0;
  const recordPoints=Math.max(0,...weekly.map(player=>player.points));
  const recordNames=weekly.filter(player=>player.points===recordPoints).map(player=>player.name);
  const maxGoals=Math.max(0,...weekly.map(player=>player.goals));
  const goalLeaders=maxGoals?weekly.filter(player=>player.goals===maxGoals).map(player=>player.name):[];
  const maxCleanSheets=Math.max(0,...weekly.map(player=>player.cleanSheets));
  const cleanSheetLeaders=maxCleanSheets?weekly.filter(player=>player.cleanSheets===maxCleanSheets).map(player=>player.name):[];
  const maxRedCards=Math.max(0,...weekly.map(player=>player.redCards));
  const redCardLeaders=maxRedCards?weekly.filter(player=>player.redCards===maxRedCards).map(player=>player.name):[];

  $('matchdayTitle').textContent=`Jornada ${matchday}`;
  $('matchdayStatus').textContent=`${weekly.filter(player=>player.played).length} resultados · publicada`;
  $('matchdayPlayerCount').textContent=`${weekly.length} participantes`;

  const podiumOrder=[
    {player:weekly[1],place:2,tone:'second'},
    {player:weekly[0],place:1,tone:'first'},
    {player:weekly[2],place:3,tone:'third'}
  ].filter(entry=>entry.player);
  $('matchdayPodium').innerHTML=podiumOrder.map(({player,place,tone})=>`<article class="podium-player podium-${tone}">
    <span class="podium-medal">${place}º</span>
    <div class="podium-avatar team-profile-link" ${profileTriggerAttrs(player.name)}><img src="${player.shield}" alt="Foto de ${player.name}"></div>
    <h4 class="team-profile-link" ${profileTriggerAttrs(player.name)}>${player.name}</h4>
    <strong>${player.points.toLocaleString('es')} pts</strong>
    <small>${player.goals} GOL · ${player.cleanSheets} CS · ${player.redCards} TR</small>
  </article>`).join('');

  $('matchdayLeaders').innerHTML=[
    featureCard({
      tone:'feature-cyan',
      icon:'ball',
      eyebrow:'GOLES',
      title:'Líder de goles',
      value:maxGoals?`${maxGoals} ${maxGoals===1?'gol':'goles'}`:'Sin goles',
      names:goalLeaders,
      description:'Todavía no hay goles registrados en esta jornada.'
    }),
    featureCard({
      tone:'feature-green',
      icon:'shield',
      eyebrow:'PORTERÍA',
      title:'Líder de clean sheets',
      value:maxCleanSheets?`${maxCleanSheets} ${maxCleanSheets===1?'clean sheet':'clean sheets'}`:'Sin clean sheets',
      names:cleanSheetLeaders,
      description:'Todavía no hay porterías a cero registradas.'
    }),
    featureCard({
      tone:'feature-red',
      icon:'red-card',
      eyebrow:'DISCIPLINA',
      title:'Más tarjetas rojas',
      value:maxRedCards?`${maxRedCards} ${maxRedCards===1?'tarjeta roja':'tarjetas rojas'}`:'Sin tarjetas rojas',
      names:redCardLeaders,
      description:'Todavía no hay expulsiones registradas en esta jornada.'
    })
  ].join('');

  if(previous==null){
    $('matchdayMovers').innerHTML=[
      featureCard({tone:'feature-up',icon:'chart',eyebrow:'MOVIMIENTO',title:'Mayor subida',value:'Clasificación inicial',description:'No existe una jornada anterior para comparar.'}),
      featureCard({tone:'feature-down',icon:'chart',eyebrow:'MOVIMIENTO',title:'Mayor caída',value:'Clasificación inicial',description:'Los movimientos comenzarán en la próxima jornada.'})
    ].join('');
  }else{
    const deltas=weekly.map(player=>({name:player.name,delta:movements.get(player.name)||0}));
    const biggestRise=Math.max(0,...deltas.map(entry=>entry.delta));
    const biggestFall=Math.min(0,...deltas.map(entry=>entry.delta));
    const risers=biggestRise?deltas.filter(entry=>entry.delta===biggestRise).map(entry=>entry.name):[];
    const fallers=biggestFall?deltas.filter(entry=>entry.delta===biggestFall).map(entry=>entry.name):[];
    $('matchdayMovers').innerHTML=[
      featureCard({
        tone:'feature-up',
        icon:'chart',
        eyebrow:`DESDE JORNADA ${previous}`,
        title:'Mayor subida',
        value:biggestRise?`↑ ${biggestRise} ${biggestRise===1?'posición':'posiciones'}`:'Sin cambios',
        names:risers,
        description:'Ningún participante ganó posiciones.'
      }),
      featureCard({
        tone:'feature-down',
        icon:'chart',
        eyebrow:`DESDE JORNADA ${previous}`,
        title:'Mayor caída',
        value:biggestFall?`↓ ${Math.abs(biggestFall)} ${Math.abs(biggestFall)===1?'posición':'posiciones'}`:'Sin cambios',
        names:fallers,
        description:'Ningún participante perdió posiciones.'
      })
    ].join('');
  }

  $('matchdayMetrics').innerHTML=`
    <article><span class="matchday-metric-icon">Ø</span><div><span>Promedio de la jornada</span><b>${average.toLocaleString('es',{minimumFractionDigits:1,maximumFractionDigits:1})}</b><small>puntos por participante</small></div></article>
    <article><span class="matchday-metric-icon"><svg class="ui-icon" aria-hidden="true"><use href="#icon-star"></use></svg></span><div><span>Récord de la jornada</span><b>${recordPoints.toLocaleString('es')} pts</b>${matchdayPlayerLinks(recordNames,2)}</div></article>`;

  $('matchdayTableRows').innerHTML=weekly.map(player=>`<div class="matchday-table-row matchday-table-grid">
    <span class="pos">${player.position}</span>
    ${teamCell(player.name)}
    <span class="num">${player.points.toLocaleString('es')}</span>
    <span class="current-stat current-goals">${player.goals}</span>
    <span class="current-stat current-clean-sheets">${player.cleanSheets}</span>
    <span class="current-stat current-red-cards">${player.redCards}</span>
  </div>`).join('');
}

function renderMatchdayCenter(){
  const select=$('publicMatchdaySelect');
  if(!select)return;
  const hasMatchdays=PUBLISHED_MATCHDAYS.length>0;
  select.disabled=!hasMatchdays;
  $('matchdayEmpty').hidden=hasMatchdays;
  $('matchdayContent').hidden=!hasMatchdays;
  if(!hasMatchdays){
    select.innerHTML='<option>Sin jornadas publicadas</option>';
    renderMatchdayArchive();
    return;
  }
  select.innerHTML=PUBLISHED_MATCHDAYS.map(day=>`<option value="${day}">Jornada ${day}</option>`).join('');
  select.value=String(SELECTED_MATCHDAY);
  select.onchange=()=>{
    SELECTED_MATCHDAY=Number(select.value);
    renderMatchdayDetails();
    renderMatchdayArchive();
  };
  renderMatchdayDetails();
  renderMatchdayArchive();
}

function sortedGeneral(mode){const x=[...DATA.general];if(mode==='points')return x.sort((a,b)=>b.points-a.points);if(mode==='titles')return x.sort((a,b)=>b.titles-a.titles||b.podiums-a.podiums||b.points-a.points);if(mode==='average')return x.sort((a,b)=>b.average-a.average);if(mode==='podiums')return x.sort((a,b)=>b.podiums-a.podiums||b.titles-a.titles||b.points-a.points);return x.sort((a,b)=>b.titles-a.titles||b.podiums-a.podiums||b.top5-a.top5||b.points-a.points||b.average-a.average)}

function historicalPodiumMetric(player,mode){
  if(mode==='points')return {label:'Puntos históricos',value:player.points,unit:'PTS',decimals:0};
  if(mode==='titles')return {label:'Palmarés',value:player.titles,unit:player.titles===1?'TÍTULO':'TÍTULOS',decimals:0};
  if(mode==='average')return {label:'Promedio',value:player.average||0,unit:'PTS / TEMP.',decimals:1};
  if(mode==='podiums')return {label:'Regularidad',value:player.podiums,unit:player.podiums===1?'PODIO':'PODIOS',decimals:0};
  return {label:'Palmarés histórico',value:player.titles,unit:player.titles===1?'TÍTULO':'TÍTULOS',decimals:0};
}

function renderHistoricalPodium(list,mode,snapshot=buildAchievementSnapshot()){
  const host=$('historicalPodium');
  if(!host)return;
  const order=[1,0,2];
  host.innerHTML=order.map(index=>{
    const player=list[index];
    if(!player)return '';
    const rank=index+1;
    const metric=historicalPodiumMetric(player,mode);
    const value=Number(metric.value||0).toLocaleString('es',{
      minimumFractionDigits:metric.decimals,
      maximumFractionDigits:metric.decimals
    });
    const badges=compactAchievementBadges(player.name,snapshot,{
      className:'historical-podium-badges'
    });
    return `<article class="historical-podium-card historical-podium-${rank} team-profile-link" ${profileTriggerAttrs(player.name)}>
      <span class="historical-podium-place">${rank}</span>
      <img src="${imageMap()[player.name]||''}" alt="Foto de ${player.name}">
      <div><small>${metric.label}</small><strong>${player.name}</strong>${badges}<b>${value}<span>${metric.unit}</span></b></div>
    </article>`;
  }).join('');
}

function renderGeneral(mode='ranking'){
  const list=sortedGeneral(mode);
  const snapshot=buildAchievementSnapshot();
  renderHistoricalPodium(list,mode,snapshot);
  $('generalRows').innerHTML=list.map((p,i)=>`<div class="general-row historical-ranking-row${i<3?` history-rank-${i+1}`:''}">
    <span class="pos">${i+1}</span>
    ${standingsTeamCell(p.name,snapshot)}
    <span class="center history-metric" data-label="Títulos">${p.titles}</span>
    <span class="center history-metric" data-label="2º lugar">${p.seconds}</span>
    <span class="center history-metric" data-label="3º lugar">${p.thirds}</span>
    <span class="center history-metric" data-label="Podios">${p.podiums}</span>
    <span class="center history-metric" data-label="Top 5">${p.top5}</span>
    <span class="center history-metric" data-label="Temporadas">${p.seasons}</span>
    <span class="num history-metric history-metric-wide history-metric-featured" data-label="Puntos">${p.points.toLocaleString('es')}</span>
    <span class="num history-metric history-metric-wide" data-label="Promedio">${p.average?p.average.toLocaleString('es',{minimumFractionDigits:1,maximumFractionDigits:1}):'—'}</span>
  </div>`).join('');
}

function renderPoints(){
  const snapshot=buildAchievementSnapshot();
  const ranking=[...DATA.historicalTables.pointsRanking].sort((a,b)=>b.points-a.points);
  $('pointsRows').innerHTML=ranking.map((p,i)=>`<div class="points-row historical-ranking-row${i<3?` history-rank-${i+1}`:''}">
    <span class="pos">${i+1}</span>
    ${standingsTeamCell(p.name,snapshot)}
    <span class="center history-metric" data-label="Temporadas">${p.seasons}</span>
    <span class="num history-metric history-metric-featured" data-label="Puntos">${p.points.toLocaleString('es')}</span>
    <span class="num history-metric" data-label="Promedio">${p.average.toLocaleString('es',{minimumFractionDigits:1,maximumFractionDigits:1})}</span>
  </div>`).join('');
}

function renderPalmares(){
  const snapshot=buildAchievementSnapshot();
  const stats=statMap();
  const ranking=[...DATA.historicalTables.palmaresRanking].sort((a,b)=>
    b.titles-a.titles
    ||b.podiums-a.podiums
    ||(stats[b.name]?.points||0)-(stats[a.name]?.points||0)
  );
  $('palmaresRows').innerHTML=ranking.map((p,i)=>`<div class="palmares-row historical-ranking-row${i<3?` history-rank-${i+1}`:''}">
    <span class="pos">${i+1}</span>
    ${standingsTeamCell(p.name,snapshot)}
    <span class="center history-metric history-metric-featured" data-label="Títulos">${p.titles}</span>
    <span class="center history-metric" data-label="2º lugar">${p.seconds}</span>
    <span class="center history-metric" data-label="3º lugar">${p.thirds}</span>
    <span class="center history-metric" data-label="Podios">${p.podiums}</span>
  </div>`).join('');
}
function renderSeasons(){
const list=DATA.historicalTables.seasonArchive;
$('seasonSelect').innerHTML=list.map(s=>`<option>${s.season}</option>`).join('');
const show=id=>{
const s=list.find(x=>x.season===id);
if(!s.results||!s.results.length){
$('seasonContent').innerHTML=`<div class="season-empty"><span class="eyebrow">${s.season}</span><h3>${s.status}</h3><p>La clasificación se irá completando durante la temporada.</p></div>`;
return;
}
const first=s.results.filter(r=>r.division===1);
const second=s.results.filter(r=>r.division===2);
const rows=first.map(r=>`<div class="season-result-row ${r.position===1?'season-winner':''}"><span class="season-pos">${r.position===1?uiIcon('trophy','season-winner-icon'):r.position+'º'}</span>${teamCell(r.name)}<span class="season-points">${r.points.toLocaleString()} pts</span></div>`).join('');
const secondRows=second.map(r=>`<div class="second-team">${teamCell(r.name)}<span>2ª División</span></div>`).join('');
$('seasonContent').innerHTML=`<div class="season-table-wrap"><div class="season-title-line"><div><span class="eyebrow">${s.season}</span><h3>Clasificación final</h3></div><span class="status">${first.length} en 1ª División</span></div><div class="card season-results">${rows}</div>${second.length?`<div class="second-division"><h3>2ª División</h3><p>Estos participantes no aparecen en la clasificación de Primera de esta temporada.</p><div class="second-grid">${secondRows}</div></div>`:''}</div>`;
};
show(list[0].season);
$('seasonSelect').onchange=e=>show(e.target.value)
}
function renderSeasonChampions(){
const list=DATA.historicalTables.seasonChampions||[];
$('championsLegacy').innerHTML=(DATA.champions?.history||[]).length
  ?`<section class="champions-legacy-section">
    <div class="champions-legacy-heading">
      <div><span class="eyebrow">HISTORIAL DE CHAMPIONS</span><h2>Campeones de Europa</h2><p>El registro oficial de todas las ediciones disputadas.</p></div>
      <span class="champions-legacy-count">${DATA.champions.history.length} ${DATA.champions.history.length===1?'edición':'ediciones'}</span>
    </div>
    <div class="champions-legacy-grid">
      ${DATA.champions.history.map(item=>{
        const img=imageMap()[item.champion];
        return `<article class="champions-legacy-card team-profile-link" ${profileTriggerAttrs(item.champion)}>
          <span class="champions-legacy-trophy">${uiIcon('trophy')}</span>
          ${img?`<img src="${img}" alt="Foto de ${profileAttr(item.champion)}">`:''}
          <div><small>CAMPEÓN · ${item.season}</small><h3>${item.champion}</h3><p>${item.note||'Campeón de la Cuban League Champions'}</p></div>
          <span class="champions-legacy-edition">EDICIÓN ${String(item.edition||1).padStart(2,'0')}</span>
        </article>`;
      }).join('')}
    </div>
  </section>`
  :'';
$('seasonChampions').innerHTML=list.map((c,index)=>{
const img=imageMap()[c.name];
return `<article class="champion-history-card">
  <span class="champion-history-number">${String(index+1).padStart(2,'0')}</span>
  ${img?`<img src="${img}" alt="Foto de ${c.name}">`:`<div class="champion-placeholder">${uiIcon('trophy','champion-placeholder-icon')}</div>`}
  <div><span class="champion-season">${c.season}</span><h3>${playerInline(c.name)}</h3><p>${c.points?c.points.toLocaleString('es')+' puntos':'El campeón de esta edición no aparece identificado en las capturas disponibles.'}</p></div>
  <span class="champion-history-mark">${uiIcon('trophy')}</span>
</article>`
}).join('')
}
const ACHIEVEMENT_CATALOG=[
  {id:'champion',icon:'🏆',name:'Campeón',rarity:'legendary',type:'Histórica',requirement:'Ganar una temporada de la Cuban League.'},
  {id:'dynasty',icon:'👑',name:'Dinastía',rarity:'legendary',type:'Histórica',requirement:'Conquistar al menos 2 títulos de Liga.'},
  {id:'podium_regular',icon:'🥉',name:'Habitual del podio',rarity:'epic',type:'Histórica',requirement:'Terminar en el Top 3 durante 3 temporadas.'},
  {id:'season_record',icon:'⚡',name:'Temporada legendaria',rarity:'legendary',type:'Récord',requirement:'Tener el récord de puntos en una temporada.'},
  {id:'two_thousand',icon:'💎',name:'Club 2.000',rarity:'epic',type:'Histórica',requirement:'Superar 2.000 puntos en una temporada.'},
  {id:'matchday_king',icon:'🗓️',name:'Rey de la jornada',rarity:'epic',type:'Temporada',requirement:'Ganar 3 jornadas en la temporada actual.'},
  {id:'on_fire',icon:'🔥',name:'En llamas',rarity:'epic',type:'Racha',requirement:'Estar en el Top 3 durante 3 jornadas seguidas.'},
  {id:'manita',icon:'⚽',name:'La Manita',rarity:'rare',type:'Jornada',requirement:'Marcar 5 goles o más en una jornada.'},
  {id:'wall',icon:'🧤',name:'El Muro',rarity:'legendary',type:'Récord',requirement:'Tener la mayor racha de clean sheets seguidos (mínimo 2).'},
  {id:'leader',icon:'⭐',name:'Líder actual',rarity:'rare',type:'Dinámica',requirement:'Ocupar el 1.º puesto de la clasificación actual.'},
  {id:'pichichi',icon:'🥇',name:'Pichichi',rarity:'rare',type:'Dinámica',requirement:'Liderar los goles de la temporada.'},
  {id:'golden_glove',icon:'🛡️',name:'Guante de Oro',rarity:'rare',type:'Dinámica',requirement:'Liderar los clean sheets de la temporada.'},
  {id:'king_europe',icon:'🌟',name:'Rey de Europa',rarity:'legendary',type:'Champions',requirement:'Ganar la Cuban League Champions.'},
  {id:'player_month',icon:'📅',name:'Jugador del Mes',rarity:'epic',type:'Mensual',requirement:'Sumar más puntos en las jornadas del mes.'},
  {id:'winter_champion',icon:'❄️',name:'Campeón de Invierno',rarity:'epic',type:'Temporada',requirement:'Liderar la tabla al cerrar diciembre.'}
];

const ACHIEVEMENT_RARITY_WEIGHT={legendary:4,epic:3,rare:2,common:1};

function achievementMonthLabel(dateValue){
  const date=new Date(`${dateValue}T12:00:00`);
  if(Number.isNaN(date.getTime()))return '';
  const label=new Intl.DateTimeFormat('es',{month:'long',year:'numeric'}).format(date);
  return label.charAt(0).toUpperCase()+label.slice(1);
}

function achievementSeasonRecord(){
  const results=(DATA.historicalTables?.seasonArchive||[]).flatMap(season=>
    (season.results||[])
      .filter(result=>result.division===1&&Number.isFinite(result.points))
      .map(result=>({name:result.name,points:Number(result.points),season:season.season}))
  );
  if(!results.length)return {points:0,holders:[]};
  const points=Math.max(...results.map(result=>result.points));
  return {points,holders:results.filter(result=>result.points===points)};
}

function championsWinner(){
  const direct=DATA.champions?.champion;
  if(typeof direct==='string'&&DATA.participants.some(player=>player.name===direct))return direct;
  const final=(DATA.champions?.knockout||[]).find(round=>/final/i.test(round.round||''));
  const winner=final?.winner||final?.champion;
  return typeof winner==='string'&&DATA.participants.some(player=>player.name===winner)?winner:null;
}

function monthlyAchievementAwards(){
  const milestonesByDay=new Map(MATCHDAY_MILESTONES.map(item=>[item.matchday,item]));
  const closingByMonth=new Map();
  MATCHDAY_MILESTONES.filter(item=>item.isMonthEnd).forEach(item=>{
    closingByMonth.set(item.matchdayDate.slice(0,7),item);
  });

  return [...closingByMonth.entries()].map(([monthKey,closing])=>{
    const monthDays=new Set(MATCHDAY_MILESTONES
      .filter(item=>item.matchdayDate.startsWith(monthKey)&&item.matchday<=closing.matchday)
      .map(item=>item.matchday));
    const totals=new Map(activeParticipants().map(player=>[
      player.name,
      {...player,points:0,goals:0,cleanSheets:0,redCards:0,played:0}
    ]));
    LIVE_MATCHDAY_ROWS.forEach(row=>{
      if(!monthDays.has(row.matchday)||!milestonesByDay.has(row.matchday)||!totals.has(row.participantName))return;
      const total=totals.get(row.participantName);
      total.points+=row.points;
      total.goals+=row.goals;
      total.cleanSheets+=row.cleanSheets;
      total.redCards+=row.redCards;
      total.played+=1;
    });
    const ranking=[...totals.values()].filter(player=>player.played>0).sort(sortStandings);
    return ranking.length?{
      name:ranking[0].name,
      month:monthKey,
      label:achievementMonthLabel(closing.matchdayDate),
      matchday:closing.matchday,
      points:ranking[0].points
    }:null;
  }).filter(Boolean).sort((a,b)=>a.month.localeCompare(b.month));
}

function winterAchievementAwards(){
  return MATCHDAY_MILESTONES.filter(item=>item.isYearEnd).map(item=>{
    const winner=cumulativeStandings(item.matchday)[0];
    return winner?{
      name:winner.name,
      year:item.matchdayDate.slice(0,4),
      matchday:item.matchday,
      points:winner.points
    }:null;
  }).filter(Boolean);
}

function buildAchievementSnapshot(){
  const players=new Map(DATA.participants.map(player=>[player.name,new Map()]));
  const metrics=new Map(DATA.participants.map(player=>[player.name,{
    matchdayWins:0,
    topThreeStreak:0,
    maxGoals:0,
    maxGoalsMatchday:null,
    cleanSheetStreak:0
  }]));
  const historical=statMap();
  const seasonRecord=achievementSeasonRecord();
  const twoThousandSeasons=new Map(DATA.participants.map(player=>[
    player.name,
    (DATA.historicalTables?.seasonArchive||[]).flatMap(season=>
      (season.results||[])
        .filter(result=>result.name===player.name&&result.division===1&&Number(result.points)>2000)
        .map(result=>({season:season.season,points:Number(result.points)}))
    ).sort((a,b)=>b.points-a.points)
  ]));
  const latest=PUBLISHED_MATCHDAYS.length?PUBLISHED_MATCHDAYS[PUBLISHED_MATCHDAYS.length-1]:null;
  const current=latest==null?[]:cumulativeStandings(latest);
  const pichichiTotal=current.length?Math.max(...current.map(player=>player.goals||0)):0;
  const gloveTotal=current.length?Math.max(...current.map(player=>player.cleanSheets||0)):0;

  PUBLISHED_MATCHDAYS.forEach(matchday=>{
    const rows=LIVE_MATCHDAY_ROWS.filter(row=>row.matchday===matchday);
    if(!rows.length)return;
    const winningPoints=Math.max(...rows.map(row=>row.points));
    rows.filter(row=>row.points===winningPoints).forEach(row=>{
      if(metrics.has(row.participantName))metrics.get(row.participantName).matchdayWins+=1;
    });
    rows.forEach(row=>{
      const playerMetrics=metrics.get(row.participantName);
      if(!playerMetrics)return;
      if(row.goals>playerMetrics.maxGoals){
        playerMetrics.maxGoals=row.goals;
        playerMetrics.maxGoalsMatchday=matchday;
      }
    });
  });

  DATA.participants.forEach(player=>{
    let topRun=0;
    let cleanRun=0;
    PUBLISHED_MATCHDAYS.forEach(matchday=>{
      const row=LIVE_MATCHDAY_ROWS.find(item=>item.matchday===matchday&&item.participantName===player.name);
      const weekly=row?weeklyStandings(matchday).find(item=>item.name===player.name):null;
      if(weekly&&weekly.position<=3){
        topRun+=1;
        metrics.get(player.name).topThreeStreak=Math.max(metrics.get(player.name).topThreeStreak,topRun);
      }else{
        topRun=0;
      }
      if(row&&(row.cleanSheets||0)>0){
        cleanRun+=1;
        metrics.get(player.name).cleanSheetStreak=Math.max(metrics.get(player.name).cleanSheetStreak,cleanRun);
      }else{
        cleanRun=0;
      }
    });
  });

  const cleanSheetRecord=Math.max(0,...[...metrics.values()].map(item=>item.cleanSheetStreak));
  const monthAwards=monthlyAchievementAwards();
  const winterAwards=winterAchievementAwards();
  const europeChampion=championsWinner();

  const resolve=(player,catalog)=>{
    const stats=historical[player.name]||{};
    const playerMetrics=metrics.get(player.name);
    const currentRow=current.find(item=>item.name===player.name);
    const monthly=monthAwards.filter(award=>award.name===player.name);
    const winter=winterAwards.filter(award=>award.name===player.name);
    const record=seasonRecord.holders.find(holder=>holder.name===player.name);
    let earned=false;
    let meta='';
    let progress='';

    if(catalog.id==='champion'){
      earned=(stats.titles||0)>=1;
      meta=earned?`${stats.titles} ${stats.titles===1?'título':'títulos'}`:'';
    }else if(catalog.id==='dynasty'){
      earned=(stats.titles||0)>=2;
      meta=earned?`${stats.titles} títulos`:'';
      progress=`${Math.min(stats.titles||0,2)}/2 títulos`;
    }else if(catalog.id==='podium_regular'){
      earned=(stats.podiums||0)>=3;
      meta=earned?`${stats.podiums} podios`:'';
      progress=`${Math.min(stats.podiums||0,3)}/3 podios`;
    }else if(catalog.id==='season_record'){
      earned=Boolean(record);
      meta=earned?`${record.points.toLocaleString('es')} pts · ${record.season}`:'';
    }else if(catalog.id==='two_thousand'){
      const seasons=twoThousandSeasons.get(player.name)||[];
      earned=seasons.length>0;
      meta=earned
        ?seasons.length===1
          ?`${seasons[0].points.toLocaleString('es')} pts · ${seasons[0].season}`
          :`${seasons.length} temporadas · máximo ${seasons[0].points.toLocaleString('es')} pts`
        :'';
    }else if(catalog.id==='matchday_king'){
      earned=playerMetrics.matchdayWins>=3;
      meta=earned?`${playerMetrics.matchdayWins} jornadas ganadas`:'';
      progress=`${Math.min(playerMetrics.matchdayWins,3)}/3 victorias`;
    }else if(catalog.id==='on_fire'){
      earned=playerMetrics.topThreeStreak>=3;
      meta=earned?`Racha de ${playerMetrics.topThreeStreak} jornadas`:'';
      progress=`${Math.min(playerMetrics.topThreeStreak,3)}/3 en el Top 3`;
    }else if(catalog.id==='manita'){
      earned=playerMetrics.maxGoals>=5;
      meta=earned?`${playerMetrics.maxGoals} goles · J${playerMetrics.maxGoalsMatchday}`:'';
      progress=`Récord personal: ${playerMetrics.maxGoals}/5 goles`;
    }else if(catalog.id==='wall'){
      earned=cleanSheetRecord>=2&&playerMetrics.cleanSheetStreak===cleanSheetRecord;
      meta=earned?`Récord: ${cleanSheetRecord} jornadas seguidas`:'';
      progress=cleanSheetRecord<2
        ?`${playerMetrics.cleanSheetStreak}/2 jornadas`
        :`Récord actual: ${cleanSheetRecord}`;
    }else if(catalog.id==='leader'){
      earned=Boolean(currentRow&&currentRow.position===1&&latest!=null);
      meta=earned?`${currentRow.points.toLocaleString('es')} pts · J${latest}`:'';
    }else if(catalog.id==='pichichi'){
      earned=Boolean(currentRow&&pichichiTotal>0&&currentRow.goals===pichichiTotal);
      meta=earned?`${currentRow.goals} ${currentRow.goals===1?'gol':'goles'}`:'';
    }else if(catalog.id==='golden_glove'){
      earned=Boolean(currentRow&&gloveTotal>0&&currentRow.cleanSheets===gloveTotal);
      meta=earned?`${currentRow.cleanSheets} clean ${currentRow.cleanSheets===1?'sheet':'sheets'}`:'';
    }else if(catalog.id==='king_europe'){
      earned=europeChampion===player.name;
      meta=earned?`Campeón de Champions · ${DATA.champions?.championSeason||'edición histórica'}`:'';
    }else if(catalog.id==='player_month'){
      earned=monthly.length>0;
      meta=earned
        ?monthly.length===1?monthly[0].label:`${monthly.length} premios · ${monthly.map(award=>award.label.split(' ')[0]).join(', ')}`
        :'';
      progress=MATCHDAY_MILESTONES.some(item=>item.isMonthEnd)?'Premio mensual publicado':'Se entrega al cerrar cada mes';
    }else if(catalog.id==='winter_champion'){
      earned=winter.length>0;
      meta=earned
        ?winter.length===1?`${winter[0].year} · ${winter[0].points.toLocaleString('es')} pts`:`${winter.length} veces`
        :'';
      progress=MATCHDAY_MILESTONES.some(item=>item.isYearEnd)?'Cierre de diciembre publicado':'Se entrega al cerrar diciembre';
    }

    return {
      ...catalog,
      earned,
      meta,
      progress,
      detail:earned?(meta||catalog.requirement):(progress||catalog.requirement)
    };
  };

  DATA.participants.forEach(player=>{
    ACHIEVEMENT_CATALOG.forEach(catalog=>{
      players.get(player.name).set(catalog.id,resolve(player,catalog));
    });
  });

  return {
    players,
    catalog:ACHIEVEMENT_CATALOG.map(catalog=>{
      const achievers=DATA.participants.filter(player=>players.get(player.name).get(catalog.id).earned);
      return {...catalog,achievers};
    })
  };
}

function playerAchievementState(name,snapshot=buildAchievementSnapshot()){
  return [...(snapshot.players.get(name)?.values()||[])];
}

function sortFeaturedAchievements(items){
  return [...items].sort((a,b)=>
    Number(b.earned)-Number(a.earned)
    ||(ACHIEVEMENT_RARITY_WEIGHT[b.rarity]||0)-(ACHIEVEMENT_RARITY_WEIGHT[a.rarity]||0)
    ||a.name.localeCompare(b.name,'es')
  );
}

function compactAchievementBadges(name,snapshot,{limit=3,className=''}={}){
  const badges=sortFeaturedAchievements(
    playerAchievementState(name,snapshot).filter(item=>item.earned)
  );
  if(!badges.length)return '';
  const visible=badges.slice(0,limit);
  const remaining=badges.length-visible.length;
  const badgeLabel=badges.length===1?'1 insignia conseguida':`${badges.length} insignias conseguidas`;
  const classes=`standings-mini-badges${className?` ${className}`:''}`;
  return `<span class="${classes}" aria-label="${badgeLabel}">
    ${visible.map(item=>`<span class="standings-mini-badge achievement-${item.rarity}" title="${item.name}: ${profileAttr(item.detail)}" aria-label="${item.name}">${item.icon}</span>`).join('')}
    ${remaining?`<span class="standings-mini-more" aria-label="${remaining} insignias más">+${remaining}</span>`:''}
  </span>`;
}

function standingsTeamCell(name,snapshot){
  return `<div class="team standings-team team-profile-link" ${profileTriggerAttrs(name)}>
    <img src="${imageMap()[name]||''}" alt="Foto de ${profileAttr(name)}">
    <div class="standings-team-copy">
      <span class="name">${name}</span>
      ${compactAchievementBadges(name,snapshot)}
    </div>
  </div>`;
}

function renderAchievementHub(snapshot=buildAchievementSnapshot()){
  const host=$('achievementHub');
  if(!host)return;
  const unlocked=snapshot.catalog.filter(item=>item.achievers.length);
  const totalAwards=snapshot.catalog.reduce((sum,item)=>sum+item.achievers.length,0);
  const rarest=[...unlocked].sort((a,b)=>
    a.achievers.length-b.achievers.length
    ||(ACHIEVEMENT_RARITY_WEIGHT[b.rarity]||0)-(ACHIEVEMENT_RARITY_WEIGHT[a.rarity]||0)
  )[0];

  host.innerHTML=`<section class="achievement-hub-shell">
    <div class="achievement-hub-head">
      <div><span class="eyebrow">SALA DE TROFEOS</span><h2>Insignias por logros</h2><p>Cada insignia nace de datos oficiales. Las bloqueadas muestran exactamente lo que falta.</p></div>
      <div class="achievement-hub-score"><b>${unlocked.length}<span>/${ACHIEVEMENT_CATALOG.length}</span></b><small>tipos estrenados</small></div>
    </div>
    <div class="achievement-hub-summary">
      <article><span>🏅</span><div><b>${totalAwards}</b><small>insignias entregadas</small></div></article>
      <article><span>💎</span><div><b>${rarest?rarest.name:'Por estrenar'}</b><small>${rarest?`${rarest.achievers.length} ${rarest.achievers.length===1?'poseedor':'poseedores'}`:'La primera puede ser tuya'}</small></div></article>
      <article><span>🔒</span><div><b>${ACHIEVEMENT_CATALOG.length-unlocked.length}</b><small>retos sin estrenar</small></div></article>
    </div>
    <div class="achievement-catalog-scroll" role="list" aria-label="Colección de insignias">
      ${snapshot.catalog.map(item=>`<article class="achievement-catalog-card achievement-${item.rarity}${item.achievers.length?' is-unlocked':' is-locked'}" role="listitem">
        <span class="achievement-catalog-icon" aria-hidden="true">${item.icon}</span>
        <div><small>${item.type}</small><b>${item.name}</b><p>${item.requirement}</p></div>
        <span class="achievement-owner-count">${item.achievers.length?`${item.achievers.length} ${item.achievers.length===1?'jugador':'jugadores'}`:'Sin estrenar'}</span>
      </article>`).join('')}
    </div>
    <p class="achievement-hub-hint">Toca cualquier participante para abrir su vitrina completa.</p>
  </section>`;
}

function renderPlayers(filter=''){
  const stats=statMap();
  const snapshot=buildAchievementSnapshot();
  renderAchievementHub(snapshot);
  const query=String(filter||'').trim().toLowerCase();
  $('playerGrid').innerHTML=DATA.participants.filter(player=>player.name.toLowerCase().includes(query)).map(player=>{
    const statsRow=stats[player.name]||{};
    const badges=sortFeaturedAchievements(playerAchievementState(player.name,snapshot).filter(item=>item.earned));
    const visible=badges.slice(0,3);
    return `<article class="player-card player-card-v76 team-profile-link" ${profileTriggerAttrs(player.name)}>
      <img src="${player.shield}" alt="Foto de ${player.name}">
      <div class="player-card-main" style="display:contents!important">
        <h3 style="grid-column:2!important;grid-row:1!important">${player.name}</h3>
        <small style="grid-column:2!important;grid-row:2!important">${statsRow.label||'Participante'}</small>
        <p style="grid-column:2!important;grid-row:3!important">${statsRow.points?.toLocaleString()||0} puntos · ${statsRow.podiums||0} podios</p>
      </div>
      <div class="player-card-badges${visible.length?'':' is-empty'}" style="grid-column:2!important;grid-row:4!important"${visible.length?` aria-label="${badges.length} insignias conseguidas"`:' aria-hidden="true"'}>
        ${visible.map(item=>`<span class="player-mini-badge achievement-${item.rarity}" title="${item.name}: ${profileAttr(item.detail)}" aria-label="${item.name}">${item.icon}</span>`).join('')}
        ${badges.length>visible.length?`<b>+${badges.length-visible.length}</b>`:''}
      </div>
      <span class="profile-card-cta" style="grid-column:3!important;grid-row:1 / 5!important" aria-hidden="true">→</span>
    </article>`;
  }).join('');
}
function getPlayerHistory(name){
  const archive=DATA.historicalTables?.seasonArchive||[];
  return archive.map(s=>{
    const row=(s.results||[]).find(r=>r.name===name);
    if(!row)return {season:s.season,division:null,position:null,points:null};
    return {season:s.season,division:row.division,position:row.position,points:row.points};
  }).filter(x=>x.season!=='2026/27');
}
function ordinal(n){return n?`${n}º`:'—'}
function currentStanding(name){
  const participant=DATA.participants.find(p=>p.name===name);
  if(participant?.active===false){
    return {active:false,started:false,position:null,points:0,goals:0,cleanSheets:0,redCards:0,played:0};
  }
  const sorted=DATA.participants.filter(p=>p.active!==false).sort((a,b)=>b.points-a.points||(b.goals||0)-(a.goals||0)||(b.cleanSheets||0)-(a.cleanSheets||0)||a.id-b.id);
  const player=sorted.find(p=>p.name===name);
  const started=sorted.some(p=>(p.played||0)>0||(p.points||0)>0);
  return {
    active:true,
    started,
    position:started?sorted.findIndex(p=>p.name===name)+1:null,
    points:player?.points||0,
    goals:player?.goals||0,
    cleanSheets:player?.cleanSheets||0,
    redCards:player?.redCards||0,
    played:player?.played||0
  };
}
function profileMetrics(name){
  const h=getPlayerHistory(name);
  const first=h.filter(x=>x.division===1&&x.position!=null);
  const second=h.filter(x=>x.division===2);
  const positions=first.map(x=>x.position);
  const best=first.length?[...first].sort((a,b)=>a.position-b.position||b.points-a.points)[0]:null;
  const worst=first.length?[...first].sort((a,b)=>b.position-a.position||a.points-b.points)[0]:null;
  const avgPos=positions.length?positions.reduce((a,b)=>a+b,0)/positions.length:null;
  const bestPoints=first.length?[...first].sort((a,b)=>(b.points||0)-(a.points||0))[0]:null;
  const historicalRank=sortedGeneral('ranking').findIndex(x=>x.name===name)+1;
  return {history:h,first,second,best,worst,avgPos,bestPoints,historicalRank:historicalRank||null,current:currentStanding(name)};
}

const MANAGER_LEGACY_POSITIONS={
  DL:{label:'Delantero',short:'DL'},
  MC:{label:'Mediocampista',short:'MC'},
  DF:{label:'Defensa',short:'DF'},
  PT:{label:'Portero',short:'PT'}
};
const MANAGER_LEGACY_LINES={
  DL:'Delantera',
  MC:'Mediocampo',
  DF:'Defensa',
  PT:'Portería'
};

function managerLegacyRecord(name){
  return DATA.managerLegacies?.[name]||null;
}

function managerMean(values){
  const numbers=values.filter(Number.isFinite);
  return numbers.length?numbers.reduce((sum,value)=>sum+value,0)/numbers.length:null;
}

function managerContinuityLabel(value){
  if(value>=70)return 'Muy conservador';
  if(value>=60)return 'Conservador';
  if(value>=55)return 'Equilibrado con tendencia conservadora';
  if(value>=50)return 'Equilibrado';
  if(value>=40)return 'Rotador';
  return 'Muy rotador';
}

function managerCrackDependenceLabel(value){
  if(value<=7)return 'Juego coral';
  if(value<=9.5)return 'Dependencia controlada';
  if(value<=12)return 'Crack-dependiente';
  return 'Muy crack-dependiente';
}

function managerLineIdentity(lines){
  if(!lines.length)return 'Sin identidad definida';
  const ordered=[...lines].sort((a,b)=>b.share-a.share);
  const dominant=ordered[0];
  const spread=dominant.share-ordered[ordered.length-1].share;
  const defensive=(lines.find(line=>line.role==='DF')?.share||0)
    +(lines.find(line=>line.role==='PT')?.share||0);
  if(spread<=7)return 'Equipo coral';
  if(defensive>=55)return 'Cerrojo defensivo';
  if(dominant.role==='DL'&&dominant.share>=35)return 'Pólvora arriba';
  if(dominant.role==='DL')return 'Perfil ofensivo moderado';
  if(dominant.role==='MC')return 'El mediocampo manda';
  if(dominant.role==='DF')return 'Construcción desde atrás';
  return 'Portería determinante';
}

function managerLegacySeasonMetrics(name,record,season){
  const expected=season.expectedMatchdays||record.expectedMatchdays||38;
  const players=season.standouts||[];
  const totalReferencePoints=players.reduce((sum,player)=>sum+(player.points||0),0);
  const totalReferenceLineups=players.reduce((sum,player)=>sum+(player.lineups||0),0);
  const averageLineups=players.length?totalReferenceLineups/players.length:0;
  const continuity=Math.max(0,Math.min(100,(averageLineups/expected)*100));
  const rotation=100-continuity;
  const result=managerLegacyResult(name,season.season);
  const teamPoints=result.points||0;
  const mvpPoints=season.mvp?.points||0;
  const mvpLineups=season.mvp?.lineups||0;
  const crackDependence=teamPoints?(mvpPoints/teamPoints)*100:0;
  const crackEfficiency=mvpLineups?mvpPoints/mvpLineups:0;
  const lines=players.map(player=>({
    ...player,
    label:MANAGER_LEGACY_LINES[player.role]||player.role,
    short:MANAGER_LEGACY_POSITIONS[player.role]?.short||player.role,
    share:totalReferencePoints?((player.points||0)/totalReferencePoints)*100:0,
    efficiency:player.lineups?(player.points||0)/player.lineups:0
  }));
  const orderedLines=[...lines].sort((a,b)=>b.share-a.share);
  const dominantLine=orderedLines[0]||null;
  const weakestLine=orderedLines[orderedLines.length-1]||null;
  const balanceSpread=dominantLine&&weakestLine?dominantLine.share-weakestLine.share:0;
  return {
    season,
    expected,
    players,
    result,
    teamPoints,
    totalReferencePoints,
    totalReferenceLineups,
    averageLineups,
    continuity,
    rotation,
    style:managerContinuityLabel(continuity),
    mvpPoints,
    mvpLineups,
    crackDependence,
    crackDependenceLabel:managerCrackDependenceLabel(crackDependence),
    crackEfficiency,
    lines,
    dominantLine,
    weakestLine,
    balanceSpread,
    lineIdentity:managerLineIdentity(lines)
  };
}

function managerLegacyMetrics(name,record){
  const seasons=(record.seasons||[]).map(season=>managerLegacySeasonMetrics(name,record,season));
  const durablePlayers=seasons.flatMap(item=>(item.players||[]).map(player=>({
    name:player.name,
    role:player.role,
    points:player.points||0,
    lineups:player.lineups||0,
    season:item.season.season
  }))).sort((a,b)=>
    b.lineups-a.lineups||
    b.points-a.points||
    a.name.localeCompare(b.name,'es')
  ).slice(0,5);
  const totalReferenceLineups=seasons.reduce((sum,item)=>sum+item.totalReferenceLineups,0);
  const totalReferenceSlots=seasons.reduce((sum,item)=>sum+(item.expected*Math.max(item.players.length,1)),0);
  const continuity=totalReferenceSlots?(totalReferenceLineups/totalReferenceSlots)*100:0;
  const rotation=100-continuity;
  const totalTeamPoints=seasons.reduce((sum,item)=>sum+item.teamPoints,0);
  const totalMvpPoints=seasons.reduce((sum,item)=>sum+item.mvpPoints,0);
  const totalMvpLineups=seasons.reduce((sum,item)=>sum+item.mvpLineups,0);
  const crackDependence=totalTeamPoints?(totalMvpPoints/totalTeamPoints)*100:0;
  const crackEfficiency=totalMvpLineups?totalMvpPoints/totalMvpLineups:0;
  const roleTotals=new Map(Object.keys(MANAGER_LEGACY_POSITIONS).map(role=>[role,0]));
  seasons.forEach(item=>item.lines.forEach(line=>{
    roleTotals.set(line.role,(roleTotals.get(line.role)||0)+(line.points||0));
  }));
  const totalRolePoints=[...roleTotals.values()].reduce((sum,value)=>sum+value,0);
  const lines=[...roleTotals.entries()].map(([role,points])=>({
    role,
    label:MANAGER_LEGACY_LINES[role]||role,
    short:MANAGER_LEGACY_POSITIONS[role]?.short||role,
    points,
    share:totalRolePoints?(points/totalRolePoints)*100:0
  })).sort((a,b)=>b.share-a.share);
  const dominantLine=lines[0]||null;
  const weakestLine=lines[lines.length-1]||null;
  const balanceSpread=dominantLine&&weakestLine?dominantLine.share-weakestLine.share:0;
  const classified=seasons.filter(item=>item.result.division===1&&Number.isFinite(item.result.position));
  const conservative=classified.filter(item=>item.continuity>=60);
  const flexible=classified.filter(item=>item.continuity<60);
  const conservativeAverage=managerMean(conservative.map(item=>item.result.position));
  const flexibleAverage=managerMean(flexible.map(item=>item.result.position));
  const bestSeason=[...classified].sort((a,b)=>a.result.position-b.result.position||b.teamPoints-a.teamPoints)[0]||null;
  let resultTitle='Aún no hay suficiente muestra';
  let resultText='Se necesitan temporadas con distintos niveles de continuidad para detectar qué modelo ha rendido mejor.';
  if(conservativeAverage!=null&&flexibleAverage!=null){
    const advantage=flexibleAverage-conservativeAverage;
    if(advantage>=1){
      resultTitle='La base estable ha rendido mejor';
      resultText=`Con 60% o más de continuidad terminó en promedio ${conservativeAverage.toFixed(1)}º; con una base más flexible, ${flexibleAverage.toFixed(1)}º.`;
    }else if(advantage<=-1){
      resultTitle='Los ajustes frecuentes han rendido mejor';
      resultText=`Con una base más flexible terminó en promedio ${flexibleAverage.toFixed(1)}º; con 60% o más de continuidad, ${conservativeAverage.toFixed(1)}º.`;
    }else{
      resultTitle='Los dos modelos han rendido parecido';
      resultText=`La diferencia entre un bloque conservador y uno más flexible es de solo ${Math.abs(advantage).toFixed(1)} posiciones de promedio.`;
    }
  }
  const bestSeasonNote=bestSeason
    ?`Su mejor campaña fue ${bestSeason.season.season}: ${bestSeason.result.result}, con ${bestSeason.continuity.toFixed(0)}% de continuidad.`
    :'';
  return {
    seasons,
    durablePlayers,
    mostDurable:durablePlayers[0]||null,
    continuity,
    rotation,
    style:managerContinuityLabel(continuity),
    totalTeamPoints,
    totalMvpPoints,
    totalMvpLineups,
    crackDependence,
    crackDependenceLabel:managerCrackDependenceLabel(crackDependence),
    crackEfficiency,
    lines,
    dominantLine,
    weakestLine,
    balanceSpread,
    lineIdentity:managerLineIdentity(lines),
    conservativeAverage,
    flexibleAverage,
    conservativeCount:conservative.length,
    flexibleCount:flexible.length,
    bestSeason,
    resultTitle,
    resultText,
    bestSeasonNote
  };
}

function managerLineDistributionMarkup(lines,label){
  return `<div class="manager-style-line-bar" role="img" aria-label="${profileAttr(label)}">
    ${lines.map(line=>`<span class="manager-style-line-segment manager-style-line-${line.role.toLowerCase()}" style="width:${line.share.toFixed(2)}%" title="${line.label}: ${line.share.toFixed(1)}%"></span>`).join('')}
  </div>
  <div class="manager-style-line-legend">
    ${lines.map(line=>`<div><span class="manager-style-line-dot manager-style-line-${line.role.toLowerCase()}"></span><small>${line.short}</small><b>${line.share.toFixed(1)}%</b></div>`).join('')}
  </div>`;
}

function managerStyleCardMarkup(name,metrics){
  const pointsPerCrack=Math.max(1,Math.round(100/Math.max(metrics.crackDependence,.1)));
  return `<div class="manager-style-dashboard">
    <article class="manager-style-identity-card">
      <div class="manager-style-identity-top">
        <div><span class="eyebrow">CARTA DE ESTILO</span><h4>${metrics.style}</h4></div>
        <span class="manager-style-season-pill">${metrics.seasons.length} temporadas</span>
      </div>
      <p>${name} presenta un <b>${metrics.continuity.toFixed(0)}% de continuidad</b> en sus referentes y una rotación estimada del <b>${metrics.rotation.toFixed(0)}%</b>.</p>
      <div class="manager-style-tug" aria-label="${metrics.continuity.toFixed(0)}% continuidad y ${metrics.rotation.toFixed(0)}% rotación estimada">
        <span style="width:${metrics.continuity}%"><b>${metrics.continuity.toFixed(0)}%</b><small>continuidad</small></span>
        <span style="width:${metrics.rotation}%"><b>${metrics.rotation.toFixed(0)}%</b><small>rotación</small></span>
      </div>
    </article>

    <div class="manager-style-stat-grid">
      <article>
        <span>${uiIcon('star')}</span>
        <small>Dependencia del crack</small>
        <b>${metrics.crackDependence.toFixed(1)}%</b>
        <p>${metrics.crackDependenceLabel}</p>
        <em>≈ 1 de cada ${pointsPerCrack} puntos</em>
      </article>
      <article>
        <span>${uiIcon('ball')}</span>
        <small>Rentabilidad del crack</small>
        <b>${metrics.crackEfficiency.toFixed(1)}</b>
        <p>puntos por alineación</p>
        <em>${metrics.totalMvpPoints} pts en ${metrics.totalMvpLineups} alineaciones</em>
      </article>
      <article>
        <span>${uiIcon('chart')}</span>
        <small>Identidad por líneas</small>
        <b>${metrics.dominantLine?.share.toFixed(1)||'0.0'}%</b>
        <p>${metrics.dominantLine?.label||'Sin dato'}</p>
        <em>${metrics.lineIdentity}</em>
      </article>
    </div>

    <div class="manager-style-lower-grid">
      <article class="manager-style-lines-card">
        <div><span class="eyebrow">REPARTO DE LOS REFERENTES</span><h4>De dónde llegan los puntos</h4></div>
        ${managerLineDistributionMarkup(metrics.lines,`Reparto histórico: ${metrics.lines.map(line=>`${line.label} ${line.share.toFixed(1)}%`).join(', ')}`)}
        <p>Compara el peso de los referentes de portería, defensa, mediocampo y delantera.</p>
      </article>
      <article class="manager-style-result-card">
        <span class="eyebrow">QUÉ MODELO LE HA FUNCIONADO</span>
        <h4>${metrics.resultTitle}</h4>
        <p>${metrics.resultText}</p>
        <strong>${metrics.bestSeasonNote}</strong>
        <small>Tendencia histórica orientativa; no implica que un estilo garantice el resultado.</small>
      </article>
    </div>
  </div>`;
}

function managerIronMenMarkup(metrics){
  if(!metrics.durablePlayers.length)return '';
  return `<article class="manager-iron-card">
    <div class="manager-iron-head">
      <div><span class="eyebrow">HOMBRES DE HIERRO</span><h4>Los más alineados por el míster</h4></div>
      <span>Máximo en una temporada</span>
    </div>
    <div class="manager-iron-list">
      ${metrics.durablePlayers.map((player,index)=>`<div class="manager-iron-row${index===0?' is-leader':''}">
        <span class="manager-iron-rank">${index+1}</span>
        <div class="manager-iron-player">
          <b>${player.name}</b>
          <small>${MANAGER_LEGACY_POSITIONS[player.role]?.short||player.role} · ${player.season}</small>
        </div>
        <strong>${player.lineups}<small>jornadas</small></strong>
      </div>`).join('')}
    </div>
    <p>Ranking de los referentes registrados. La cifra indica cuántas jornadas fueron alineados en esa campaña; no tiene que ser una racha consecutiva.</p>
  </article>`;
}

function managerComparisonResultMarkup(primaryName,secondaryName){
  const primaryRecord=managerLegacyRecord(primaryName);
  const secondaryRecord=managerLegacyRecord(secondaryName);
  if(!primaryRecord||!secondaryRecord)return '';
  const a=managerLegacyMetrics(primaryName,primaryRecord);
  const b=managerLegacyMetrics(secondaryName,secondaryRecord);
  const moreConservative=a.continuity===b.continuity?'Empate':a.continuity>b.continuity?primaryName:secondaryName;
  const lessDependent=a.crackDependence===b.crackDependence?'Empate':a.crackDependence<b.crackDependence?primaryName:secondaryName;
  const moreEfficient=a.crackEfficiency===b.crackEfficiency?'Empate':a.crackEfficiency>b.crackEfficiency?primaryName:secondaryName;
  const moreBalanced=a.balanceSpread===b.balanceSpread?'Empate':a.balanceSpread<b.balanceSpread?primaryName:secondaryName;
  const aDurable=a.mostDurable;
  const bDurable=b.mostDurable;
  const aDurableStat=aDurable?`${aDurable.lineups}<small>${aDurable.name}</small>`:'—';
  const bDurableStat=bDurable?`${bDurable.lineups}<small>${bDurable.name}</small>`:'—';
  const durableLeader=(!aDurable&&!bDurable)
    ?'Sin datos'
    :(aDurable?.lineups||0)===(bDurable?.lineups||0)
      ?`Empate: ${aDurable?.name||'—'} y ${bDurable?.name||'—'} (${aDurable?.lineups||0})`
      :(aDurable?.lineups||0)>(bDurable?.lineups||0)
        ?`${primaryName}: ${aDurable.name} (${aDurable.lineups})`
        :`${secondaryName}: ${bDurable.name} (${bDurable.lineups})`;
  return `<div class="manager-duel-scoreboard">
    <div class="manager-duel-names"><b>${primaryName}</b><span>VS</span><b>${secondaryName}</b></div>
    <div class="manager-duel-table">
      <div><strong>${a.continuity.toFixed(0)}%</strong><span>Continuidad</span><strong>${b.continuity.toFixed(0)}%</strong></div>
      <div><strong>${a.rotation.toFixed(0)}%</strong><span>Rotación estimada</span><strong>${b.rotation.toFixed(0)}%</strong></div>
      <div><strong>${a.crackDependence.toFixed(1)}%</strong><span>Dependencia del crack</span><strong>${b.crackDependence.toFixed(1)}%</strong></div>
      <div><strong>${a.crackEfficiency.toFixed(1)}</strong><span>Pts/alineación del crack</span><strong>${b.crackEfficiency.toFixed(1)}</strong></div>
      <div><strong>${a.balanceSpread.toFixed(1)} pp</strong><span>Desnivel entre líneas</span><strong>${b.balanceSpread.toFixed(1)} pp</strong></div>
      <div><strong>${aDurableStat}</strong><span>Máximo de jornadas</span><strong>${bDurableStat}</strong></div>
    </div>
    <div class="manager-duel-verdicts">
      <span>Más conservador <b>${moreConservative}</b></span>
      <span>Menos crack-dependiente <b>${lessDependent}</b></span>
      <span>Crack más rentable <b>${moreEfficient}</b></span>
      <span>Más equilibrado <b>${moreBalanced}</b></span>
      <span>Jugador más duradero <b>${durableLeader}</b></span>
    </div>
  </div>`;
}

function managerDuelMarkup(name){
  const available=Object.keys(DATA.managerLegacies||{}).filter(manager=>manager!==name);
  if(!available.length){
    return `<article class="manager-duel-card manager-duel-card-empty">
      <div><span class="eyebrow">DUELO DE BANQUILLOS</span><h4>Comparador preparado</h4></div>
      <p>Se activará automáticamente cuando exista la carta de estilo de un segundo míster.</p>
      <span>${uiIcon('users')} Próximo rival pendiente</span>
    </article>`;
  }
  const selected=available[0];
  return `<article class="manager-duel-card">
    <div class="manager-duel-head">
      <div><span class="eyebrow">DUELO DE BANQUILLOS</span><h4>Compara estilos</h4></div>
      <label><span>Rival</span><select data-manager-compare-select data-manager-primary="${profileAttr(name)}">${available.map(manager=>`<option value="${profileAttr(manager)}">${manager}</option>`).join('')}</select></label>
    </div>
    <div id="managerDuelResult" aria-live="polite">${managerComparisonResultMarkup(name,selected)}</div>
  </article>`;
}

function renderManagerComparison(primaryName,secondaryName){
  const host=$('managerDuelResult');
  if(!host)return;
  host.innerHTML=managerComparisonResultMarkup(primaryName,secondaryName);
}

function managerLegacyResult(name,season){
  const historical=getPlayerHistory(name).find(entry=>entry.season===season);
  if(!historical)return {result:'Sin dato',points:null,position:null,division:null};
  return {
    result:historical.division===1?ordinal(historical.position):historyResult(historical),
    points:historical.points,
    position:historical.position,
    division:historical.division
  };
}

function managerLegacySeasonMarkup(name,record,season){
  const metrics=managerLegacySeasonMetrics(name,record,season);
  const result=metrics.result;
  const mvp=season.mvp||{};
  const mvpPosition=MANAGER_LEGACY_POSITIONS[mvp.role]?.label||'Jugador';
  const pointsPerCrack=Math.max(1,Math.round(100/Math.max(metrics.crackDependence,.1)));
  return `<div class="manager-legacy-season-head">
      <div>
        <span class="eyebrow">TEMPORADA ${season.season}</span>
        <h4>${metrics.style}</h4>
      </div>
      <div class="manager-legacy-season-result">
        <span>Resultado del equipo</span>
        <b>${result.result}</b>
        <small>${result.points!=null?`${result.points.toLocaleString()} puntos`:'Sin puntuación registrada'}</small>
      </div>
    </div>
    <div class="manager-season-style-grid">
      <article class="manager-season-style-main">
        <span class="eyebrow">GESTIÓN DE LOS REFERENTES</span>
        <div class="manager-season-style-numbers">
          <div><b>${metrics.continuity.toFixed(0)}%</b><span>continuidad</span></div>
          <div><b>${metrics.rotation.toFixed(0)}%</b><span>rotación estimada</span></div>
        </div>
        <p>Los referentes de las cuatro líneas promediaron <b>${metrics.averageLineups.toFixed(1)}</b> alineaciones sobre ${metrics.expected} jornadas.</p>
      </article>
      <article class="manager-season-crack-card">
        <div><span class="manager-legacy-award">CRACK</span><small>${mvpPosition}</small></div>
        <h4>${mvp.name}</h4>
        <div class="manager-season-crack-stats">
          <div><b>${mvp.points}</b><span>puntos</span></div>
          <div><b>${metrics.crackDependence.toFixed(1)}%</b><span>del equipo</span></div>
          <div><b>${metrics.crackEfficiency.toFixed(1)}</b><span>pts/alineación</span></div>
        </div>
        <p>${metrics.crackDependenceLabel}: aproximadamente 1 de cada ${pointsPerCrack} puntos del equipo.</p>
      </article>
    </div>
    <div class="manager-season-lines-head">
      <div><span class="eyebrow">CUATRO LÍNEAS</span><h4>${metrics.lineIdentity}</h4></div>
      <small>Porcentaje sobre los puntos de los cuatro referentes</small>
    </div>
    <div class="manager-season-lines-grid">
      ${metrics.lines.map(line=>`<article class="manager-season-line-card manager-season-line-${line.role.toLowerCase()}${line.name===mvp.name?' is-mvp':''}">
        <div><span>${line.short}</span><small>${line.name===mvp.name?'MVP':line.label}</small></div>
        <h5>${line.name}</h5>
        <strong>${line.share.toFixed(1)}%<small>del núcleo</small></strong>
        <div class="manager-season-line-meter"><span style="width:${line.share}%"></span></div>
        <p><b>${line.points}</b> pts · <b>${line.lineups}</b> alineaciones · <b>${line.efficiency.toFixed(1)}</b> pts/al.</p>
      </article>`).join('')}
    </div>`;
}

function managerLegacyMarkup(name){
  const record=managerLegacyRecord(name);
  if(!record?.seasons?.length)return '';
  const metrics=managerLegacyMetrics(name,record);
  const selected=record.seasons[record.seasons.length-1];
  return `<section class="manager-board-shell" data-manager-board-name="${profileAttr(name)}">
    <button type="button" class="manager-board-toggle" aria-expanded="false" aria-controls="managerBoardPanel" data-manager-board-toggle>
      <span class="manager-board-toggle-icon">${uiIcon('ball')}</span>
      <span class="manager-board-toggle-copy">
        <small>ESTILO DEL EQUIPO</small>
        <strong>La Pizarra del Míster</strong>
        <span>Estilo, dependencia del crack, hombres de hierro y comparación</span>
      </span>
      <span class="manager-board-toggle-summary">
        <b>${metrics.continuity.toFixed(0)}%</b>
        <small>continuidad</small>
        <em data-manager-board-action>Abrir análisis</em>
      </span>
      <span class="manager-board-toggle-chevron" aria-hidden="true">⌄</span>
    </button>

    <div id="managerBoardPanel" class="manager-board-panel" data-manager-board-panel hidden>
      <section class="profile-section manager-legacy-section" data-manager-legacy-name="${profileAttr(name)}">
        <div class="profile-section-head manager-legacy-heading">
          <div>
            <span class="eyebrow">LA PIZARRA DEL MÍSTER</span>
            <h3>El estilo de ${name}, en números</h3>
            <p>Una lectura sencilla de continuidad, rotación estimada, dependencia del crack, jugadores más alineados y reparto de puntos por líneas.</p>
          </div>
          <span class="manager-legacy-season-count">${record.seasons.length} temporadas</span>
        </div>

        ${managerStyleCardMarkup(name,metrics)}
        ${managerIronMenMarkup(metrics)}
        ${managerDuelMarkup(name)}

        <div class="manager-legacy-season-nav">
          <div><span class="eyebrow">TEMPORADA A TEMPORADA</span><h4>Cómo cambió el estilo</h4></div>
          <div class="manager-legacy-tabs" role="tablist" aria-label="Temporadas analizadas de ${name}">
            ${record.seasons.map(season=>`<button type="button" class="manager-legacy-season-tab${season.season===selected.season?' is-active':''}" role="tab" aria-selected="${season.season===selected.season?'true':'false'}" data-manager-legacy-season="${season.season}" data-manager-legacy-manager="${profileAttr(name)}">${season.season.slice(2)}</button>`).join('')}
          </div>
        </div>
        <div id="managerLegacyDetail" class="manager-legacy-detail" role="tabpanel" aria-live="polite">
          ${managerLegacySeasonMarkup(name,record,selected)}
        </div>
        <p class="manager-legacy-method"><b>Cómo se calcula:</b> la continuidad usa las alineaciones de los referentes PT, DF, MC y DL sobre las jornadas posibles; la rotación estimada es su complemento. La dependencia del crack compara los puntos del MVP con todos los puntos del equipo en esa temporada. Es una tendencia general basada en los datos disponibles, no un registro completo de cada cambio de plantilla.</p>
        <button type="button" class="manager-board-close" data-manager-board-close>Ocultar la pizarra</button>
      </section>
    </div>
  </section>`;
}

function toggleManagerBoard(button,forceExpanded){
  const shell=button?.closest('.manager-board-shell');
  const panel=shell?.querySelector('[data-manager-board-panel]');
  if(!shell||!panel)return;
  const expanded=forceExpanded??button.getAttribute('aria-expanded')!=='true';
  const name=shell.dataset.managerBoardName||'este míster';
  button.setAttribute('aria-expanded',expanded?'true':'false');
  button.setAttribute('aria-label',`${expanded?'Cerrar':'Abrir'} la Pizarra del Míster de ${name}`);
  shell.classList.toggle('is-open',expanded);
  panel.hidden=!expanded;
  const action=button.querySelector('[data-manager-board-action]');
  if(action)action.textContent=expanded?'Cerrar análisis':'Abrir análisis';
}

function closeManagerBoard(button){
  const shell=button?.closest('.manager-board-shell');
  const toggle=shell?.querySelector('[data-manager-board-toggle]');
  if(!toggle)return;
  toggleManagerBoard(toggle,false);
  toggle.focus({preventScroll:true});
  toggle.scrollIntoView({
    behavior:prefersReducedMotion()?'auto':'smooth',
    block:'center'
  });
}

function selectManagerLegacySeason(name,seasonName){
  const record=managerLegacyRecord(name);
  const season=record?.seasons?.find(item=>item.season===seasonName);
  const host=$('managerLegacyDetail');
  if(!record||!season||!host)return;
  document.querySelectorAll('[data-manager-legacy-season]').forEach(button=>{
    const active=button.dataset.managerLegacySeason===seasonName;
    button.classList.toggle('is-active',active);
    button.setAttribute('aria-selected',active?'true':'false');
  });
  host.classList.remove('is-changing');
  void host.offsetWidth;
  host.innerHTML=managerLegacySeasonMarkup(name,record,season);
  host.classList.add('is-changing');
}

function historyResult(entry){
  if(entry.division===1&&entry.position===1)return 'Campeón';
  if(entry.division===1)return ordinal(entry.position);
  if(entry.division===2)return '2ª Div.';
  return 'Sin dato';
}
function buildJourney(history){
  if(!history.length)return '<div class="profile-no-data">Sin temporadas históricas registradas.</div>';
  return `<div class="profile-journey-scroll"><div class="profile-journey" role="list" aria-label="Recorrido histórico por temporada">${history.map((entry,index)=>{
    const status=entry.division===1?(entry.position===1?' champion':''):(entry.division===2?' second':' missing');
    return `<div class="profile-journey-step${status}" role="listitem">
      <small>${entry.season}</small>
      <b>${historyResult(entry)}</b>
      <span>${entry.points!=null?entry.points.toLocaleString()+' pts':entry.division===2?'Segunda División':'Sin clasificación'}</span>
    </div>${index<history.length-1?'<span class="profile-journey-arrow" aria-hidden="true">→</span>':''}`;
  }).join('')}</div></div>`;
}
function buildEvolutionSVG(history){
  const first=history.filter(x=>x.division===1&&x.position!=null);
  if(!first.length)return `<div class="profile-no-data">Sin temporadas en Primera División para graficar.</div>`;
  const W=Math.max(720,history.length*112),H=300,padL=46,padR=24,padT=30,padB=72;
  const maxPos=20;
  const x=(i)=>history.length===1?(W/2):padL+i*((W-padL-padR)/(history.length-1));
  const y=(p)=>padT+((p-1)/(maxPos-1))*(H-padT-padB);
  const grid=[1,5,10,15,20].filter(v=>v<=maxPos).map(v=>{
    const yy=y(v);return `<line x1="${padL}" y1="${yy}" x2="${W-padR}" y2="${yy}" class="evo-grid"/><text x="8" y="${yy+4}" class="evo-axis">${v}º</text>`
  }).join('');
  const firstPoints=history.map((d,i)=>({d,i})).filter(x=>x.d.division===1&&x.d.position!=null);
  const lines=firstPoints.slice(1).map((point,index)=>{
    const previous=firstPoints[index];
    const hasGap=point.i-previous.i>1;
    return `<line x1="${x(previous.i)}" y1="${y(previous.d.position)}" x2="${x(point.i)}" y2="${y(point.d.position)}" class="evo-line${hasGap?' evo-line-gap':''}"/>`;
  }).join('');
  const labels=history.map((d,i)=>`<text x="${x(i)}" y="${H-14}" text-anchor="middle" class="evo-label">${d.season.slice(2)}</text>`).join('');
  const marks=history.map((d,i)=>{
    if(d.division===1&&d.position!=null)return `<circle cx="${x(i)}" cy="${y(d.position)}" r="7" class="evo-dot"><title>${d.season}: ${d.position}º · ${(d.points||0).toLocaleString()} puntos</title></circle><text x="${x(i)}" y="${y(d.position)-13}" text-anchor="middle" class="evo-value">${d.position}º</text>`;
    if(d.division===2)return `<rect x="${x(i)-18}" y="${H-61}" width="36" height="22" rx="8" class="evo-second-marker"><title>${d.season}: Segunda División</title></rect><text x="${x(i)}" y="${H-46}" text-anchor="middle" class="evo-second-text">2ª</text>`;
    return `<circle cx="${x(i)}" cy="${H-50}" r="4" class="evo-missing"><title>${d.season}: sin datos</title></circle>`;
  }).join('');
  return `<div class="evolution-chart-scroll"><svg class="evolution-chart" viewBox="0 0 ${W} ${H}" style="min-width:${W}px" role="img" aria-label="Gráfica de evolución histórica de posiciones. Primera posición arriba y Segunda División indicada debajo.">${grid}${lines}${marks}${labels}</svg></div>`;
}
let profileReturnFocus=null;
function syncModalLock(){
  const anyOpen=['playerModal','installModal'].some(id=>$(id)&&!$(id).hidden);
  document.body.classList.toggle('modal-open',anyOpen);
}
function closePlayer(){
  const modal=$('playerModal');
  if(modal.hidden)return;
  modal.hidden=true;
  syncModalLock();
  profileReturnFocus?.focus?.();
}
function openPlayer(name){
  const p=DATA.participants.find(x=>x.name===name);
  if(!p)return;
  const returnFocus=document.activeElement;
  profileReturnFocus=returnFocus?.id==='achievementUnlockToast'
    ?document.querySelector('.navtab.active')
    :returnFocus;
  dismissAchievementToast();
  const s=statMap()[name]||{};
  const m=profileMetrics(name);
  const seasonRows=m.history.map(x=>{
    const isWinner=x.division===1&&x.position===1;
    const rowClass=isWinner?' profile-season-champion':x.division===2?' profile-season-second':x.division===null?' profile-season-missing':'';
    return `<div class="profile-season-row${rowClass}">
      <span>${x.season}</span>
      <b>${isWinner?'🏆 Campeón':historyResult(x)}</b>
      <span>${x.points!=null?x.points.toLocaleString()+' pts':'—'}</span>
    </div>`
  }).join('');
  const currentLabel=!m.current.active?'No participa':m.current.started?`${ordinal(m.current.position)} puesto`:'Sin comenzar';
  const achievements=playerAchievementState(name);
  const earnedAchievements=achievements.filter(item=>item.earned);
  const achievementPercent=Math.round((earnedAchievements.length/ACHIEVEMENT_CATALOG.length)*100);
  $('modalContent').innerHTML=`
    <section class="profile-hero">
      <img src="${p.shield}" class="profile-avatar" alt="Foto de ${name}">
      <div class="profile-identity">
        <span class="eyebrow">${s.label||'PARTICIPANTE'}</span>
        <h2 id="profileTitle">${name}</h2>
        <p>${s.description||'Historial de la Cuban League.'}</p>
      </div>
    </section>

    <section class="profile-current-card">
      <div><span>Temporada ${DATA.currentSeason}</span><b>${currentLabel}</b></div>
      <div><span>Jornadas</span><b>${m.current.played}</b></div>
      <div><span>Puntos</span><b>${m.current.points.toLocaleString()}</b></div>
      <div><span>Goles</span><b>${m.current.goals}</b></div>
      <div><span>Clean sheets</span><b>${m.current.cleanSheets}</b></div>
      <div class="profile-current-red"><span>Tarjetas rojas</span><b>${m.current.redCards}</b></div>
      <div><span>Ranking histórico</span><b>${m.historicalRank?`#${m.historicalRank}`:'—'}</b></div>
    </section>

    <section class="profile-major-stats">
      <article><b>${s.titles||0}</b><span>Títulos</span></article>
      <article><b>${s.seconds||0}</b><span>Subcampeonatos</span></article>
      <article><b>${s.podiums||0}</b><span>Podios</span></article>
      <article><b>${s.points?.toLocaleString()||0}</b><span>Puntos históricos</span></article>
    </section>

    ${managerLegacyMarkup(name)}

    <section class="profile-section profile-achievements-section">
      <div class="profile-section-head achievement-profile-head">
        <div><span class="eyebrow">VITRINA PERSONAL</span><h3>Insignias por logros</h3><p>Los premios se actualizan automáticamente con cada jornada publicada.</p></div>
        <div class="profile-achievement-count"><b>${earnedAchievements.length}<span>/${ACHIEVEMENT_CATALOG.length}</span></b><small>conseguidas</small></div>
      </div>
      <div class="profile-achievement-progress" role="progressbar" aria-label="Progreso de insignias" aria-valuemin="0" aria-valuemax="${ACHIEVEMENT_CATALOG.length}" aria-valuenow="${earnedAchievements.length}">
        <span style="width:${achievementPercent}%"></span>
      </div>
      <div class="profile-achievement-grid">
        ${achievements.map(item=>`<article class="profile-achievement-card achievement-${item.rarity} achievement-${item.id}${item.earned?' is-earned':' is-locked'}" data-achievement-id="${item.id}">
          <div class="profile-achievement-card-top">
            <span class="profile-achievement-icon" aria-hidden="true">${item.icon}</span>
            <span class="profile-achievement-status">${item.earned?'DESBLOQUEADA':'BLOQUEADA'}</span>
          </div>
          <small>${item.type}</small>
          <h4>${item.name}</h4>
          <p>${item.requirement}</p>
          ${item.earned||item.progress?`<span class="profile-achievement-detail">${profileAttr(item.detail)}</span>`:''}
        </article>`).join('')}
      </div>
    </section>

    <section class="profile-section">
      <div class="profile-section-head"><div><span class="eyebrow">TRAYECTORIA</span><h3>Evolución por temporada</h3></div></div>
      ${buildJourney(m.history)}
      <div class="profile-chart-note">1º aparece arriba. Las líneas discontinuas indican temporadas intermedias en 2ª División.</div>
      ${buildEvolutionSVG(m.history)}
    </section>

    <section class="profile-detail-grid">
      <article><span>Mejor temporada</span><b>${m.best?`${m.best.season} · ${ordinal(m.best.position)}`:'—'}</b><small>${m.best?.points!=null?m.best.points.toLocaleString()+' pts':''}</small></article>
      <article><span>Peor temporada en 1ª</span><b>${m.worst?`${m.worst.season} · ${ordinal(m.worst.position)}`:'—'}</b><small>${m.worst?.points!=null?m.worst.points.toLocaleString()+' pts':''}</small></article>
      <article><span>Promedio de posición</span><b>${m.avgPos?m.avgPos.toFixed(1)+'º':'—'}</b><small>Solo temporadas en 1ª</small></article>
      <article><span>Mayor puntuación</span><b>${m.bestPoints?.points!=null?m.bestPoints.points.toLocaleString():'—'}</b><small>${m.bestPoints?.season||'Puntos en una temporada'}</small></article>
      <article><span>Temporadas en 1ª</span><b>${m.first.length}</b><small>De ${m.history.length} temporadas históricas</small></article>
      <article><span>Temporadas en 2ª</span><b>${m.second.length}</b><small>Registro histórico</small></article>
      <article><span>Terceros lugares</span><b>${s.thirds||0}</b><small>Podios de bronce</small></article>
      <article><span>Top 5</span><b>${s.top5||0}</b><small>Acumulado histórico</small></article>
    </section>

    <section class="profile-section">
      <div class="profile-section-head"><div><span class="eyebrow">ARCHIVO</span><h3>Temporada por temporada</h3></div></div>
      <div class="profile-season-table">
        <div class="profile-season-head"><span>Temporada</span><span>Resultado</span><span>Puntos</span></div>
        ${seasonRows}
      </div>
    </section>`;
  $('playerModal').hidden=false;
  syncModalLock();
  requestAnimationFrame(()=>{
    animateProfileAchievementUnlocks();
    $('closeModal').focus();
  });
}

let evolutionSelected=[];
const EVOLUTION_COLORS=['#42d8d1','#f4c651','#7f8cff','#ff7c91','#9be36d','#df8cff','#ff9f43','#4dabf7'];

function initHistoricalEvolution(){
  const picker=$('evolutionPlayerPicker');
  if(!picker)return;
  if(!evolutionSelected.length){
    evolutionSelected=(DATA.historicalStats||[]).slice(0,4).map(x=>x.name);
  }
  picker.innerHTML=DATA.participants.map(p=>`
    <button class="evolution-player-chip ${evolutionSelected.includes(p.name)?'selected':''}" data-evo-player="${p.name}">
      <img src="${p.shield}" alt=""><span>${p.name}</span>
    </button>`).join('');
  picker.querySelectorAll('[data-evo-player]').forEach(btn=>btn.onclick=()=>{
    const name=btn.dataset.evoPlayer;
    if(evolutionSelected.includes(name)){
      evolutionSelected=evolutionSelected.filter(x=>x!==name);
    }else{
      if(evolutionSelected.length>=6){alert('Puedes comparar hasta 6 competidores a la vez.');return;}
      evolutionSelected.push(name);
    }
    initHistoricalEvolution();
  });
  const clear=$('clearEvolutionPlayers');
  if(clear)clear.onclick=()=>{evolutionSelected=[];initHistoricalEvolution()};
  renderHistoricalEvolutionChart();
}

function renderHistoricalEvolutionChart(){
  const host=$('historicalEvolutionChart');
  if(!host)return;
  const archive=(DATA.historicalTables?.seasonArchive||[]).filter(s=>s.season!=='2026/27');
  if(!evolutionSelected.length){
    host.innerHTML='<div class="evolution-empty">Selecciona al menos un competidor para crear la gráfica.</div>';
    return;
  }

  const W=Math.max(760,archive.length*120), H=430, L=58, R=28, T=35, B=78;
  const maxPos=20;
  const x=i=>archive.length===1?W/2:L+i*((W-L-R)/(archive.length-1));
  const y=p=>T+((p-1)/(maxPos-1))*(H-T-B);

  const grid=[1,5,10,15,20].map(v=>{
    const yy=y(v);
    return `<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" class="hist-grid"/>
      <text x="${L-12}" y="${yy+4}" text-anchor="end" class="hist-axis">${v}º</text>`;
  }).join('');

  const seasons=archive.map((s,i)=>`<text x="${x(i)}" y="${H-42}" text-anchor="middle" class="hist-season">${s.season}</text>`).join('');

  let series='';
  evolutionSelected.forEach((name,idx)=>{
    const color=EVOLUTION_COLORS[idx%EVOLUTION_COLORS.length];
    const points=[];
    const marks=[];
    archive.forEach((s,i)=>{
      const row=(s.results||[]).find(r=>r.name===name);
      if(row&&row.division===1&&row.position!=null){
        points.push(`${x(i)},${y(row.position)}`);
        marks.push(`<circle cx="${x(i)}" cy="${y(row.position)}" r="6" fill="${color}" class="hist-dot">
          <title>${name} · ${s.season}: ${row.position}º</title></circle>
          <text x="${x(i)}" y="${y(row.position)-10}" text-anchor="middle" fill="${color}" class="hist-value">${row.position}º</text>`);
      }else if(row&&row.division===2){
        marks.push(`<text x="${x(i)}" y="${H-18}" text-anchor="middle" fill="${color}" class="hist-second">2ª</text>`);
      }
    });
    if(points.length>1)series+=`<polyline points="${points.join(' ')}" fill="none" stroke="${color}" class="hist-line"/>`;
    series+=marks.join('');
  });

  const legend=evolutionSelected.map((name,idx)=>{
    const p=DATA.participants.find(x=>x.name===name);
    const color=EVOLUTION_COLORS[idx%EVOLUTION_COLORS.length];
    return `<div class="hist-legend-item"><span class="hist-color" style="background:${color}"></span><img src="${p?.shield||''}" alt=""><b>${playerInline(name)}</b></div>`;
  }).join('');

  host.innerHTML=`<div class="hist-legend">${legend}</div>
    <div class="hist-svg-scroll">
      <svg viewBox="0 0 ${W} ${H}" style="min-width:${W}px" class="historical-svg" role="img" aria-label="Comparación histórica de posiciones">
        ${grid}${series}${seasons}
      </svg>
    </div>`;
}
function recordPresentation(title){
  if(/títulos|podios|top 5/i.test(title))return {label:'Palmarés',icon:'trophy',tone:'honours'};
  if(/puntos|promedio/i.test(title))return {label:'Rendimiento',icon:'chart',tone:'performance'};
  return {label:'Trayectoria',icon:'calendar',tone:'career'};
}

function recordUnit(title){
  const units={
    'Más títulos':'títulos',
    'Más podios':'podios',
    'Más puntos acumulados':'puntos',
    'Más puntos en una temporada':'puntos',
    'Mejor promedio':'pts / temporada',
    'Más temporadas':'temporadas',
    'Más Top 5':'veces'
  };
  return units[title]||'marca';
}

function singleSeasonPointsRecord(){
  const performances=(DATA.historicalTables?.seasonArchive||[]).flatMap(season=>
    (season.results||[])
      .filter(result=>result.division===1&&typeof result.points==='number'&&Number.isFinite(result.points))
      .map(result=>({
        name:result.name,
        points:Number(result.points),
        season:season.season
      }))
  );
  if(!performances.length)return null;

  const maximum=Math.max(...performances.map(result=>result.points));
  const leaders=performances.filter(result=>result.points===maximum);
  return {
    title:'Más puntos en una temporada',
    player:[...new Set(leaders.map(result=>result.name))].join(' / '),
    value:maximum.toLocaleString('en-US'),
    season:[...new Set(leaders.map(result=>result.season))].join(' / ')
  };
}

function officialRecords(){
  const records=DATA.records.filter(record=>record.title!=='Más puntos en una temporada').map(record=>({...record}));
  const singleSeason=singleSeasonPointsRecord();
  if(!singleSeason)return records;
  const accumulatedIndex=records.findIndex(record=>record.title==='Más puntos acumulados');
  records.splice(accumulatedIndex>=0?accumulatedIndex+1:records.length,0,singleSeason);
  return records;
}

function renderRecords(){
  const records=officialRecords();
  const completedSeasons=(DATA.historicalTables?.seasonArchive||[]).filter(season=>season.results?.length).length;
  $('recordsMeta').innerHTML=`
    <article><span class="records-meta-icon">${uiIcon('trophy')}</span><div><b>${records.length}</b><small>Marcas oficiales</small></div></article>
    <article><span class="records-meta-icon">${uiIcon('calendar')}</span><div><b>${completedSeasons}</b><small>Temporadas analizadas</small></div></article>
    <article><span class="records-meta-icon">${uiIcon('users')}</span><div><b>${DATA.participants.length}</b><small>Perfiles históricos</small></div></article>`;

  $('recordGrid').innerHTML=records.map((record,index)=>{
    const category=recordPresentation(record.title);
    return `<article class="record-entry record-${category.tone}">
      <div class="record-entry-head">
        <span class="record-order">${String(index+1).padStart(2,'0')}</span>
        <span class="record-category">${uiIcon(category.icon)}${category.label}</span>
      </div>
      <div class="record-entry-body">
        <div class="record-entry-copy">
          <span class="record-entry-label">${record.title}</span>
          <div class="record-holder">${playerInline(record.player)}</div>
        </div>
        <div class="record-value"><b>${record.value}</b><small>${recordUnit(record.title)}</small>${record.season?`<span class="record-season">${uiIcon('calendar')} ${record.season}</span>`:''}</div>
      </div>
    </article>`;
  }).join('');

  $('awardGrid').innerHTML=DATA.awards.map((award,index)=>`<article class="hall-entry">
    <div class="hall-entry-side"><span class="hall-order">${String(index+1).padStart(2,'0')}</span><span class="hall-icon">${uiIcon('star')}</span></div>
    <div class="hall-entry-copy">
      <span class="hall-kicker">RECONOCIMIENTO HISTÓRICO</span>
      <h3>${award.title}</h3>
      <div class="hall-holder">${playerInline(award.player)}</div>
      <p>${award.text}</p>
    </div>
  </article>`).join('');
}
function championsGroupStandings(group){
  const rowMap=new Map(CHAMPIONS_MATCHDAY_ROWS.map(row=>[`${row.participantName}:${row.matchday}`,row]));
  return group.teams.map((name,sourceIndex)=>{
    const matchdays=Array.from({length:CHAMPIONS_MATCHDAY_COUNT},(_,index)=>{
      const matchday=index+1;
      const row=rowMap.get(`${name}:${matchday}`);
      return {
        matchday,
        played:Boolean(row),
        points:row?.points||0,
        goals:row?.goals||0,
        cleanSheets:row?.cleanSheets||0,
        redCards:row?.redCards||0
      };
    });
    return {
      name,
      sourceIndex,
      matchdays,
      played:matchdays.filter(day=>day.played).length,
      total:matchdays.reduce((sum,day)=>sum+day.points,0),
      goals:matchdays.reduce((sum,day)=>sum+day.goals,0),
      cleanSheets:matchdays.reduce((sum,day)=>sum+day.cleanSheets,0),
      redCards:matchdays.reduce((sum,day)=>sum+day.redCards,0)
    };
  }).sort((a,b)=>
    b.total-a.total
    ||b.goals-a.goals
    ||b.cleanSheets-a.cleanSheets
    ||b.played-a.played
    ||a.sourceIndex-b.sourceIndex
  );
}

function renderChampions(){
  const publishedCount=CHAMPIONS_PUBLISHED_MATCHDAYS.length;
  const championsHolder=DATA.champions?.defendingChampion||DATA.champions?.champion;
  const defendingHost=$('championsDefendingChampion');
  if(defendingHost){
    const championImage=imageMap()[championsHolder];
    defendingHost.innerHTML=championsHolder?`<article class="champions-defending-card team-profile-link" ${profileTriggerAttrs(championsHolder)}>
      <span class="champions-defending-crown">${uiIcon('trophy')}</span>
      ${championImage?`<img src="${championImage}" alt="Foto de ${profileAttr(championsHolder)}">`:''}
      <div><span>CAMPEÓN DEFENSOR</span><h3>${championsHolder}</h3><p>Campeón de Champions ${DATA.champions?.championSeason||''} · única edición disputada</p></div>
      <span class="champions-defending-badge">REY DE EUROPA</span>
    </article>`:'';
  }
  const status=$('championsStatus');
  if(status){
    status.textContent=publishedCount===0
      ?DATA.champions.status
      :publishedCount===CHAMPIONS_MATCHDAY_COUNT
        ?'Fase completada'
        :`${publishedCount}/${CHAMPIONS_MATCHDAY_COUNT} jornadas`;
  }

  $('groupGrid').innerHTML=DATA.champions.groups.map(group=>{
    const standings=championsGroupStandings(group);
    const headerDays=Array.from({length:CHAMPIONS_MATCHDAY_COUNT},(_,index)=>`<span class="champions-day-head">J${index+1}</span>`).join('');
    const rows=standings.map((team,index)=>{
      const safeName=profileAttr(team.name);
      const points=team.matchdays.map(day=>`<span class="champions-points-cell${day.played?' is-played':''}" title="${day.played?`Jornada ${day.matchday}: ${day.points.toLocaleString('es')} puntos`:`Jornada ${day.matchday}: pendiente`}">${day.played?day.points.toLocaleString('es'):'—'}</span>`).join('');
      return `<div class="champions-score-row champions-score-grid${index<2?' is-qualifying':''}">
        <span class="champions-rank">${index+1}</span>
        <div class="champions-team-cell team-profile-link" ${profileTriggerAttrs(team.name)}>
          <img src="${imageMap()[team.name]||''}" alt="Foto de ${safeName}">
          <b>${safeName}</b>
        </div>
        ${points}
        <strong class="champions-total champions-points-total">${team.total.toLocaleString('es')}</strong>
        <strong class="champions-stat-total champions-goals-total">${team.goals.toLocaleString('es')}</strong>
        <strong class="champions-stat-total champions-cs-total">${team.cleanSheets.toLocaleString('es')}</strong>
        <strong class="champions-stat-total champions-red-cards-total">${team.redCards.toLocaleString('es')}</strong>
      </div>`;
    }).join('');
    return `<article class="group champions-group">
      <header class="champions-group-head">
        <span class="champions-group-icon">${uiIcon('shield')}</span>
        <div><h3>${group.name}</h3><small>5 competidores · ida y vuelta</small></div>
        <span class="champions-round-count">${publishedCount}/${CHAMPIONS_MATCHDAY_COUNT}</span>
      </header>
      <div class="champions-scroll-cue"><span>J1–J8 · PTS · GOL · CS · TR</span><b>Desliza para ver todo →</b></div>
      <div class="champions-score-scroll" tabindex="0" aria-label="Tabla de ${group.name}. Desliza horizontalmente para consultar las ocho jornadas.">
        <div class="champions-score-table">
          <div class="champions-score-head champions-score-grid">
            <span>#</span>
            <span>Participante</span>
            ${headerDays}
            <span class="champions-summary-head champions-points-head">PTS</span>
            <span class="champions-summary-head champions-goals-head">GOL</span>
            <span class="champions-summary-head champions-cs-head">CS</span>
            <span class="champions-summary-head champions-red-cards-head">TR</span>
          </div>
          ${rows}
        </div>
      </div>
      <footer class="champions-group-footer"><span>Clasifican los 2 primeros</span><span>TR = tarjetas rojas · desempate: PTS · GOL · CS</span></footer>
    </article>`;
  }).join('');
  $('bracket').innerHTML=DATA.champions.knockout.map(r=>`<article class="round"><h3 class="group-title">${uiIcon('trophy')}<span>${r.round}</span></h3><div class="empty-match">Pendiente de clasificación</div><div class="empty-match">Pendiente de clasificación</div></article>`).join('');
}

function renderCup(){
  const rowsHost=$('cupRows');
  if(!rowsHost)return;

  const tournament=buildCupTournament();
  const matchdays=cupMatchdays();
  if(!CUP_SELECTION_MANUAL||!matchdays.includes(SELECTED_CUP_MATCHDAY)){
    SELECTED_CUP_MATCHDAY=defaultCupMatchday(tournament);
  }

  const selectedRound=tournament.rounds.find(round=>round.matchday===SELECTED_CUP_MATCHDAY)||tournament.rounds[0];
  const completedRounds=tournament.rounds.filter(round=>round.published);
  const eliminatedRounds=completedRounds.filter(round=>round.eliminated);
  const nextRound=tournament.rounds.find(round=>!round.published)||null;
  const selectedIsNext=nextRound?.matchday===selectedRound.matchday;

  $('cupHeroStatus').textContent=tournament.champion
    ?'Copa finalizada'
    :completedRounds.length
      ?`${tournament.survivors.length} equipos siguen en pie`
      :'Empieza en la Jornada 4';
  $('cupAliveCount').textContent=tournament.survivors.length.toLocaleString('es');
  $('cupEliminatedCount').textContent=eliminatedRounds.length.toLocaleString('es');
  $('cupNextMatchday').textContent=tournament.champion
    ?'Campeón'
    :nextRound
      ?`J${nextRound.matchday}`
      :'J22';
  $('cupProgressCopy').textContent=`J4–J22 · ${eliminatedRounds.length} de 19 eliminaciones completadas`;

  const championHost=$('cupChampion');
  championHost.hidden=!tournament.champion;
  championHost.innerHTML=tournament.champion?`<article class="cup-champion-card team-profile-link" ${profileTriggerAttrs(tournament.champion.name)}>
    <span class="cup-champion-crown">${uiIcon('trophy')}</span>
    <img src="${imageMap()[tournament.champion.name]||''}" alt="Foto de ${profileAttr(tournament.champion.name)}">
    <div><span>CAMPEÓN DE COPA</span><h3>${profileAttr(tournament.champion.name)}</h3><p>El último equipo en pie después de 19 eliminaciones.</p></div>
    <strong>J22</strong>
  </article>`:'';

  $('cupTimeline').innerHTML=tournament.rounds.map(round=>{
    const isSelected=round.matchday===selectedRound.matchday;
    const isNext=round.matchday===nextRound?.matchday;
    const stateCopy=round.published
      ?round.eliminated?`Sale ${profileAttr(round.eliminated.name)}`:'Cerrada'
      :isNext?'Próxima':'Pendiente';
    return `<button type="button" class="cup-timeline-step${round.published?' is-complete':''}${isNext?' is-next':''}${isSelected?' is-selected':''}" data-cup-matchday="${round.matchday}" aria-pressed="${isSelected}">
      <span>J${round.matchday}</span><small>${stateCopy}</small>
    </button>`;
  }).join('');

  $('cupRoundTitle').textContent=`Jornada ${selectedRound.matchday}`;
  const roundState=$('cupRoundState');
  roundState.textContent=selectedRound.published
    ?'Jornada cerrada'
    :selectedIsNext
      ?'Próxima eliminación'
      :'Ronda pendiente';
  roundState.className=`cup-round-state ${selectedRound.published?'is-closed':'is-pending'}`;

  const dangerHost=$('cupDanger');
  if(selectedRound.published&&selectedRound.eliminated){
    const eliminated=selectedRound.eliminated;
    dangerHost.innerHTML=`<article class="cup-danger-card is-eliminated team-profile-link" ${profileTriggerAttrs(eliminated.name)}>
      <span class="cup-danger-icon">${uiIcon('red-card')}</span>
      <img src="${imageMap()[eliminated.name]||''}" alt="Foto de ${profileAttr(eliminated.name)}">
      <div><span>ELIMINADO EN J${selectedRound.matchday}</span><h3>${profileAttr(eliminated.name)}</h3><p>${eliminated.points.toLocaleString('es')} PTS · ${eliminated.goals.toLocaleString('es')} goles · ${eliminated.cleanSheets.toLocaleString('es')} clean sheets · ${eliminated.leaguePosition}º de Liga</p></div>
      <strong>Fuera</strong>
    </article>`;
  }else{
    dangerHost.innerHTML=`<article class="cup-danger-card is-pending">
      <span class="cup-danger-icon">${uiIcon('shield')}</span>
      <div><span>${selectedIsNext?'PRÓXIMA ELIMINACIÓN':'RONDA PENDIENTE'}</span><h3>${selectedIsNext?`Todo empieza en cero en la J${selectedRound.matchday}`:'Aún no se ha llegado a esta ronda'}</h3><p>Los puntos, goles y clean sheets de jornadas anteriores no se arrastran.</p></div>
      <strong>${selectedIsNext?'0 PTS':'—'}</strong>
    </article>`;
  }

  rowsHost.innerHTML=selectedRound.rows.map(participant=>{
    const safeName=profileAttr(participant.name);
    const eliminated=selectedRound.eliminated?.name===participant.name;
    const status=eliminated?'Eliminado':selectedRound.published?'Clasificado':'En Copa';
    return `<div class="cup-row cup-table-grid${eliminated?' is-eliminated':''}">
      <span class="cup-rank">${participant.position}</span>
      <div class="cup-team-cell team-profile-link" ${profileTriggerAttrs(participant.name)}>
        <img src="${imageMap()[participant.name]||''}" alt="Foto de ${safeName}">
        <span><b>${safeName}</b><small>${eliminated?'Último de la ronda':selectedRound.published?'Supera la ronda':'Sigue en pie'}</small></span>
      </div>
      <span class="cup-stat cup-stat-points"><small>PTS</small><b>${participant.points.toLocaleString('es')}</b></span>
      <span class="cup-stat cup-stat-goals"><small>GOL</small><b>${participant.goals.toLocaleString('es')}</b></span>
      <span class="cup-stat cup-stat-clean"><small>CS</small><b>${participant.cleanSheets.toLocaleString('es')}</b></span>
      <span class="cup-league-position"><small>Liga</small><b>${participant.leaguePosition}º</b></span>
      <span class="cup-row-status">${status}</span>
    </div>`;
  }).join('');

  $('cupHistory').innerHTML=eliminatedRounds.length
    ?eliminatedRounds.slice().reverse().map(round=>{
      const eliminated=round.eliminated;
      return `<article class="cup-history-item team-profile-link" ${profileTriggerAttrs(eliminated.name)}>
        <span>J${round.matchday}</span>
        <img src="${imageMap()[eliminated.name]||''}" alt="Foto de ${profileAttr(eliminated.name)}">
        <div><b>${profileAttr(eliminated.name)}</b><small>${eliminated.points.toLocaleString('es')} PTS · ${eliminated.goals.toLocaleString('es')} GOL · ${eliminated.cleanSheets.toLocaleString('es')} CS</small></div>
        <strong>Eliminado</strong>
      </article>`;
    }).join('')
    :`<div class="cup-history-empty"><span>${uiIcon('trophy')}</span><div><b>La Copa todavía no ha comenzado</b><small>El primer eliminado se conocerá al cerrar la Jornada 4.</small></div></div>`;
}

function crazyStatsNormalizeName(value){
  return String(value||'')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .trim()
    .toLocaleLowerCase('es');
}

function crazyStatsEscape(value){
  return String(value??'').replace(/[&<>"']/g,char=>({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#039;'
  })[char]);
}

function crazyStatsNumber(value,digits=0){
  const number=Number(value)||0;
  return number.toLocaleString('es-ES',{
    minimumFractionDigits:digits,
    maximumFractionDigits:digits
  });
}

function crazyStatsPlayerRecords(){
  const records=[];
  Object.entries(DATA.managerLegacies||{}).forEach(([manager,legacy])=>{
    (legacy.seasons||[]).forEach(season=>{
      const seasonPlayers=new Map();
      const addPlayer=(player,isMvp=false)=>{
        if(!player?.name)return;
        const key=crazyStatsNormalizeName(player.name);
        const previous=seasonPlayers.get(key);
        seasonPlayers.set(key,{
          manager,
          season:season.season,
          name:previous?.name||player.name,
          points:Math.max(previous?.points||0,Number(player.points)||0),
          lineups:Math.max(previous?.lineups||0,Number(player.lineups)||0),
          role:previous?.role||player.role||(isMvp?'MVP':'Jugador'),
          isMvp:Boolean(previous?.isMvp||isMvp)
        });
      };
      (season.standouts||[]).forEach(player=>addPlayer(player,false));
      addPlayer(season.mvp,true);
      records.push(...seasonPlayers.values());
    });
  });
  return records;
}

function crazyStatsAggregateCareers(records){
  const careers=new Map();
  records.forEach(record=>{
    const key=crazyStatsNormalizeName(record.name);
    const current=careers.get(key)||{
      name:record.name,
      manager:record.manager,
      points:0,
      lineups:0,
      seasons:new Set(),
      mvpSeasons:0
    };
    current.points+=record.points||0;
    current.lineups+=record.lineups||0;
    current.seasons.add(record.season);
    if(record.isMvp)current.mvpSeasons+=1;
    careers.set(key,current);
  });
  return [...careers.values()].map(item=>({
    ...item,
    seasonsCount:item.seasons.size,
    average:item.lineups?item.points/item.lineups:0
  }));
}

function crazyStatsCrackCareers(manager,legacy){
  const cracks=new Map();
  (legacy.seasons||[]).forEach(season=>{
    const player=season.mvp;
    if(!player?.name)return;
    const key=crazyStatsNormalizeName(player.name);
    const current=cracks.get(key)||{
      name:player.name,
      manager,
      points:0,
      lineups:0,
      seasons:new Set()
    };
    current.points+=Number(player.points)||0;
    current.lineups+=Number(player.lineups)||0;
    current.seasons.add(season.season);
    cracks.set(key,current);
  });
  return [...cracks.values()].map(item=>({
    ...item,
    seasonsCount:item.seasons.size,
    average:item.lineups?item.points/item.lineups:0
  })).sort((a,b)=>b.points-a.points||b.lineups-a.lineups||a.name.localeCompare(b.name,'es'));
}

function crazyStatsDataset(){
  const records=crazyStatsPlayerRecords();
  const teams=Object.entries(DATA.managerLegacies||{}).map(([name,legacy])=>{
    const metrics=managerLegacyMetrics(name,legacy);
    const teamRecords=records.filter(record=>record.manager===name);
    const careers=crazyStatsAggregateCareers(teamRecords)
      .sort((a,b)=>b.lineups-a.lineups||b.points-a.points||a.name.localeCompare(b.name,'es'));
    const ironMan=[...teamRecords].sort((a,b)=>
      b.lineups-a.lineups||
      b.points-a.points||
      String(b.season||'').localeCompare(String(a.season||''),'es')||
      a.name.localeCompare(b.name,'es')
    )[0]||null;
    const cracks=crazyStatsCrackCareers(name,legacy);
    return {
      name,
      legacy,
      metrics,
      careers,
      ironMan,
      cracks,
      bestCrack:cracks[0]||null
    };
  }).filter(team=>team.legacy?.seasons?.length);
  const byContinuity=[...teams].sort((a,b)=>b.metrics.continuity-a.metrics.continuity||a.name.localeCompare(b.name,'es'));
  const withOfficialPoints=teams.filter(team=>team.metrics.totalTeamPoints>0&&team.metrics.crackDependence>0);
  const byDependence=[...withOfficialPoints].sort((a,b)=>b.metrics.crackDependence-a.metrics.crackDependence||a.name.localeCompare(b.name,'es'));
  const ironMen=teams.filter(team=>team.ironMan).sort((a,b)=>
    b.ironMan.lineups-a.ironMan.lineups||
    b.ironMan.points-a.ironMan.points||
    a.name.localeCompare(b.name,'es')
  );
  const cracks=teams.flatMap(team=>team.cracks).sort((a,b)=>
    b.points-a.points||b.lineups-a.lineups||a.name.localeCompare(b.name,'es')
  );
  const efficientCracks=cracks.filter(player=>player.lineups>=20).sort((a,b)=>
    b.average-a.average||b.points-a.points||a.name.localeCompare(b.name,'es')
  );
  const bestSeasonRecord=[...records].sort((a,b)=>
    b.points-a.points||b.lineups-a.lineups||a.name.localeCompare(b.name,'es')
  );
  return {
    records,
    teams,
    totalSeasons:teams.reduce((sum,team)=>sum+(team.legacy.seasons||[]).length,0),
    totalCareers:teams.reduce((sum,team)=>sum+team.careers.length,0),
    conservative:byContinuity[0]||null,
    rotator:byContinuity[byContinuity.length-1]||null,
    dependent:byDependence[0]||null,
    coral:byDependence[byDependence.length-1]||null,
    ironMen,
    leagueIronMan:ironMen[0]||null,
    cracks,
    bestCrack:cracks[0]||null,
    efficientCrack:efficientCracks[0]||null,
    bestSeasonRecord:bestSeasonRecord[0]||null
  };
}

function crazyStatsTeamLink(name){
  const safe=crazyStatsEscape(name);
  const photo=imageMap()[name]||'';
  return `<button type="button" class="crazy-team-link" data-profile-player="${crazyStatsEscape(name)}">
    ${photo?`<img class="crazy-team-photo" src="${crazyStatsEscape(photo)}" alt="" loading="lazy" decoding="async">`:''}
    <span>${safe}</span><small>Ver perfil →</small>
  </button>`;
}

function crazyStatsRecordCard({icon='sparkles',label,title,value,detail,tone='green',manager=''}){
  return `<article class="crazy-record-card tone-${tone}">
    <div class="crazy-record-card-top"><span>${uiIcon(icon)}</span><small class="crazy-record-kicker">${crazyStatsEscape(label)}</small></div>
    <h4>${crazyStatsEscape(title)}</h4>
    <strong class="crazy-record-card-value">${crazyStatsEscape(value)}</strong>
    <p>${crazyStatsEscape(detail)}</p>
    ${manager?crazyStatsTeamLink(manager):''}
  </article>`;
}

function crazyStatsIronCard(team,index){
  const player=team.ironMan;
  return `<article class="crazy-team-card crazy-iron-card">
    <span class="crazy-rank">${String(index+1).padStart(2,'0')}</span>
    <div class="crazy-team-card-copy">
      ${crazyStatsTeamLink(team.name)}
      <h4>${crazyStatsEscape(player.name)}</h4>
      <p>El futbolista más alineado por este equipo en una sola temporada.</p>
    </div>
    <div class="crazy-team-card-metrics">
      <div class="crazy-metric"><span>alineaciones</span><strong>${crazyStatsNumber(player.lineups)}</strong></div>
      <div class="crazy-metric"><span>puntos</span><strong>${crazyStatsNumber(player.points)}</strong></div>
      <div class="crazy-metric"><span>temporada</span><strong>${crazyStatsEscape(player.season||'—')}</strong></div>
    </div>
  </article>`;
}

function crazyStatsStyleCard(team,index){
  const metrics=team.metrics;
  return `<article class="crazy-team-card crazy-style-card">
    <span class="crazy-rank">${String(index+1).padStart(2,'0')}</span>
    <div class="crazy-team-card-copy">
      ${crazyStatsTeamLink(team.name)}
      <h4>${crazyStatsEscape(metrics.style)}</h4>
      <p>${crazyStatsEscape(metrics.lineIdentity)} · línea dominante: ${crazyStatsEscape(metrics.dominantLine?.label||'sin dato')}.</p>
    </div>
    <div class="crazy-style-bars">
      <div><span class="crazy-style-bar-head"><b>Continuidad</b><strong>${crazyStatsNumber(metrics.continuity,1)}%</strong></span><i class="crazy-style-track"><u style="width:${Math.max(0,Math.min(100,metrics.continuity))}%"></u></i></div>
      <div><span class="crazy-style-bar-head"><b>Rotación estimada</b><strong>${crazyStatsNumber(metrics.rotation,1)}%</strong></span><i class="crazy-style-track"><u style="width:${Math.max(0,Math.min(100,metrics.rotation))}%"></u></i></div>
      <div><span class="crazy-style-bar-head"><b>Dependencia del crack</b><strong>${crazyStatsNumber(metrics.crackDependence,1)}%</strong></span><i class="crazy-style-track"><u style="width:${Math.max(0,Math.min(100,metrics.crackDependence))}%"></u></i></div>
    </div>
  </article>`;
}

function crazyStatsCrackCard(team,index){
  const crack=team.bestCrack;
  return `<article class="crazy-team-card crazy-crack-card">
    <span class="crazy-rank">${String(index+1).padStart(2,'0')}</span>
    <div class="crazy-team-card-copy">
      ${crazyStatsTeamLink(team.name)}
      <h4>${crazyStatsEscape(crack.name)}</h4>
      <p>El crack que más puntos MVP acumuló para este equipo.</p>
    </div>
    <div class="crazy-team-card-metrics">
      <div class="crazy-metric"><span>puntos MVP</span><strong>${crazyStatsNumber(crack.points)}</strong></div>
      <div class="crazy-metric"><span>alineaciones</span><strong>${crazyStatsNumber(crack.lineups)}</strong></div>
      <div class="crazy-metric"><span>pts/alineación</span><strong>${crazyStatsNumber(crack.average,1)}</strong></div>
      <div class="crazy-metric"><span>del equipo</span><strong>${crazyStatsNumber(team.metrics.crackDependence,1)}%</strong></div>
    </div>
  </article>`;
}

function renderCrazyStats(){
  const root=$('crazyStatsRoot');
  if(!root)return;
  const stats=crazyStatsDataset();
  const conservative=stats.conservative;
  const rotator=stats.rotator;
  const dependent=stats.dependent;
  const coral=stats.coral;
  const iron=stats.leagueIronMan;
  const bestCrack=stats.bestCrack;
  const efficient=stats.efficientCrack;
  const bestSeasonRecord=stats.bestSeasonRecord;
  const styleTeams=[...stats.teams].sort((a,b)=>b.metrics.continuity-a.metrics.continuity||a.name.localeCompare(b.name,'es'));
  const crackTeams=stats.teams.filter(team=>team.bestCrack).sort((a,b)=>
    b.bestCrack.points-a.bestCrack.points||b.bestCrack.lineups-a.bestCrack.lineups||a.name.localeCompare(b.name,'es')
  );
  root.innerHTML=`
    <div class="crazy-stats-overview">
      <div class="crazy-stats-overview-copy">
        <span class="eyebrow">RADAR HISTÓRICO</span>
        <h3>La liga entera, de un vistazo.</h3>
        <p>Una lectura acumulada y directa: sin selector de temporada y sin cambiar ningún dato del historial.</p>
      </div>
      <div class="crazy-stats-counts" aria-label="Cobertura de las estadísticas">
        <span class="crazy-stats-count"><strong>${stats.teams.length}</strong><span>equipos</span></span>
        <span class="crazy-stats-count"><strong>${stats.totalSeasons}</strong><span>temporadas</span></span>
        <span class="crazy-stats-count"><strong>${stats.totalCareers}</strong><span>jugadores</span></span>
      </div>
    </div>

    <div class="crazy-stats-tabs" role="tablist" aria-label="Categorías de estadísticas locas">
      <button id="crazyStatsTabRecords" type="button" class="crazy-stats-tab is-active" role="tab" aria-selected="true" aria-controls="crazyStatsRecords" data-crazy-stats-tab="records">${uiIcon('sparkles')}<span>Lo más loco</span></button>
      <button id="crazyStatsTabIron" type="button" class="crazy-stats-tab" role="tab" aria-selected="false" aria-controls="crazyStatsIron" data-crazy-stats-tab="iron">${uiIcon('shield')}<span>Jugadores de hierro</span></button>
      <button id="crazyStatsTabStyles" type="button" class="crazy-stats-tab" role="tab" aria-selected="false" aria-controls="crazyStatsStyles" data-crazy-stats-tab="styles">${uiIcon('chart')}<span>Estilos de equipo</span></button>
      <button id="crazyStatsTabCracks" type="button" class="crazy-stats-tab" role="tab" aria-selected="false" aria-controls="crazyStatsCracks" data-crazy-stats-tab="cracks">${uiIcon('star')}<span>Cracks</span></button>
    </div>

    <section id="crazyStatsRecords" class="crazy-stats-panel is-active" role="tabpanel" aria-labelledby="crazyStatsTabRecords" data-crazy-stats-panel="records">
      <div class="crazy-panel-head"><div><span class="eyebrow">RÉCORDS GENERALES</span><h3>Los extremos de la liga</h3></div><p>Ocho datos rápidos con su significado visible.</p></div>
      <div class="crazy-record-grid">
        ${crazyStatsRecordCard({icon:'shield',label:'MAYOR CONTINUIDAD',title:conservative?.name||'Sin dato',value:`${crazyStatsNumber(conservative?.metrics.continuity,1)}%`,detail:`${conservative?.metrics.style||'Sin estilo'} en ${conservative?.legacy.seasons.length||0} temporadas.`,tone:'green',manager:conservative?.name})}
        ${crazyStatsRecordCard({icon:'chart',label:'MAYOR ROTACIÓN',title:rotator?.name||'Sin dato',value:`${crazyStatsNumber(rotator?.metrics.rotation,1)}%`,detail:`Rotación estimada según el uso de sus cuatro referentes.`,tone:'cyan',manager:rotator?.name})}
        ${crazyStatsRecordCard({icon:'star',label:'MEJOR CRACK ACUMULADO',title:bestCrack?.name||'Sin dato',value:`${crazyStatsNumber(bestCrack?.points)} pts`,detail:`Con ${bestCrack?.manager||'sin equipo'}: ${crazyStatsNumber(bestCrack?.lineups)} alineaciones MVP.`,tone:'gold',manager:bestCrack?.manager})}
        ${crazyStatsRecordCard({icon:'ball',label:'MÁS CRACK-DEPENDIENTE',title:dependent?.name||'Sin dato',value:`${crazyStatsNumber(dependent?.metrics.crackDependence,1)}%`,detail:`Porcentaje de los puntos oficiales aportados por sus MVP.`,tone:'orange',manager:dependent?.name})}
        ${crazyStatsRecordCard({icon:'users',label:'JUEGO MÁS CORAL',title:coral?.name||'Sin dato',value:`${crazyStatsNumber(coral?.metrics.crackDependence,1)}%`,detail:`La menor dependencia acumulada de un solo crack.`,tone:'violet',manager:coral?.name})}
        ${crazyStatsRecordCard({icon:'trophy',label:'JUGADOR DE HIERRO',title:iron?.ironMan?.name||'Sin dato',value:`${crazyStatsNumber(iron?.ironMan?.lineups)} alineaciones`,detail:`${iron?.name||'Sin equipo'} · temporada ${iron?.ironMan?.season||'—'} · ${crazyStatsNumber(iron?.ironMan?.points)} puntos.`,tone:'green',manager:iron?.name})}
        ${crazyStatsRecordCard({icon:'medal',label:'MEJOR TEMPORADA INDIVIDUAL',title:bestSeasonRecord?.name||'Sin dato',value:`${crazyStatsNumber(bestSeasonRecord?.points)} pts`,detail:`${bestSeasonRecord?.manager||'Sin equipo'} · temporada ${bestSeasonRecord?.season||'—'} · ${crazyStatsNumber(bestSeasonRecord?.lineups)} alineaciones.`,tone:'gold',manager:bestSeasonRecord?.manager})}
        ${crazyStatsRecordCard({icon:'chart',label:'CRACK MÁS RENTABLE',title:efficient?.name||'Sin dato',value:`${crazyStatsNumber(efficient?.average,1)} pts/al.`,detail:`${efficient?.manager||'Sin equipo'} · mínimo 20 alineaciones MVP acumuladas.`,tone:'cyan',manager:efficient?.manager})}
      </div>
    </section>

    <section id="crazyStatsIron" class="crazy-stats-panel" role="tabpanel" aria-labelledby="crazyStatsTabIron" data-crazy-stats-panel="iron" hidden>
      <div class="crazy-panel-head"><div><span class="eyebrow">UNO POR EQUIPO</span><h3>Los jugadores de hierro</h3></div><p>El jugador con más alineaciones en una sola temporada de cada equipo.</p></div>
      <div class="crazy-team-list">${stats.ironMen.map(crazyStatsIronCard).join('')}</div>
    </section>

    <section id="crazyStatsStyles" class="crazy-stats-panel" role="tabpanel" aria-labelledby="crazyStatsTabStyles" data-crazy-stats-panel="styles" hidden>
      <div class="crazy-panel-head"><div><span class="eyebrow">COMPARADOR DE BANQUILLOS</span><h3>¿Conservar o rotar?</h3></div><p>Ordenado de mayor a menor continuidad histórica.</p></div>
      <div class="crazy-team-list">${styleTeams.map(crazyStatsStyleCard).join('')}</div>
    </section>

    <section id="crazyStatsCracks" class="crazy-stats-panel" role="tabpanel" aria-labelledby="crazyStatsTabCracks" data-crazy-stats-panel="cracks" hidden>
      <div class="crazy-panel-head"><div><span class="eyebrow">FIGURA POR EQUIPO</span><h3>El mejor crack de cada banquillo</h3></div><p>Ordenado por puntos acumulados como MVP del equipo.</p></div>
      <div class="crazy-team-list">${crackTeams.map(crazyStatsCrackCard).join('')}</div>
    </section>

    <details class="crazy-stats-method">
      <summary><span>${uiIcon('shield')} Cómo se calculan estas estadísticas</span><b>Ver método</b></summary>
      <div>
        <p><b>Continuidad:</b> promedio de alineaciones de los referentes PT, DF, MC y DL frente a las jornadas posibles. <b>Rotación estimada:</b> el porcentaje restante; es una tendencia, no el recuento de todos los fichajes.</p>
        <p><b>Dependencia del crack:</b> puntos de los MVP divididos entre los puntos oficiales del equipo. <b>Jugador de hierro:</b> mejor registro de alineaciones de un futbolista en una sola temporada, comparando todas las temporadas del equipo.</p>
        <p>Cuando un MVP también aparece como mejor jugador de su posición en una temporada, se cuenta una sola vez. Los datos históricos originales permanecen intactos.</p>
      </div>
    </details>`;
}

function setCrazyStatsTab(tab){
  const allowed=['records','iron','styles','cracks'];
  const selected=allowed.includes(tab)?tab:'records';
  document.querySelectorAll('[data-crazy-stats-tab]').forEach(button=>{
    const active=button.dataset.crazyStatsTab===selected;
    button.classList.toggle('is-active',active);
    button.setAttribute('aria-selected',String(active));
    button.tabIndex=active?0:-1;
  });
  document.querySelectorAll('[data-crazy-stats-panel]').forEach(panel=>{
    const active=panel.dataset.crazyStatsPanel===selected;
    panel.classList.toggle('is-active',active);
    panel.hidden=!active;
  });
}

const SHARE_CARD_WIDTH=1080;
const SHARE_CARD_HEIGHT=1350;
const SHARE_CARD_IMAGE_CACHE=new Map();
let SHARE_CARD_BOUND=false;

function cardFont(ctx,size,weight=700){
  const fontWeight=weight>=700?'bold':'normal';
  ctx.font=`${fontWeight} ${size}px Arial, sans-serif`;
}

function roundedPath(ctx,x,y,width,height,radius){
  const r=Math.min(radius,width/2,height/2);
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.lineTo(x+width-r,y);
  ctx.quadraticCurveTo(x+width,y,x+width,y+r);
  ctx.lineTo(x+width,y+height-r);
  ctx.quadraticCurveTo(x+width,y+height,x+width-r,y+height);
  ctx.lineTo(x+r,y+height);
  ctx.quadraticCurveTo(x,y+height,x,y+height-r);
  ctx.lineTo(x,y+r);
  ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}

function fillRounded(ctx,x,y,width,height,radius,fill){
  roundedPath(ctx,x,y,width,height,radius);
  ctx.fillStyle=fill;
  ctx.fill();
}

function strokeRounded(ctx,x,y,width,height,radius,stroke,lineWidth=1){
  roundedPath(ctx,x,y,width,height,radius);
  ctx.strokeStyle=stroke;
  ctx.lineWidth=lineWidth;
  ctx.stroke();
}

function fitCardText(ctx,text,maxWidth,startSize,minSize=18,weight=800){
  let size=startSize;
  do{
    cardFont(ctx,size,weight);
    if(ctx.measureText(String(text)).width<=maxWidth)break;
    size-=1;
  }while(size>minSize);
  return size;
}

function drawCardText(ctx,text,x,y,maxWidth,startSize,minSize=18,weight=800,align='left',color='#f4faf7'){
  fitCardText(ctx,text,maxWidth,startSize,minSize,weight);
  ctx.fillStyle=color;
  ctx.textAlign=align;
  ctx.textBaseline='alphabetic';
  ctx.fillText(String(text),x,y);
}

function playerInitials(name){
  return String(name||'?').replace(/^@/,'').split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join('').toUpperCase()||'?';
}

function loadShareCardImage(src){
  if(!src)return Promise.resolve(null);
  if(SHARE_CARD_IMAGE_CACHE.has(src))return SHARE_CARD_IMAGE_CACHE.get(src);
  const promise=new Promise(resolve=>{
    const image=new Image();
    image.onload=()=>resolve(image);
    image.onerror=()=>resolve(null);
    image.src=src;
  });
  SHARE_CARD_IMAGE_CACHE.set(src,promise);
  return promise;
}

async function preloadShareCardPlayers(names){
  await Promise.all(names.map(name=>loadShareCardImage(imageMap()[name]||'')));
}

function drawCoveredImage(ctx,image,x,y,width,height,radius){
  if(!image)return false;
  const sourceWidth=image.naturalWidth||image.width||width;
  const sourceHeight=image.naturalHeight||image.height||height;
  const scale=Math.max(width/sourceWidth,height/sourceHeight);
  const drawWidth=sourceWidth*scale;
  const drawHeight=sourceHeight*scale;
  ctx.save();
  roundedPath(ctx,x,y,width,height,radius);
  ctx.clip();
  ctx.drawImage(image,x+(width-drawWidth)/2,y+(height-drawHeight)/2,drawWidth,drawHeight);
  ctx.restore();
  return true;
}

async function drawPlayerAvatar(ctx,name,x,y,size,radius=size/2){
  const image=await loadShareCardImage(imageMap()[name]||'');
  fillRounded(ctx,x,y,size,size,radius,'#0d2c29');
  const drawn=drawCoveredImage(ctx,image,x,y,size,size,radius);
  if(!drawn){
    drawCardText(ctx,playerInitials(name),x+size/2,y+size*.63,size-16,size*.34,18,850,'center','#72e4d7');
  }
  strokeRounded(ctx,x,y,size,size,radius,'rgba(112,238,213,.28)',2);
}

async function drawShareCardBase(ctx,{eyebrow,title,subtitle,badge}){
  ctx.clearRect(0,0,SHARE_CARD_WIDTH,SHARE_CARD_HEIGHT);
  const background=ctx.createLinearGradient(0,0,SHARE_CARD_WIDTH,SHARE_CARD_HEIGHT);
  background.addColorStop(0,'#061b1d');
  background.addColorStop(.48,'#031117');
  background.addColorStop(1,'#02090f');
  ctx.fillStyle=background;
  ctx.fillRect(0,0,SHARE_CARD_WIDTH,SHARE_CARD_HEIGHT);

  const glow=ctx.createRadialGradient(925,115,10,925,115,470);
  glow.addColorStop(0,'rgba(108,255,115,.22)');
  glow.addColorStop(.45,'rgba(80,230,208,.07)');
  glow.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=glow;
  ctx.fillRect(450,0,630,610);

  ctx.save();
  ctx.globalAlpha=.08;
  ctx.strokeStyle='#50e6d0';
  ctx.lineWidth=2;
  for(let i=0;i<4;i++){
    strokeRounded(ctx,735+i*42,-135+i*42,300,420,42,'#50e6d0',2);
  }
  ctx.beginPath();
  ctx.arc(540,710,360,0,Math.PI*2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(80,710);
  ctx.lineTo(1000,710);
  ctx.stroke();
  ctx.restore();

  const logo=await loadShareCardImage('cuban-league-green-logo.svg');
  fillRounded(ctx,58,52,76,76,21,'rgba(108,255,115,.08)');
  drawCoveredImage(ctx,logo,58,52,76,76,21);
  strokeRounded(ctx,58,52,76,76,21,'rgba(108,255,115,.28)',2);
  drawCardText(ctx,'CUBAN LEAGUE',154,88,460,27,22,850,'left','#f4faf7');
  drawCardText(ctx,'REGISTRO OFICIAL',154,115,460,14,12,800,'left','#6e9593');

  fillRounded(ctx,810,62,212,51,25,'rgba(108,255,115,.075)');
  strokeRounded(ctx,810,62,212,51,25,'rgba(108,255,115,.2)',2);
  drawCardText(ctx,badge,916,95,182,16,12,850,'center','#91f388');

  drawCardText(ctx,eyebrow,60,190,620,19,16,850,'left','#50e6d0');
  drawCardText(ctx,title,60,259,960,56,34,850,'left','#f7faf8');
  drawCardText(ctx,subtitle,60,305,930,23,17,600,'left','#849ca5');
  ctx.fillStyle='#6cff73';
  ctx.fillRect(60,329,88,4);
  const line=ctx.createLinearGradient(148,0,1000,0);
  line.addColorStop(0,'rgba(80,230,208,.55)');
  line.addColorStop(1,'rgba(80,230,208,0)');
  ctx.fillStyle=line;
  ctx.fillRect(148,330,852,2);
}

function drawShareCardFooter(ctx){
  ctx.fillStyle='rgba(80,230,208,.12)';
  ctx.fillRect(60,1273,960,2);
  drawCardText(ctx,'CUBAN LEAGUE · TEMPORADA 2026/27',60,1314,650,16,13,750,'left','#6f898f');
  drawCardText(ctx,'DATOS OFICIALES',1020,1314,260,16,13,850,'right','#6fe0d3');
}

function drawShareCardEmpty(ctx,title,copy){
  fillRounded(ctx,120,465,840,460,34,'rgba(7,30,34,.88)');
  strokeRounded(ctx,120,465,840,460,34,'rgba(80,230,208,.16)',2);
  fillRounded(ctx,452,548,176,176,88,'rgba(108,255,115,.06)');
  strokeRounded(ctx,452,548,176,176,88,'rgba(108,255,115,.2)',2);
  ctx.save();
  ctx.strokeStyle='#6cff73';
  ctx.lineWidth=11;
  roundedPath(ctx,497,594,86,78,14);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(520,620,8,0,Math.PI*2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(503,662);
  ctx.lineTo(538,633);
  ctx.lineTo(572,662);
  ctx.stroke();
  ctx.restore();
  drawCardText(ctx,title,540,789,680,36,26,850,'center','#f0f7f3');
  drawCardText(ctx,copy,540,843,700,21,17,600,'center','#80999f');
}

async function drawPodiumShareCard(ctx,matchday){
  await drawShareCardBase(ctx,{
    eyebrow:'RESUMEN SEMANAL',
    title:'PODIO DE LA JORNADA',
    subtitle:'Los tres mejores puntajes de la fecha.',
    badge:matchday?`JORNADA ${matchday}`:'SIN JORNADAS'
  });
  if(!matchday){
    drawShareCardEmpty(ctx,'Esperando la Jornada 1','Publica una jornada para generar el primer podio.');
    drawShareCardFooter(ctx);
    return false;
  }

  const weekly=weeklyStandings(matchday);
  const top=weekly.slice(0,3);
  await preloadShareCardPlayers(top.map(player=>player.name));
  const placements=[
    {player:top[1],rank:2,x:58,y:470,width:302,height:510,avatar:148,tone:'#b8cad3'},
    {player:top[0],rank:1,x:389,y:382,width:302,height:598,avatar:178,tone:'#e7ca69'},
    {player:top[2],rank:3,x:720,y:505,width:302,height:475,avatar:140,tone:'#cc926e'}
  ];

  for(const placement of placements){
    if(!placement.player)continue;
    const {player,rank,x,y,width,height,avatar,tone}=placement;
    const tileGradient=ctx.createLinearGradient(x,y,x,y+height);
    tileGradient.addColorStop(0,rank===1?'rgba(231,202,105,.14)':'rgba(80,230,208,.075)');
    tileGradient.addColorStop(1,'rgba(4,18,24,.94)');
    fillRounded(ctx,x,y,width,height,30,tileGradient);
    strokeRounded(ctx,x,y,width,height,30,rank===1?'rgba(231,202,105,.42)':'rgba(80,230,208,.18)',2);
    fillRounded(ctx,x+20,y+20,58,58,18,tone);
    drawCardText(ctx,rank,x+49,y+60,40,28,22,900,'center','#061015');
    await drawPlayerAvatar(ctx,player.name,x+(width-avatar)/2,y+92,avatar,avatar/2);
    drawCardText(ctx,player.name,x+width/2,y+92+avatar+50,width-34,30,19,850,'center','#f4faf7');
    drawCardText(ctx,`${player.points.toLocaleString('es')} PTS`,x+width/2,y+height-56,width-30,30,21,900,'center',tone);
  }

  const average=weekly.reduce((sum,player)=>sum+player.points,0)/weekly.length;
  const goals=leadersForShareCard(weekly,'goals');
  const cleanSheets=leadersForShareCard(weekly,'cleanSheets');
  const redCards=leadersForShareCard(weekly,'redCards');
  const leaderName=leader=>leader.names.length>1
    ?`${leader.names[0]} +${leader.names.length-1}`
    :leader.names[0]||'Sin registro';
  const metrics=[
    {
      x:60,
      label:'PROMEDIO',
      name:'PUNTOS POR JUGADOR',
      value:`${average.toLocaleString('es',{minimumFractionDigits:1,maximumFractionDigits:1})} PTS`,
      tone:'#79eadd'
    },
    {
      x:303,
      label:'MÁXIMO GOLEADOR',
      name:leaderName(goals),
      value:goals.value?`${goals.value} ${goals.value===1?'GOL':'GOLES'}`:'SIN GOLES',
      tone:'#91f188'
    },
    {
      x:546,
      label:'MÁS CLEAN SHEETS',
      name:leaderName(cleanSheets),
      value:cleanSheets.value?`${cleanSheets.value} ${cleanSheets.value===1?'CLEAN SHEET':'CLEAN SHEETS'}`:'SIN CLEAN SHEETS',
      tone:'#e7ca69'
    },
    {
      x:789,
      label:'TARJETAS ROJAS',
      name:leaderName(redCards),
      value:redCards.value?`${redCards.value} ${redCards.value===1?'ROJA':'ROJAS'}`:'SIN ROJAS',
      tone:'#ff6f79'
    }
  ];
  metrics.forEach(metric=>{
    fillRounded(ctx,metric.x,1022,231,164,24,'rgba(7,30,34,.88)');
    strokeRounded(ctx,metric.x,1022,231,164,24,`${metric.tone}35`,2);
    drawCardText(ctx,metric.label,metric.x+115.5,1061,205,15,10,850,'center','#819b9e');
    drawCardText(ctx,metric.name,metric.x+115.5,1105,205,20,12,850,'center','#f0f7f3');
    drawCardText(ctx,metric.value,metric.x+115.5,1154,205,29,18,900,'center',metric.tone);
  });
  drawShareCardFooter(ctx);
  return true;
}

async function drawStandingsShareCard(ctx,matchday){
  await drawShareCardBase(ctx,{
    eyebrow:'CLASIFICACIÓN GENERAL',
    title:'TOP 10 DE LA TEMPORADA',
    subtitle:'Tabla acumulada después de la jornada seleccionada.',
    badge:matchday?`HASTA J${matchday}`:'SIN JORNADAS'
  });
  if(!matchday){
    drawShareCardEmpty(ctx,'Clasificación sin comenzar','Publica una jornada para crear el Top 10 oficial.');
    drawShareCardFooter(ctx);
    return false;
  }

  const standings=cumulativeStandings(matchday).slice(0,10);
  const movements=movementForMatchday(matchday);
  await preloadShareCardPlayers(standings.map(player=>player.name));
  for(let index=0;index<standings.length;index++){
    const player=standings[index];
    const y=355+index*86;
    fillRounded(ctx,60,y,960,75,19,index===0?'rgba(231,202,105,.105)':'rgba(7,28,34,.88)');
    strokeRounded(ctx,60,y,960,75,19,index===0?'rgba(231,202,105,.28)':'rgba(80,230,208,.11)',2);
    fillRounded(ctx,77,y+12,52,52,15,index<3?['#e7ca69','#b9cad2','#c7906c'][index]:'rgba(80,230,208,.08)');
    drawCardText(ctx,index+1,103,y+47,38,22,18,900,'center',index<3?'#071015':'#6edfd3');
    await drawPlayerAvatar(ctx,player.name,148,y+9,57,17);
    drawCardText(ctx,player.name,222,y+47,470,26,17,850,'left','#f0f7f4');
    const movement=movements.get(player.name);
    const movementText=movement==null?'—':movement>0?`↑ +${movement}`:movement<0?`↓ ${movement}`:'• 0';
    const movementColor=movement>0?'#79ef7a':movement<0?'#ff7f91':'#718a91';
    drawCardText(ctx,movementText,805,y+47,120,19,15,850,'right',movementColor);
    drawCardText(ctx,player.points.toLocaleString('es'),980,y+44,140,27,20,900,'right',index===0?'#e7ca69':'#82eee1');
    drawCardText(ctx,'PTS',980,y+61,100,12,10,800,'right','#687f86');
  }
  drawShareCardFooter(ctx);
  return true;
}

function leadersForShareCard(standings,key){
  const value=Math.max(0,...standings.map(player=>player[key]||0));
  const names=value?standings.filter(player=>(player[key]||0)===value).map(player=>player.name):[];
  return {value,names};
}

async function drawLeaderShareTile(ctx,{x,y,label,key,name,extra,value,tone}){
  const gradient=ctx.createLinearGradient(x,y,x+450,y+330);
  gradient.addColorStop(0,`${tone}1f`);
  gradient.addColorStop(1,'rgba(4,18,24,.94)');
  fillRounded(ctx,x,y,460,335,28,gradient);
  strokeRounded(ctx,x,y,460,335,28,`${tone}55`,2);
  fillRounded(ctx,x+24,y+24,70,42,18,`${tone}24`);
  drawCardText(ctx,key,x+59,y+52,54,17,13,900,'center',tone);
  drawCardText(ctx,label,x+112,y+52,310,17,13,850,'left','#86a0a1');
  if(name){
    await drawPlayerAvatar(ctx,name,x+31,y+91,112,32);
    drawCardText(ctx,name,x+163,y+139,265,27,17,850,'left','#f2f8f5');
    if(extra)drawCardText(ctx,`y ${extra} más`,x+163,y+171,240,16,13,700,'left','#738d91');
  }else{
    fillRounded(ctx,x+31,y+91,112,112,32,'rgba(255,255,255,.03)');
    drawCardText(ctx,'—',x+87,y+161,80,42,30,850,'center','#617a80');
    drawCardText(ctx,'Sin registro',x+163,y+148,250,25,18,800,'left','#80969a');
  }
  drawCardText(ctx,value,x+31,y+287,398,38,24,900,'left',tone);
}

async function drawLeadersShareCard(ctx,matchday){
  await drawShareCardBase(ctx,{
    eyebrow:'FIGURAS DE LA TEMPORADA',
    title:'LÍDERES Y DESTACADOS',
    subtitle:'MVP semanal, goles, clean sheets y mayor subida.',
    badge:matchday?`JORNADA ${matchday}`:'SIN JORNADAS'
  });
  if(!matchday){
    drawShareCardEmpty(ctx,'Esperando los primeros líderes','Publica una jornada para generar esta tarjeta.');
    drawShareCardFooter(ctx);
    return false;
  }

  const weekly=weeklyStandings(matchday);
  const standings=cumulativeStandings(matchday);
  const movements=movementForMatchday(matchday);
  const goals=leadersForShareCard(standings,'goals');
  const cleanSheets=leadersForShareCard(standings,'cleanSheets');
  const rises=[...movements.entries()].filter(([,delta])=>Number.isFinite(delta)&&delta>0);
  const biggestRise=rises.length?Math.max(...rises.map(([,delta])=>delta)):0;
  const risers=biggestRise?rises.filter(([,delta])=>delta===biggestRise).map(([name])=>name):[];
  const tiles=[
    {x:60,y:385,label:'MVP DE LA JORNADA',key:'MVP',name:weekly[0]?.name,extra:0,value:`${(weekly[0]?.points||0).toLocaleString('es')} PUNTOS`,tone:'#e7ca69'},
    {x:560,y:385,label:'LÍDER DE GOLES',key:'GOL',name:goals.names[0],extra:Math.max(0,goals.names.length-1),value:`${goals.value} ${goals.value===1?'GOL':'GOLES'}`,tone:'#6cff73'},
    {x:60,y:760,label:'CLEAN SHEETS',key:'CS',name:cleanSheets.names[0],extra:Math.max(0,cleanSheets.names.length-1),value:`${cleanSheets.value} CLEAN SHEETS`,tone:'#50e6d0'},
    {x:560,y:760,label:'MAYOR SUBIDA',key:'↑',name:risers[0],extra:Math.max(0,risers.length-1),value:biggestRise?`+${biggestRise} ${biggestRise===1?'POSICIÓN':'POSICIONES'}`:'SIN CAMBIOS',tone:'#8b9cff'}
  ];
  await preloadShareCardPlayers(tiles.map(tile=>tile.name).filter(Boolean));
  for(const tile of tiles)await drawLeaderShareTile(ctx,tile);
  drawShareCardFooter(ctx);
  return true;
}

async function drawChampionsShareCard(ctx,groupIndex){
  const group=DATA.champions.groups[groupIndex]||DATA.champions.groups[0];
  const publishedCount=CHAMPIONS_PUBLISHED_MATCHDAYS.length;
  await drawShareCardBase(ctx,{
    eyebrow:'CUBAN LEAGUE CHAMPIONS',
    title:`${group.name.toUpperCase()} · FASE DE GRUPOS`,
    subtitle:'Ocho partidos por competidor · Ida y vuelta.',
    badge:`${publishedCount}/8 JORNADAS`
  });
  const standings=championsGroupStandings(group);
  await preloadShareCardPlayers(standings.map(player=>player.name));

  fillRounded(ctx,50,358,980,64,18,'rgba(80,230,208,.075)');
  drawCardText(ctx,'#',80,399,34,15,12,850,'center','#78aaa7');
  drawCardText(ctx,'PARTICIPANTE',126,399,220,15,12,850,'left','#78aaa7');
  for(let day=1;day<=8;day++)drawCardText(ctx,`J${day}`,405+(day-1)*50,399,34,13,10,850,'center','#78aaa7');
  drawCardText(ctx,'PTS',820,399,48,13,10,850,'center','#91f188');
  drawCardText(ctx,'GOL',880,399,48,13,10,850,'center','#6cff73');
  drawCardText(ctx,'CS',940,399,48,13,10,850,'center','#50e6d0');
  drawCardText(ctx,'TR',1000,399,48,13,10,850,'center','#ff6f79');

  for(let index=0;index<standings.length;index++){
    const player=standings[index];
    const y=438+index*142;
    fillRounded(ctx,50,y,980,124,22,index<2?'rgba(108,255,115,.07)':'rgba(6,25,31,.9)');
    strokeRounded(ctx,50,y,980,124,22,index<2?'rgba(108,255,115,.2)':'rgba(80,230,208,.1)',2);
    if(index<2){
      ctx.fillStyle='#6cff73';
      ctx.fillRect(50,y+25,5,74);
    }
    drawCardText(ctx,index+1,80,y+73,34,25,20,900,'center',index<2?'#8df486':'#708b90');
    await drawPlayerAvatar(ctx,player.name,115,y+25,74,19);
    drawCardText(ctx,player.name,205,y+71,165,22,13,850,'left','#eff7f4');
    player.matchdays.forEach((day,dayIndex)=>{
      const center=405+dayIndex*50;
      fillRounded(ctx,center-17,y+42,34,42,10,day.played?'rgba(80,230,208,.085)':'rgba(255,255,255,.025)');
      drawCardText(ctx,day.played?day.points.toLocaleString('es'):'—',center,y+69,29,13,9,850,'center',day.played?'#7feadd':'#50696f');
    });
    drawCardText(ctx,player.total.toLocaleString('es'),820,y+73,48,21,15,900,'center',index<2?'#91f188':'#79e2d7');
    drawCardText(ctx,player.goals.toLocaleString('es'),880,y+73,48,19,13,900,'center','#6cff73');
    drawCardText(ctx,player.cleanSheets.toLocaleString('es'),940,y+73,48,19,13,900,'center','#50e6d0');
    drawCardText(ctx,player.redCards.toLocaleString('es'),1000,y+73,48,19,13,900,'center','#ff6f79');
  }

  fillRounded(ctx,160,1177,760,58,22,'rgba(231,202,105,.055)');
  strokeRounded(ctx,160,1177,760,58,22,'rgba(231,202,105,.15)',2);
  drawCardText(ctx,'CLASIFICAN LOS 2 PRIMEROS · PTS · GOL · CS · TR',540,1214,760,17,13,850,'center','#d8c36f');
  drawShareCardFooter(ctx);
  return true;
}

function selectedShareCardMatchday(){
  const select=$('cardMatchdaySelect');
  const value=Number(select?.value);
  return PUBLISHED_MATCHDAYS.includes(value)?value:null;
}

function setShareCardStatus(message,error=false){
  const status=$('shareCardStatus');
  if(!status)return;
  status.textContent=message;
  status.classList.toggle('error',error);
}

async function renderShareCardPreview(){
  const canvas=$('shareCardCanvas');
  if(!canvas)return;
  let previewCtx=null;
  try{
    previewCtx=canvas.getContext('2d');
  }catch{
    previewCtx=null;
  }
  if(!previewCtx){
    setShareCardStatus('Este navegador no permite generar la imagen.',true);
    return;
  }
  const workCanvas=document.createElement('canvas');
  workCanvas.width=SHARE_CARD_WIDTH;
  workCanvas.height=SHARE_CARD_HEIGHT;
  const ctx=workCanvas.getContext('2d');
  if(!ctx){
    setShareCardStatus('Este navegador no permite generar la imagen.',true);
    return;
  }
  const token=++SHARE_CARD_RENDER_TOKEN;
  SHARE_CARD_READY=false;
  $('downloadShareCard').disabled=true;
  $('shareShareCard').disabled=true;
  setShareCardStatus('Generando la vista previa…');
  if(document.fonts?.ready){
    try{await document.fonts.ready}catch{}
  }

  try{
    let ready=false;
    const matchday=selectedShareCardMatchday();
    if(SHARE_CARD_TYPE==='podium')ready=await drawPodiumShareCard(ctx,matchday);
    else if(SHARE_CARD_TYPE==='standings')ready=await drawStandingsShareCard(ctx,matchday);
    else if(SHARE_CARD_TYPE==='leaders')ready=await drawLeadersShareCard(ctx,matchday);
    else ready=await drawChampionsShareCard(ctx,SHARE_CARD_GROUP_INDEX);
    if(token!==SHARE_CARD_RENDER_TOKEN)return;
    previewCtx.clearRect(0,0,SHARE_CARD_WIDTH,SHARE_CARD_HEIGHT);
    previewCtx.drawImage(workCanvas.__shareCardSurface||workCanvas,0,0);
    SHARE_CARD_READY=ready;
    $('downloadShareCard').disabled=!ready;
    $('shareShareCard').disabled=!ready;
    setShareCardStatus(
      ready
        ?'Tarjeta lista para descargar o compartir.'
        :'Publica una jornada desde el panel privado para activar esta tarjeta.'
    );
  }catch{
    if(token!==SHARE_CARD_RENDER_TOKEN)return;
    SHARE_CARD_READY=false;
    setShareCardStatus('No se pudo generar la tarjeta. Inténtalo nuevamente.',true);
  }
}

function renderShareCardStudio(){
  if(!$('shareCardCanvas'))return;
  const matchdaySelect=$('cardMatchdaySelect');
  const previousSelection=Number(matchdaySelect.value);
  const selected=PUBLISHED_MATCHDAYS.includes(previousSelection)
    ?previousSelection
    :PUBLISHED_MATCHDAYS[PUBLISHED_MATCHDAYS.length-1];
  matchdaySelect.disabled=!PUBLISHED_MATCHDAYS.length;
  matchdaySelect.innerHTML=PUBLISHED_MATCHDAYS.length
    ?PUBLISHED_MATCHDAYS.map(day=>`<option value="${day}">Jornada ${day}</option>`).join('')
    :'<option>Sin jornadas publicadas</option>';
  if(selected!=null)matchdaySelect.value=String(selected);

  $('cardGroupSelect').innerHTML=DATA.champions.groups.map((group,index)=>`<option value="${index}">${group.name}</option>`).join('');
  $('cardGroupSelect').value=String(SHARE_CARD_GROUP_INDEX);
  const champions=SHARE_CARD_TYPE==='champions';
  $('cardMatchdayField').hidden=champions;
  $('cardGroupField').hidden=!champions;
  document.querySelectorAll('[data-card-type]').forEach(button=>{
    const active=button.dataset.cardType===SHARE_CARD_TYPE;
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',String(active));
  });
  const titles={
    podium:'Podio de la jornada',
    standings:'Top 10 de la temporada',
    leaders:'Líderes y destacados',
    champions:'Tabla del grupo de Champions'
  };
  $('shareCardPreviewTitle').textContent=titles[SHARE_CARD_TYPE];
  renderShareCardPreview();
}

function shareCardFilename(){
  const matchday=selectedShareCardMatchday();
  const parts={
    podium:`Podio-Jornada-${matchday||'Sin-Datos'}`,
    standings:`Top-10-Jornada-${matchday||'Sin-Datos'}`,
    leaders:`Lideres-Jornada-${matchday||'Sin-Datos'}`,
    champions:`Champions-${(DATA.champions.groups[SHARE_CARD_GROUP_INDEX]?.name||'Grupo').replace(/\s+/g,'-')}`
  };
  return `Cuban-League-${parts[SHARE_CARD_TYPE]}.png`;
}

function shareCardBlob(){
  return new Promise((resolve,reject)=>{
    const canvas=$('shareCardCanvas');
    if(canvas.toBlob){
      canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Imagen vacía')),'image/png',1);
      return;
    }
    fetch(canvas.toDataURL('image/png')).then(response=>response.blob()).then(resolve,reject);
  });
}

async function downloadShareCard({silent=false}={}){
  if(!SHARE_CARD_READY)return;
  try{
    const blob=await shareCardBlob();
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;
    link.download=shareCardFilename();
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1200);
    if(!silent)setShareCardStatus('Imagen descargada. Ya puedes enviarla por WhatsApp.');
  }catch{
    setShareCardStatus('No se pudo descargar la imagen.',true);
  }
}

async function shareGeneratedCard(){
  if(!SHARE_CARD_READY)return;
  try{
    const blob=await shareCardBlob();
    const file=new File([blob],shareCardFilename(),{type:'image/png'});
    if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]}))){
      await navigator.share({
        files:[file],
        title:'Cuban League',
        text:'Tarjeta oficial de Cuban League'
      });
      setShareCardStatus('Tarjeta compartida correctamente.');
      return;
    }
    await downloadShareCard({silent:true});
    setShareCardStatus('Tu dispositivo descargó la imagen. Adjúntala en WhatsApp.');
  }catch(error){
    if(error?.name==='AbortError'){
      setShareCardStatus('No se compartió la tarjeta.');
      return;
    }
    setShareCardStatus('No se pudo compartir la tarjeta.',true);
  }
}

function setupShareCardStudio(){
  if(SHARE_CARD_BOUND||!$('shareCardCanvas'))return;
  SHARE_CARD_BOUND=true;
  document.querySelectorAll('[data-card-type]').forEach(button=>button.onclick=()=>{
    SHARE_CARD_TYPE=button.dataset.cardType;
    renderShareCardStudio();
  });
  $('cardMatchdaySelect').onchange=renderShareCardPreview;
  $('cardGroupSelect').onchange=()=>{
    SHARE_CARD_GROUP_INDEX=Number($('cardGroupSelect').value)||0;
    renderShareCardPreview();
  };
  $('generateShareCard').onclick=renderShareCardPreview;
  $('downloadShareCard').onclick=()=>downloadShareCard();
  $('shareShareCard').onclick=shareGeneratedCard;
  renderShareCardStudio();
}

let deferredInstallPrompt=null;
let installReturnFocus=null;
const isStandalone=()=>window.matchMedia?.('(display-mode: standalone)')?.matches||window.navigator.standalone===true;
const isIOS=()=>/iphone|ipad|ipod/i.test(window.navigator.userAgent)||(window.navigator.platform==='MacIntel'&&window.navigator.maxTouchPoints>1);

function closeInstallGuide(){
  const modal=$('installModal');
  if(!modal||modal.hidden)return;
  modal.hidden=true;
  syncModalLock();
  installReturnFocus?.focus?.();
}

function openInstallGuide(){
  installReturnFocus=document.activeElement;
  if(!isIOS()){
    $('installIntro').textContent='Puedes instalar Cuban League desde el navegador y abrirla como una aplicación independiente.';
    document.querySelector('.install-warning').hidden=true;
    $('copySafariLink').hidden=true;
    $('installSteps').innerHTML=`
      <li><b>Abre el menú del navegador.</b><span>Normalmente son tres puntos en la parte superior.</span></li>
      <li><b>Elige “Instalar aplicación”.</b><span>También puede aparecer como “Añadir a pantalla de inicio”.</span></li>
      <li><b>Confirma la instalación.</b><span>Cuban League aparecerá junto a tus otras aplicaciones.</span></li>`;
  }
  $('nativeInstall').hidden=!deferredInstallPrompt;
  $('installModal').hidden=false;
  syncModalLock();
  requestAnimationFrame(()=>$('closeInstall').focus());
}

async function copySafariUrl(){
  const url=`${location.origin}${location.pathname}`;
  try{
    await navigator.clipboard.writeText(url);
  }catch{
    const field=document.createElement('textarea');
    field.value=url;
    field.setAttribute('readonly','');
    field.style.position='fixed';
    field.style.opacity='0';
    document.body.appendChild(field);
    field.select();
    document.execCommand('copy');
    field.remove();
  }
  $('copySafariStatus').textContent='Enlace copiado. Ahora abre Safari, pégalo en la barra de dirección y continúa con el paso 2.';
}

async function requestInstall(){
  if(!deferredInstallPrompt){openInstallGuide();return}
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt=null;
  closeInstallGuide();
  $('nativeInstall').hidden=true;
  if(isStandalone())$('installApp').hidden=true;
}

function updateInstallUI(){
  if(!$('installApp'))return;
  $('installApp').hidden=isStandalone();
  if($('nativeInstall'))$('nativeInstall').hidden=!deferredInstallPrompt;
}

function setupPWA(){
  updateInstallUI();
  $('installApp').onclick=requestInstall;
  $('nativeInstall').onclick=requestInstall;
  $('copySafariLink').onclick=copySafariUrl;
  $('closeInstall').onclick=closeInstallGuide;
  $('installModal').onclick=e=>{if(e.target.id==='installModal')closeInstallGuide()};

  const syncConnection=()=>document.body.classList.toggle('is-offline',!navigator.onLine);
  window.addEventListener('online',syncConnection);
  window.addEventListener('offline',syncConnection);
  syncConnection();

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register(`./sw.js?v=${APP_VERSION}`,{scope:'./'}).then(registration=>registration.update()).catch(()=>{});
  }
}

window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();
  deferredInstallPrompt=event;
  updateInstallUI();
});

window.addEventListener('appinstalled',()=>{
  deferredInstallPrompt=null;
  closeInstallGuide();
  updateInstallUI();
});

async function init(){
  trackSiteVisit();
  DATA=await(await fetch(`data.json?v=${APP_VERSION}`,{cache:'no-store'})).json();
  renderCurrent();
  renderMatchdayCenter();
  renderHomeLive();
  renderGeneral();
  renderPoints();
  renderPalmares();
  renderSeasons();
  renderSeasonChampions();
  renderPlayers();
  renderRecords();
  renderChampions();
  renderCup();
  setupShareCardStudio();

  const syncPublishedData=async()=>{
    await syncLiveCurrentStats({render:false});
    await Promise.all([
      syncAchievementMilestones({render:false}),
      syncChampionsStats({render:false})
    ]);
    renderCurrent();
    renderMatchdayCenter();
    renderHomeLive();
    renderPlayers($('playerSearch')?.value||'');
    renderChampions();
    renderCup();
    if(SHARE_CARD_BOUND)renderShareCardStudio();
    checkForNewAchievementUnlocks();
  };
  syncPublishedData();
  window.setInterval(()=>{
    if(document.visibilityState==='visible')syncPublishedData();
  },60000);
  window.addEventListener('online',syncPublishedData);
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible')syncPublishedData();
  });

  document.addEventListener('click',e=>{
    const route=e.target.closest('[data-go]');
    if(route){
      go(route.dataset.go,route.dataset.historyView);
      return;
    }
    const cupMatchday=e.target.closest('[data-cup-matchday]');
    if(cupMatchday){
      SELECTED_CUP_MATCHDAY=Number(cupMatchday.dataset.cupMatchday);
      CUP_SELECTION_MANUAL=true;
      renderCup();
      return;
    }
    const managerBoardToggle=e.target.closest('[data-manager-board-toggle]');
    if(managerBoardToggle){
      toggleManagerBoard(managerBoardToggle);
      return;
    }
    const managerBoardClose=e.target.closest('[data-manager-board-close]');
    if(managerBoardClose){
      closeManagerBoard(managerBoardClose);
      return;
    }
    const legacySeason=e.target.closest('[data-manager-legacy-season]');
    if(legacySeason){
      selectManagerLegacySeason(legacySeason.dataset.managerLegacyManager,legacySeason.dataset.managerLegacySeason);
      return;
    }
    const team=e.target.closest('[data-profile-player]');
    if(team)openPlayer(team.dataset.profilePlayer);
  });
  document.addEventListener('change',e=>{
    const managerCompare=e.target.closest?.('[data-manager-compare-select]');
    if(managerCompare){
      renderManagerComparison(managerCompare.dataset.managerPrimary,managerCompare.value);
    }
  });
  document.addEventListener('keydown',e=>{
    const team=e.target.closest?.('[data-profile-player]');
    if(team&&(e.key==='Enter'||e.key===' ')){
      e.preventDefault();
      openPlayer(team.dataset.profilePlayer);
    }
    if(e.key==='Escape'&&!$('playerModal').hidden)closePlayer();
    else if(e.key==='Escape'&&!$('installModal').hidden)closeInstallGuide();
  });
  document.querySelectorAll('.navtab').forEach(b=>b.onclick=()=>go(b.dataset.section));
  document.querySelectorAll('[data-regulation-view]').forEach(button=>{
    button.onclick=()=>setRegulationView(button.dataset.regulationView);
  });
  document.querySelectorAll('.history-hub-tab[data-history-view]').forEach(button=>{
    button.onclick=()=>setHistoryHubView(button.dataset.historyView);
  });
  document.querySelectorAll('.subtab').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('.subtab,.history-panel').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    $(`${b.dataset.hist}Table`).classList.add('active');
  });
  $('sortGeneral').onchange=e=>renderGeneral(e.target.value);
  $('playerSearch').oninput=e=>renderPlayers(e.target.value);
  $('closeModal').onclick=closePlayer;
  $('playerModal').onclick=e=>{if(e.target.id==='playerModal')closePlayer()};
  $('share').onclick=()=>navigator.share
    ?navigator.share({title:'Cuban League',url:location.href})
    :navigator.clipboard.writeText(location.href);
  setupStandingsSwitcher();
  setupPWA();
  const launchParams=new URLSearchParams(location.search);
  const launchSection=launchParams.get('section');
  const launchHistoryView=launchParams.get('view');
  if(['home','current','matchdays','seasons','players','history','records','cup','champions','rules','cards'].includes(launchSection)){
    requestAnimationFrame(()=>go(launchSection,launchHistoryView));
  }
}
init();
