const APP_VERSION='157-20260902';
const OWNER_VISIT_EXCLUSION_KEY='cuban-league-owner-browser';
const ACHIEVEMENT_SEEN_KEY='cuban-league-seen-achievements-v1';
let DATA;
let PLAYER_CATALOG=null;
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
let SHARE_CARD_MONTH_KEY='';
let SHARE_CARD_RENDER_TOKEN=0;
let SHARE_CARD_READY=false;
let SECTION_TRANSITION_TOKEN=0;
let KNOWN_ACHIEVEMENT_KEYS=null;
let ACHIEVEMENT_UNLOCK_TIMER=null;
let ACHIEVEMENT_UNLOCK_HIDE_TIMER=null;
let LINEUP_MODAL_REQUEST_TOKEN=0;
let LINEUP_MODAL_ABORT_CONTROLLER=null;
let LINEUP_RETURN_FOCUS=null;
let LINEUP_RETURN_CONTEXT=null;
let PROFILE_SEASON_REQUEST_TOKEN=0;
let PROFILE_SEASON_ABORT_CONTROLLER=null;
const PROFILE_SEASON_CACHE=new Map();
let PROFILE_SEASON_STATE=null;
let LEAGUE_STATS_REQUEST_TOKEN=0;
let LEAGUE_STATS_ABORT_CONTROLLER=null;
const LEAGUE_STATS_CACHE=new Map();
const LEAGUE_STATS_STATE={
  status:'idle',
  section:'captains',
  captainMode:'points',
  linePosition:'all',
  data:null,
  error:''
};
const LEAGUE_COMPARATOR_STATE={
  leftName:'',
  rightName:''
};
const $=id=>document.getElementById(id);const imageMap=()=>Object.fromEntries(DATA.participants.map(p=>[p.name,p.shield]));const statMap=()=>Object.fromEntries(DATA.general.map(p=>[p.name,p]));
const uiIcon=(name,className='ui-icon')=>`<svg class="${className}" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
const profileAttr=name=>String(name).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function profileTriggerAttrs(name){const safe=profileAttr(name);return `data-profile-player="${safe}" role="button" tabindex="0" aria-label="Ver perfil completo de ${safe}"`}
function teamCell(name){return `<div class="team team-profile-link" ${profileTriggerAttrs(name)}><img src="${imageMap()[name]||''}" alt="Foto de ${name}"><span class="name">${name}</span></div>`}
function matchdayLineupTriggerAttrs(name,matchday,postponed=false){
  const safe=profileAttr(name);
  const day=Number(matchday);
  return `data-matchday-lineup-player="${safe}" data-matchday="${day}" aria-haspopup="dialog" aria-label="Ver alineación de ${safe} en la jornada ${day}${postponed?', pendiente por partido aplazado':''}"`;
}
function matchdayLineupTeamCell(name,postponed=false){
  const safe=profileAttr(name);
  return `<span class="team matchday-lineup-team">
    <img src="${imageMap()[name]||''}" alt="Foto de ${safe}">
    <span class="matchday-lineup-team-copy"><span class="name">${safe}</span><small>${postponed?'Pendiente':'Ver alineación'}</small></span>
    <span class="matchday-lineup-team-arrow" aria-hidden="true">›</span>
  </span>`;
}

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
    points:Number.isFinite(Number(row.points))?Number(row.points):0,
    goals:Math.max(0,Number(row.goals)||0),
    cleanSheets:Math.max(0,Number(row.clean_sheets)||0),
    redCards:Math.max(0,Number(row.red_cards)||0),
    hasPostponedMatches:row.has_postponed_matches===true,
    updatedAt:row.updated_at||null
  })).filter(row=>validNames.has(row.participantName)&&Number.isInteger(row.matchday)&&row.matchday>0);
}

function championsConfiguration(){
  const leagueMatchdays=DATA?.champions?.format?.leagueMatchdays;
  const groups=DATA?.champions?.groups;
  if(!Array.isArray(leagueMatchdays)||leagueMatchdays.length!==CHAMPIONS_MATCHDAY_COUNT)return null;
  const normalizedMatchdays=leagueMatchdays.map(Number);
  if(
    normalizedMatchdays.some(matchday=>!Number.isInteger(matchday)||matchday<1||matchday>38)
    ||new Set(normalizedMatchdays).size!==CHAMPIONS_MATCHDAY_COUNT
  )return null;
  if(!Array.isArray(groups)||groups.length!==4||groups.some(group=>
    !group
    ||typeof group.name!=='string'
    ||!Array.isArray(group.teams)
    ||group.teams.length!==5
  ))return null;

  const groupNames=groups.flatMap(group=>group.teams.map(name=>String(name||'').trim()));
  const uniqueGroupNames=new Set(groupNames);
  const activeNames=new Set(activeParticipants().map(participant=>participant.name));
  if(
    uniqueGroupNames.size!==groupNames.length
    ||groupNames.some(name=>!name||!activeNames.has(name))
    ||activeNames.size!==uniqueGroupNames.size
    ||[...activeNames].some(name=>!uniqueGroupNames.has(name))
  )return null;

  return {
    leagueMatchdays:normalizedMatchdays,
    leagueToChampions:new Map(normalizedMatchdays.map((leagueMatchday,index)=>[leagueMatchday,index+1])),
    participantNames:uniqueGroupNames
  };
}

function deriveChampionsStatsFromLeague(){
  const configuration=championsConfiguration();
  if(!configuration)return null;
  const derivedRows=new Map();
  LIVE_MATCHDAY_ROWS.forEach(row=>{
    const championsMatchday=configuration.leagueToChampions.get(row.matchday);
    if(!championsMatchday||!configuration.participantNames.has(row.participantName))return;
    derivedRows.set(`${row.participantName}:${championsMatchday}`,{
      participantName:row.participantName,
      matchday:championsMatchday,
      leagueMatchday:row.matchday,
      points:row.points,
      goals:row.goals,
      cleanSheets:row.cleanSheets,
      redCards:row.redCards,
      hasPostponedMatches:row.hasPostponedMatches,
      updatedAt:row.updatedAt
    });
  });
  const rows=[...derivedRows.values()].sort((a,b)=>a.matchday-b.matchday||a.participantName.localeCompare(b.participantName,'es'));
  const participantCountByMatchday=rows.reduce((counts,row)=>{
    counts.set(row.matchday,(counts.get(row.matchday)||0)+1);
    return counts;
  },new Map());
  return {
    rows,
    publishedMatchdays:[...participantCountByMatchday]
      .filter(([,participantCount])=>participantCount===configuration.participantNames.size)
      .map(([matchday])=>matchday)
      .sort((a,b)=>a-b)
  };
}

async function fetchPublishedStatsRows(season,{minimumMatchday=null,maximumMatchday=null}={}){
  const config=window.CUBAN_LEAGUE_SUPABASE;
  const request=async({includeRedCards=true,includePostponed=true}={})=>{
    const endpoint=new URL(`${config.url.replace(/\/$/,'')}/rest/v1/matchday_stats`);
    endpoint.searchParams.set(
      'select',
      `participant_name,matchday,points,goals,clean_sheets,${includeRedCards?'red_cards,':''}${includePostponed?'has_postponed_matches,':''}updated_at`
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

  let response=await request({includeRedCards:true,includePostponed:true});
  if(!response.ok)response=await request({includeRedCards:true,includePostponed:false});
  if(!response.ok)response=await request({includeRedCards:false,includePostponed:false});
  if(!response.ok)throw new Error('No se pudieron actualizar las estadísticas');
  const rows=await response.json();
  if(!Array.isArray(rows))throw new Error('Respuesta de estadísticas no válida');
  return rows;
}

function syncChampionsStats({render=true}={}){
  if(!DATA)return false;
  const derived=deriveChampionsStatsFromLeague();
  if(!derived)return false;
  CHAMPIONS_MATCHDAY_ROWS=derived.rows;
  CHAMPIONS_PUBLISHED_MATCHDAYS=derived.publishedMatchdays;
  if(render){
    renderChampions();
    if(SHARE_CARD_BOUND)renderShareCardStudio();
  }
  return true;
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
  const roster=activeParticipants();
  const rosterNames=new Set(roster.map(participant=>participant.name));
  const officialSurvivors=new Set(rosterNames);
  const projectedSurvivors=new Set(rosterNames);
  let confirmationOpen=true;
  let projectionOpen=true;
  let blockedBy=null;
  const rounds=cupMatchdays().map(matchday=>{
    const matchdayRows=LIVE_MATCHDAY_ROWS.filter(row=>row.matchday===matchday&&rosterNames.has(row.participantName));
    const rowNames=new Set(matchdayRows.map(row=>row.participantName));
    const hasAnyStats=matchdayRows.length>0;
    const hasFullStats=roster.every(participant=>rowNames.has(participant.name));
    const incomplete=hasFullStats&&matchdayRows.some(row=>row.hasPostponedMatches);
    const entrants=[...projectedSurvivors];

    if(!hasFullStats){
      blockedBy??=matchday;
      confirmationOpen=false;
      projectionOpen=false;
      return {
        matchday,
        status:hasAnyStats?'invalid':'pending',
        hasAnyStats,
        hasFullStats:false,
        incomplete:false,
        blockedBy,
        rows:cupRoundStandings(matchday,projectedSurvivors,{includeStats:hasAnyStats,leagueMatchday:matchday}),
        eliminated:null,
        provisionalEliminated:null,
        entrants,
        officialSurvivorsAfter:[...officialSurvivors],
        projectedSurvivorsAfter:[...projectedSurvivors]
      };
    }

    if(!projectionOpen){
      return {
        matchday,
        status:'blocked',
        hasAnyStats:true,
        hasFullStats:true,
        incomplete,
        blockedBy,
        rows:cupRoundStandings(matchday,projectedSurvivors,{includeStats:true,leagueMatchday:matchday}),
        eliminated:null,
        provisionalEliminated:null,
        entrants,
        officialSurvivorsAfter:[...officialSurvivors],
        projectedSurvivorsAfter:[...projectedSurvivors]
      };
    }

    const rows=cupRoundStandings(matchday,projectedSurvivors,{includeStats:true,leagueMatchday:matchday});
    const candidate=projectedSurvivors.size>1?rows.at(-1)||null:null;
    const confirmed=confirmationOpen&&!incomplete;
    const status=confirmed?'confirmed':'provisional';
    const eliminated=confirmed?candidate:null;
    const provisionalEliminated=confirmed?null:candidate;
    if(candidate)projectedSurvivors.delete(candidate.name);
    if(eliminated)officialSurvivors.delete(eliminated.name);
    if(!confirmed){
      blockedBy??=matchday;
      confirmationOpen=false;
    }

    return {
      matchday,
      status,
      hasAnyStats:true,
      hasFullStats:true,
      incomplete,
      blockedBy:confirmed?null:blockedBy,
      rows,
      eliminated,
      provisionalEliminated,
      entrants,
      officialSurvivorsAfter:[...officialSurvivors],
      projectedSurvivorsAfter:[...projectedSurvivors]
    };
  });
  const allConfirmed=rounds.length>0&&rounds.every(round=>round.status==='confirmed');
  const champion=allConfirmed&&officialSurvivors.size===1
    ?roster.find(participant=>officialSurvivors.has(participant.name))||null
    :null;
  return {
    rounds,
    survivors:[...officialSurvivors],
    projectedSurvivors:[...projectedSurvivors],
    champion,
    blockedBy
  };
}

function defaultCupMatchday(tournament){
  return tournament.rounds.find(round=>round.status!=='confirmed')?.matchday||CUP_FINAL_MATCHDAY;
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
  if(!DATA||!config?.url||!config?.publishableKey)return {synced:false,changed:false};
  try{
    const rows=await fetchPublishedStatsRows(config.season||DATA.currentSeason);
    const previousSignature=profileSeasonPublishedRowsSignature(LIVE_MATCHDAY_ROWS);
    const nextRows=normalizeMatchdayRows(rows);
    const publishedStatsChanged=previousSignature!==profileSeasonPublishedRowsSignature(nextRows);
    LIVE_MATCHDAY_ROWS=nextRows;
    if(publishedStatsChanged){
      PROFILE_SEASON_CACHE.clear();
      LEAGUE_STATS_CACHE.clear();
      LEAGUE_STATS_ABORT_CONTROLLER?.abort();
      LEAGUE_STATS_ABORT_CONTROLLER=null;
      LEAGUE_STATS_REQUEST_TOKEN+=1;
      LEAGUE_STATS_STATE.status=LEAGUE_STATS_STATE.data?'ready':'idle';
      LEAGUE_STATS_STATE.error='';
    }
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
    const activeStandingsView=document.querySelector('[data-standings-view][aria-selected="true"]')?.dataset.standingsView;
    if(publishedStatsChanged&&document.body.dataset.section==='current'&&['statistics','comparator'].includes(activeStandingsView)){
      ensureLeagueStatsData({force:true});
    }
    return {synced:true,changed:publishedStatsChanged};
  }catch{
    return {synced:false,changed:false};
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
  const previousSignature=JSON.stringify(MATCHDAY_MILESTONES);
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
    const milestonesChanged=previousSignature!==JSON.stringify(MATCHDAY_MILESTONES);
    if(render)renderPlayers($('playerSearch')?.value||'');
    return milestonesChanged;
  }catch{
    MATCHDAY_MILESTONES=[];
    const milestonesChanged=previousSignature!==JSON.stringify(MATCHDAY_MILESTONES);
    if(render)renderPlayers($('playerSearch')?.value||'');
    return milestonesChanged;
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
  $('achievementUnlockIcon').innerHTML=achievementIconMarkup(first.item);
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

function setHistoricalTableView(view='premium',{focus=false}={}){
  const tabs=[...document.querySelectorAll('.history-subtabs .subtab[data-hist]')];
  const selected=tabs.some(tab=>tab.dataset.hist===view)?view:'premium';
  tabs.forEach(tab=>{
    const active=tab.dataset.hist===selected;
    tab.classList.toggle('active',active);
    tab.setAttribute('aria-selected',String(active));
    tab.tabIndex=active?0:-1;
    const panel=$(tab.getAttribute('aria-controls'));
    if(panel){
      panel.classList.toggle('active',active);
      panel.hidden=!active;
    }
    if(active&&focus)tab.focus();
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
  const monthGroups=monthlyAchievementGroups();
  const currentMonthTitle=latestOfficialPlayerMonthGroup(monthGroups);
  const monthWinners=new Set(currentMonthTitle?.winners.map(winner=>winner.name)||[]);
  $('updated').textContent=DATA.lastUpdated;
  $('currentRows').innerHTML=rows.map(p=>{
    const isRelegation=p.position>=16&&p.position<=20;
    const isPlayerMonth=monthWinners.has(p.name);
    return `<div class="row current-row${isRelegation?' is-relegation':''}${isPlayerMonth?' is-player-month':''}">
    <span class="pos"${isRelegation?` aria-label="Puesto ${p.position}, zona de descenso"`:''}>${p.position}</span>
    ${standingsTeamCell(p.name,achievementSnapshot,{playerMonthLabel:isPlayerMonth?currentMonthTitle.label:''})}
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
  renderPlayerOfMonth(monthGroups);
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
  const hasStandings=standings.length>0;
  const bestPoints=hasStandings?standings[0].points:0;
  const winners=hasStandings
    ?standings.filter(player=>player.points===bestPoints).map(player=>player.name)
    :[];
  const average=standings.length
    ?standings.reduce((total,player)=>total+player.points,0)/standings.length
    :0;
  const totalGoals=standings.reduce((total,player)=>total+player.goals,0);
  const totalCleanSheets=standings.reduce((total,player)=>total+player.cleanSheets,0);
  const totalRedCards=standings.reduce((total,player)=>total+player.redCards,0);
  const postponed=LIVE_MATCHDAY_ROWS.some(row=>row.matchday===SELECTED_CLASSIFICATION_MATCHDAY&&row.hasPostponedMatches);

  summary.innerHTML=`<article class="classification-matchday-winner">
      <span class="classification-matchday-summary-icon">${uiIcon('trophy')}</span>
      <div><small>${winners.length>1?'Ganadores empatados':'Ganador de la jornada'}</small>
      ${winners.length?matchdayPlayerLinks(winners,3):'<strong>Sin puntos registrados</strong>'}</div>
      <b>${bestPoints.toLocaleString('es')}<span>PTS</span></b>
    </article>
    <article><small>Promedio</small><strong>${average.toLocaleString('es',{minimumFractionDigits:1,maximumFractionDigits:1})}</strong><span>PTS / jugador</span></article>
    <article><small>Estadísticas</small><strong>${totalGoals.toLocaleString('es')} GOL · ${totalRedCards.toLocaleString('es')} TR</strong><span>${totalCleanSheets.toLocaleString('es')} clean sheets</span></article>`;

  rowsHost.innerHTML=standings.map((player,index)=>`<button type="button" class="classification-matchday-row classification-matchday-grid matchday-lineup-row${index<3?' is-weekly-podium':''}" ${matchdayLineupTriggerAttrs(player.name,SELECTED_CLASSIFICATION_MATCHDAY,postponed)}>
    <span class="classification-matchday-rank">${player.position}</span>
    ${matchdayLineupTeamCell(player.name,postponed)}
    <strong class="classification-matchday-points">${player.points.toLocaleString('es')}</strong>
    <span class="current-stat current-goals" aria-label="${player.goals} goles">${player.goals}</span>
    <span class="current-stat current-clean-sheets" aria-label="${player.cleanSheets} clean sheets">${player.cleanSheets}</span>
    <span class="current-stat current-red-cards" aria-label="${player.redCards} tarjetas rojas">${player.redCards}</span>
  </button>`).join('');
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
  if(['statistics','comparator'].includes(validView))ensureLeagueStatsData();
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
  const match=score.match(/^([+\-−]?[\d.,]+)\s+puntos?\s*(.*)$/i);
  if(!match)return `<small>${detail}</small>`;
  const caption=[match[2].trim(),...sections].filter(Boolean).join(' · ');
  return `<small class="hero-kpi-score"><strong><span class="hero-kpi-score-value">${match[1]}</span><span class="hero-kpi-score-unit">puntos</span></strong>${caption?`<em>${caption}</em>`:''}</small>`;
}

function heroLeaderMetricCard({label,icon,tone,names=[],value,detail}){
  const leaders=names
    .map(name=>DATA.participants.find(entry=>entry.name===name))
    .filter(Boolean);
  const player=leaders[0]||null;
  const extra=Math.max(0,leaders.length-1);
  const displayName=player?(extra?`${player.name} +${extra}`:player.name):'Por definir';
  const attrs=player?profileTriggerAttrs(player.name):'';
  const photoColumns=Math.max(1,Math.ceil(Math.sqrt(leaders.length)));
  const photoRows=Math.max(1,Math.ceil(leaders.length/photoColumns));
  const visual=leaders.length
    ? `<span class="hero-leader-icon hero-leader-photos${leaders.length>1?' is-multiple':''}" style="--leader-photo-columns:${photoColumns};--leader-photo-rows:${photoRows}" data-leader-photo-count="${leaders.length}" role="img" aria-label="Fotos de ${profileAttr(leaders.map(leader=>leader.name).join(', '))}">
        ${leaders.map(leader=>`<img src="${profileAttr(leader.shield)}" alt="" title="${profileAttr(leader.name)}">`).join('')}
      </span>`
    : `<span class="hero-leader-icon">${uiIcon(icon)}</span>`;
  return `<article class="hero-leader-metric hero-leader-${tone}${player?' team-profile-link':' hero-kpi-placeholder'}" ${attrs}>
    ${visual}
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

const MATCHDAY_LINEUP_POSITIONS=['DL','MC','DF','PT'];
const MATCHDAY_LINEUP_POSITION_LABELS={PT:'Portería',DF:'Defensa',MC:'Medio',DL:'Delantera'};
const MATCHDAY_EMPTY_PLAYER_ID_PREFIX='empty-slot-';
const MATCHDAY_EMPTY_PLAYER_NAME='Posición vacía';
const MATCHDAY_EMPTY_CLUB_NAME='Penalización automática';
const MATCHDAY_EMPTY_POINTS=-4;

function isPublishedEmptyLineupPlayer(row){
  const playerId=String(row?.player_id||row?.playerId||'').trim().toLowerCase();
  const playerName=String(row?.player_name||row?.playerName||'').trim().toLocaleLowerCase('es');
  return playerId.startsWith(MATCHDAY_EMPTY_PLAYER_ID_PREFIX)
    ||playerName===MATCHDAY_EMPTY_PLAYER_NAME.toLocaleLowerCase('es');
}

function matchdayLineupNumericValue(value,fallback=0){
  const normalized=typeof value==='string'?value.replace(',','.'):value;
  const number=Number(normalized);
  return Number.isFinite(number)?number:fallback;
}

function matchdayLineupNumber(value,{signed=false,minimumFractionDigits=1}={}){
  const number=matchdayLineupNumericValue(value);
  const formatted=Math.abs(number).toLocaleString('es',{
    minimumFractionDigits,
    maximumFractionDigits:2
  });
  if(number<0)return `−${formatted}`;
  if(signed&&number>0)return `+${formatted}`;
  return formatted;
}

function matchdayLineupMultiplier(value){
  const candidate=matchdayLineupNumericValue(value,1);
  const multiplier=candidate>0?candidate:1;
  return multiplier.toLocaleString('es',{minimumFractionDigits:0,maximumFractionDigits:2});
}

function normalizePublishedMatchdayLineup(rawLineup){
  let lineup=rawLineup;
  if(typeof lineup==='string'){
    try{lineup=JSON.parse(lineup)}catch{return []}
  }
  const rows=Array.isArray(lineup)
    ?lineup
    :Array.isArray(lineup?.players)
      ?lineup.players
      :[];
  return rows.map((row,index)=>{
    const isEmptyPosition=isPublishedEmptyLineupPlayer(row);
    const playerId=String(row?.player_id||'').trim();
    const clubId=String(row?.club_id||'').trim();
    const catalogPlayer=isEmptyPosition?null:PLAYER_CATALOG?.resolve({
      playerId,
      playerName:row?.player_name,
      clubId,
      clubName:row?.club_name
    })||null;
    const position=String(row?.position||catalogPlayer?.position||'').trim().toUpperCase();
    const playerName=isEmptyPosition
      ?MATCHDAY_EMPTY_PLAYER_NAME
      :String(row?.player_name||catalogPlayer?.displayName||'').trim();
    const isCaptain=!isEmptyPosition&&(row?.is_captain===true||row?.is_captain==='true');
    const slotNumber=Math.trunc(matchdayLineupNumericValue(row?.slot_number,index+1));
    const captainMultiplier=matchdayLineupNumericValue(row?.captain_multiplier,1);
    return {
      slotNumber:slotNumber>0?slotNumber:index+1,
      playerId:playerId||catalogPlayer?.id||'',
      playerName,
      clubId:clubId||catalogPlayer?.clubId||'',
      clubName:isEmptyPosition
        ?MATCHDAY_EMPTY_CLUB_NAME
        :String(row?.club_name||catalogPlayer?.clubName||'').trim(),
      photo:catalogPlayer?.photo||'',
      crest:catalogPlayer?.crest||'',
      position,
      displayedPoints:isEmptyPosition?MATCHDAY_EMPTY_POINTS:matchdayLineupNumericValue(row?.displayed_points),
      isCaptain,
      captainMultiplier:isCaptain&&captainMultiplier>0?captainMultiplier:1,
      isEmptyPosition
    };
  }).filter(player=>player.playerName&&MATCHDAY_LINEUP_POSITIONS.includes(player.position))
    .sort((a,b)=>a.slotNumber-b.slotNumber||a.playerName.localeCompare(b.playerName,'es'));
}

function matchdayLineupInitials(name){
  const parts=String(name).trim().split(/\s+/).map(part=>part.replace(/[^\p{L}\p{N}]/gu,'')).filter(Boolean);
  if(!parts.length)return 'CL';
  return parts.slice(0,2).map(part=>part[0]).join('').toUpperCase();
}

function matchdayLineupOfficialStats(name,matchday){
  const standing=weeklyStandings(matchday).find(player=>player.name===name)||null;
  const publishedRow=LIVE_MATCHDAY_ROWS.find(row=>row.matchday===matchday&&row.participantName===name)||null;
  return {
    standing,
    played:publishedRow!=null,
    provisional:LIVE_MATCHDAY_ROWS.some(row=>row.matchday===matchday&&row.hasPostponedMatches)
  };
}

async function fetchPublishedMatchdayLineup(name,matchday,signal){
  const config=window.CUBAN_LEAGUE_SUPABASE;
  if(!config?.url||!config?.publishableKey)throw new Error('Supabase no está configurado');
  const season=config.season||DATA.currentSeason;
  const endpoint=new URL(`${config.url.replace(/\/$/,'')}/rest/v1/matchday_stats`);
  endpoint.searchParams.set('select','lineup');
  endpoint.searchParams.set('season',`eq.${season}`);
  endpoint.searchParams.set('matchday',`eq.${matchday}`);
  endpoint.searchParams.set('participant_name',`eq.${name}`);
  endpoint.searchParams.set('published','eq.true');
  endpoint.searchParams.set('limit','1');
  const response=await fetch(endpoint,{
    cache:'no-store',
    signal,
    headers:{
      apikey:config.publishableKey,
      Authorization:`Bearer ${config.publishableKey}`,
      Accept:'application/json'
    }
  });
  if(!response.ok){
    const errorText=await response.text().catch(()=>'');
    if((response.status===400||response.status===404)&&/lineup|schema cache|column/i.test(errorText)){
      return {lineup:null,schemaMissing:true};
    }
    throw new Error('No se pudo cargar la alineación');
  }
  const rows=await response.json();
  return {
    lineup:Array.isArray(rows)&&rows.length?rows[0]?.lineup??null:null,
    schemaMissing:false
  };
}

function matchdayLineupHeaderMarkup(participant,matchday,official,{formation='',playerCount=0,emptyCount=0}={}){
  const safeName=profileAttr(participant.name);
  const safeShield=profileAttr(participant.shield||'');
  const occupancy=emptyCount
    ?`${playerCount} puestos · ${emptyCount} vacío${emptyCount===1?'':'s'}`
    :`${playerCount} ${playerCount===1?'jugador':'jugadores'}`;
  const subtitle=formation
    ?`Formación ${formation} · ${occupancy}`
    :'Detalle del equipo en esta jornada';
  return `<section class="matchday-lineup-hero">
    <img src="${safeShield}" alt="Foto de ${safeName}">
    <div class="matchday-lineup-identity">
      <span class="eyebrow">JORNADA ${matchday}</span>
      <h2 id="lineupModalTitle">${safeName}</h2>
      <p>${subtitle}</p>
    </div>
    <span class="matchday-lineup-state${official.provisional?' is-provisional':''}">${official.provisional?'Pendiente':'Publicada'}</span>
  </section>`;
}

function matchdayLineupOfficialStatsMarkup(official){
  const player=official.standing;
  const position=official.played&&player?`${player.position}º`:'—';
  const points=official.played&&player?player.points.toLocaleString('es'):'—';
  const goals=official.played&&player?player.goals.toLocaleString('es'):'—';
  const cleanSheets=official.played&&player?player.cleanSheets.toLocaleString('es'):'—';
  const redCards=official.played&&player?player.redCards.toLocaleString('es'):'—';
  return `<section class="matchday-lineup-official" aria-label="Estadísticas oficiales de la jornada">
    <article><span>Puesto</span><b>${position}</b></article>
    <article><span>Puntos</span><b>${points}</b></article>
    <article><span>Goles</span><b>${goals}</b></article>
    <article><span>Clean sheets</span><b>${cleanSheets}</b></article>
    <article><span>Tarjetas rojas</span><b>${redCards}</b></article>
  </section>`;
}

function matchdayLineupProvisionalMarkup(official){
  if(!official.provisional)return '';
  return `<div class="matchday-lineup-provisional" role="status">
    <span aria-hidden="true">⏳</span>
    <div><b>Jornada provisional</b><p>Hay un partido aplazado. La alineación y sus estadísticas pueden actualizarse cuando se juegue.</p></div>
  </div>`;
}

function renderMatchdayLineupState(participant,matchday,official,{type='empty',schemaMissing=false}={}){
  const content=$('lineupModalContent');
  if(!content)return;
  const loading=type==='loading';
  const error=type==='error';
  const icon=loading?'<span class="lineup-loader" aria-hidden="true"></span>':error?'!':uiIcon('calendar');
  const title=loading
    ?'Cargando alineación…'
    :error
      ?'No se pudo cargar ahora'
      :'Alineación aún no disponible';
  const copy=loading
    ?'Estamos buscando el equipo publicado para esta jornada.'
    :error
      ?'Comprueba tu conexión e inténtalo nuevamente tocando el participante.'
      :schemaMissing
        ?'Esta sección quedará disponible cuando se active el registro de alineaciones.'
        :'Todavía no se ha cargado el equipo utilizado en esta jornada.';
  content.setAttribute('aria-busy',String(loading));
  content.innerHTML=`${matchdayLineupHeaderMarkup(participant,matchday,official)}
    ${matchdayLineupOfficialStatsMarkup(official)}
    ${matchdayLineupProvisionalMarkup(official)}
    <section class="matchday-lineup-empty${error?' is-error':''}" role="status" aria-live="polite">
      <span class="matchday-lineup-empty-icon">${icon}</span>
      <h3>${title}</h3>
      <p>${copy}</p>
    </section>`;
}

function matchdayLineupPlayerMarkup(player,isMvp){
  const emptyPosition=player.isEmptyPosition===true;
  const safeName=profileAttr(player.playerName);
  const safeClub=profileAttr(player.clubName||'Club no registrado');
  const points=matchdayLineupNumber(player.displayedPoints);
  const captainLabel=player.isCaptain?`, capitán por ${matchdayLineupMultiplier(player.captainMultiplier)}`:'';
  const initials=profileAttr(matchdayLineupInitials(player.playerName));
  const marker=emptyPosition
    ?`<span class="matchday-field-player-marker is-empty-position" aria-hidden="true">−4</span>`
    :player.photo
    ?`<span class="matchday-field-player-marker has-photo" aria-hidden="true"><span>${initials}</span><img data-player-catalog-image src="${profileAttr(player.photo)}" alt="" loading="lazy"></span>`
    :`<span class="matchday-field-player-marker" aria-hidden="true">${initials}</span>`;
  const club=emptyPosition
    ?`<small title="${safeClub}">${safeClub}</small>`
    :player.crest
    ?`<small class="has-crest" title="${safeClub}"><img data-player-catalog-image src="${profileAttr(player.crest)}" alt="" loading="lazy"><span>${safeClub}</span></small>`
    :`<small title="${safeClub}">${safeClub}</small>`;
  return `<article class="matchday-field-player${player.isCaptain?' is-captain':''}${isMvp?' is-mvp':''}${emptyPosition?' is-empty-position':''}" aria-label="${safeName}, ${MATCHDAY_LINEUP_POSITION_LABELS[player.position]}, ${points} puntos${captainLabel}">
    ${marker}
    ${player.isCaptain?`<span class="matchday-field-captain">C ×${matchdayLineupMultiplier(player.captainMultiplier)}</span>`:''}
    ${isMvp?'<span class="matchday-field-mvp" title="MVP del equipo" aria-hidden="true">★</span>':''}
    <strong title="${safeName}">${safeName}</strong>
    ${club}
    <b${player.displayedPoints < 0 ? ' class="is-negative"' : ''}>${points}</b>
  </article>`;
}

function matchdayLineupJoinedLabels(labels){
  if(labels.length<2)return labels[0]||'';
  try{return new Intl.ListFormat('es',{style:'long',type:'conjunction'}).format(labels)}catch{return labels.join(' y ')}
}

function matchdayLineupLimitedLabels(labels,limit=3){
  const visible=labels.slice(0,limit);
  const remaining=labels.length-visible.length;
  if(!remaining)return matchdayLineupJoinedLabels(visible);
  return `${visible.join(', ')} y ${remaining} más`;
}

function renderPublishedMatchdayLineup(participant,matchday,official,players){
  const content=$('lineupModalContent');
  if(!content)return;
  const totals={PT:0,DF:0,MC:0,DL:0};
  const counts={PT:0,DF:0,MC:0,DL:0};
  players.forEach(player=>{
    totals[player.position]+=player.displayedPoints;
    counts[player.position]+=1;
  });
  const formation=`${counts.DF}-${counts.MC}-${counts.DL}`;
  const eligibleMvpPlayers=players.filter(player=>!player.isEmptyPosition);
  const mvpPoints=eligibleMvpPlayers.length?Math.max(...eligibleMvpPlayers.map(player=>player.displayedPoints)):0;
  const hasDefinedMvp=eligibleMvpPlayers.some(player=>Math.abs(player.displayedPoints)>=.0001);
  const hasLinePoints=players.some(player=>Math.abs(player.displayedPoints)>=.0001);
  const mvps=hasDefinedMvp
    ?eligibleMvpPlayers.filter(player=>Math.abs(player.displayedPoints-mvpPoints)<.0001)
    :[];
  const mvpPlayers=new Set(mvps);
  const captain=players.find(player=>player.isCaptain)||null;
  const outfieldPositions=['DF','MC','DL'].filter(position=>counts[position]>0);
  const strongestTotal=outfieldPositions.length?Math.max(...outfieldPositions.map(position=>totals[position])):0;
  const strongestPositions=hasLinePoints
    ?outfieldPositions.filter(position=>Math.abs(totals[position]-strongestTotal)<.0001)
    :[];
  const strongestLabels=strongestPositions.map(position=>MATCHDAY_LINEUP_POSITION_LABELS[position].toLowerCase());
  const strongestTitle=!hasLinePoints
    ?'Sin línea destacada'
    :strongestPositions.length===3
    ?'Triple empate entre líneas'
    :strongestPositions.length>1
      ?`Empate: ${matchdayLineupJoinedLabels(strongestLabels)}`
      :strongestPositions.length
        ?`${MATCHDAY_LINEUP_POSITION_LABELS[strongestPositions[0]]} fue la línea más fuerte`
        :'Sin líneas registradas';
  const captainBase=captain?captain.displayedPoints/captain.captainMultiplier:0;
  const captainImpact=captain?captain.displayedPoints-captainBase:0;
  const fieldLines=MATCHDAY_LINEUP_POSITIONS.map(position=>{
    const linePlayers=players.filter(player=>player.position===position);
    if(!linePlayers.length)return '';
    return `<section class="matchday-field-line matchday-field-line-${position.toLowerCase()}" style="--lineup-count:${linePlayers.length}" aria-label="${MATCHDAY_LINEUP_POSITION_LABELS[position]}">
      ${linePlayers.map(player=>matchdayLineupPlayerMarkup(player,mvpPlayers.has(player))).join('')}
    </section>`;
  }).join('');
  const captainMarkup=captain
    ?`<article class="matchday-lineup-analysis-card captain-card">
        <div class="matchday-lineup-analysis-head"><span class="matchday-analysis-icon">C</span><div><small>CAPITÁN</small><h3>${profileAttr(captain.playerName)}</h3><p>${profileAttr(captain.clubName||'Club no registrado')} · ${MATCHDAY_LINEUP_POSITION_LABELS[captain.position]}</p></div><b>×${matchdayLineupMultiplier(captain.captainMultiplier)}</b></div>
        <div class="matchday-captain-metrics">
          <div><span>Puntos finales</span><strong>${matchdayLineupNumber(captain.displayedPoints)}</strong></div>
          <div><span>Base estimada</span><strong>${matchdayLineupNumber(captainBase)}</strong></div>
          <div><span>Impacto</span><strong class="${captainImpact<0?'is-negative':'is-positive'}">${matchdayLineupNumber(captainImpact,{signed:true})}</strong></div>
        </div>
        <p class="matchday-analysis-note">Los puntos finales ya incluyen el multiplicador del capitán.</p>
      </article>`
    :`<article class="matchday-lineup-analysis-card captain-card is-empty"><span class="matchday-analysis-icon">C</span><div><small>CAPITÁN</small><h3>Sin capitán registrado</h3><p>No se recibió el multiplicador de esta alineación.</p></div></article>`;
  const mvpMarkup=hasDefinedMvp
    ?`<article class="matchday-lineup-analysis-card mvp-card">
        <div class="matchday-lineup-analysis-head"><span class="matchday-analysis-icon">★</span><div><small>${mvps.length>1?'MVP EMPATADOS':'MVP DEL EQUIPO'}</small><h3>${matchdayLineupLimitedLabels(mvps.map(player=>profileAttr(player.playerName)))}</h3><p>${mvps.length>1?`${mvps.length} jugadores compartieron la mejor puntuación`:'El jugador que más puntos aportó'}</p></div><b>${matchdayLineupNumber(mvpPoints)}</b></div>
        <p class="matchday-analysis-note">Se utilizan los puntos mostrados, incluido el multiplicador si el MVP fue capitán.</p>
      </article>`
    :`<article class="matchday-lineup-analysis-card mvp-card is-empty">
        <div class="matchday-lineup-analysis-head"><span class="matchday-analysis-icon">★</span><div><small>MVP DEL EQUIPO</small><h3>MVP aún no definido</h3><p>Se mostrará cuando algún jugador tenga una puntuación distinta de cero.</p></div><b>—</b></div>
      </article>`;
  const totalsMarkup=`<article class="matchday-lineup-analysis-card lines-card">
      <div class="matchday-lineup-lines-head"><div><small>RENDIMIENTO POR LÍNEA</small><h3>${strongestTitle}</h3></div><b>${hasLinePoints?matchdayLineupNumber(strongestTotal):'—'}</b></div>
      <div class="matchday-line-totals">
        ${['PT','DF','MC','DL'].map(position=>{
          const emptyCount=players.filter(player=>player.position===position&&player.isEmptyPosition).length;
          return `<div class="${strongestPositions.includes(position)?'is-strongest':''}"><span>${position}</span><strong>${matchdayLineupNumber(totals[position])}</strong><small>${counts[position]} ${counts[position]===1?'puesto':'puestos'}${emptyCount?` · ${emptyCount} vacío${emptyCount===1?'':'s'}`:''}</small></div>`;
        }).join('')}
      </div>
    </article>`;
  const emptyCount=players.filter(player=>player.isEmptyPosition).length;
  content.setAttribute('aria-busy','false');
  content.innerHTML=`${matchdayLineupHeaderMarkup(participant,matchday,official,{formation,playerCount:players.length,emptyCount})}
    ${matchdayLineupOfficialStatsMarkup(official)}
    ${matchdayLineupProvisionalMarkup(official)}
    <div class="matchday-lineup-detail-grid">
      <section class="matchday-lineup-field-card" aria-labelledby="matchdayLineupFieldTitle">
        <div class="matchday-lineup-field-head"><div><span class="eyebrow">ONCE UTILIZADO</span><h3 id="matchdayLineupFieldTitle">Formación ${formation}</h3></div><span>${players.length}/11</span></div>
        <div class="matchday-lineup-field" role="group" aria-label="Alineación de ${profileAttr(participant.name)} en la jornada ${matchday}">${fieldLines}</div>
      </section>
      <aside class="matchday-lineup-analysis" aria-label="Análisis de la alineación">${captainMarkup}${mvpMarkup}${totalsMarkup}</aside>
    </div>`;
}

function matchdayLineupFallbackFocus(){
  if(LINEUP_RETURN_FOCUS?.isConnected)return LINEUP_RETURN_FOCUS;
  if(LINEUP_RETURN_CONTEXT){
    const profileModal=$('playerModal');
    const roots=profileModal&&!profileModal.hidden?[profileModal,document]:[document];
    for(const root of roots){
      const fallback=[...root.querySelectorAll('[data-matchday-lineup-player]')].find(button=>
        button.dataset.matchdayLineupPlayer===LINEUP_RETURN_CONTEXT.name
        &&Number(button.dataset.matchday)===LINEUP_RETURN_CONTEXT.matchday
      );
      if(fallback)return fallback;
    }
  }
  return document.querySelector('.navtab.active');
}

function closeMatchdayLineup(){
  const modal=$('lineupModal');
  if(!modal||modal.hidden)return;
  LINEUP_MODAL_REQUEST_TOKEN+=1;
  LINEUP_MODAL_ABORT_CONTROLLER?.abort();
  LINEUP_MODAL_ABORT_CONTROLLER=null;
  const returnTarget=matchdayLineupFallbackFocus();
  modal.hidden=true;
  syncModalLock();
  LINEUP_RETURN_FOCUS=null;
  LINEUP_RETURN_CONTEXT=null;
  returnTarget?.focus?.();
}

async function openMatchdayLineup(name,matchday){
  const participant=DATA.participants.find(player=>player.name===name);
  const day=Number(matchday);
  const modal=$('lineupModal');
  if(!participant||!Number.isInteger(day)||day<1||!modal)return;
  LINEUP_RETURN_FOCUS=document.activeElement;
  LINEUP_RETURN_CONTEXT={name,matchday:day};
  LINEUP_MODAL_ABORT_CONTROLLER?.abort();
  const controller=new AbortController();
  LINEUP_MODAL_ABORT_CONTROLLER=controller;
  const requestToken=++LINEUP_MODAL_REQUEST_TOKEN;
  const official=matchdayLineupOfficialStats(name,day);
  renderMatchdayLineupState(participant,day,official,{type:'loading'});
  modal.hidden=false;
  syncModalLock();
  requestAnimationFrame(()=>$('closeLineupModal')?.focus());
  try{
    const result=await fetchPublishedMatchdayLineup(name,day,controller.signal);
    if(requestToken!==LINEUP_MODAL_REQUEST_TOKEN||modal.hidden)return;
    const players=normalizePublishedMatchdayLineup(result.lineup);
    if(!players.length){
      renderMatchdayLineupState(participant,day,official,{type:'empty',schemaMissing:result.schemaMissing});
      return;
    }
    renderPublishedMatchdayLineup(participant,day,official,players);
  }catch(error){
    if(error?.name==='AbortError'||requestToken!==LINEUP_MODAL_REQUEST_TOKEN||modal.hidden)return;
    renderMatchdayLineupState(participant,day,official,{type:'error'});
  }finally{
    if(requestToken===LINEUP_MODAL_REQUEST_TOKEN)LINEUP_MODAL_ABORT_CONTROLLER=null;
  }
}

async function refreshOpenMatchdayLineup(){
  const modal=$('lineupModal');
  const context=LINEUP_RETURN_CONTEXT;
  if(!modal||modal.hidden||!context||LINEUP_MODAL_ABORT_CONTROLLER)return false;
  const participant=DATA.participants.find(player=>player.name===context.name);
  const day=Number(context.matchday);
  if(!participant||!Number.isInteger(day)||day<1)return false;

  const controller=new AbortController();
  LINEUP_MODAL_ABORT_CONTROLLER=controller;
  const requestToken=++LINEUP_MODAL_REQUEST_TOKEN;
  const official=matchdayLineupOfficialStats(context.name,day);
  try{
    const result=await fetchPublishedMatchdayLineup(context.name,day,controller.signal);
    const currentContext=LINEUP_RETURN_CONTEXT;
    if(requestToken!==LINEUP_MODAL_REQUEST_TOKEN
      ||modal.hidden
      ||currentContext?.name!==context.name
      ||Number(currentContext?.matchday)!==day)return false;
    const players=normalizePublishedMatchdayLineup(result.lineup);
    if(!players.length){
      renderMatchdayLineupState(participant,day,official,{type:'empty',schemaMissing:result.schemaMissing});
    }else{
      renderPublishedMatchdayLineup(participant,day,official,players);
    }
    return true;
  }catch(error){
    if(error?.name==='AbortError'||requestToken!==LINEUP_MODAL_REQUEST_TOKEN||modal.hidden)return false;
    return false;
  }finally{
    if(requestToken===LINEUP_MODAL_REQUEST_TOKEN)LINEUP_MODAL_ABORT_CONTROLLER=null;
  }
}

function trapMatchdayLineupFocus(event){
  if(event.key!=='Tab')return;
  const modal=$('lineupModal');
  if(!modal||modal.hidden)return;
  const focusable=[...modal.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')]
    .filter(element=>!element.disabled&&!element.hidden&&element.getClientRects().length);
  if(!focusable.length){event.preventDefault();return}
  const first=focusable[0];
  const last=focusable[focusable.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
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
    const postponed=LIVE_MATCHDAY_ROWS.some(row=>row.matchday===day&&row.hasPostponedMatches);
    return `<button type="button" class="matchday-archive-card ${day===SELECTED_MATCHDAY?'active':''}${postponed?' is-pending':''}" data-matchday-open="${day}" aria-label="Ver resumen de la jornada ${day}${postponed?', pendiente por partido aplazado':''}">
      <span class="matchday-archive-number">J${day}</span>
      <span class="matchday-archive-copy"><small>Jornada ${day}${postponed?' · Pendiente':''}</small><b>${winner.name}</b><span>${winner.points.toLocaleString('es')} pts · ${totalGoals} ${totalGoals===1?'gol':'goles'} · ${totalRedCards} TR</span></span>
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
  const recordPoints=weekly.length?Math.max(...weekly.map(player=>player.points)):0;
  const recordNames=weekly.filter(player=>player.points===recordPoints).map(player=>player.name);
  const maxGoals=Math.max(0,...weekly.map(player=>player.goals));
  const goalLeaders=maxGoals?weekly.filter(player=>player.goals===maxGoals).map(player=>player.name):[];
  const maxCleanSheets=Math.max(0,...weekly.map(player=>player.cleanSheets));
  const cleanSheetLeaders=maxCleanSheets?weekly.filter(player=>player.cleanSheets===maxCleanSheets).map(player=>player.name):[];
  const maxRedCards=Math.max(0,...weekly.map(player=>player.redCards));
  const redCardLeaders=maxRedCards?weekly.filter(player=>player.redCards===maxRedCards).map(player=>player.name):[];
  const postponed=LIVE_MATCHDAY_ROWS.some(row=>row.matchday===matchday&&row.hasPostponedMatches);

  $('matchdayTitle').textContent=`Jornada ${matchday}`;
  $('matchdayStatus').textContent=postponed
    ?`${weekly.filter(player=>player.played).length} resultados · pendiente por partido aplazado`
    :`${weekly.filter(player=>player.played).length} resultados · publicada`;
  $('matchdayStatus').classList.toggle('pending',postponed);
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

  $('matchdayTableRows').innerHTML=weekly.map(player=>`<button type="button" class="matchday-table-row matchday-table-grid matchday-lineup-row" ${matchdayLineupTriggerAttrs(player.name,matchday,postponed)}>
    <span class="pos">${player.position}</span>
    ${matchdayLineupTeamCell(player.name,postponed)}
    <span class="num">${player.points.toLocaleString('es')}</span>
    <span class="current-stat current-goals">${player.goals}</span>
    <span class="current-stat current-clean-sheets">${player.cleanSheets}</span>
    <span class="current-stat current-red-cards">${player.redCards}</span>
  </button>`).join('');
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

function historicalTitleIndex(){
  const leagueTitles=new Map();
  const championsTitles=new Map();
  const championsSeasons=new Map();

  const seenLeagueEditions=new Set();
  (DATA.historicalTables?.seasonChampions||[]).forEach(entry=>{
    const name=String(entry?.name||'').trim();
    if(!name)return;
    const editionKey=`${entry.season||'sin-temporada'}::${name}`;
    if(seenLeagueEditions.has(editionKey))return;
    seenLeagueEditions.add(editionKey);
    leagueTitles.set(name,(leagueTitles.get(name)||0)+1);
  });

  const seenChampionsEditions=new Set();
  (DATA.champions?.history||[]).forEach((entry,index)=>{
    const name=String(entry?.champion||'').trim();
    if(!name)return;
    const editionKey=entry.edition!=null
      ?`edicion:${entry.edition}`
      :`temporada:${entry.season||index}::${name}`;
    if(seenChampionsEditions.has(editionKey))return;
    seenChampionsEditions.add(editionKey);
    championsTitles.set(name,(championsTitles.get(name)||0)+1);
    if(!championsSeasons.has(name))championsSeasons.set(name,[]);
    championsSeasons.get(name).push(entry.season||'Edición histórica');
  });

  return {leagueTitles,championsTitles,championsSeasons};
}

function withHistoricalHonours(player,index=historicalTitleIndex()){
  const name=player?.name||'';
  const legacyLeagueTitles=Number(player?.leagueTitles??player?.titles??0)||0;
  const leagueTitles=Math.max(legacyLeagueTitles,index.leagueTitles.get(name)||0);
  const championsTitles=index.championsTitles.get(name)||0;
  return {...player,leagueTitles,championsTitles,totalTitles:leagueTitles+championsTitles};
}

function titleSort(a,b){
  return b.totalTitles-a.totalTitles
    ||(b.podiums||0)-(a.podiums||0)
    ||(b.points||0)-(a.points||0);
}

function generalPalmaresSort(a,b){
  return b.totalTitles-a.totalTitles
    ||(b.podiums||0)-(a.podiums||0)
    ||(b.top5||0)-(a.top5||0)
    ||(b.points||0)-(a.points||0)
    ||(b.average||0)-(a.average||0);
}

function sortedGeneral(mode){
  const titleIndex=historicalTitleIndex();
  const list=DATA.general.map(player=>withHistoricalHonours(player,titleIndex));
  if(mode==='points')return list.sort((a,b)=>b.points-a.points);
  if(mode==='titles')return list.sort(titleSort);
  if(mode==='average')return list.sort((a,b)=>b.average-a.average);
  if(mode==='podiums')return list.sort((a,b)=>b.podiums-a.podiums||titleSort(a,b));
  return list.sort(generalPalmaresSort);
}

function historicalPodiumMetric(player,mode){
  if(mode==='points')return {label:'Puntos históricos',value:player.points,unit:'PTS',decimals:0};
  if(mode==='titles')return {label:'Palmarés total',value:player.totalTitles,unit:player.totalTitles===1?'TÍTULO':'TÍTULOS',decimals:0,detail:`${player.leagueTitles} Liga · ${player.championsTitles} Champions`};
  if(mode==='average')return {label:'Promedio',value:player.average||0,unit:'PTS / TEMP.',decimals:1};
  if(mode==='podiums')return {label:'Regularidad',value:player.podiums,unit:player.podiums===1?'PODIO':'PODIOS',decimals:0};
  return {label:'Palmarés histórico',value:player.totalTitles,unit:player.totalTitles===1?'TÍTULO':'TÍTULOS',decimals:0,detail:`${player.leagueTitles} Liga · ${player.championsTitles} Champions`};
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
      <div><small>${metric.label}</small><strong>${player.name}</strong>${badges}<b>${value}<span>${metric.unit}</span></b>${metric.detail?`<em>${metric.detail}</em>`:''}</div>
    </article>`;
  }).join('');
}

function renderGeneral(mode='ranking'){
  const list=sortedGeneral(mode);
  const snapshot=buildAchievementSnapshot();
  renderHistoricalPodium(list,mode,snapshot);
  $('historyGeneralRows').innerHTML=list.map((p,i)=>`<tr class="history-data-row${i<3?` history-rank-${i+1}`:''}">
    <td class="history-rank-cell"><span>${i+1}</span></td>
    <td class="history-participant-cell">${standingsTeamCell(p.name,snapshot)}</td>
    <td class="history-number history-title-total">${p.totalTitles}</td>
    <td class="history-number history-title-league">${p.leagueTitles}</td>
    <td class="history-number history-title-champions">${p.championsTitles}</td>
    <td class="history-number">${p.seconds}</td>
    <td class="history-number">${p.thirds}</td>
    <td class="history-number">${p.podiums}</td>
    <td class="history-number">${p.top5}</td>
    <td class="history-number">${p.seasons}</td>
    <td class="history-number history-points">${p.points.toLocaleString('es')}</td>
    <td class="history-number history-average">${p.average?p.average.toLocaleString('es',{minimumFractionDigits:1,maximumFractionDigits:1}):'—'}</td>
  </tr>`).join('');
}

function renderPoints(){
  const snapshot=buildAchievementSnapshot();
  const ranking=[...DATA.historicalTables.pointsRanking].sort((a,b)=>b.points-a.points);
  $('historyPointsRows').innerHTML=ranking.map((p,i)=>`<tr class="history-data-row${i<3?` history-rank-${i+1}`:''}">
    <td class="history-rank-cell"><span>${i+1}</span></td>
    <td class="history-participant-cell">${standingsTeamCell(p.name,snapshot)}</td>
    <td class="history-number">${p.seasons}</td>
    <td class="history-number history-points">${p.points.toLocaleString('es')}</td>
    <td class="history-number history-average">${p.average.toLocaleString('es',{minimumFractionDigits:1,maximumFractionDigits:1})}</td>
  </tr>`).join('');
}

function renderPalmares(){
  const snapshot=buildAchievementSnapshot();
  const stats=statMap();
  const titleIndex=historicalTitleIndex();
  const rankingByName=new Map((DATA.historicalTables.palmaresRanking||[]).map(player=>[player.name,player]));
  titleIndex.championsTitles.forEach((_,name)=>{
    if(rankingByName.has(name))return;
    const general=stats[name]||{name,titles:0,seconds:0,thirds:0,podiums:0,points:0};
    rankingByName.set(name,{
      name,
      titles:general.titles||0,
      seconds:general.seconds||0,
      thirds:general.thirds||0,
      podiums:general.podiums||0
    });
  });
  const ranking=[...rankingByName.values()]
    .map(player=>withHistoricalHonours({...player,points:stats[player.name]?.points||0},titleIndex))
    .sort(titleSort);
  $('historyPalmaresRows').innerHTML=ranking.map((p,i)=>`<tr class="history-data-row${i<3?` history-rank-${i+1}`:''}">
    <td class="history-rank-cell"><span>${i+1}</span></td>
    <td class="history-participant-cell">${standingsTeamCell(p.name,snapshot)}</td>
    <td class="history-number history-title-total">${p.totalTitles}</td>
    <td class="history-number history-title-league">${p.leagueTitles}</td>
    <td class="history-number history-title-champions">${p.championsTitles}</td>
    <td class="history-number">${p.seconds}</td>
    <td class="history-number">${p.thirds}</td>
    <td class="history-number">${p.podiums}</td>
  </tr>`).join('');
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
  {id:'pichichi',icon:'🥇',iconAsset:'golden-boot-pichichi.png',name:'Pichichi',rarity:'rare',type:'Dinámica',requirement:'Liderar los goles de la temporada.'},
  {id:'golden_glove',icon:'🛡️',name:'Guante de Oro',rarity:'rare',type:'Dinámica',requirement:'Liderar los clean sheets de la temporada.'},
  {id:'king_europe',icon:'🌟',name:'Rey de Europa',rarity:'legendary',type:'Champions',requirement:'Ganar la Cuban League Champions.'},
  {id:'player_month',icon:'📅',name:'Jugador del Mes',rarity:'epic',type:'Mensual',requirement:'Sumar más puntos en las jornadas del mes.'},
  {id:'winter_champion',icon:'❄️',name:'Campeón de Invierno',rarity:'epic',type:'Temporada',requirement:'Liderar la tabla al cerrar diciembre.'}
];

const ACHIEVEMENT_RARITY_WEIGHT={legendary:4,epic:3,rare:2,common:1};

function achievementIconMarkup(item){
  return item.iconAsset
    ?`<img class="achievement-icon-image" src="${item.iconAsset}" alt="">`
    :item.icon;
}

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

function buildMonthlyAchievementAwards({participants,rows,milestones,publishedMatchdays,season}){
  const published=new Set(publishedMatchdays);
  const roster=[...participants];
  const rosterNames=new Set(roster.map(player=>player.name));
  const visibleMilestones=milestones
    .filter(item=>published.has(item.matchday))
    .sort((a,b)=>a.matchday-b.matchday);
  const milestonesByDay=new Map(visibleMilestones.map(item=>[item.matchday,item]));
  const closingByMonth=new Map();
  visibleMilestones.filter(item=>item.isMonthEnd).forEach(item=>{
    const monthKey=item.matchdayDate.slice(0,7);
    const current=closingByMonth.get(monthKey);
    if(!current||item.matchday>current.matchday)closingByMonth.set(monthKey,item);
  });

  const uniqueRows=new Map();
  rows.forEach(row=>{
    if(!rosterNames.has(row.participantName)||!published.has(row.matchday))return;
    uniqueRows.set(`${row.matchday}\u0000${row.participantName}`,row);
  });

  return [...closingByMonth.entries()].flatMap(([monthKey,closing])=>{
    const matchdays=visibleMilestones
      .filter(item=>item.matchdayDate.startsWith(monthKey)&&item.matchday<=closing.matchday)
      .map(item=>item.matchday);
    if(!matchdays.length)return [];
    const complete=matchdays.every(matchday=>
      roster.every(player=>uniqueRows.has(`${matchday}\u0000${player.name}`))
    );
    if(!complete)return [];

    const monthDays=new Set(matchdays);
    const monthRows=[...uniqueRows.values()].filter(row=>monthDays.has(row.matchday));
    const totals=new Map(roster.map(player=>[
      player.name,
      {...player,points:0,goals:0,cleanSheets:0,redCards:0,played:0}
    ]));
    monthRows.forEach(row=>{
      if(!milestonesByDay.has(row.matchday)||!totals.has(row.participantName))return;
      const total=totals.get(row.participantName);
      total.points+=row.points;
      total.goals+=row.goals;
      total.cleanSheets+=row.cleanSheets;
      total.redCards+=row.redCards;
      total.played+=1;
    });
    const ranking=[...totals.values()].filter(player=>player.played>0).sort(sortStandings);
    if(!ranking.length)return [];
    const winningPoints=ranking[0].points;
    const provisional=monthRows.some(row=>row.hasPostponedMatches);
    return ranking
      .filter(player=>player.points===winningPoints)
      .sort((a,b)=>(a.id??0)-(b.id??0)||a.name.localeCompare(b.name,'es'))
      .map(player=>({
        key:`${season}:${monthKey}:${player.id??player.name}`,
        season,
        name:player.name,
        month:monthKey,
        label:achievementMonthLabel(closing.matchdayDate),
        matchday:closing.matchday,
        closingDate:closing.matchdayDate,
        matchdays:[...matchdays],
        points:player.points,
        goals:player.goals,
        cleanSheets:player.cleanSheets,
        redCards:player.redCards,
        played:player.played,
        provisional
      }));
  }).sort((a,b)=>a.month.localeCompare(b.month)||a.name.localeCompare(b.name,'es'));
}

function monthlyAchievementAwards(){
  return buildMonthlyAchievementAwards({
    participants:activeParticipants(),
    rows:LIVE_MATCHDAY_ROWS,
    milestones:MATCHDAY_MILESTONES,
    publishedMatchdays:PUBLISHED_MATCHDAYS,
    season:DATA.currentSeason
  });
}

function monthlyAchievementGroups(awards=monthlyAchievementAwards()){
  const groups=new Map();
  awards.forEach(award=>{
    if(!groups.has(award.month))groups.set(award.month,{
      month:award.month,
      label:award.label,
      matchday:award.matchday,
      closingDate:award.closingDate,
      matchdays:award.matchdays,
      provisional:award.provisional,
      winners:[]
    });
    groups.get(award.month).winners.push(award);
  });
  return [...groups.values()].sort((a,b)=>b.month.localeCompare(a.month));
}

function latestOfficialPlayerMonthGroup(groups=monthlyAchievementGroups()){
  return groups.find(group=>!group.provisional)||null;
}

function monthlyMatchdayLabel(matchdays){
  const days=[...matchdays].sort((a,b)=>a-b);
  if(!days.length)return 'Sin jornadas';
  if(days.length===1)return `Jornada ${days[0]}`;
  const consecutive=days.every((day,index)=>index===0||day===days[index-1]+1);
  return consecutive
    ?`Jornadas ${days[0]}–${days.at(-1)}`
    :`Jornadas ${days.join(', ')}`;
}

function renderPlayerOfMonth(groups=monthlyAchievementGroups()){
  const host=$('currentPlayerMonthContent');
  if(!host)return;
  if(!groups.length){
    host.innerHTML=`<div class="player-month-empty">
      <span class="player-month-empty-icon">${uiIcon('medal')}</span>
      <span class="eyebrow">HISTORIAL MENSUAL</span>
      <strong>Todavía no hay premios publicados</strong>
      <p>Cuando se publique la última jornada de un mes, sus ganadores aparecerán aquí automáticamente.</p>
    </div>`;
    return;
  }

  const uniqueWinners=new Set(groups.flatMap(group=>group.winners.map(winner=>winner.name))).size;
  const awardCount=groups.reduce((total,group)=>total+group.winners.length,0);
  host.innerHTML=`<section class="player-month-hero" aria-labelledby="playerMonthTitle">
    <div class="player-month-hero-copy">
      <span class="player-month-hero-icon">${uiIcon('medal')}</span>
      <div><span class="eyebrow">HISTORIAL OFICIAL</span><h3 id="playerMonthTitle">Ganadores mensuales</h3><p>El premio se calcula con los puntos de todas las jornadas del mes cuando se publica su cierre.</p></div>
    </div>
    <div class="player-month-overview" aria-label="Resumen de premios mensuales">
      <span><strong>${groups.length}</strong><small>${groups.length===1?'mes entregado':'meses entregados'}</small></span>
      <span><strong>${uniqueWinners}</strong><small>${uniqueWinners===1?'ganador distinto':'ganadores distintos'}</small></span>
      <span><strong>${awardCount}</strong><small>${awardCount===1?'premio':'premios'}</small></span>
    </div>
  </section>
  <div class="player-month-list">${groups.map(group=>{
    const tied=group.winners.length>1;
    return `<article class="player-month-card${group.provisional?' is-provisional':''}">
      <header class="player-month-card-head">
        <div><span class="eyebrow">CIERRE MENSUAL</span><h4>${group.label}</h4><p>${monthlyMatchdayLabel(group.matchdays)} · Cierre J${group.matchday}</p></div>
        <div class="player-month-card-status"><span>${group.provisional?'PROVISIONAL':'OFICIAL'}</span><small>${tied?`${group.winners.length} co-ganadores`:'1 ganador'}</small></div>
      </header>
      <div class="player-month-winners">${group.winners.map(winner=>{
        const safeName=profileAttr(winner.name);
        return `<button type="button" class="player-month-winner team-profile-link" ${profileTriggerAttrs(winner.name)}>
          <span class="player-month-winner-medal" aria-hidden="true">${uiIcon('medal')}</span>
          <img src="${imageMap()[winner.name]||''}" alt="Foto de ${safeName}">
          <span class="player-month-winner-copy"><small>${tied?'CO-GANADOR':'GANADOR DEL MES'}</small><strong>${safeName}</strong><span>${winner.played} J · ${winner.goals} GOL · ${winner.cleanSheets} CS · ${winner.redCards} TR</span></span>
          <span class="player-month-winner-points"><b>${winner.points.toLocaleString('es')}</b><small>PTS</small></span>
        </button>`;
      }).join('')}</div>
      ${group.provisional?'<p class="player-month-provisional-note">Hay resultados aplazados en este cierre. El ganador se actualizará automáticamente al publicar la corrección.</p>':''}
    </article>`;
  }).join('')}</div>
  <p class="player-month-note">Solo aparecen meses cerrados y publicados. Si corriges o deshaces una jornada, este historial se recalcula sin duplicar premios.</p>`;
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
  const championsSeasons=historicalTitleIndex().championsSeasons;

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
      const seasons=championsSeasons.get(player.name)||[];
      earned=seasons.length>0;
      meta=earned
        ?seasons.length===1
          ?`Campeón de Champions · ${seasons[0]}`
          :`${seasons.length} Champions · ${seasons.join(', ')}`
        :'';
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
    ${visible.map(item=>`<span class="standings-mini-badge achievement-${item.rarity}" title="${item.name}: ${profileAttr(item.detail)}" aria-label="${item.name}">${achievementIconMarkup(item)}</span>`).join('')}
    ${remaining?`<span class="standings-mini-more" aria-label="${remaining} insignias más">+${remaining}</span>`:''}
  </span>`;
}

function standingsTeamCell(name,snapshot,{playerMonthLabel=''}={}){
  const badges=compactAchievementBadges(name,snapshot,{limit:playerMonthLabel?2:3});
  const monthTitle=playerMonthLabel
    ?`<span class="standings-player-month-pill" title="Jugador del mes · ${profileAttr(playerMonthLabel)}" aria-label="Jugador del mes · ${profileAttr(playerMonthLabel)}">
        ${uiIcon('medal')}<span class="standings-player-month-long">Jugador del mes</span><span class="standings-player-month-short">Del mes</span>
      </span>`
    :'';
  return `<div class="team standings-team team-profile-link" ${profileTriggerAttrs(name)}>
    <img src="${imageMap()[name]||''}" alt="Foto de ${profileAttr(name)}">
    <div class="standings-team-copy">
      <span class="name">${name}</span>
      ${playerMonthLabel?`<span class="standings-title-meta">${monthTitle}${badges}</span>`:badges}
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
        <span class="achievement-catalog-icon" aria-hidden="true">${achievementIconMarkup(item)}</span>
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
        ${visible.map(item=>`<span class="player-mini-badge achievement-${item.rarity}" title="${item.name}: ${profileAttr(item.detail)}" aria-label="${item.name}">${achievementIconMarkup(item)}</span>`).join('')}
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

function profileCurrentSnapshot(name){
  const latestMatchday=PUBLISHED_MATCHDAYS.length?PUBLISHED_MATCHDAYS[PUBLISHED_MATCHDAYS.length-1]:null;
  const standings=latestMatchday==null
    ?activeParticipants().sort(sortStandings).map((participant,index)=>({...participant,position:index+1}))
    :cumulativeStandings(latestMatchday);
  const index=standings.findIndex(participant=>participant.name===name);
  const player=index>=0?standings[index]:null;
  const latestRow=latestMatchday==null
    ?null
    :LIVE_MATCHDAY_ROWS.find(row=>row.matchday===latestMatchday&&row.participantName===name)||null;
  const movement=latestMatchday==null||index<0?null:movementForMatchday(latestMatchday).get(name);
  const recent=PUBLISHED_MATCHDAYS
    .filter(matchday=>latestMatchday==null||matchday<=latestMatchday)
    .slice(-5)
    .map(matchday=>{
      const row=LIVE_MATCHDAY_ROWS.find(item=>item.matchday===matchday&&item.participantName===name)||null;
      return {matchday,points:row?.points??null,played:Boolean(row)};
    });
  return {
    latestMatchday,
    standings,
    player,
    movement,
    latestRow,
    recent,
    above:index>0?standings[index-1]:null,
    below:index>=0&&index<standings.length-1?standings[index+1]:null
  };
}

function profileMovementText(delta){
  if(delta==null)return 'Primera jornada';
  if(delta>0)return `↑ ${delta} ${delta===1?'puesto':'puestos'}`;
  if(delta<0)return `↓ ${Math.abs(delta)} ${Math.abs(delta)===1?'puesto':'puestos'}`;
  return '• Sin cambios';
}

function profileDistanceMarkup(snapshot){
  if(!snapshot.player)return '<span>Sin clasificación disponible</span>';
  const items=[];
  if(snapshot.above){
    const gap=snapshot.above.points-snapshot.player.points;
    items.push(gap===0
      ?`Empatado con el ${ordinal(snapshot.above.position)}`
      :`A ${gap.toLocaleString('es')} ${gap===1?'punto':'puntos'} del ${ordinal(snapshot.above.position)}`);
  }
  if(snapshot.below){
    const gap=snapshot.player.points-snapshot.below.points;
    items.push(gap===0
      ?`Empatado con el ${ordinal(snapshot.below.position)}`
      :`+${gap.toLocaleString('es')} sobre el ${ordinal(snapshot.below.position)}`);
  }
  return items.length?items.map(item=>`<span>${item}</span>`).join('<i aria-hidden="true">·</i>'):'<span>Clasificación sin rivales activos</span>';
}

function profileRecentFormMarkup(snapshot){
  const rows=snapshot.recent.filter(item=>item.played&&Number.isFinite(item.points));
  if(!rows.length)return '<div class="profile-summary-empty">Todavía no hay jornadas publicadas.</div>';
  const maximum=Math.max(1,...rows.map(item=>Math.abs(item.points)));
  const average=rows.reduce((sum,item)=>sum+item.points,0)/rows.length;
  return `<div class="profile-form-bars" style="--profile-form-count:${rows.length}" role="img" aria-label="Puntos recientes: ${rows.map(item=>`jornada ${item.matchday}, ${item.points} puntos`).join('; ')}">
      ${rows.map(item=>{
        const height=Math.max(18,Math.round((Math.abs(item.points)/maximum)*100));
        return `<div class="profile-form-bar${item.points<0?' is-negative':''}"><b>${item.points.toLocaleString('es')}</b><span><i style="height:${height}%"></i></span><small>J${item.matchday}</small></div>`;
      }).join('')}
    </div>
    <p class="profile-form-average">Promedio <b>${average.toLocaleString('es',{minimumFractionDigits:1,maximumFractionDigits:1})}</b></p>`;
}

function profileHeroAwards(name,earnedAchievements){
  const latestMonth=latestOfficialPlayerMonthGroup(monthlyAchievementGroups());
  const isCurrentMonth=latestMonth?.winners.some(winner=>winner.name===name);
  const priority=['pichichi','golden_glove','leader','champion','king_europe'];
  const selected=[];
  if(isCurrentMonth){
    const monthly=earnedAchievements.find(item=>item.id==='player_month');
    if(monthly)selected.push({...monthly,name:`Jugador del mes · ${latestMonth.label}`});
  }
  priority.forEach(id=>{
    const item=earnedAchievements.find(achievement=>achievement.id===id);
    if(item&&selected.length<2)selected.push(item);
  });
  return selected.map(item=>`<span class="profile-hero-award achievement-${item.rarity}"><span aria-hidden="true">${achievementIconMarkup(item)}</span>${profileAttr(item.name)}</span>`).join('');
}

function profileAchievementPreviewMarkup(earnedAchievements){
  const visible=earnedAchievements.slice(0,2);
  if(!visible.length)return '<p class="profile-summary-empty">Aún no tiene insignias desbloqueadas.</p>';
  return visible.map(item=>`<article class="profile-featured-achievement achievement-${item.rarity}">
      <span aria-hidden="true">${achievementIconMarkup(item)}</span>
      <div><small>${item.type}</small><b>${item.name}</b></div>
    </article>`).join('');
}

function profileLatestLineupMarkup(data){
  if(!data)return '<div class="profile-lineup-loading"><span class="lineup-loader" aria-hidden="true"></span><small>Preparando la última alineación…</small></div>';
  const row=[...data.rows].reverse().find(item=>item.players.length===11);
  if(!row)return '<div class="profile-summary-empty">Todavía no hay un XI completo publicado.</div>';
  const counts={PT:0,DF:0,MC:0,DL:0};
  row.players.forEach(player=>{if(counts[player.position]!=null)counts[player.position]+=1});
  const formation=`${counts.DF}-${counts.MC}-${counts.DL}`;
  const captain=row.players.find(player=>player.isCaptain&&!player.isEmptyPosition)||null;
  const lines=['DL','MC','DF','PT'].map(position=>`<span class="profile-lineup-line is-${position.toLowerCase()}">
      ${row.players.filter(player=>player.position===position).map(player=>`<i class="${player.isCaptain?'is-captain':''}${player.isEmptyPosition?' is-empty':''}" title="${profileAttr(player.playerName)}" aria-label="${profileAttr(player.playerName)}${player.isCaptain?', capitán':''}"></i>`).join('')}
    </span>`).join('');
  return `<div class="profile-lineup-preview-head"><div><b>${formation}</b>${captain?`<span><i>C</i>${profileAttr(captain.playerName)}</span>`:'<span>Sin capitán</span>'}</div><small>J${row.matchday}</small></div>
    <div class="profile-lineup-pitch" aria-label="Vista previa de la alineación de la jornada ${row.matchday}">${lines}</div>
    <button type="button" class="profile-lineup-open" ${matchdayLineupTriggerAttrs(data.name,row.matchday,row.hasPostponedMatches)}>Ver XI completo</button>`;
}

function profileCurrentLabel(m,current){
  if(!m.current.active)return 'No participa';
  return m.current.started?ordinal(current.position):'—';
}

function profileLatestLabel(snapshot){
  if(snapshot.latestMatchday==null)return 'Sin jornadas';
  return snapshot.latestRow
    ?`J${snapshot.latestMatchday} · ${snapshot.latestRow.points.toLocaleString('es')} pts`
    :`J${snapshot.latestMatchday} · Pendiente`;
}

function profileScoreHeroMarkup(name,snapshot,current,currentLabel,latestLabel){
  return `<section id="profileCurrentScore" class="profile-score-hero" aria-label="Situación actual de ${profileAttr(name)}">
    <div class="profile-score-rank"><b>${currentLabel}</b><span class="${snapshot.movement>0?'is-up':snapshot.movement<0?'is-down':''}">${profileMovementText(snapshot.movement)}</span></div>
    <div class="profile-score-points"><b>${Number(current.points||0).toLocaleString('es')}</b><span>PTS</span><small>${latestLabel}</small></div>
    <p class="profile-score-distance">${profileDistanceMarkup(snapshot)}</p>
  </section>`;
}

function profileSummaryMetricsMarkup(current,currentLabel){
  return `<section id="profileCurrentMetrics" class="profile-summary-metrics" aria-label="Resumen de temporada">
    <article><span>Posición</span><b>${currentLabel}</b></article>
    <article><span>Puntos</span><b>${Number(current.points||0).toLocaleString('es')}</b></article>
    <article><span>Jornadas</span><b>${current.played||0}</b></article>
    <article><span>Goles</span><b>${current.goals||0}</b></article>
    <div class="profile-summary-secondary"><span>CS <b>${current.cleanSheets||0}</b></span><span>TR <b>${current.redCards||0}</b></span></div>
  </section>`;
}

function profileFormCardMarkup(snapshot){
  return `<section id="profileCurrentForm" class="profile-form-card"><h3>Forma reciente</h3>${profileRecentFormMarkup(snapshot)}</section>`;
}

function refreshOpenProfileCurrentSummary(){
  if(!PROFILE_SEASON_STATE||$('playerModal')?.hidden)return;
  const {name}=PROFILE_SEASON_STATE;
  const m=profileMetrics(name);
  const snapshot=profileCurrentSnapshot(name);
  const current=snapshot.player||m.current;
  const currentLabel=profileCurrentLabel(m,current);
  const latestLabel=profileLatestLabel(snapshot);
  const achievements=playerAchievementState(name);
  const earnedAchievements=achievements.filter(item=>item.earned);
  const achievementPercent=Math.round((earnedAchievements.length/ACHIEVEMENT_CATALOG.length)*100);
  const heroAwards=document.querySelector('#playerModal .profile-hero-awards');
  const score=$('profileCurrentScore');
  const metrics=$('profileCurrentMetrics');
  const form=$('profileCurrentForm');
  const featured=document.querySelector('#playerModal .profile-featured-achievement-grid');
  const achievementPanel=$('profileAchievementsPanel');
  if(heroAwards)heroAwards.innerHTML=profileHeroAwards(name,earnedAchievements);
  if(score)score.outerHTML=profileScoreHeroMarkup(name,snapshot,current,currentLabel,latestLabel);
  if(metrics)metrics.outerHTML=profileSummaryMetricsMarkup(current,currentLabel);
  if(form)form.outerHTML=profileFormCardMarkup(snapshot);
  if(featured)featured.innerHTML=profileAchievementPreviewMarkup(earnedAchievements);
  if(achievementPanel)achievementPanel.innerHTML=profileAchievementsPanelMarkup(achievements,earnedAchievements,achievementPercent);
  if(PROFILE_SEASON_STATE.view==='achievements')requestAnimationFrame(animateProfileAchievementUnlocks);
}

function renderProfileSummarySeasonData(){
  const host=$('profileLatestLineup');
  if(!host||!PROFILE_SEASON_STATE)return;
  if(PROFILE_SEASON_STATE.status==='error'){
    host.innerHTML='<div class="profile-summary-empty">No pudimos cargar la alineación. Puedes intentarlo desde Equipo.</div>';
    return;
  }
  host.innerHTML=profileLatestLineupMarkup(PROFILE_SEASON_STATE.data);
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

function profileSeasonLongLabel(value){
  const season=String(value||'').trim();
  const match=season.match(/^(\d{4})\/(\d{2}|\d{4})$/);
  if(!match)return season.replace('/', '-');
  const ending=match[2].length===2?`${match[1].slice(0,2)}${match[2]}`:match[2];
  return `${match[1]}-${ending}`;
}

function profileSeasonPublishedRowsSignature(rows){
  return JSON.stringify((Array.isArray(rows)?rows:[]).map(row=>[
    row.participantName,
    row.matchday,
    row.points,
    row.goals,
    row.cleanSheets,
    row.redCards,
    row.hasPostponedMatches,
    row.updatedAt
  ]).sort((a,b)=>a[1]-b[1]||String(a[0]).localeCompare(String(b[0]),'es')));
}

function profileSeasonFormat(value,{signed=false}={}){
  const number=matchdayLineupNumericValue(value);
  const absolute=Math.abs(number).toLocaleString('es',{
    minimumFractionDigits:Number.isInteger(number)?0:1,
    maximumFractionDigits:2
  });
  if(number<0)return `−${absolute}`;
  if(signed&&number>0)return `+${absolute}`;
  return absolute;
}

function profileSeasonPlayerKey(player){
  const playerId=String(player?.playerId||'').trim().toLowerCase();
  if(playerId)return `id:${playerId}`;
  const name=String(player?.playerName||'').trim().toLocaleLowerCase('es');
  const club=String(player?.clubId||player?.clubName||'').trim().toLocaleLowerCase('es');
  return `legacy:${name}|${club}`;
}

async function fetchPublishedProfileSeasonRows(name,signal){
  const config=window.CUBAN_LEAGUE_SUPABASE;
  if(!config?.url||!config?.publishableKey)throw new Error('Supabase no está configurado');
  const season=config.season||DATA.currentSeason;
  const endpoint=new URL(`${config.url.replace(/\/$/,'')}/rest/v1/matchday_stats`);
  endpoint.searchParams.set('select','participant_name,matchday,points,goals,clean_sheets,red_cards,has_postponed_matches,lineup,updated_at');
  endpoint.searchParams.set('season',`eq.${season}`);
  endpoint.searchParams.set('participant_name',`eq.${name}`);
  endpoint.searchParams.set('published','eq.true');
  endpoint.searchParams.set('order','matchday.asc');
  endpoint.searchParams.set('limit','60');
  const response=await fetch(endpoint,{
    cache:'no-store',
    signal,
    headers:{
      apikey:config.publishableKey,
      Authorization:`Bearer ${config.publishableKey}`,
      Accept:'application/json'
    }
  });
  if(!response.ok){
    const errorText=await response.text().catch(()=>'');
    if((response.status===400||response.status===404)&&/lineup|schema cache|column/i.test(errorText)){
      const error=new Error('La base de datos todavía no expone las alineaciones V116');
      error.code='LINEUP_SCHEMA_MISSING';
      throw error;
    }
    throw new Error('No se pudo cargar el acumulado de la temporada');
  }
  const rows=await response.json();
  if(!Array.isArray(rows))throw new Error('La respuesta de temporada no es válida');
  return rows;
}

function buildProfileSeasonStats(name,rawRows){
  const rows=(Array.isArray(rawRows)?rawRows:[]).map(row=>({
    participantName:String(row?.participant_name||name).trim(),
    matchday:Math.trunc(matchdayLineupNumericValue(row?.matchday)),
    points:matchdayLineupNumericValue(row?.points),
    goals:Math.max(0,Math.trunc(matchdayLineupNumericValue(row?.goals))),
    cleanSheets:Math.max(0,Math.trunc(matchdayLineupNumericValue(row?.clean_sheets))),
    redCards:Math.max(0,Math.trunc(matchdayLineupNumericValue(row?.red_cards))),
    hasPostponedMatches:row?.has_postponed_matches===true,
    updatedAt:row?.updated_at||null,
    players:normalizePublishedMatchdayLineup(row?.lineup)
  })).filter(row=>Number.isInteger(row.matchday)&&row.matchday>0)
    .sort((a,b)=>a.matchday-b.matchday);

  const playersById=new Map();
  const formations=new Map();
  const positionTotals={PT:0,DF:0,MC:0,DL:0};
  const occupiedPositions=new Set();
  let lineupMatchdays=0;
  let lineupPoints=0;
  let captainBonus=0;

  rows.forEach(row=>{
    const lineup=row.players.length===11?row.players:[];
    if(!lineup.length)return;
    lineupMatchdays+=1;
    const counts={PT:0,DF:0,MC:0,DL:0};
    const playerBases=new Map();
    lineup.forEach(player=>{
      counts[player.position]+=1;
      occupiedPositions.add(player.position);
      const finalPoints=matchdayLineupNumericValue(player.displayedPoints);
      lineupPoints+=finalPoints;
      positionTotals[player.position]+=finalPoints;
      if(player.isEmptyPosition)return;
      const multiplier=player.isCaptain?Math.max(1,matchdayLineupNumericValue(player.captainMultiplier,1)):1;
      const basePoints=player.isCaptain?finalPoints/multiplier:finalPoints;
      playerBases.set(profileSeasonPlayerKey(player),basePoints);

      const key=profileSeasonPlayerKey(player);
      const existing=playersById.get(key)||{
        key,
        playerId:player.playerId||'',
        playerName:player.playerName,
        clubId:player.clubId||'',
        clubName:player.clubName||'',
        photo:player.photo||'',
        crest:player.crest||'',
        position:player.position,
        appearances:0,
        contributionPoints:0,
        basePoints:0,
        captainUses:0,
        captainPoints:0,
        captainBasePoints:0,
        captainBonus:0,
        captainSuccesses:0,
        bestPoints:null,
        bestMatchday:null,
        bestCaptainPoints:null,
        bestCaptainMatchday:null,
        bestCaptainMultiplier:null,
        latestMatchday:0
      };
      existing.appearances+=1;
      existing.contributionPoints+=finalPoints;
      existing.basePoints+=basePoints;
      if(existing.bestPoints===null||finalPoints>existing.bestPoints){
        existing.bestPoints=finalPoints;
        existing.bestMatchday=row.matchday;
      }
      if(player.isCaptain){
        const bonus=finalPoints-basePoints;
        existing.captainUses+=1;
        existing.captainPoints+=finalPoints;
        existing.captainBasePoints+=basePoints;
        existing.captainBonus+=bonus;
        captainBonus+=bonus;
        if(existing.bestCaptainPoints===null||finalPoints>existing.bestCaptainPoints){
          existing.bestCaptainPoints=finalPoints;
          existing.bestCaptainMatchday=row.matchday;
          existing.bestCaptainMultiplier=multiplier;
        }
      }
      if(row.matchday>=existing.latestMatchday){
        existing.playerName=player.playerName;
        existing.clubId=player.clubId||existing.clubId;
        existing.clubName=player.clubName||existing.clubName;
        existing.photo=player.photo||existing.photo;
        existing.crest=player.crest||existing.crest;
        existing.position=player.position;
        existing.latestMatchday=row.matchday;
      }
      playersById.set(key,existing);
    });

    const formation=`${counts.DF}-${counts.MC}-${counts.DL}`;
    formations.set(formation,(formations.get(formation)||0)+1);
    const captain=lineup.find(player=>player.isCaptain);
    if(captain&&playerBases.size){
      const captainKey=profileSeasonPlayerKey(captain);
      const captainRecord=playersById.get(captainKey);
      const maximumBase=Math.max(...playerBases.values());
      if(captainRecord&&Math.abs((playerBases.get(captainKey)||0)-maximumBase)<.0001){
        captainRecord.captainSuccesses+=1;
      }
    }
  });

  const playerRows=[...playersById.values()].map(player=>({
    ...player,
    average:player.appearances?player.contributionPoints/player.appearances:0,
    baseAverage:player.appearances?player.basePoints/player.appearances:0,
    captainAverage:player.captainUses?player.captainPoints/player.captainUses:0
  }));
  const captains=playerRows.filter(player=>player.captainUses>0);
  const officialPoints=rows.reduce((sum,row)=>sum+row.points,0);
  const goals=rows.reduce((sum,row)=>sum+row.goals,0);
  const cleanSheets=rows.reduce((sum,row)=>sum+row.cleanSheets,0);
  const redCards=rows.reduce((sum,row)=>sum+row.redCards,0);
  const favoriteFormation=[...formations.entries()]
    .sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'es'))[0]||null;
  const lineEntries=Object.entries(positionTotals).filter(([position])=>occupiedPositions.has(position));
  const strongestLinePoints=lineEntries.length?Math.max(...lineEntries.map(([,points])=>points)):0;
  const strongestLine=lineEntries.length
    ?{
      positions:lineEntries.filter(([,points])=>Math.abs(points-strongestLinePoints)<.0001).map(([position])=>position),
      points:strongestLinePoints
    }
    :null;
  const bestMatchday=[...rows].sort((a,b)=>b.points-a.points||a.matchday-b.matchday)[0]||null;
  const worstMatchday=[...rows].sort((a,b)=>a.points-b.points||a.matchday-b.matchday)[0]||null;
  const latestUpdate=rows.map(row=>new Date(row.updatedAt)).filter(date=>!Number.isNaN(date.getTime()))
    .sort((a,b)=>b-a)[0]||null;

  return {
    name,
    season:window.CUBAN_LEAGUE_SUPABASE?.season||DATA.currentSeason,
    rows,
    publishedMatchdays:rows.length,
    lineupMatchdays,
    officialPoints,
    officialAverage:rows.length?officialPoints/rows.length:0,
    goals,
    cleanSheets,
    redCards,
    lineupPoints,
    captainBonus,
    uniquePlayers:playerRows.length,
    favoriteFormation:favoriteFormation?{formation:favoriteFormation[0],uses:favoriteFormation[1]}:null,
    strongestLine,
    positionTotals,
    bestMatchday,
    worstMatchday,
    players:playerRows,
    captains,
    latestUpdate
  };
}

function profileSeasonSortedRows(rows,sort,kind){
  const pointsKey=kind==='captains'?'captainPoints':'contributionPoints';
  const usesKey=kind==='captains'?'captainUses':'appearances';
  const averageKey=kind==='captains'?'captainAverage':'average';
  return [...rows].sort((a,b)=>{
    if(sort==='uses')return b[usesKey]-a[usesKey]||b[pointsKey]-a[pointsKey]||a.playerName.localeCompare(b.playerName,'es');
    if(sort==='average')return b[averageKey]-a[averageKey]||b[usesKey]-a[usesKey]||a.playerName.localeCompare(b.playerName,'es');
    return b[pointsKey]-a[pointsKey]||b[usesKey]-a[usesKey]||a.playerName.localeCompare(b.playerName,'es');
  });
}

function profileSeasonPlayerVisual(player){
  const safeName=profileAttr(player.playerName);
  const photo=profileAttr(player.photo||'');
  const crest=profileAttr(player.crest||'');
  const initials=profileAttr(matchdayLineupInitials(player.playerName));
  return `<span class="profile-season-player-photo${photo?' has-photo':''}" aria-hidden="true"><span>${initials}</span>${photo?`<img data-player-catalog-image src="${photo}" alt="" loading="lazy">`:''}</span>
    <span class="profile-season-player-copy">
      <strong>${safeName}</strong>
      <small>${crest?`<img data-player-catalog-image src="${crest}" alt="" loading="lazy">`:''}${profileAttr(player.clubName||'Club no registrado')} · ${profileAttr(player.position)}</small>
    </span>`;
}

function leagueStatsPlayerKey(player){
  const playerId=String(player?.playerId||'').trim().toLowerCase();
  if(playerId)return `id:${playerId}`;
  const name=String(player?.playerName||'').normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const club=String(player?.clubId||player?.clubName||'').normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  return `legacy:${name}|${club}`;
}

async function fetchPublishedLeagueStatsRows(signal){
  const config=window.CUBAN_LEAGUE_SUPABASE;
  if(!config?.url||!config?.publishableKey)throw new Error('Supabase no está configurado');
  const season=config.season||DATA.currentSeason;
  const pageSize=500;
  const rows=[];
  for(let offset=0;offset<10000;offset+=pageSize){
    const endpoint=new URL(`${config.url.replace(/\/$/,'')}/rest/v1/matchday_stats`);
    endpoint.searchParams.set('select','participant_name,matchday,points,goals,clean_sheets,lineup,updated_at');
    endpoint.searchParams.set('season',`eq.${season}`);
    endpoint.searchParams.set('published','eq.true');
    endpoint.searchParams.set('order','matchday.asc,participant_name.asc');
    endpoint.searchParams.set('limit',String(pageSize));
    endpoint.searchParams.set('offset',String(offset));
    const response=await fetch(endpoint,{
      cache:'no-store',
      signal,
      headers:{
        apikey:config.publishableKey,
        Authorization:`Bearer ${config.publishableKey}`,
        Accept:'application/json'
      }
    });
    if(!response.ok){
      const errorText=await response.text().catch(()=>'');
      if((response.status===400||response.status===404)&&/lineup|schema cache|column/i.test(errorText)){
        const error=new Error('La base de datos todavía no expone las alineaciones V116');
        error.code='LINEUP_SCHEMA_MISSING';
        throw error;
      }
      throw new Error('No se pudieron cargar las estadísticas de la competición');
    }
    const page=await response.json();
    if(!Array.isArray(page))throw new Error('La respuesta de estadísticas no es válida');
    rows.push(...page);
    if(page.length<pageSize)return rows;
  }
  throw new Error('La respuesta de estadísticas superó el límite de seguridad');
}

function buildLeagueStats(rawRows){
  const participants=activeParticipants();
  const validNames=new Set(participants.map(participant=>participant.name));
  const teamsByName=new Map(participants.map(participant=>[participant.name,{
    name:participant.name,
    shield:participant.shield||'',
    publishedRows:0,
    lineupMatchdays:0,
    officialPoints:0,
    goals:0,
    cleanSheets:0,
    positionTotals:{PT:0,DF:0,MC:0,DL:0},
    playersByKey:new Map()
  }]));
  const uniqueRows=new Map();
  (Array.isArray(rawRows)?rawRows:[]).forEach(row=>{
    const participantName=String(row?.participant_name||'').trim();
    const matchday=Math.trunc(matchdayLineupNumericValue(row?.matchday));
    if(!validNames.has(participantName)||!Number.isInteger(matchday)||matchday<1)return;
    const key=`${participantName}\u0000${matchday}`;
    const current=uniqueRows.get(key);
    const currentTime=new Date(current?.updated_at||0).getTime()||0;
    const nextTime=new Date(row?.updated_at||0).getTime()||0;
    if(!current||nextTime>=currentTime)uniqueRows.set(key,{...row,participantName,matchday});
  });
  const rows=[...uniqueRows.values()].sort((a,b)=>a.matchday-b.matchday||a.participantName.localeCompare(b.participantName,'es'));
  const publishedMatchdays=new Set();
  let lineupRows=0;
  rows.forEach(row=>{
    const team=teamsByName.get(row.participantName);
    if(!team)return;
    team.publishedRows+=1;
    team.officialPoints+=matchdayLineupNumericValue(row.points);
    team.goals+=Math.max(0,Math.trunc(matchdayLineupNumericValue(row.goals)));
    team.cleanSheets+=Math.max(0,Math.trunc(matchdayLineupNumericValue(row.clean_sheets)));
    publishedMatchdays.add(row.matchday);
    const lineup=normalizePublishedMatchdayLineup(row.lineup);
    if(lineup.length!==11)return;
    team.lineupMatchdays+=1;
    lineupRows+=1;
    lineup.forEach(player=>{
      const finalPoints=matchdayLineupNumericValue(player.displayedPoints);
      team.positionTotals[player.position]+=finalPoints;
      if(player.isEmptyPosition)return;
      const multiplier=player.isCaptain?Math.max(1,matchdayLineupNumericValue(player.captainMultiplier,1)):1;
      const basePoints=player.isCaptain?finalPoints/multiplier:finalPoints;
      const key=leagueStatsPlayerKey(player);
      const existing=team.playersByKey.get(key)||{
        key,
        playerId:player.playerId||'',
        playerName:player.playerName,
        clubId:player.clubId||'',
        clubName:player.clubName||'',
        photo:player.photo||'',
        crest:player.crest||'',
        position:player.position,
        appearances:0,
        contributionPoints:0,
        basePoints:0,
        captainUses:0,
        captainPoints:0,
        captainBasePoints:0,
        captainBonus:0,
        bestPoints:null,
        bestMatchday:null,
        latestMatchday:0
      };
      existing.appearances+=1;
      existing.contributionPoints+=finalPoints;
      existing.basePoints+=basePoints;
      if(existing.bestPoints===null||finalPoints>existing.bestPoints){
        existing.bestPoints=finalPoints;
        existing.bestMatchday=row.matchday;
      }
      if(player.isCaptain){
        existing.captainUses+=1;
        existing.captainPoints+=finalPoints;
        existing.captainBasePoints+=basePoints;
        existing.captainBonus+=finalPoints-basePoints;
      }
      if(row.matchday>=existing.latestMatchday){
        existing.playerName=player.playerName;
        existing.clubId=player.clubId||existing.clubId;
        existing.clubName=player.clubName||existing.clubName;
        existing.photo=player.photo||existing.photo;
        existing.crest=player.crest||existing.crest;
        existing.position=player.position;
        existing.latestMatchday=row.matchday;
      }
      team.playersByKey.set(key,existing);
    });
  });
  const tiedMaximum=(records,valueFor)=>{
    if(!records.length)return [];
    const maximum=Math.max(...records.map(valueFor));
    return records.filter(record=>Math.abs(valueFor(record)-maximum)<.0001);
  };
  const teams=[...teamsByName.values()].map(team=>{
    const players=[...team.playersByKey.values()].map(player=>({
      ...player,
      average:player.appearances?player.contributionPoints/player.appearances:0,
      captainAverage:player.captainUses?player.captainPoints/player.captainUses:0
    }));
    const captains=players.filter(player=>player.captainUses>0);
    const topCaptainsByPoints=tiedMaximum(captains,player=>player.captainPoints)
      .sort((a,b)=>b.captainUses-a.captainUses||b.captainAverage-a.captainAverage||a.playerName.localeCompare(b.playerName,'es'));
    const topCaptainsByAverage=tiedMaximum(captains,player=>player.captainAverage)
      .sort((a,b)=>b.captainUses-a.captainUses||b.captainPoints-a.captainPoints||a.playerName.localeCompare(b.playerName,'es'));
    const mvps=tiedMaximum(players,player=>player.contributionPoints)
      .sort((a,b)=>b.appearances-a.appearances||a.playerName.localeCompare(b.playerName,'es'));
    const totalLinePoints=Object.values(team.positionTotals).reduce((sum,value)=>sum+value,0);
    return {
      name:team.name,
      shield:team.shield,
      publishedRows:team.publishedRows,
      lineupMatchdays:team.lineupMatchdays,
      officialPoints:team.officialPoints,
      goals:team.goals,
      cleanSheets:team.cleanSheets,
      positionTotals:team.positionTotals,
      totalLinePoints,
      players,
      captains,
      topCaptainsByPoints,
      topCaptainsByAverage,
      mvps
    };
  });
  const lineRankings=Object.fromEntries(['PT','DF','MC','DL'].map(position=>[
    position,
    [...teams].filter(team=>team.lineupMatchdays>0).sort((a,b)=>
      b.positionTotals[position]-a.positionTotals[position]
      ||b.lineupMatchdays-a.lineupMatchdays
      ||a.name.localeCompare(b.name,'es')
    )
  ]));
  const latestUpdate=rows.map(row=>new Date(row.updated_at)).filter(date=>!Number.isNaN(date.getTime()))
    .sort((a,b)=>b-a)[0]||null;
  return {
    season:window.CUBAN_LEAGUE_SUPABASE?.season||DATA.currentSeason,
    publishedRows:rows.length,
    publishedMatchdays:publishedMatchdays.size,
    lineupRows,
    teamsWithLineups:teams.filter(team=>team.lineupMatchdays>0).length,
    teams,
    lineRankings,
    latestUpdate
  };
}

function leagueStatsTeamVisual(team){
  const safeName=profileAttr(team.name);
  const shield=profileAttr(team.shield||'');
  return `<div class="league-stats-team" ${profileTriggerAttrs(team.name)}>
    ${shield?`<img src="${shield}" alt="">`:''}
    <span><strong>${safeName}</strong><small>${team.lineupMatchdays} ${team.lineupMatchdays===1?'XI registrado':'XI registrados'}</small></span>
  </div>`;
}

function leagueStatsTiedPlayerVisual(players,emptyLabel='Sin capitán registrado'){
  const records=Array.isArray(players)?players:[];
  if(!records.length)return `<div class="league-stats-no-player"><b>${emptyLabel}</b><small>Esperando una alineación publicada</small></div>`;
  const first=records[0];
  const tiedNames=records.length>1?records.map(player=>player.playerName).join(' / '):'';
  return `<div class="league-stats-player-wrap">${profileSeasonPlayerVisual(first)}${records.length>1?`<span class="league-stats-tie">Empate: ${profileAttr(tiedNames)} · métricas mostradas de ${profileAttr(first.playerName)}</span>`:''}</div>`;
}

function leagueComparatorResolveTeams(data){
  const teams=[...(data?.teams||[])];
  const names=new Set(teams.map(team=>team.name));
  const ordered=[...teams].sort((a,b)=>
    Number(b.publishedRows>0)-Number(a.publishedRows>0)
    ||Number(b.lineupMatchdays>0)-Number(a.lineupMatchdays>0)
    ||b.officialPoints-a.officialPoints
    ||b.publishedRows-a.publishedRows
    ||a.name.localeCompare(b.name,'es')
  );
  if(!names.has(LEAGUE_COMPARATOR_STATE.leftName)){
    LEAGUE_COMPARATOR_STATE.leftName=ordered[0]?.name||'';
  }
  if(!names.has(LEAGUE_COMPARATOR_STATE.rightName)||LEAGUE_COMPARATOR_STATE.rightName===LEAGUE_COMPARATOR_STATE.leftName){
    LEAGUE_COMPARATOR_STATE.rightName=ordered.find(team=>team.name!==LEAGUE_COMPARATOR_STATE.leftName)?.name||'';
  }
  return {
    teams,
    left:teams.find(team=>team.name===LEAGUE_COMPARATOR_STATE.leftName)||null,
    right:teams.find(team=>team.name===LEAGUE_COMPARATOR_STATE.rightName)||null
  };
}

function leagueComparatorResult(leftValue,rightValue,leftAvailable=true,rightAvailable=true){
  if(!leftAvailable||!rightAvailable)return 'unavailable';
  const left=matchdayLineupNumericValue(leftValue);
  const right=matchdayLineupNumericValue(rightValue);
  if(Math.abs(left-right)<.0001)return 'tie';
  return left>right?'left':'right';
}

function leagueComparatorLeaderBadge(side,result){
  if(result==='tie')return '<span class="league-comparator-leader is-tie">EMPATE</span>';
  if(result!==side)return '';
  return '<span class="league-comparator-leader">★ LÍDER</span>';
}

function leagueComparatorSelectMarkup(teams,selected,disabled,label,side){
  return `<label class="league-comparator-select is-${side}"><span>${label}</span><select data-league-comparator-side="${side}" aria-label="${label}">
      ${teams.map(team=>`<option value="${profileAttr(team.name)}"${team.name===selected?' selected':''}${team.name===disabled?' disabled':''}>${profileAttr(team.name)}</option>`).join('')}
    </select></label>`;
}

function leagueComparatorHeroTeamMarkup(team,side,result){
  const safeName=profileAttr(team.name);
  const shield=profileAttr(team.shield||'');
  const available=team.publishedRows>0;
  return `<article class="league-comparator-hero-team is-${side}${result===side?' is-winner':''}" ${profileTriggerAttrs(team.name)}>
      <div class="league-comparator-avatar">${shield?`<img src="${shield}" alt="Foto de ${safeName}">`:`<span>${profileAttr(matchdayLineupInitials(team.name))}</span>`}</div>
      <h3>${safeName}</h3>
      <strong>${available?profileSeasonFormat(team.officialPoints):'—'}<small> pts</small></strong>
      ${leagueComparatorLeaderBadge(side,result)}
      <span class="league-comparator-games">${team.publishedRows} ${team.publishedRows===1?'jornada oficial':'jornadas oficiales'}</span>
    </article>`;
}

function leagueComparatorPlayerCard(team,side,type,result){
  const isCaptain=type==='captain';
  const records=isCaptain?team.topCaptainsByPoints:team.mvps;
  const player=records[0]||null;
  const points=player?(isCaptain?player.captainPoints:player.contributionPoints):0;
  const uses=player?(isCaptain?player.captainUses:player.appearances):0;
  const average=player?(isCaptain?player.captainAverage:player.average):0;
  const title=isCaptain?'MEJOR CAPITÁN':'MVP';
  return `<article class="league-comparator-player-card is-${side} is-${type}${result===side?' is-winner':''}">
      <header><span>${isCaptain?uiIcon('crown'):uiIcon('star')}</span><b>${title}</b>${leagueComparatorLeaderBadge(side,result)}</header>
      ${player?`<div class="league-comparator-player">${profileSeasonPlayerVisual(player)}</div>
        <div class="league-comparator-player-numbers"><strong>${profileSeasonFormat(points)} pts</strong><span>${uses} ${uses===1?'jornada':'jornadas'} · ${profileSeasonFormat(average)} prom.</span></div>
        ${records.length>1?`<small class="league-comparator-shared">Liderato compartido entre ${records.length} jugadores</small>`:''}`
        :`<div class="league-comparator-player-empty"><b>Sin ${isCaptain?'capitán':'MVP'} registrado</b><span>Esperando un XI completo</span></div>`}
    </article>`;
}

function leagueComparatorLineMarkup(left,right){
  const labels={PT:'Portería',DF:'Defensa',MC:'Mediocampo',DL:'Delantera'};
  return ['PT','DF','MC','DL'].map(position=>{
    const leftAvailable=left.lineupMatchdays>0;
    const rightAvailable=right.lineupMatchdays>0;
    const leftValue=left.positionTotals[position];
    const rightValue=right.positionTotals[position];
    const result=leagueComparatorResult(leftValue,rightValue,leftAvailable,rightAvailable);
    const scaleMinimum=Math.min(0,leftValue,rightValue);
    const scaleMaximum=Math.max(0,leftValue,rightValue);
    const scaleRange=scaleMaximum-scaleMinimum;
    const visualWidth=(value,available)=>{
      if(!available)return 0;
      if(scaleRange<.0001)return Math.abs(value)<.0001?0:100;
      if(scaleMinimum<0)return Math.min(100,Math.max(12,12+(value-scaleMinimum)/scaleRange*88));
      return scaleMaximum>0?Math.min(100,Math.max(0,value/scaleMaximum*100)):0;
    };
    const leftWidth=visualWidth(leftValue,leftAvailable);
    const rightWidth=visualWidth(rightValue,rightAvailable);
    const resultText=result==='left'?`${left.name} lidera`:result==='right'?`${right.name} lidera`:result==='tie'?'empate':'comparación no disponible';
    const aria=`${labels[position]}: ${left.name}, ${leftAvailable?`${profileSeasonFormat(leftValue)} puntos`:'sin XI'}; ${right.name}, ${rightAvailable?`${profileSeasonFormat(rightValue)} puntos`:'sin XI'}. Resultado: ${resultText}`;
    return `<div class="league-comparator-line" role="img" aria-label="${profileAttr(aria)}">
      <strong class="is-left${result==='left'?' is-winner':''}">${leftAvailable?profileSeasonFormat(leftValue):'—'}${result==='left'?'<span aria-hidden="true">★</span>':''}</strong>
      <span class="league-comparator-track is-left${leftValue<0?' is-negative':''}"><i style="--compare-width:${leftWidth.toFixed(2)}%"></i></span>
      <b title="${labels[position]}">${position}</b>
      <span class="league-comparator-track is-right${rightValue<0?' is-negative':''}"><i style="--compare-width:${rightWidth.toFixed(2)}%"></i></span>
      <strong class="is-right${result==='right'?' is-winner':''}">${result==='right'?'<span aria-hidden="true">★</span>':''}${rightAvailable?profileSeasonFormat(rightValue):'—'}</strong>
      ${result==='tie'?'<small>EMPATE</small>':''}
    </div>`;
  }).join('');
}

function leagueComparatorOfficialMetricMarkup(label,icon,left,right,key){
  const leftAvailable=left.publishedRows>0;
  const rightAvailable=right.publishedRows>0;
  const leftValue=left[key];
  const rightValue=right[key];
  const result=leagueComparatorResult(leftValue,rightValue,leftAvailable,rightAvailable);
  const resultText=result==='left'?`${left.name} lidera`:result==='right'?`${right.name} lidera`:result==='tie'?'empate':'comparación no disponible';
  return `<article class="league-comparator-official-metric" aria-label="${profileAttr(`${label}: ${left.name}, ${leftAvailable?profileSeasonFormat(leftValue):'sin datos'}; ${right.name}, ${rightAvailable?profileSeasonFormat(rightValue):'sin datos'}. Resultado: ${resultText}`)}">
    <span class="league-comparator-official-icon">${uiIcon(icon)}</span>
    <div class="is-left${result==='left'?' is-winner':''}"><strong>${leftAvailable?profileSeasonFormat(leftValue):'—'}</strong>${result==='left'?'<small>★ LÍDER</small>':''}</div>
    <b>${label}</b>
    <div class="is-right${result==='right'?' is-winner':''}"><strong>${rightAvailable?profileSeasonFormat(rightValue):'—'}</strong>${result==='right'?'<small>★ LÍDER</small>':''}</div>
    ${result==='tie'?'<span class="league-comparator-metric-tie">EMPATE</span>':''}
  </article>`;
}

function renderLeagueComparatorContent(){
  const host=$('leagueComparatorContent');
  if(!host)return;
  if(LEAGUE_STATS_STATE.status==='idle'||(LEAGUE_STATS_STATE.status==='loading'&&!LEAGUE_STATS_STATE.data)){
    host.innerHTML=leagueStatsLoadingMarkup().replace('Calculando la competición','Preparando el cara a cara').replace('Sumando capitanes, líneas y MVP de todos los XI publicados…','Reuniendo los datos oficiales de ambos participantes…');
    return;
  }
  if(LEAGUE_STATS_STATE.status==='error'&&!LEAGUE_STATS_STATE.data){
    host.innerHTML=leagueStatsErrorMarkup(LEAGUE_STATS_STATE.error);
    return;
  }
  const data=LEAGUE_STATS_STATE.data;
  if(!data){
    host.innerHTML=leagueStatsLoadingMarkup();
    return;
  }
  const {teams,left,right}=leagueComparatorResolveTeams(data);
  if(!left||!right){
    host.innerHTML='<div class="league-stats-empty"><span>VS</span><h3>Faltan participantes</h3><p>El comparador necesita al menos dos participantes activos.</p></div>';
    return;
  }
  const pointsResult=leagueComparatorResult(left.officialPoints,right.officialPoints,left.publishedRows>0,right.publishedRows>0);
  const leftMvp=left.mvps[0]||null;
  const rightMvp=right.mvps[0]||null;
  const mvpResult=leagueComparatorResult(leftMvp?.contributionPoints,rightMvp?.contributionPoints,Boolean(leftMvp),Boolean(rightMvp));
  const leftCaptain=left.topCaptainsByPoints[0]||null;
  const rightCaptain=right.topCaptainsByPoints[0]||null;
  const captainResult=leagueComparatorResult(leftCaptain?.captainPoints,rightCaptain?.captainPoints,Boolean(leftCaptain),Boolean(rightCaptain));
  const officialCoverageDiffers=left.publishedRows!==right.publishedRows;
  const lineupCoverageDiffers=left.lineupMatchdays!==right.lineupMatchdays;
  const unequalCoverage=officialCoverageDiffers||lineupCoverageDiffers;
  host.innerHTML=`<section class="league-comparator-shell league-comparator-panel" aria-labelledby="leagueComparatorTitle">
    <header class="league-comparator-heading">
      <div><span class="eyebrow">TEMPORADA ${profileSeasonLongLabel(data.season)}</span><h3 id="leagueComparatorTitle">Comparador de participantes</h3><p>Enfrenta su temporada, sus figuras y el rendimiento de cada línea.</p></div>
      <span class="league-comparator-heading-mark">VS</span>
    </header>
    <div class="league-comparator-selectors">
      ${leagueComparatorSelectMarkup(teams,left.name,right.name,'Participante izquierdo','left')}
      <button type="button" class="league-comparator-swap" data-league-comparator-swap aria-label="Intercambiar participantes" title="Intercambiar participantes"><span aria-hidden="true">⇄</span></button>
      ${leagueComparatorSelectMarkup(teams,right.name,left.name,'Participante derecho','right')}
    </div>
    <div class="league-comparator-faceoff">
      ${leagueComparatorHeroTeamMarkup(left,'left',pointsResult)}
      <div class="league-comparator-vs" aria-hidden="true"><span>VS</span><small>PTS</small></div>
      ${leagueComparatorHeroTeamMarkup(right,'right',pointsResult)}
    </div>
    <div class="league-comparator-player-grid">
      ${leagueComparatorPlayerCard(left,'left','mvp',mvpResult)}
      ${leagueComparatorPlayerCard(right,'right','mvp',mvpResult)}
      ${leagueComparatorPlayerCard(left,'left','captain',captainResult)}
      ${leagueComparatorPlayerCard(right,'right','captain',captainResult)}
    </div>
    <section class="league-comparator-lines">
      <div class="league-comparator-section-title"><span class="eyebrow">XI PUBLICADOS</span><h4>Rendimiento por líneas</h4></div>
      <div class="league-comparator-line-head"><span>${profileAttr(left.name)}</span><span>${profileAttr(right.name)}</span></div>
      ${leagueComparatorLineMarkup(left,right)}
    </section>
    <div class="league-comparator-official-grid">
      ${leagueComparatorOfficialMetricMarkup('GOLES','ball',left,right,'goals')}
      ${leagueComparatorOfficialMetricMarkup('CLEAN SHEETS','shield',left,right,'cleanSheets')}
    </div>
    <div class="league-comparator-coverage${unequalCoverage?' is-unequal':''}">
      <span><b>${left.publishedRows}</b> jornadas oficiales · <b>${left.lineupMatchdays}</b> XI completos</span>
      <span><b>${right.publishedRows}</b> jornadas oficiales · <b>${right.lineupMatchdays}</b> XI completos</span>
      ${unequalCoverage?`<small>La cobertura ${officialCoverageDiffers&&lineupCoverageDiffers?'de jornadas oficiales y XI':officialCoverageDiffers?'de jornadas oficiales':'de XI'} es diferente; compara los acumulados con cautela.</small>`:''}
    </div>
    <p class="league-comparator-updated">${LEAGUE_STATS_STATE.status==='loading'
      ?'Actualizando…'
      :LEAGUE_STATS_STATE.error
        ?`Mostrando datos anteriores · ${profileAttr(LEAGUE_STATS_STATE.error)}`
        :`Datos publicados${data.latestUpdate?` · ${new Intl.DateTimeFormat('es',{dateStyle:'medium',timeStyle:'short'}).format(data.latestUpdate)}`:''}`}</p>
  </section>`;
}

function setLeagueComparatorParticipant(side,name,{focus=false}={}){
  const data=LEAGUE_STATS_STATE.data;
  if(!data||!['left','right'].includes(side))return;
  const names=new Set(data.teams.map(team=>team.name));
  if(!names.has(name))return;
  const currentKey=side==='left'?'leftName':'rightName';
  const otherKey=side==='left'?'rightName':'leftName';
  const previous=LEAGUE_COMPARATOR_STATE[currentKey];
  if(name===LEAGUE_COMPARATOR_STATE[otherKey]){
    LEAGUE_COMPARATOR_STATE[otherKey]=previous;
  }
  LEAGUE_COMPARATOR_STATE[currentKey]=name;
  leagueComparatorResolveTeams(data);
  renderLeagueComparatorContent();
  if(focus){
    requestAnimationFrame(()=>document.querySelector(`[data-league-comparator-side="${side}"]`)?.focus());
  }
}

function swapLeagueComparatorParticipants({focus=false}={}){
  const previous=LEAGUE_COMPARATOR_STATE.leftName;
  LEAGUE_COMPARATOR_STATE.leftName=LEAGUE_COMPARATOR_STATE.rightName;
  LEAGUE_COMPARATOR_STATE.rightName=previous;
  renderLeagueComparatorContent();
  if(focus){
    requestAnimationFrame(()=>document.querySelector('[data-league-comparator-swap]')?.focus());
  }
}

function leagueStatsCompetitionRanks(rows,valueFor){
  let previous=null;
  let rank=0;
  return rows.map((row,index)=>{
    const value=valueFor(row);
    if(index===0||Math.abs(value-previous)>.0001)rank=index+1;
    previous=value;
    return {row,rank};
  });
}

function leagueStatsCaptainMarkup(data){
  const mode=LEAGUE_STATS_STATE.captainMode==='average'?'average':'points';
  const leadersFor=team=>mode==='average'?team.topCaptainsByAverage:team.topCaptainsByPoints;
  const metricFor=team=>{
    const leader=leadersFor(team)[0];
    return leader?(mode==='average'?leader.captainAverage:leader.captainPoints):Number.NEGATIVE_INFINITY;
  };
  const teams=[...data.teams].sort((a,b)=>metricFor(b)-metricFor(a)||b.lineupMatchdays-a.lineupMatchdays||a.name.localeCompare(b.name,'es'));
  const ranked=leagueStatsCompetitionRanks(teams,team=>metricFor(team));
  return `<div class="league-stats-toolbar" role="group" aria-label="Orden de capitanes">
      <span>Comparar por</span>
      <button type="button" data-league-captain-mode="points" aria-pressed="${mode==='points'}">Más puntos</button>
      <button type="button" data-league-captain-mode="average" aria-pressed="${mode==='average'}">Mejor promedio</button>
    </div>
    <div class="league-stats-explainer"><b>Un líder por equipo</b><span>${mode==='points'?'El capitán que más puntos finales generó para cada participante.':'El capitán con mejor promedio final de cada participante; las jornadas utilizadas siempre quedan visibles.'}</span></div>
    <div class="league-stats-ranking" role="list">
      ${ranked.map(({row:team,rank})=>{
        const leaders=leadersFor(team);
        const player=leaders[0]||null;
        const both=player&&team.topCaptainsByPoints.some(item=>item.key===player.key)&&team.topCaptainsByAverage.some(item=>item.key===player.key);
        return `<article class="league-stats-captain-card${player?'':' is-empty'}" role="listitem">
          <span class="league-stats-rank">${player?rank:'—'}</span>
          ${leagueStatsTeamVisual(team)}
          <div class="league-stats-captain-player">
            ${leagueStatsTiedPlayerVisual(leaders)}
            ${player?`<div class="league-stats-tags"><span>${mode==='points'?'Más puntos':'Mejor promedio'}</span>${both?'<span class="is-double">Líder en ambos</span>':''}</div>`:''}
          </div>
          <div class="league-stats-metrics">
            <div><span>Puntos</span><b>${player?profileSeasonFormat(player.captainPoints):'—'}</b></div>
            <div><span>Jornadas</span><b>${player?player.captainUses:'—'}</b></div>
            <div><span>Promedio</span><b>${player?profileSeasonFormat(player.captainAverage):'—'}</b></div>
            <div><span>Bono</span><b class="${player?.captainBonus<0?'is-negative':'is-positive'}">${player?profileSeasonFormat(player.captainBonus,{signed:true}):'—'}</b></div>
          </div>
        </article>`;
      }).join('')}
    </div>
    <p class="league-stats-note">Los puntos del capitán son los finales, ya multiplicados. El bono indica el efecto estimado del brazalete.</p>`;
}

function leagueStatsLineMarkup(data){
  const position=['PT','DF','MC','DL'].includes(LEAGUE_STATS_STATE.linePosition)?LEAGUE_STATS_STATE.linePosition:'all';
  const positions=['PT','DF','MC','DL'];
  const positionLabels={PT:'Portería',DF:'Defensa',MC:'Mediocampo',DL:'Delantera'};
  const valueFor=team=>position==='all'?team.totalLinePoints:team.positionTotals[position];
  const teams=[...data.teams].sort((a,b)=>{
    const aMissing=a.lineupMatchdays===0;
    const bMissing=b.lineupMatchdays===0;
    if(aMissing!==bMissing)return aMissing?1:-1;
    return valueFor(b)-valueFor(a)||b.lineupMatchdays-a.lineupMatchdays||a.name.localeCompare(b.name,'es');
  });
  const ranked=leagueStatsCompetitionRanks(teams,team=>team.lineupMatchdays?valueFor(team):Number.NEGATIVE_INFINITY);
  return `<div class="league-stats-line-leaders">
      ${positions.map(line=>{
        const ranking=data.lineRankings[line]||[];
        const best=ranking[0]?.positionTotals[line];
        const leaders=ranking.filter(team=>Math.abs(team.positionTotals[line]-best)<.0001);
        return `<article><span>${line}</span><b>${leaders.length?profileSeasonFormat(best):'—'}</b><small>${leaders.length?profileAttr(leaders.map(team=>team.name).join(' / ')):'Sin XI registrados'}</small></article>`;
      }).join('')}
    </div>
    <div class="league-stats-toolbar" role="group" aria-label="Ordenar líneas">
      <span>Ordenar por</span>
      ${[['all','Todas'],...positions.map(line=>[line,line])].map(([value,label])=>`<button type="button" data-league-line-position="${value}" aria-pressed="${position===value}">${label}</button>`).join('')}
    </div>
    <div class="league-stats-explainer"><b>${position==='all'?'Todas las líneas':positionLabels[position]}</b><span>Puntos acumulados de los XI publicados; el aporte del capitán permanece dentro de su posición.</span></div>
    <div class="league-stats-ranking" role="list">
      ${ranked.map(({row:team,rank})=>`<article class="league-stats-line-card${team.lineupMatchdays?'':' is-empty'}" role="listitem">
        <span class="league-stats-rank">${team.lineupMatchdays?rank:'—'}</span>
        ${leagueStatsTeamVisual(team)}
        <div class="league-stats-line-metrics">
          ${positions.map(line=>`<div class="${position===line?'is-selected':''}"><span>${line}</span><b>${team.lineupMatchdays?profileSeasonFormat(team.positionTotals[line]):'—'}</b></div>`).join('')}
        </div>
        <div class="league-stats-line-total"><span>${position==='all'?'Total del XI':positionLabels[position]}</span><b>${team.lineupMatchdays?profileSeasonFormat(valueFor(team)):'—'}</b><small>${team.lineupMatchdays?`${profileSeasonFormat(valueFor(team)/team.lineupMatchdays)} pts por XI`:'Sin alineaciones'}</small></div>
      </article>`).join('')}
    </div>
    <p class="league-stats-note">PT + DF + MC + DL equivale a todos los puntos registrados en las alineaciones de ese participante.</p>`;
}

function leagueStatsMvpMarkup(data){
  const teams=[...data.teams].sort((a,b)=>{
    const aValue=a.mvps[0]?.contributionPoints??Number.NEGATIVE_INFINITY;
    const bValue=b.mvps[0]?.contributionPoints??Number.NEGATIVE_INFINITY;
    return bValue-aValue||b.lineupMatchdays-a.lineupMatchdays||a.name.localeCompare(b.name,'es');
  });
  const ranked=leagueStatsCompetitionRanks(teams,team=>team.mvps[0]?.contributionPoints??Number.NEGATIVE_INFINITY);
  return `<div class="league-stats-explainer"><b>MVP histórico de cada equipo</b><span>Es el futbolista que más puntos aportó mientras pertenecía a ese participante. Un traspaso inicia un acumulado separado en el nuevo equipo.</span></div>
    <div class="league-stats-ranking" role="list">
      ${ranked.map(({row:team,rank})=>`<article class="league-stats-mvp-card${team.mvps.length?'':' is-empty'}" role="listitem">
        <span class="league-stats-rank">${team.mvps.length?rank:'—'}</span>
        ${leagueStatsTeamVisual(team)}
        <div class="league-stats-mvp-players">
          ${team.mvps.length?team.mvps.slice(0,1).map(player=>`<div class="league-stats-mvp-player">
            ${profileSeasonPlayerVisual(player)}
            <div class="league-stats-mvp-metrics"><span><small>Puntos</small><b>${profileSeasonFormat(player.contributionPoints)}</b></span><span><small>Jornadas</small><b>${player.appearances}</b></span><span><small>Promedio</small><b>${profileSeasonFormat(player.average)}</b></span></div>
          </div>`).join(''):'<div class="league-stats-no-player"><b>Sin MVP registrado</b><small>Esperando un XI publicado</small></div>'}
          ${team.mvps.length>1?`<span class="league-stats-tie">MVP compartido entre ${team.mvps.length} jugadores · se muestra una referencia</span>`:''}
        </div>
      </article>`).join('')}
    </div>
    <p class="league-stats-note">Si el mismo futbolista cambia de participante, sus puntos anteriores permanecen en el equipo donde los consiguió.</p>`;
}

function leagueStatsLoadingMarkup(){
  return `<div class="league-stats-loading" role="status" aria-live="polite"><span class="lineup-loader" aria-hidden="true"></span><div><b>Calculando la competición</b><small>Sumando capitanes, líneas y MVP de todos los XI publicados…</small></div></div>`;
}

function leagueStatsErrorMarkup(message){
  return `<div class="league-stats-empty is-error" role="alert"><span>!</span><h3>No pudimos cargar las estadísticas</h3><p>${profileAttr(message||'Inténtalo nuevamente.')}</p><button type="button" data-league-stats-retry>Volver a intentar</button></div>`;
}

function renderLeagueStatsContent(){
  renderLeagueComparatorContent();
  const host=$('leagueStatsContent');
  if(!host)return;
  if(LEAGUE_STATS_STATE.status==='idle'||(LEAGUE_STATS_STATE.status==='loading'&&!LEAGUE_STATS_STATE.data)){
    host.innerHTML=leagueStatsLoadingMarkup();
    return;
  }
  if(LEAGUE_STATS_STATE.status==='error'&&!LEAGUE_STATS_STATE.data){
    host.innerHTML=leagueStatsErrorMarkup(LEAGUE_STATS_STATE.error);
    return;
  }
  const data=LEAGUE_STATS_STATE.data;
  if(!data){
    host.innerHTML=leagueStatsLoadingMarkup();
    return;
  }
  const section=['captains','lines','mvp'].includes(LEAGUE_STATS_STATE.section)?LEAGUE_STATS_STATE.section:'captains';
  const updated=data.latestUpdate
    ?new Intl.DateTimeFormat('es',{dateStyle:'medium',timeStyle:'short'}).format(data.latestUpdate)
    :'Sin actualizaciones registradas';
  const panelMarkup=data.lineupRows
    ?section==='lines'
      ?leagueStatsLineMarkup(data)
      :section==='mvp'
        ?leagueStatsMvpMarkup(data)
        :leagueStatsCaptainMarkup(data)
    :`<div class="league-stats-empty"><span>${uiIcon('sparkles')}</span><h3>Todavía no hay XI publicados</h3><p>Estas estadísticas aparecerán cuando se publique al menos una alineación completa de 11 futbolistas.</p></div>`;
  host.innerHTML=`<header class="league-stats-head">
      <div><span class="eyebrow">TEMPORADA ${profileSeasonLongLabel(data.season)}</span><h3>Radiografía de la competición</h3><p>Capitanes destacados, rendimiento por líneas y MVP de cada participante.</p></div>
      <div class="league-stats-coverage"><b>${data.lineupRows}</b><span>XI publicados</span><small>${data.teamsWithLineups}/${data.teams.length} equipos con datos</small></div>
    </header>
    <nav class="league-stats-subtabs" role="tablist" aria-label="Estadísticas generales de jugadores">
      ${[['captains','Capitanes'],['lines','Líneas'],['mvp','MVP']].map(([value,label])=>`<button id="leagueStats${value[0].toUpperCase()}${value.slice(1)}Tab" type="button" role="tab" data-league-stats-section="${value}" aria-controls="leagueStatsSectionPanel" aria-selected="${section===value}" tabindex="${section===value?'0':'-1'}">${label}</button>`).join('')}
    </nav>
    <section id="leagueStatsSectionPanel" class="league-stats-section" role="tabpanel" aria-labelledby="leagueStats${section[0].toUpperCase()}${section.slice(1)}Tab">
      ${panelMarkup}
    </section>
    <p class="league-stats-updated">${LEAGUE_STATS_STATE.status==='loading'
      ?'Actualizando…'
      :LEAGUE_STATS_STATE.error
        ?`Mostrando datos anteriores · ${profileAttr(LEAGUE_STATS_STATE.error)}`
        :`Datos publicados · ${updated}`}</p>`;
}

async function ensureLeagueStatsData({force=false}={}){
  if(!DATA)return;
  if(!force&&LEAGUE_STATS_STATE.status==='loading'&&LEAGUE_STATS_ABORT_CONTROLLER)return;
  const season=window.CUBAN_LEAGUE_SUPABASE?.season||DATA.currentSeason;
  if(!force&&LEAGUE_STATS_CACHE.has(season)){
    LEAGUE_STATS_STATE.data=LEAGUE_STATS_CACHE.get(season);
    LEAGUE_STATS_STATE.status='ready';
    LEAGUE_STATS_STATE.error='';
    renderLeagueStatsContent();
    return;
  }
  LEAGUE_STATS_ABORT_CONTROLLER?.abort();
  const controller=new AbortController();
  LEAGUE_STATS_ABORT_CONTROLLER=controller;
  const token=++LEAGUE_STATS_REQUEST_TOKEN;
  const keepCurrentData=force&&Boolean(LEAGUE_STATS_STATE.data);
  if(!keepCurrentData)LEAGUE_STATS_STATE.data=null;
  LEAGUE_STATS_STATE.status='loading';
  LEAGUE_STATS_STATE.error='';
  renderLeagueStatsContent();
  try{
    const rows=await fetchPublishedLeagueStatsRows(controller.signal);
    if(token!==LEAGUE_STATS_REQUEST_TOKEN)return;
    const data=buildLeagueStats(rows);
    LEAGUE_STATS_CACHE.set(season,data);
    LEAGUE_STATS_STATE.data=data;
    LEAGUE_STATS_STATE.status='ready';
    renderLeagueStatsContent();
  }catch(error){
    if(error?.name==='AbortError'||token!==LEAGUE_STATS_REQUEST_TOKEN)return;
    if(keepCurrentData){
      LEAGUE_STATS_STATE.status='ready';
      LEAGUE_STATS_STATE.error=navigator.onLine===false
        ?'No se pudo actualizar sin conexión.'
        :error?.message||'No se pudo completar la actualización.';
      renderLeagueStatsContent();
      return;
    }
    LEAGUE_STATS_STATE.status='error';
    LEAGUE_STATS_STATE.error=navigator.onLine===false
      ?'Las estadísticas no están disponibles sin conexión.'
      :error?.message||'Inténtalo nuevamente.';
    renderLeagueStatsContent();
  }finally{
    if(token===LEAGUE_STATS_REQUEST_TOKEN&&LEAGUE_STATS_ABORT_CONTROLLER===controller){
      LEAGUE_STATS_ABORT_CONTROLLER=null;
    }
  }
}

function setLeagueStatsSection(section,{focus=false}={}){
  LEAGUE_STATS_STATE.section=['captains','lines','mvp'].includes(section)?section:'captains';
  renderLeagueStatsContent();
  if(focus)document.querySelector(`[data-league-stats-section="${LEAGUE_STATS_STATE.section}"]`)?.focus();
}

function setLeagueCaptainMode(mode,{focus=false}={}){
  LEAGUE_STATS_STATE.captainMode=mode==='average'?'average':'points';
  renderLeagueStatsContent();
  if(focus)document.querySelector(`[data-league-captain-mode="${LEAGUE_STATS_STATE.captainMode}"]`)?.focus();
}

function setLeagueLinePosition(position,{focus=false}={}){
  LEAGUE_STATS_STATE.linePosition=['PT','DF','MC','DL'].includes(position)?position:'all';
  renderLeagueStatsContent();
  if(focus)document.querySelector(`[data-league-line-position="${LEAGUE_STATS_STATE.linePosition}"]`)?.focus();
}

function profileSeasonSortControls(kind,active){
  const label=kind==='captains'?'capitanes':'jugadores';
  return `<div class="profile-season-sort" role="group" aria-label="Ordenar ${label}">
    <span>Ordenar por</span>
    ${[
      ['points','Puntos'],
      ['uses','Jornadas'],
      ['average','Promedio']
    ].map(([value,text])=>`<button type="button" data-profile-season-sort="${kind}" data-profile-season-sort-value="${value}" aria-pressed="${active===value?'true':'false'}">${text}</button>`).join('')}
  </div>`;
}

function profileSeasonSummaryMarkup(data){
  if(!data.publishedMatchdays){
    return `<div class="profile-season-empty"><span>${uiIcon('calendar')}</span><h4>La temporada todavía no tiene jornadas publicadas</h4><p>El acumulado aparecerá automáticamente con la primera jornada oficial.</p></div>`;
  }
  const positionLabels={PT:'Portería',DF:'Defensa',MC:'Medio',DL:'Delantera'};
  const coverage=data.publishedMatchdays?Math.round((data.lineupMatchdays/data.publishedMatchdays)*100):0;
  const strongestLineLabel=data.strongestLine
    ?data.strongestLine.positions.length===1
      ?positionLabels[data.strongestLine.positions[0]]
      :`Empate: ${matchdayLineupJoinedLabels(data.strongestLine.positions.map(position=>positionLabels[position]))}`
    :'—';
  return `<section class="profile-season-kpis">
      <article><span>Jornadas publicadas</span><b>${data.publishedMatchdays}</b><small>${data.lineupMatchdays} con XI registrado</small></article>
      <article><span>Puntos oficiales</span><b>${profileSeasonFormat(data.officialPoints)}</b><small>${profileSeasonFormat(data.officialAverage)} de promedio</small></article>
      <article><span>Jugadores utilizados</span><b>${data.uniquePlayers}</b><small>Futbolistas diferentes</small></article>
      <article class="is-captain"><span>Bono de capitanes</span><b>${profileSeasonFormat(data.captainBonus,{signed:true})}</b><small>Impacto del brazalete</small></article>
    </section>
    <section class="profile-season-coverage" aria-label="Cobertura de alineaciones">
      <div><span>XI registrados</span><b>${data.lineupMatchdays}/${data.publishedMatchdays}</b></div>
      <span class="profile-season-coverage-track"><i style="width:${coverage}%"></i></span>
      <small>${coverage}% de las jornadas publicadas tiene alineación completa.</small>
    </section>
    <section class="profile-season-official-grid">
      <article><span>Goles</span><b>${data.goals}</b></article>
      <article><span>Clean sheets</span><b>${data.cleanSheets}</b></article>
      <article class="is-red"><span>Tarjetas rojas</span><b>${data.redCards}</b></article>
    </section>
    <section class="profile-season-highlights">
      <article><span>Mejor jornada</span><b>${data.bestMatchday?`J${data.bestMatchday.matchday} · ${profileSeasonFormat(data.bestMatchday.points)} pts`:'—'}</b></article>
      <article><span>Peor jornada</span><b>${data.worstMatchday?`J${data.worstMatchday.matchday} · ${profileSeasonFormat(data.worstMatchday.points)} pts`:'—'}</b></article>
      <article><span>Formación favorita</span><b>${data.favoriteFormation?data.favoriteFormation.formation:'—'}</b><small>${data.favoriteFormation?`${data.favoriteFormation.uses} ${data.favoriteFormation.uses===1?'jornada':'jornadas'}`:'Sin XI registrados'}</small></article>
      <article><span>Línea más productiva</span><b>${strongestLineLabel}</b><small>${data.strongestLine?`${profileSeasonFormat(data.strongestLine.points)} pts aportados`:'Sin una línea destacada'}</small></article>
    </section>
    <section class="profile-season-lines">
      <div class="profile-season-section-title"><span class="eyebrow">APORTE ACUMULADO</span><h4>Rendimiento por líneas</h4></div>
      <div class="profile-season-line-grid">
        ${['PT','DF','MC','DL'].map(position=>`<article class="${data.strongestLine?.positions.includes(position)?'is-strongest':''}"><span>${position}</span><b>${profileSeasonFormat(data.positionTotals[position])}</b><small>${positionLabels[position]}</small></article>`).join('')}
      </div>
    </section>`;
}

function profileSeasonCaptainsMarkup(data){
  const sort=PROFILE_SEASON_STATE?.captainSort||'points';
  const captains=profileSeasonSortedRows(data.captains,sort,'captains');
  if(!captains.length){
    return `${profileSeasonSortControls('captains',sort)}<div class="profile-season-empty"><span>C</span><h4>Sin capitanes registrados</h4><p>Se mostrarán cuando exista una alineación publicada con brazalete.</p></div>`;
  }
  return `${profileSeasonSortControls('captains',sort)}
    <div class="profile-season-ranking" role="list" aria-label="Capitanes utilizados por ${profileAttr(data.name)}">
      ${captains.map((player,index)=>`<article class="profile-season-rank-card is-captain" role="listitem">
        <span class="profile-season-rank">${index+1}</span>
        <div class="profile-season-rank-player">${profileSeasonPlayerVisual(player)}</div>
        <div class="profile-season-rank-metrics">
          <div><span>Puntos</span><b>${profileSeasonFormat(player.captainPoints)}</b></div>
          <div><span>Jornadas</span><b>${player.captainUses}</b></div>
          <div><span>Promedio</span><b>${profileSeasonFormat(player.captainAverage)}</b></div>
          <div><span>Bono</span><b class="${player.captainBonus<0?'is-negative':'is-positive'}">${profileSeasonFormat(player.captainBonus,{signed:true})}</b></div>
        </div>
        <div class="profile-season-rank-foot"><span>Mejor: J${player.bestCaptainMatchday} · ${profileSeasonFormat(player.bestCaptainPoints)} pts ×${matchdayLineupMultiplier(player.bestCaptainMultiplier)}</span><span>${player.captainSuccesses}/${player.captainUses} ${player.captainUses===1?'acierto perfecto':'aciertos perfectos'}</span></div>
      </article>`).join('')}
    </div>`;
}

function profileSeasonPlayersMarkup(data){
  const sort=PROFILE_SEASON_STATE?.playerSort||'points';
  const players=profileSeasonSortedRows(data.players,sort,'players');
  if(!players.length){
    return `${profileSeasonSortControls('players',sort)}<div class="profile-season-empty"><span>${uiIcon('users')}</span><h4>Sin futbolistas registrados</h4><p>Esta lista reúne a quienes hayan sido alineados al menos una jornada.</p></div>`;
  }
  return `${profileSeasonSortControls('players',sort)}
    <div class="profile-season-ranking" role="list" aria-label="Jugadores utilizados por ${profileAttr(data.name)}">
      ${players.map((player,index)=>`<article class="profile-season-rank-card" role="listitem">
        <span class="profile-season-rank">${index+1}</span>
        <div class="profile-season-rank-player">${profileSeasonPlayerVisual(player)}</div>
        <div class="profile-season-rank-metrics">
          <div><span>Puntos</span><b>${profileSeasonFormat(player.contributionPoints)}</b></div>
          <div><span>Jornadas</span><b>${player.appearances}</b></div>
          <div><span>Promedio</span><b>${profileSeasonFormat(player.average)}</b></div>
          <div><span>Capitán</span><b>${player.captainUses}</b></div>
        </div>
        <div class="profile-season-rank-foot"><span>Base estimada: ${profileSeasonFormat(player.basePoints)} pts</span><span>Mejor: J${player.bestMatchday} · ${profileSeasonFormat(player.bestPoints)} pts</span></div>
      </article>`).join('')}
    </div>`;
}

function profileSeasonLoadingMarkup(){
  return `<div class="profile-season-loading" role="status" aria-live="polite"><span class="lineup-loader" aria-hidden="true"></span><div><b>Preparando la temporada</b><small>Sumando jornadas, capitanes y futbolistas utilizados…</small></div></div>`;
}

function profileSeasonErrorMarkup(message){
  return `<div class="profile-season-empty is-error" role="alert"><span>!</span><h4>No pudimos cargar la temporada</h4><p>${profileAttr(message||'Inténtalo nuevamente.')}</p><button type="button" data-profile-season-retry>Volver a intentar</button></div>`;
}

function renderProfileSeasonContent(){
  const host=$('profileSeasonContent');
  const state=PROFILE_SEASON_STATE;
  if(!host||!state)return;
  if(state.status==='loading'){
    host.innerHTML=profileSeasonLoadingMarkup();
    renderProfileSummarySeasonData();
    return;
  }
  if(state.status==='error'){
    host.innerHTML=profileSeasonErrorMarkup(state.error);
    renderProfileSummarySeasonData();
    return;
  }
  if(!state.data){
    host.innerHTML=profileSeasonLoadingMarkup();
    renderProfileSummarySeasonData();
    return;
  }
  const section=state.section||'summary';
  const data=state.data;
  const updated=data.latestUpdate
    ?new Intl.DateTimeFormat('es',{dateStyle:'medium',timeStyle:'short'}).format(data.latestUpdate)
    :'Sin actualizaciones registradas';
  host.innerHTML=`<header class="profile-season-live-head">
      <div><span class="eyebrow">TEMPORADA ${profileSeasonLongLabel(data.season)}</span><h3>Radiografía de ${profileAttr(data.name)}</h3><p>Acumulado automático de todas sus jornadas publicadas.</p></div>
      <span class="profile-season-live-badge">${data.lineupMatchdays}/${data.publishedMatchdays} XI</span>
    </header>
    <nav class="profile-season-subtabs" role="tablist" aria-label="Estadísticas de la temporada">
      ${[
        ['summary','Resumen'],
        ['captains','Capitanes'],
        ['players','Jugadores']
      ].map(([value,label])=>`<button id="profileSeason${value[0].toUpperCase()}${value.slice(1)}Tab" type="button" role="tab" data-profile-season-section="${value}" aria-controls="profileSeasonSectionPanel" aria-selected="${section===value?'true':'false'}" tabindex="${section===value?'0':'-1'}">${label}</button>`).join('')}
    </nav>
    <section id="profileSeasonSectionPanel" class="profile-season-section-panel" role="tabpanel" aria-labelledby="profileSeason${section[0].toUpperCase()}${section.slice(1)}Tab">
      ${section==='captains'?profileSeasonCaptainsMarkup(data):section==='players'?profileSeasonPlayersMarkup(data):profileSeasonSummaryMarkup(data)}
    </section>
    <p class="profile-season-updated">Actualizado con datos publicados · ${updated}</p>`;
  renderProfileSummarySeasonData();
}

async function ensureProfileSeasonData({force=false}={}){
  const state=PROFILE_SEASON_STATE;
  if(!state?.name)return;
  if(!force&&state.status==='loading')return;
  const season=window.CUBAN_LEAGUE_SUPABASE?.season||DATA.currentSeason;
  const cacheKey=`${season}|${state.name}`;
  if(!force&&PROFILE_SEASON_CACHE.has(cacheKey)){
    state.data=PROFILE_SEASON_CACHE.get(cacheKey);
    state.status='ready';
    state.error='';
    renderProfileSeasonContent();
    return;
  }
  PROFILE_SEASON_ABORT_CONTROLLER?.abort();
  const controller=new AbortController();
  PROFILE_SEASON_ABORT_CONTROLLER=controller;
  const token=++PROFILE_SEASON_REQUEST_TOKEN;
  const keepCurrentData=force&&Boolean(state.data);
  if(!keepCurrentData)state.status='loading';
  state.error='';
  if(!keepCurrentData)renderProfileSeasonContent();
  try{
    const rows=await fetchPublishedProfileSeasonRows(state.name,controller.signal);
    if(token!==PROFILE_SEASON_REQUEST_TOKEN||PROFILE_SEASON_STATE?.name!==state.name)return;
    const data=buildProfileSeasonStats(state.name,rows);
    PROFILE_SEASON_CACHE.set(cacheKey,data);
    state.data=data;
    state.status='ready';
    renderProfileSeasonContent();
  }catch(error){
    if(error?.name==='AbortError'||token!==PROFILE_SEASON_REQUEST_TOKEN)return;
    if(keepCurrentData){
      state.status='ready';
      return;
    }
    state.status='error';
    state.error=navigator.onLine===false
      ?'Las estadísticas de temporada no están disponibles sin conexión.'
      :error?.message||'Inténtalo nuevamente.';
    renderProfileSeasonContent();
  }finally{
    if(token===PROFILE_SEASON_REQUEST_TOKEN&&PROFILE_SEASON_ABORT_CONTROLLER===controller){
      PROFILE_SEASON_ABORT_CONTROLLER=null;
    }
  }
}

function setProfileView(view,{focus=false}={}){
  const next=['summary','team','achievements','history'].includes(view)?view:'summary';
  const scroller=document.querySelector('#playerModal .player-profile-modal');
  const tabs=scroller?.querySelector('.profile-view-tabs');
  const returnToTabs=Boolean(scroller&&tabs&&scroller.scrollTop>tabs.offsetTop);
  if(PROFILE_SEASON_STATE)PROFILE_SEASON_STATE.view=next;
  document.querySelectorAll('[data-profile-view]').forEach(button=>{
    const active=button.dataset.profileView===next;
    button.classList.toggle('is-active',active);
    button.setAttribute('aria-selected',active?'true':'false');
    button.tabIndex=active?0:-1;
  });
  document.querySelectorAll('[data-profile-panel]').forEach(panel=>{
    const active=panel.dataset.profilePanel===next;
    panel.hidden=!active;
    panel.classList.toggle('is-active',active);
  });
  if(returnToTabs)scroller.scrollTo({top:Math.max(0,tabs.offsetTop),behavior:'auto'});
  if(focus)document.querySelector(`[data-profile-view="${next}"]`)?.focus();
  if(next==='team')ensureProfileSeasonData();
  if(next==='achievements')requestAnimationFrame(animateProfileAchievementUnlocks);
}

function setProfileSeasonSection(section,{focus=false}={}){
  if(!PROFILE_SEASON_STATE)return;
  PROFILE_SEASON_STATE.section=['summary','captains','players'].includes(section)?section:'summary';
  renderProfileSeasonContent();
  if(focus)document.querySelector(`[data-profile-season-section="${PROFILE_SEASON_STATE.section}"]`)?.focus();
}

function setProfileSeasonSort(kind,sort,{focus=false}={}){
  if(!PROFILE_SEASON_STATE||!['points','uses','average'].includes(sort))return;
  if(kind==='captains')PROFILE_SEASON_STATE.captainSort=sort;
  else if(kind==='players')PROFILE_SEASON_STATE.playerSort=sort;
  renderProfileSeasonContent();
  if(focus)document.querySelector(`[data-profile-season-sort="${kind}"][data-profile-season-sort-value="${sort}"]`)?.focus();
}

function handleProfileTabsKeydown(event){
  const tab=event.target.closest?.('[role="tab"]');
  const tablist=tab?.closest?.('.profile-view-tabs,.profile-season-subtabs,.league-stats-subtabs');
  if(!tablist||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return false;
  const tabs=[...tablist.querySelectorAll('[role="tab"]')];
  const current=Math.max(0,tabs.indexOf(tab));
  const next=event.key==='Home'
    ?0
    :event.key==='End'
      ?tabs.length-1
      :event.key==='ArrowRight'
        ?(current+1)%tabs.length
        :(current-1+tabs.length)%tabs.length;
  event.preventDefault();
  tabs[next]?.click();
  return true;
}

let profileReturnFocus=null;
function syncModalLock(){
  const anyOpen=['playerModal','lineupModal','installModal'].some(id=>$(id)&&!$(id).hidden);
  document.body.classList.toggle('modal-open',anyOpen);
}
function closePlayer(){
  const modal=$('playerModal');
  if(modal.hidden)return;
  PROFILE_SEASON_ABORT_CONTROLLER?.abort();
  PROFILE_SEASON_ABORT_CONTROLLER=null;
  PROFILE_SEASON_REQUEST_TOKEN+=1;
  PROFILE_SEASON_STATE=null;
  modal.hidden=true;
  syncModalLock();
  profileReturnFocus?.focus?.();
}

function profileAchievementsPanelMarkup(achievements,earnedAchievements,achievementPercent){
  return `<section class="profile-section profile-achievements-section">
    <div class="profile-section-head achievement-profile-head">
      <div><span class="eyebrow">VITRINA PERSONAL</span><h3>Insignias por logros</h3><p>Conseguidas, en progreso y todavía bloqueadas.</p></div>
      <div class="profile-achievement-count"><b>${earnedAchievements.length}<span>/${ACHIEVEMENT_CATALOG.length}</span></b><small>conseguidas</small></div>
    </div>
    <div class="profile-achievement-progress" role="progressbar" aria-label="Progreso de insignias" aria-valuemin="0" aria-valuemax="${ACHIEVEMENT_CATALOG.length}" aria-valuenow="${earnedAchievements.length}">
      <span style="width:${achievementPercent}%"></span>
    </div>
    <div class="profile-achievement-grid">
      ${achievements.map(item=>`<article class="profile-achievement-card achievement-${item.rarity} achievement-${item.id}${item.earned?' is-earned':' is-locked'}" data-achievement-id="${item.id}">
        <div class="profile-achievement-card-top">
          <span class="profile-achievement-icon" aria-hidden="true">${achievementIconMarkup(item)}</span>
          <span class="profile-achievement-status">${item.earned?'DESBLOQUEADA':'BLOQUEADA'}</span>
        </div>
        <small>${item.type}</small>
        <h4>${item.name}</h4>
        <p>${item.requirement}</p>
        ${item.earned||item.progress?`<span class="profile-achievement-detail">${profileAttr(item.detail)}</span>`:''}
      </article>`).join('')}
    </div>
  </section>`;
}

function profileHistoryPanelMarkup(name,s,honours,m,seasonRows){
  return `${managerLegacyMarkup(name)}
    <section class="profile-major-stats" aria-label="Palmarés histórico">
      <article><b>${honours.totalTitles}</b><span>Títulos totales</span><small>${honours.leagueTitles} Liga · ${honours.championsTitles} Champions</small></article>
      <article><b>${s.podiums||0}</b><span>Podios</span><small>${s.seconds||0} subcampeonatos · ${s.thirds||0} terceros</small></article>
      <article><b>${s.points?.toLocaleString()||0}</b><span>Puntos históricos</span><small>Ranking histórico ${m.historicalRank?`#${m.historicalRank}`:'—'}</small></article>
      <article><b>${s.top5||0}</b><span>Top 5</span><small>Acumulado histórico</small></article>
    </section>
    <section class="profile-section profile-history-chart">
      <div class="profile-section-head"><div><span class="eyebrow">TRAYECTORIA</span><h3>Evolución por temporada</h3></div></div>
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
    </section>
    <details class="profile-history-archive">
      <summary><span><small>ARCHIVO</small><b>Temporada por temporada</b></span><em>Ver historial</em></summary>
      <div class="profile-season-table">
        <div class="profile-season-head"><span>Temporada</span><span>Resultado</span><span>Puntos</span></div>
        ${seasonRows}
      </div>
    </details>`;
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
  const honours=withHistoricalHonours({name,...s});
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
  const snapshot=profileCurrentSnapshot(name);
  const current=snapshot.player||m.current;
  const currentLabel=profileCurrentLabel(m,current);
  const latestLabel=profileLatestLabel(snapshot);
  const achievements=playerAchievementState(name);
  const earnedAchievements=achievements.filter(item=>item.earned);
  const achievementPercent=Math.round((earnedAchievements.length/ACHIEVEMENT_CATALOG.length)*100);
  PROFILE_SEASON_ABORT_CONTROLLER?.abort();
  PROFILE_SEASON_ABORT_CONTROLLER=null;
  PROFILE_SEASON_REQUEST_TOKEN+=1;
  PROFILE_SEASON_STATE={
    name,
    view:'summary',
    section:'summary',
    captainSort:'points',
    playerSort:'points',
    status:'idle',
    error:'',
    data:null
  };
  $('modalContent').innerHTML=`<div class="profile-v152">
    <section class="profile-hero profile-hero-v152">
      <img src="${p.shield}" class="profile-avatar" alt="Foto de ${name}">
      <div class="profile-identity">
        <span class="eyebrow">${s.label||'PARTICIPANTE'}</span>
        <h2 id="profileTitle">${name}</h2>
        <div class="profile-hero-awards">${profileHeroAwards(name,earnedAchievements)}</div>
      </div>
    </section>

    ${profileScoreHeroMarkup(name,snapshot,current,currentLabel,latestLabel)}

    <nav class="profile-view-tabs" role="tablist" aria-label="Perfil de ${profileAttr(name)}">
      <button id="profileSummaryTab" class="is-active" type="button" role="tab" data-profile-view="summary" aria-controls="profileSummaryPanel" aria-selected="true" tabindex="0">Resumen</button>
      <button id="profileTeamTab" type="button" role="tab" data-profile-view="team" aria-controls="profileTeamPanel" aria-selected="false" tabindex="-1">Equipo</button>
      <button id="profileAchievementsTab" type="button" role="tab" data-profile-view="achievements" aria-controls="profileAchievementsPanel" aria-selected="false" tabindex="-1">Logros</button>
      <button id="profileHistoryTab" type="button" role="tab" data-profile-view="history" aria-controls="profileHistoryPanel" aria-selected="false" tabindex="-1">Historia</button>
    </nav>

    <section id="profileSummaryPanel" class="profile-view-panel is-active" role="tabpanel" aria-labelledby="profileSummaryTab" data-profile-panel="summary">
      <div class="profile-summary-grid">
        ${profileSummaryMetricsMarkup(current,currentLabel)}
        ${profileFormCardMarkup(snapshot)}
      </div>
      <section class="profile-latest-lineup-card">
        <div class="profile-summary-section-head"><div><span>ÚLTIMO XI PUBLICADO</span><h3>Última alineación</h3></div></div>
        <div id="profileLatestLineup" aria-live="polite">${profileLatestLineupMarkup(null)}</div>
      </section>
      <section class="profile-featured-achievements">
        <div class="profile-summary-section-head"><div><span>VITRINA PERSONAL</span><h3>Logros destacados</h3></div><button type="button" data-profile-jump="achievements">Ver todos <span aria-hidden="true">›</span></button></div>
        <div class="profile-featured-achievement-grid">${profileAchievementPreviewMarkup(earnedAchievements)}</div>
      </section>
    </section>

    <section id="profileTeamPanel" class="profile-view-panel profile-season-panel" role="tabpanel" aria-labelledby="profileTeamTab" data-profile-panel="team" hidden>
      <div id="profileSeasonContent">${profileSeasonLoadingMarkup()}</div>
    </section>

    <section id="profileAchievementsPanel" class="profile-view-panel" role="tabpanel" aria-labelledby="profileAchievementsTab" data-profile-panel="achievements" hidden>
      ${profileAchievementsPanelMarkup(achievements,earnedAchievements,achievementPercent)}
    </section>

    <section id="profileHistoryPanel" class="profile-view-panel" role="tabpanel" aria-labelledby="profileHistoryTab" data-profile-panel="history" hidden>
      ${profileHistoryPanelMarkup(name,s,honours,m,seasonRows)}
    </section>
  </div>`;
  $('playerModal').hidden=false;
  syncModalLock();
  requestAnimationFrame(()=>{
    $('closeModal').focus();
  });
  ensureProfileSeasonData();
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
  const titleIndex=historicalTitleIndex();
  const honours=DATA.general.map(player=>withHistoricalHonours(player,titleIndex));
  const maximumTitles=Math.max(0,...honours.map(player=>player.totalTitles));
  const titleLeaders=honours.filter(player=>player.totalTitles===maximumTitles).map(player=>player.name);
  const records=DATA.records
    .filter(record=>record.title!=='Más puntos en una temporada')
    .map(record=>record.title==='Más títulos'
      ?{...record,player:titleLeaders.join(' / '),value:String(maximumTitles)}
      :{...record}
    );
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
  const leagueMatchdays=championsConfiguration()?.leagueMatchdays||[];
  const progress=championsMatchdayProgress();
  const rowMap=new Map(CHAMPIONS_MATCHDAY_ROWS.map(row=>[`${row.participantName}:${row.matchday}`,row]));
  return group.teams.map((name,sourceIndex)=>{
    const matchdays=Array.from({length:CHAMPIONS_MATCHDAY_COUNT},(_,index)=>{
      const matchday=index+1;
      const row=rowMap.get(`${name}:${matchday}`);
      return {
        matchday,
        leagueMatchday:row?.leagueMatchday||leagueMatchdays[index]||null,
        played:Boolean(row),
        points:row?.points||0,
        goals:row?.goals||0,
        cleanSheets:row?.cleanSheets||0,
        redCards:row?.redCards||0,
        provisional:progress.provisional.has(matchday),
        provisionalReason:progress.partial.has(matchday)
          ?'pendiente: faltan participantes'
          :progress.postponed.has(matchday)
            ?'provisional por partido aplazado'
            :''
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

function championsMatchdayProgress(){
  const configuration=championsConfiguration();
  const expectedParticipants=configuration?.participantNames.size||0;
  const participantCountByMatchday=CHAMPIONS_MATCHDAY_ROWS.reduce((counts,row)=>{
    counts.set(row.matchday,(counts.get(row.matchday)||0)+1);
    return counts;
  },new Map());
  const partial=new Set(
    [...participantCountByMatchday]
      .filter(([,participantCount])=>participantCount>0&&participantCount<expectedParticipants)
      .map(([matchday])=>matchday)
  );
  const postponed=new Set(
    CHAMPIONS_MATCHDAY_ROWS
      .filter(row=>row.hasPostponedMatches)
      .map(row=>row.matchday)
  );
  return {
    partial,
    postponed,
    provisional:new Set([...partial,...postponed])
  };
}

function renderChampionsGroupCalendar(configuration=championsConfiguration()){
  const list=document.querySelector('#championsCalendarPanel .champions-calendar-phase.is-groups .champions-calendar-dates');
  if(!list||!configuration)return false;
  list.innerHTML=configuration.leagueMatchdays.map((leagueMatchday,index)=>
    `<li><span>Champions J${index+1}</span><strong>Liga J${leagueMatchday}</strong></li>`
  ).join('');
  return true;
}

function renderChampions(){
  const publishedCount=CHAMPIONS_PUBLISHED_MATCHDAYS.length;
  const progress=championsMatchdayProgress();
  const partialMatchdays=[...progress.partial].sort((a,b)=>a-b);
  const postponedMatchdays=[...progress.postponed].sort((a,b)=>a-b);
  renderChampionsGroupCalendar();
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
    status.textContent=partialMatchdays.length
      ?`${publishedCount}/${CHAMPIONS_MATCHDAY_COUNT} completas · pendiente J${partialMatchdays.join(', J')}`
      :postponedMatchdays.length
        ?`${publishedCount}/${CHAMPIONS_MATCHDAY_COUNT} jornadas · provisional J${postponedMatchdays.join(', J')}`
      :publishedCount===0
        ?DATA.champions.status
        :publishedCount===CHAMPIONS_MATCHDAY_COUNT
          ?'Fase completada'
          :`${publishedCount}/${CHAMPIONS_MATCHDAY_COUNT} jornadas`;
    status.classList.toggle('pending',progress.provisional.size>0);
  }

  $('groupGrid').innerHTML=DATA.champions.groups.map(group=>{
    const standings=championsGroupStandings(group);
    const headerDays=Array.from({length:CHAMPIONS_MATCHDAY_COUNT},(_,index)=>`<span class="champions-day-head">J${index+1}</span>`).join('');
    const rows=standings.map((team,index)=>{
      const safeName=profileAttr(team.name);
      const points=team.matchdays.map(day=>`<span class="champions-points-cell${day.played?' is-played':''}${day.provisional?' is-provisional':''}" title="${day.played?`Champions J${day.matchday} · Liga J${day.leagueMatchday}: ${day.points.toLocaleString('es')} puntos${day.provisionalReason?` · ${day.provisionalReason}`:''}`:`Champions J${day.matchday} · Liga J${day.leagueMatchday}: pendiente`}">${day.played?day.points.toLocaleString('es'):'—'}</span>`).join('');
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
  const completedRounds=tournament.rounds.filter(round=>round.status==='confirmed');
  const eliminatedRounds=completedRounds.filter(round=>round.eliminated);
  const nextRound=tournament.rounds.find(round=>round.status!=='confirmed')||null;
  const postponedBlocker=nextRound?.incomplete?nextRound:null;
  const selectedIsNext=nextRound?.matchday===selectedRound.matchday;

  $('cupHeroStatus').textContent=tournament.champion
    ?'Copa finalizada'
    :nextRound?.status==='invalid'
      ?`Jornada ${nextRound.matchday} con datos incompletos`
    :postponedBlocker
      ?`Jornada ${postponedBlocker.matchday} pendiente por partido aplazado`
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
  $('cupProgressCopy').textContent=tournament.champion
    ?'Copa completada · consulta el recorrido ronda a ronda.'
    :postponedBlocker
      ?`Las eliminaciones desde J${postponedBlocker.matchday} son provisionales hasta completar el partido aplazado.`
      :nextRound?.status==='invalid'
        ?`La Jornada ${nextRound.matchday} no tiene todos los participantes y no puede cerrar la eliminación.`
        :'Selecciona una jornada para revisar su clasificación.';

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
    const stateCopy=round.status==='confirmed'
      ?round.eliminated?`Sale ${profileAttr(round.eliminated.name)}`:'Cerrada'
      :round.status==='provisional'
        ?round.incomplete?'Con aplazado':'Provisional'
        :round.status==='blocked'
          ?`Espera J${round.blockedBy}`
          :round.status==='invalid'
            ?'Datos incompletos'
            :isNext?'Próxima':'Pendiente';
    const stateClass=round.status==='confirmed'
      ?' is-complete'
      :['provisional','blocked','invalid'].includes(round.status)
        ?' is-provisional'
        :'';
    return `<button type="button" class="cup-timeline-step${stateClass}${isNext?' is-next':''}${isSelected?' is-selected':''}" data-cup-matchday="${round.matchday}" aria-pressed="${isSelected}">
      <span>J${round.matchday}</span><small>${stateCopy}</small>
    </button>`;
  }).join('');

  $('cupRoundTitle').textContent=`Jornada ${selectedRound.matchday}`;
  const roundState=$('cupRoundState');
  roundState.textContent=selectedRound.status==='confirmed'
    ?'Jornada cerrada'
    :selectedRound.status==='provisional'
      ?selectedRound.incomplete?'Pendiente por partido aplazado':'Resultado provisional'
      :selectedRound.status==='blocked'
        ?`En espera de J${selectedRound.blockedBy}`
        :selectedRound.status==='invalid'
          ?'Datos incompletos'
          :selectedIsNext?'Próxima eliminación':'Ronda pendiente';
  roundState.className=`cup-round-state ${selectedRound.status==='confirmed'?'is-closed':['provisional','blocked','invalid'].includes(selectedRound.status)?'is-provisional':'is-pending'}`;

  const dangerHost=$('cupDanger');
  if(selectedRound.status==='confirmed'&&selectedRound.eliminated){
    const eliminated=selectedRound.eliminated;
    dangerHost.innerHTML=`<article class="cup-danger-card is-eliminated team-profile-link" ${profileTriggerAttrs(eliminated.name)}>
      <span class="cup-danger-icon">${uiIcon('red-card')}</span>
      <img src="${imageMap()[eliminated.name]||''}" alt="Foto de ${profileAttr(eliminated.name)}">
      <div><span>ELIMINADO EN J${selectedRound.matchday}</span><h3>${profileAttr(eliminated.name)}</h3><p>${eliminated.points.toLocaleString('es')} PTS · ${eliminated.leaguePosition}º de Liga en esa jornada</p></div>
      <strong>Fuera</strong>
    </article>`;
  }else if(selectedRound.status==='provisional'&&selectedRound.provisionalEliminated){
    const candidate=selectedRound.provisionalEliminated;
    dangerHost.innerHTML=`<article class="cup-danger-card is-provisional team-profile-link" ${profileTriggerAttrs(candidate.name)}>
      <span class="cup-danger-icon">${uiIcon('calendar')}</span>
      <img src="${imageMap()[candidate.name]||''}" alt="Foto de ${profileAttr(candidate.name)}">
      <div><span>${selectedRound.incomplete?'ÚLTIMO PROVISIONAL':'PROYECCIÓN PROVISIONAL'}</span><h3>${profileAttr(candidate.name)}</h3><p>${candidate.points.toLocaleString('es')} PTS · todavía no está eliminado · espera el partido aplazado de J${selectedRound.blockedBy}</p></div>
      <strong>En riesgo</strong>
    </article>`;
  }else{
    const pendingTitle=selectedRound.status==='blocked'
      ?`Espera a completar la Jornada ${selectedRound.blockedBy}`
      :selectedRound.status==='invalid'
        ?'Faltan participantes por publicar en esta jornada'
        :selectedIsNext?`J${selectedRound.matchday} · todos parten de cero`:'Aún no se ha llegado a esta ronda';
    dangerHost.innerHTML=`<article class="cup-danger-card is-pending">
      <span class="cup-danger-icon">${uiIcon('shield')}</span>
      <div><span>${selectedRound.status==='blocked'?'ELIMINACIÓN EN PAUSA':selectedRound.status==='invalid'?'JORNADA INCOMPLETA':selectedIsNext?'PRÓXIMA ELIMINACIÓN':'RONDA PENDIENTE'}</span><h3>${pendingTitle}</h3></div>
      <strong>${selectedIsNext?`J${selectedRound.matchday}`:'—'}</strong>
    </article>`;
  }

  rowsHost.innerHTML=selectedRound.rows.map(participant=>{
    const safeName=profileAttr(participant.name);
    const eliminated=selectedRound.eliminated?.name===participant.name;
    const provisional=selectedRound.provisionalEliminated?.name===participant.name;
    const status=eliminated
      ?'Eliminado'
      :selectedRound.status==='confirmed'
        ?'Clasifica'
        :selectedRound.status==='provisional'
          ?provisional?'En riesgo':'Provisional'
          :selectedRound.status==='blocked'
            ?'En espera'
            :selectedRound.status==='invalid'
              ?'Incompleta'
              :'En juego';
    const statusClass=selectedRound.status==='provisional'
      ?' is-provisional'
      :selectedRound.status==='blocked'
        ?' is-waiting'
        :selectedRound.status==='invalid'
          ?' is-invalid'
          :'';
    return `<div class="cup-row cup-table-grid${eliminated?' is-eliminated':''}${provisional?' is-provisional-candidate':''}">
      <span class="cup-rank">${participant.position}</span>
      <div class="cup-team-cell team-profile-link" ${profileTriggerAttrs(participant.name)}>
        <img src="${imageMap()[participant.name]||''}" alt="Foto de ${safeName}">
        <span><b>${safeName}</b><small class="cup-team-meta"><span>Liga ${participant.leaguePosition}º</span><span class="cup-mobile-extra"> · ${participant.goals.toLocaleString('es')} GOL · ${participant.cleanSheets.toLocaleString('es')} CS</span></small></span>
      </div>
      <span class="cup-stat cup-stat-points"><b>${participant.points.toLocaleString('es')}</b></span>
      <span class="cup-stat cup-stat-goals"><b>${participant.goals.toLocaleString('es')}</b></span>
      <span class="cup-stat cup-stat-clean"><b>${participant.cleanSheets.toLocaleString('es')}</b></span>
      <span class="cup-row-status${statusClass}">${status}</span>
    </div>`;
  }).join('');

  $('cupHistory').innerHTML=eliminatedRounds.length
    ?eliminatedRounds.slice().reverse().map(round=>{
      const eliminated=round.eliminated;
      return `<article class="cup-history-item team-profile-link" ${profileTriggerAttrs(eliminated.name)}>
        <span>J${round.matchday}</span>
        <img src="${imageMap()[eliminated.name]||''}" alt="Foto de ${profileAttr(eliminated.name)}">
        <div><b>${profileAttr(eliminated.name)}</b><small>${eliminated.points.toLocaleString('es')} PTS · ${eliminated.leaguePosition}º de Liga</small></div>
        <strong>Fuera</strong>
      </article>`;
    }).join('')
    :postponedBlocker
      ?`<div class="cup-history-empty"><span>${uiIcon('calendar')}</span><div><b>Eliminaciones en pausa</b><small>La Jornada ${postponedBlocker.matchday} tiene un partido aplazado; todavía no hay ningún eliminado oficial.</small></div></div>`
      :nextRound?.status==='invalid'
        ?`<div class="cup-history-empty"><span>${uiIcon('calendar')}</span><div><b>Jornada con datos incompletos</b><small>Faltan participantes en la Jornada ${nextRound.matchday}; la Copa no confirmará eliminados hasta corregirla.</small></div></div>`
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
        const incomingPoints=Number(player.points);
        const points=Number.isFinite(incomingPoints)?incomingPoints:(previous?.points??0);
        seasonPlayers.set(key,{
          manager,
          season:season.season,
          name:previous?.name||player.name,
          points:previous?Math.max(previous.points,points):points,
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

function drawPlayerMonthMetric(ctx,{x,y,width=216,label,value,tone='#e7ca69'}){
  fillRounded(ctx,x,y,width,142,23,'rgba(3,18,24,.86)');
  strokeRounded(ctx,x,y,width,142,23,`${tone}38`,2);
  drawCardText(ctx,label,x+width/2,y+45,width-28,14,11,850,'center','#7f999d');
  drawCardText(ctx,value,x+width/2,y+102,width-28,34,24,900,'center',tone);
}

function drawPlayerMonthStar(ctx,cx,cy,outerRadius=22,innerRadius=10){
  ctx.save();
  ctx.beginPath();
  for(let point=0;point<10;point++){
    const radius=point%2===0?outerRadius:innerRadius;
    const angle=-Math.PI/2+point*Math.PI/5;
    const x=cx+Math.cos(angle)*radius;
    const y=cy+Math.sin(angle)*radius;
    if(point===0)ctx.moveTo(x,y);
    else ctx.lineTo(x,y);
  }
  ctx.closePath();
  ctx.fillStyle='#071015';
  ctx.fill();
  ctx.restore();
}

function playerMonthCanvasLabel(group){
  return String(group?.label||group?.month||'MES CERRADO').toLocaleUpperCase('es').replace(' DE ',' ');
}

async function drawSinglePlayerMonthWinner(ctx,group,winner){
  const tone=group.provisional?'#efb75d':'#e7ca69';
  const panel=ctx.createLinearGradient(60,365,1020,1200);
  panel.addColorStop(0,group.provisional?'rgba(239,183,93,.13)':'rgba(231,202,105,.14)');
  panel.addColorStop(.48,'rgba(8,35,36,.93)');
  panel.addColorStop(1,'rgba(3,17,24,.97)');
  fillRounded(ctx,60,365,960,855,38,panel);
  strokeRounded(ctx,60,365,960,855,38,group.provisional?'rgba(239,183,93,.45)':'rgba(231,202,105,.48)',3);

  ctx.save();
  roundedPath(ctx,60,365,960,855,38);
  ctx.clip();
  const halo=ctx.createRadialGradient(540,535,20,540,535,390);
  halo.addColorStop(0,group.provisional?'rgba(239,183,93,.24)':'rgba(231,202,105,.27)');
  halo.addColorStop(.48,'rgba(80,230,208,.07)');
  halo.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=halo;
  ctx.fillRect(60,365,960,690);
  ctx.restore();

  await drawPlayerAvatar(ctx,winner.name,390,405,300,62);
  strokeRounded(ctx,378,393,324,324,72,'rgba(231,202,105,.38)',5);
  strokeRounded(ctx,369,384,342,342,79,'rgba(80,230,208,.12)',2);
  fillRounded(ctx,492,680,96,62,24,tone);
  drawPlayerMonthStar(ctx,540,711,23,10);

  fillRounded(ctx,382,754,316,45,22,group.provisional?'rgba(239,183,93,.13)':'rgba(231,202,105,.11)');
  strokeRounded(ctx,382,754,316,45,22,group.provisional?'rgba(239,183,93,.32)':'rgba(231,202,105,.32)',2);
  drawCardText(ctx,group.provisional?'RESULTADO PROVISIONAL':'GANADOR OFICIAL',540,784,282,15,11,900,'center',tone);
  drawCardText(ctx,winner.name,540,860,860,58,34,900,'center','#f8fbf8');
  drawCardText(ctx,`${winner.points.toLocaleString('es')} PTS`,540,952,700,76,50,900,'center',tone);

  const metrics=[
    {x:72,label:'JORNADAS',value:winner.played.toLocaleString('es'),tone:'#76e8da'},
    {x:306,label:'GOLES',value:winner.goals.toLocaleString('es'),tone:'#6cff73'},
    {x:540,label:'CLEAN SHEETS',value:winner.cleanSheets.toLocaleString('es'),tone:'#50e6d0'},
    {x:774,label:'TARJETAS ROJAS',value:winner.redCards.toLocaleString('es'),tone:'#ff7180'}
  ];
  metrics.forEach(metric=>drawPlayerMonthMetric(ctx,{...metric,y:1000,width:216}));
  drawCardText(ctx,`${monthlyMatchdayLabel(group.matchdays).toLocaleUpperCase('es')} · CIERRE J${group.matchday}`,540,1198,840,17,12,850,'center','#90a8a8');
}

async function drawTwoPlayerMonthWinners(ctx,group){
  const tone=group.provisional?'#efb75d':'#e7ca69';
  for(let index=0;index<2;index++){
    const winner=group.winners[index];
    const x=index===0?60:560;
    const gradient=ctx.createLinearGradient(x,375,x+460,1115);
    gradient.addColorStop(0,index===0?'rgba(231,202,105,.14)':'rgba(80,230,208,.105)');
    gradient.addColorStop(1,'rgba(3,18,25,.96)');
    fillRounded(ctx,x,375,460,745,34,gradient);
    strokeRounded(ctx,x,375,460,745,34,index===0?'rgba(231,202,105,.42)':'rgba(80,230,208,.31)',3);
    await drawPlayerAvatar(ctx,winner.name,x+125,421,210,50);
    strokeRounded(ctx,x+116,412,228,228,58,index===0?'rgba(231,202,105,.4)':'rgba(80,230,208,.3)',4);
    fillRounded(ctx,x+178,610,104,46,19,tone);
    drawPlayerMonthStar(ctx,x+230,633,18,8);
    drawCardText(ctx,winner.name,x+230,726,402,42,25,900,'center','#f7faf8');
    drawCardText(ctx,`${winner.points.toLocaleString('es')} PTS`,x+230,798,390,50,34,900,'center',tone);
    fillRounded(ctx,x+28,848,404,116,22,'rgba(5,24,30,.82)');
    strokeRounded(ctx,x+28,848,404,116,22,'rgba(80,230,208,.13)',2);
    drawCardText(ctx,`${winner.played} J`,x+78,914,80,25,18,900,'center','#76e8da');
    drawCardText(ctx,`${winner.goals} GOL`,x+178,914,95,25,18,900,'center','#6cff73');
    drawCardText(ctx,`${winner.cleanSheets} CS`,x+282,914,82,25,18,900,'center','#50e6d0');
    drawCardText(ctx,`${winner.redCards} TR`,x+382,914,74,25,18,900,'center','#ff7180');
    drawCardText(ctx,group.provisional?'CO-GANADOR PROVISIONAL':'CO-GANADOR OFICIAL',x+230,1042,390,16,11,900,'center',tone);
  }
  fillRounded(ctx,160,1158,760,58,22,group.provisional?'rgba(239,183,93,.075)':'rgba(231,202,105,.06)');
  strokeRounded(ctx,160,1158,760,58,22,group.provisional?'rgba(239,183,93,.2)':'rgba(231,202,105,.18)',2);
  drawCardText(ctx,`${monthlyMatchdayLabel(group.matchdays).toLocaleUpperCase('es')} · CIERRE J${group.matchday}`,540,1195,720,17,12,850,'center','#a5aa91');
}

async function drawPlayerMonthWinnerGrid(ctx,group){
  const count=group.winners.length;
  const columns=count<=4?2:count<=9?3:4;
  const rows=Math.ceil(count/columns);
  const gap=14;
  const gridX=60;
  const gridY=375;
  const gridWidth=960;
  const gridHeight=770;
  const tileWidth=(gridWidth-gap*(columns-1))/columns;
  const tileHeight=(gridHeight-gap*(rows-1))/rows;
  const spacious=count<=4;

  for(let index=0;index<count;index++){
    const winner=group.winners[index];
    const column=index%columns;
    const row=Math.floor(index/columns);
    const x=gridX+column*(tileWidth+gap);
    const y=gridY+row*(tileHeight+gap);
    const gradient=ctx.createLinearGradient(x,y,x+tileWidth,y+tileHeight);
    gradient.addColorStop(0,index%2?'rgba(80,230,208,.09)':'rgba(231,202,105,.105)');
    gradient.addColorStop(1,'rgba(3,18,25,.96)');
    fillRounded(ctx,x,y,tileWidth,tileHeight,spacious?28:20,gradient);
    strokeRounded(ctx,x,y,tileWidth,tileHeight,spacious?28:20,index%2?'rgba(80,230,208,.24)':'rgba(231,202,105,.28)',2);

    if(spacious){
      const avatar=Math.min(150,tileHeight-128);
      await drawPlayerAvatar(ctx,winner.name,x+30,y+58,avatar,38);
      const copyX=x+avatar+52;
      const copyWidth=tileWidth-avatar-76;
      drawCardText(ctx,winner.name,copyX,y+106,copyWidth,31,17,900,'left','#f7faf8');
      drawCardText(ctx,`${winner.points.toLocaleString('es')} PTS`,copyX,y+158,copyWidth,36,22,900,'left','#e7ca69');
      drawCardText(ctx,group.provisional?'PROVISIONAL':'CO-GANADOR',copyX,y+198,copyWidth,14,10,900,'left',group.provisional?'#efb75d':'#7fe3d7');
      fillRounded(ctx,x+28,y+tileHeight-94,tileWidth-56,66,18,'rgba(3,18,24,.68)');
      strokeRounded(ctx,x+28,y+tileHeight-94,tileWidth-56,66,18,'rgba(80,230,208,.12)',2);
      drawCardText(ctx,`${winner.played} J  ·  ${winner.goals} GOL  ·  ${winner.cleanSheets} CS  ·  ${winner.redCards} TR`,x+tileWidth/2,y+tileHeight-52,tileWidth-78,17,11,850,'center','#83aaa6');
    }else{
      const avatar=Math.max(52,Math.min(88,tileHeight-58));
      await drawPlayerAvatar(ctx,winner.name,x+14,y+18,avatar,22);
      const copyX=x+avatar+27;
      const copyWidth=tileWidth-avatar-39;
      drawCardText(ctx,winner.name,copyX,y+44,copyWidth,22,10,900,'left','#f7faf8');
      drawCardText(ctx,`${winner.points.toLocaleString('es')} PTS`,copyX,y+78,copyWidth,25,13,900,'left','#e7ca69');
      drawCardText(ctx,`${winner.played}J · ${winner.goals}G · ${winner.cleanSheets}CS · ${winner.redCards}TR`,x+14,y+tileHeight-17,tileWidth-28,13,8,850,'left','#78a29e');
    }
  }

  fillRounded(ctx,160,1168,760,48,20,group.provisional?'rgba(239,183,93,.075)':'rgba(231,202,105,.06)');
  drawCardText(ctx,`${count} CO-GANADORES · ${monthlyMatchdayLabel(group.matchdays).toLocaleUpperCase('es')} · CIERRE J${group.matchday}`,540,1200,730,15,9,850,'center',group.provisional?'#efb75d':'#dcca7e');
}

async function drawPlayerMonthShareCard(ctx,group){
  const winnerCount=group?.winners?.length||0;
  await drawShareCardBase(ctx,{
    eyebrow:'PREMIO MENSUAL',
    title:winnerCount>1?'CO-GANADORES DEL MES':'JUGADOR DEL MES',
    subtitle:group?`${monthlyMatchdayLabel(group.matchdays)} · Cierre J${group.matchday}${group.provisional?' · Resultado provisional':''}`:'Se activa al publicar el cierre de un mes.',
    badge:group?playerMonthCanvasLabel(group):'SIN PREMIOS'
  });
  if(!group||!winnerCount){
    drawShareCardEmpty(ctx,'Esperando el primer cierre mensual','Publica la jornada de cierre para generar esta tarjeta.');
    drawShareCardFooter(ctx);
    return false;
  }

  await preloadShareCardPlayers(group.winners.map(winner=>winner.name));
  if(winnerCount===1)await drawSinglePlayerMonthWinner(ctx,group,group.winners[0]);
  else if(winnerCount===2)await drawTwoPlayerMonthWinners(ctx,group);
  else await drawPlayerMonthWinnerGrid(ctx,group);
  drawShareCardFooter(ctx);
  return true;
}

async function drawChampionsShareCard(ctx,groupIndex){
  const group=DATA.champions.groups[groupIndex]||DATA.champions.groups[0];
  const publishedCount=CHAMPIONS_PUBLISHED_MATCHDAYS.length;
  const progress=championsMatchdayProgress();
  const partialMatchdays=[...progress.partial].sort((a,b)=>a-b);
  const postponedMatchdays=[...progress.postponed].sort((a,b)=>a-b);
  await drawShareCardBase(ctx,{
    eyebrow:'CUBAN LEAGUE CHAMPIONS',
    title:`${group.name.toUpperCase()} · FASE DE GRUPOS`,
    subtitle:partialMatchdays.length
      ?`Datos automáticos de Liga · Pendiente Champions J${partialMatchdays.join(', J')}.`
      :postponedMatchdays.length
        ?`Datos automáticos de Liga · Provisional Champions J${postponedMatchdays.join(', J')}.`
        :'Ocho partidos por competidor · Ida y vuelta.',
    badge:partialMatchdays.length
      ?'DATOS PENDIENTES'
      :postponedMatchdays.length
        ?'PROVISIONAL'
        :`${publishedCount}/8 JORNADAS`
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

function selectedShareCardMonthGroup(groups=monthlyAchievementGroups()){
  const selectedKey=$('cardMonthSelect')?.value||SHARE_CARD_MONTH_KEY;
  return groups.find(group=>group.month===selectedKey)||groups[0]||null;
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
    else if(SHARE_CARD_TYPE==='champions')ready=await drawChampionsShareCard(ctx,SHARE_CARD_GROUP_INDEX);
    else if(SHARE_CARD_TYPE==='player-month')ready=await drawPlayerMonthShareCard(ctx,selectedShareCardMonthGroup());
    else throw new Error('Tipo de tarjeta desconocido');
    if(token!==SHARE_CARD_RENDER_TOKEN)return;
    previewCtx.clearRect(0,0,SHARE_CARD_WIDTH,SHARE_CARD_HEIGHT);
    previewCtx.drawImage(workCanvas.__shareCardSurface||workCanvas,0,0);
    const monthGroup=SHARE_CARD_TYPE==='player-month'?selectedShareCardMonthGroup():null;
    canvas.setAttribute('aria-label',monthGroup
      ?`Tarjeta de ${monthGroup.winners.length>1?'co-ganadores':'Jugador del mes'} de ${monthGroup.label}: ${monthGroup.winners.map(winner=>winner.name).join(', ')}`
      :'Vista previa de la tarjeta para compartir');
    SHARE_CARD_READY=ready;
    $('downloadShareCard').disabled=!ready;
    $('shareShareCard').disabled=!ready;
    setShareCardStatus(
      ready
        ?'Tarjeta lista para descargar o compartir.'
        :SHARE_CARD_TYPE==='player-month'
          ?'Publica el cierre de un mes para activar esta tarjeta.'
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

  const monthGroups=monthlyAchievementGroups();
  const monthSelect=$('cardMonthSelect');
  const previousMonth=SHARE_CARD_MONTH_KEY||monthSelect.value;
  const selectedMonth=monthGroups.some(group=>group.month===previousMonth)
    ?previousMonth
    :monthGroups[0]?.month||'';
  monthSelect.disabled=!monthGroups.length;
  monthSelect.innerHTML=monthGroups.length
    ?monthGroups.map(group=>`<option value="${profileAttr(group.month)}">${profileAttr(group.label)}${group.provisional?' · Provisional':' · Oficial'}</option>`).join('')
    :'<option value="">Sin meses cerrados</option>';
  monthSelect.value=selectedMonth;
  SHARE_CARD_MONTH_KEY=selectedMonth;

  const champions=SHARE_CARD_TYPE==='champions';
  const playerMonth=SHARE_CARD_TYPE==='player-month';
  const usesMatchday=!champions&&!playerMonth;
  $('cardMatchdayField').hidden=!usesMatchday;
  $('cardGroupField').hidden=!champions;
  $('cardMonthField').hidden=!playerMonth;
  $('shareCardDataHint').textContent=playerMonth
    ?'Solo aparecen meses cerrados y publicados.'
    :champions
      ?'La tabla usa los datos automáticos de Champions.'
      :'Solo aparecen jornadas publicadas.';
  document.querySelectorAll('[data-card-type]').forEach(button=>{
    const active=button.dataset.cardType===SHARE_CARD_TYPE;
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',String(active));
  });
  const titles={
    podium:'Podio de la jornada',
    standings:'Top 10 de la temporada',
    leaders:'Líderes y destacados',
    champions:'Tabla del grupo de Champions',
    'player-month':'Jugador del mes'
  };
  $('shareCardPreviewTitle').textContent=titles[SHARE_CARD_TYPE];
  renderShareCardPreview();
}

function shareCardFilename(){
  const matchday=selectedShareCardMatchday();
  const monthGroup=selectedShareCardMonthGroup();
  const parts={
    podium:`Podio-Jornada-${matchday||'Sin-Datos'}`,
    standings:`Top-10-Jornada-${matchday||'Sin-Datos'}`,
    leaders:`Lideres-Jornada-${matchday||'Sin-Datos'}`,
    champions:`Champions-${(DATA.champions.groups[SHARE_CARD_GROUP_INDEX]?.name||'Grupo').replace(/\s+/g,'-')}`,
    'player-month':`Jugador-del-Mes-${monthGroup?.month||'Sin-Datos'}`
  };
  return `Cuban-League-${parts[SHARE_CARD_TYPE]}.png`;
}

function shareCardMessage(){
  if(SHARE_CARD_TYPE!=='player-month')return 'Tarjeta oficial de Cuban League';
  const group=selectedShareCardMonthGroup();
  if(!group)return 'Jugador del mes de Cuban League';
  const winners=group.winners.map(winner=>winner.name).join(' y ');
  return `${group.winners.length>1?'Co-ganadores':'Jugador del mes'} de ${group.label}: ${winners} · Cuban League`;
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
        text:shareCardMessage()
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
  $('cardMonthSelect').onchange=()=>{
    SHARE_CARD_MONTH_KEY=$('cardMonthSelect').value;
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

function setupChampionsCalendarToggle(){
  const calendar=$('championsCalendar');
  const toggle=$('championsCalendarToggle');
  const panel=$('championsCalendarPanel');
  if(!calendar||!toggle||!panel)return;

  const setCalendarOpen=open=>{
    calendar.classList.toggle('is-open',open);
    toggle.setAttribute('aria-expanded',String(open));
    panel.setAttribute('aria-hidden',String(!open));
  };

  setCalendarOpen(false);
  toggle.addEventListener('click',()=>{
    setCalendarOpen(toggle.getAttribute('aria-expanded')!=='true');
  });
}

async function init(){
  trackSiteVisit();
  const catalogPromise=window.CubanLeaguePlayerCatalog
    ?window.CubanLeaguePlayerCatalog.load(APP_VERSION).catch(()=>null)
    :Promise.resolve(null);
  const [dataResponse,catalog]=await Promise.all([
    fetch(`data.json?v=${APP_VERSION}`,{cache:'no-store'}),
    catalogPromise
  ]);
  DATA=await dataResponse.json();
  PLAYER_CATALOG=catalog;
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
  setupChampionsCalendarToggle();
  renderCup();
  setupShareCardStudio();

  const syncPublishedData=async()=>{
    const liveStatsResult=await syncLiveCurrentStats({render:false});
    const liveStatsSynced=liveStatsResult.synced;
    const liveStatsChanged=liveStatsResult.changed;
    syncChampionsStats({render:false});
    const milestonesChanged=await syncAchievementMilestones({render:false});
    if((liveStatsChanged||milestonesChanged)&&PROFILE_SEASON_STATE&&!$('playerModal')?.hidden){
      refreshOpenProfileCurrentSummary();
      if(liveStatsChanged)ensureProfileSeasonData({force:true});
    }
    renderCurrent();
    renderMatchdayCenter();
    renderHomeLive();
    renderPlayers($('playerSearch')?.value||'');
    renderChampions();
    renderCup();
    if(SHARE_CARD_BOUND)renderShareCardStudio();
    checkForNewAchievementUnlocks();
    if(liveStatsSynced)await refreshOpenMatchdayLineup();
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
    const leagueStatsSection=e.target.closest('[data-league-stats-section]');
    if(leagueStatsSection){
      setLeagueStatsSection(leagueStatsSection.dataset.leagueStatsSection,{focus:true});
      return;
    }
    const leagueComparatorSwap=e.target.closest('[data-league-comparator-swap]');
    if(leagueComparatorSwap){
      swapLeagueComparatorParticipants({focus:true});
      return;
    }
    const leagueCaptainMode=e.target.closest('[data-league-captain-mode]');
    if(leagueCaptainMode){
      setLeagueCaptainMode(leagueCaptainMode.dataset.leagueCaptainMode,{focus:true});
      return;
    }
    const leagueLinePosition=e.target.closest('[data-league-line-position]');
    if(leagueLinePosition){
      setLeagueLinePosition(leagueLinePosition.dataset.leagueLinePosition,{focus:true});
      return;
    }
    const leagueStatsRetry=e.target.closest('[data-league-stats-retry]');
    if(leagueStatsRetry){
      ensureLeagueStatsData({force:true});
      return;
    }
    const profileJump=e.target.closest('[data-profile-jump]');
    if(profileJump){
      setProfileView(profileJump.dataset.profileJump,{focus:true});
      return;
    }
    const profileView=e.target.closest('[data-profile-view]');
    if(profileView){
      setProfileView(profileView.dataset.profileView,{focus:true});
      return;
    }
    const profileSeasonSection=e.target.closest('[data-profile-season-section]');
    if(profileSeasonSection){
      setProfileSeasonSection(profileSeasonSection.dataset.profileSeasonSection,{focus:true});
      return;
    }
    const profileSeasonSort=e.target.closest('[data-profile-season-sort]');
    if(profileSeasonSort){
      setProfileSeasonSort(profileSeasonSort.dataset.profileSeasonSort,profileSeasonSort.dataset.profileSeasonSortValue,{focus:true});
      return;
    }
    const profileSeasonRetry=e.target.closest('[data-profile-season-retry]');
    if(profileSeasonRetry){
      ensureProfileSeasonData({force:true});
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
    const lineup=e.target.closest('[data-matchday-lineup-player]');
    if(lineup){
      openMatchdayLineup(lineup.dataset.matchdayLineupPlayer,Number(lineup.dataset.matchday));
      return;
    }
    const team=e.target.closest('[data-profile-player]');
    if(team)openPlayer(team.dataset.profilePlayer);
  });
  document.addEventListener('change',e=>{
    const leagueComparatorSelect=e.target.closest?.('[data-league-comparator-side]');
    if(leagueComparatorSelect){
      setLeagueComparatorParticipant(leagueComparatorSelect.dataset.leagueComparatorSide,leagueComparatorSelect.value,{focus:true});
      return;
    }
    const managerCompare=e.target.closest?.('[data-manager-compare-select]');
    if(managerCompare){
      renderManagerComparison(managerCompare.dataset.managerPrimary,managerCompare.value);
    }
  });
  document.addEventListener('keydown',e=>{
    trapMatchdayLineupFocus(e);
    if(handleProfileTabsKeydown(e))return;
    const team=e.target.closest?.('[data-profile-player]');
    if(team&&(e.key==='Enter'||e.key===' ')){
      e.preventDefault();
      openPlayer(team.dataset.profilePlayer);
    }
    if(e.key==='Escape'&&!$('lineupModal').hidden)closeMatchdayLineup();
    else if(e.key==='Escape'&&!$('playerModal').hidden)closePlayer();
    else if(e.key==='Escape'&&!$('installModal').hidden)closeInstallGuide();
  });
  document.querySelectorAll('.navtab').forEach(b=>b.onclick=()=>go(b.dataset.section));
  document.querySelectorAll('[data-regulation-view]').forEach(button=>{
    button.onclick=()=>setRegulationView(button.dataset.regulationView);
  });
  document.querySelectorAll('.history-hub-tab[data-history-view]').forEach(button=>{
    button.onclick=()=>setHistoryHubView(button.dataset.historyView);
  });
  const historySubtabs=[...document.querySelectorAll('.history-subtabs .subtab[data-hist]')];
  historySubtabs.forEach((button,index)=>{
    button.onclick=()=>setHistoricalTableView(button.dataset.hist);
    button.onkeydown=event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      const nextIndex=event.key==='Home'
        ?0
        :event.key==='End'
          ?historySubtabs.length-1
          :(index+(event.key==='ArrowRight'?1:-1)+historySubtabs.length)%historySubtabs.length;
      setHistoricalTableView(historySubtabs[nextIndex].dataset.hist,{focus:true});
    };
  });
  $('sortGeneral').onchange=e=>renderGeneral(e.target.value);
  $('playerSearch').oninput=e=>renderPlayers(e.target.value);
  $('closeLineupModal').onclick=closeMatchdayLineup;
  $('lineupModal').onclick=e=>{if(e.target.id==='lineupModal')closeMatchdayLineup()};
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
