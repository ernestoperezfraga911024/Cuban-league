const APP_VERSION='44-20260725';
let DATA;
let LIVE_MATCHDAY_ROWS=[];
let PUBLISHED_MATCHDAYS=[];
let SELECTED_MATCHDAY=null;
const CHAMPIONS_MATCHDAY_COUNT=8;
let CHAMPIONS_MATCHDAY_ROWS=[];
let CHAMPIONS_PUBLISHED_MATCHDAYS=[];
let SHARE_CARD_TYPE='podium';
let SHARE_CARD_GROUP_INDEX=0;
let SHARE_CARD_RENDER_TOKEN=0;
let SHARE_CARD_READY=false;
const $=id=>document.getElementById(id);const imageMap=()=>Object.fromEntries(DATA.participants.map(p=>[p.name,p.shield]));const statMap=()=>Object.fromEntries(DATA.general.map(p=>[p.name,p]));
const uiIcon=(name,className='ui-icon')=>`<svg class="${className}" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
const profileAttr=name=>String(name).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function profileTriggerAttrs(name){const safe=profileAttr(name);return `data-profile-player="${safe}" role="button" tabindex="0" aria-label="Ver perfil completo de ${safe}"`}
function teamCell(name){return `<div class="team team-profile-link" ${profileTriggerAttrs(name)}><img src="${imageMap()[name]||''}" alt="Foto de ${name}"><span class="name">${name}</span></div>`}

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
    updatedAt:row.updated_at||null
  })).filter(row=>
    validNames.has(row.participantName)
    &&Number.isInteger(row.matchday)
    &&row.matchday>=1
    &&row.matchday<=CHAMPIONS_MATCHDAY_COUNT
  );
}

async function syncChampionsStats({render=true}={}){
  const config=window.CUBAN_LEAGUE_SUPABASE;
  if(!DATA||!config?.url||!config?.publishableKey)return false;
  try{
    const endpoint=new URL(`${config.url.replace(/\/$/,'')}/rest/v1/matchday_stats`);
    endpoint.searchParams.set('select','participant_name,matchday,points,updated_at');
    endpoint.searchParams.set('season',`eq.${championsSeasonKey()}`);
    endpoint.searchParams.set('published','eq.true');
    endpoint.searchParams.append('matchday','gte.1');
    endpoint.searchParams.append('matchday',`lte.${CHAMPIONS_MATCHDAY_COUNT}`);
    endpoint.searchParams.set('order','matchday.asc');
    const response=await fetch(endpoint,{
      cache:'no-store',
      headers:{
        apikey:config.publishableKey,
        Authorization:`Bearer ${config.publishableKey}`,
        Accept:'application/json'
      }
    });
    if(!response.ok)throw new Error('No se pudo actualizar la Champions');
    const rows=await response.json();
    if(!Array.isArray(rows))throw new Error('Respuesta de Champions no válida');

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
      played:row?1:0
    };
  }).sort(sortStandings).map((participant,index)=>({...participant,position:index+1}));
}

function cumulativeStandings(matchday){
  const totals=new Map(activeParticipants().map(participant=>[
    participant.name,
    {points:0,goals:0,cleanSheets:0,matchdays:new Set()}
  ]));
  LIVE_MATCHDAY_ROWS.forEach(row=>{
    if(row.matchday>matchday||!totals.has(row.participantName))return;
    const total=totals.get(row.participantName);
    total.points+=row.points;
    total.goals+=row.goals;
    total.cleanSheets+=row.cleanSheets;
    total.matchdays.add(row.matchday);
  });
  return activeParticipants().map(participant=>{
    const total=totals.get(participant.name);
    return {
      ...participant,
      points:total.points,
      goals:total.goals,
      cleanSheets:total.cleanSheets,
      played:total.matchdays.size
    };
  }).sort(sortStandings).map((participant,index)=>({...participant,position:index+1}));
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
    const endpoint=new URL(`${config.url.replace(/\/$/,'')}/rest/v1/matchday_stats`);
    endpoint.searchParams.set('select','participant_name,matchday,points,goals,clean_sheets,updated_at');
    endpoint.searchParams.set('season',`eq.${config.season||DATA.currentSeason}`);
    endpoint.searchParams.set('published','eq.true');
    endpoint.searchParams.set('order','matchday.asc');
    const response=await fetch(endpoint,{
      cache:'no-store',
      headers:{
        apikey:config.publishableKey,
        Authorization:`Bearer ${config.publishableKey}`,
        Accept:'application/json'
      }
    });
    if(!response.ok)throw new Error('No se pudo actualizar la clasificación');
    const rows=await response.json();
    if(!Array.isArray(rows))throw new Error('Respuesta de clasificación no válida');

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
      if(SHARE_CARD_BOUND)renderShareCardStudio();
    }
    return true;
  }catch{
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
function go(id){document.querySelectorAll('.page,.navtab').forEach(x=>x.classList.remove('active'));$(id).classList.add('active');document.querySelector(`.navtab[data-section="${id}"]`)?.classList.add('active');scrollTo({top:document.querySelector('main').offsetTop-100,behavior:'smooth'})}
function renderCurrent(){
  const latest=PUBLISHED_MATCHDAYS.length?PUBLISHED_MATCHDAYS[PUBLISHED_MATCHDAYS.length-1]:null;
  const rows=latest==null
    ?activeParticipants().sort(sortStandings).map((participant,index)=>({...participant,position:index+1}))
    :cumulativeStandings(latest);
  const movements=latest==null?new Map():movementForMatchday(latest);
  $('updated').textContent=DATA.lastUpdated;
  $('currentRows').innerHTML=rows.map(p=>`<div class="row current-row">
    <span class="pos">${p.position}</span>
    ${teamCell(p.name)}
    <span class="center">${p.played}</span>
    <span class="num">${p.points.toLocaleString('es')}</span>
    <span class="current-stat current-goals" aria-label="${p.goals??0} goles">${p.goals??0}</span>
    <span class="current-stat current-clean-sheets" aria-label="${p.cleanSheets??0} clean sheets">${p.cleanSheets??0}</span>
    <span class="current-movement">${movementBadge(latest==null?null:movements.get(p.name))}</span>
    <span class="current-form" aria-label="Forma de las últimas jornadas">${recentForm(p.name,latest)}</span>
  </div>`).join('');
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
    badge:'PRETEMPORADA',
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
    <div><span>${label}</span><b>${name}</b><small>${detail}</small></div>
  </article>`;
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
  return `<div class="hero-kpis-heading">
    <div><span>${eyebrow}</span><strong>${title}</strong><small>${subtitle}</small></div>
    <span class="hero-kpis-badge">${badge}</span>
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
    $('homeLiveBadge').textContent='PRETEMPORADA';
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
  $('homeLiveCopy').textContent=`${weeklyLeader.name} lideró la fecha con ${weeklyLeader.points.toLocaleString('es')} puntos. Consulta el resumen completo, los goles, clean sheets y movimientos.`;
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
    badge.textContent='PRETEMPORADA';
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
          tone:'pulse-rise',
          icon:'chart',
          label:'Mayor subida',
          names:risers,
          value:biggestRise?`+${biggestRise} ${biggestRise===1?'posición':'posiciones'}`:'Sin cambios',
          emptyCopy:previousPublishedMatchday(latest)==null?'Primera jornada':'Nadie subió'
        })}
      </div>`;
  }

  host.querySelectorAll('[data-go]').forEach(button=>button.onclick=()=>go(button.dataset.go));
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
    return `<button type="button" class="matchday-archive-card ${day===SELECTED_MATCHDAY?'active':''}" data-matchday-open="${day}" aria-label="Ver resumen de la jornada ${day}">
      <span class="matchday-archive-number">J${day}</span>
      <span class="matchday-archive-copy"><small>Jornada ${day}</small><b>${winner.name}</b><span>${winner.points.toLocaleString('es')} pts · ${totalGoals} ${totalGoals===1?'gol':'goles'}</span></span>
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
    <small>${player.goals} GOL · ${player.cleanSheets} CS</small>
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

function sortedGeneral(mode){const x=[...DATA.general];if(mode==='points')return x.sort((a,b)=>b.points-a.points);if(mode==='titles')return x.sort((a,b)=>b.titles-a.titles||b.podiums-a.podiums||b.points-a.points);if(mode==='average')return x.sort((a,b)=>b.average-a.average);if(mode==='podiums')return x.sort((a,b)=>b.podiums-a.podiums||b.titles-a.titles);return x.sort((a,b)=>b.score-a.score)}
function renderGeneral(mode='ranking'){$('generalRows').innerHTML=sortedGeneral(mode).map((p,i)=>`<div class="general-row"><span class="pos">${i+1}</span>${teamCell(p.name)}<span class="center">${p.titles}</span><span class="center">${p.seconds}</span><span class="center">${p.thirds}</span><span class="center">${p.podiums}</span><span class="center">${p.top5}</span><span class="center">${p.seasons}</span><span class="num">${p.points.toLocaleString()}</span><span class="num">${p.average?p.average.toFixed(1):'—'}</span><span class="num">${p.score.toFixed(1)}</span></div>`).join('')}
function renderPoints(){$('pointsRows').innerHTML=DATA.historicalTables.pointsRanking.map((p,i)=>`<div class="points-row"><span class="pos">${i+1}</span>${teamCell(p.name)}<span class="center">${p.seasons}</span><span class="num">${p.points.toLocaleString()}</span><span class="num">${p.average.toFixed(1)}</span></div>`).join('')}
function renderPalmares(){$('palmaresRows').innerHTML=DATA.historicalTables.palmaresRanking.map((p,i)=>`<div class="palmares-row"><span class="pos">${i+1}</span>${teamCell(p.name)}<span class="center">${p.titles}</span><span class="center">${p.seconds}</span><span class="center">${p.thirds}</span><span class="center">${p.podiums}</span></div>`).join('')}
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
$('seasonChampions').innerHTML=list.map(c=>{
const img=imageMap()[c.name];
return `<article class="champion-history-card">${img?`<img src="${img}" alt="">`:`<div class="champion-placeholder">${uiIcon('trophy','champion-placeholder-icon')}</div>`}<div><span>${c.season}</span><h3>${playerInline(c.name)}</h3><p>${c.points?c.points.toLocaleString()+' puntos':'El campeón de esta edición no aparece identificado en las capturas disponibles.'}</p></div></article>`
}).join('')
}
function renderPlayers(filter=''){const stats=statMap();$('playerGrid').innerHTML=DATA.participants.filter(p=>p.name.toLowerCase().includes(filter.toLowerCase())).map(p=>{const s=stats[p.name]||{};return `<article class="player-card team-profile-link" ${profileTriggerAttrs(p.name)}><img src="${p.shield}" alt="Foto de ${p.name}"><h3>${p.name}</h3><small>${s.label||'Participante'}</small><p>${s.points?.toLocaleString()||0} puntos · ${s.podiums||0} podios</p><span class="profile-card-cta">Ver ficha completa →</span></article>`}).join('')}
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
    return {active:false,started:false,position:null,points:0,played:0};
  }
  const sorted=DATA.participants.filter(p=>p.active!==false).sort((a,b)=>b.points-a.points||(b.goals||0)-(a.goals||0)||(b.cleanSheets||0)-(a.cleanSheets||0)||a.id-b.id);
  const player=sorted.find(p=>p.name===name);
  const started=sorted.some(p=>(p.played||0)>0||(p.points||0)>0);
  return {
    active:true,
    started,
    position:started?sorted.findIndex(p=>p.name===name)+1:null,
    points:player?.points||0,
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
  const historicalRank=[...DATA.general].sort((a,b)=>b.score-a.score).findIndex(x=>x.name===name)+1;
  return {history:h,first,second,best,worst,avgPos,bestPoints,historicalRank:historicalRank||null,current:currentStanding(name)};
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
  profileReturnFocus=document.activeElement;
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
      <div><span>Ranking histórico</span><b>${m.historicalRank?`#${m.historicalRank}`:'—'}</b></div>
    </section>

    <section class="profile-major-stats">
      <article><b>${s.titles||0}</b><span>Títulos</span></article>
      <article><b>${s.seconds||0}</b><span>Subcampeonatos</span></article>
      <article><b>${s.podiums||0}</b><span>Podios</span></article>
      <article><b>${s.points?.toLocaleString()||0}</b><span>Puntos históricos</span></article>
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
  requestAnimationFrame(()=>$('closeModal').focus());
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
    'Mejor promedio':'pts / temporada',
    'Más temporadas':'temporadas',
    'Más Top 5':'veces'
  };
  return units[title]||'marca';
}

function renderRecords(){
  const completedSeasons=(DATA.historicalTables?.seasonArchive||[]).filter(season=>season.results?.length).length;
  $('recordsMeta').innerHTML=`
    <article><span class="records-meta-icon">${uiIcon('trophy')}</span><div><b>${DATA.records.length}</b><small>Marcas oficiales</small></div></article>
    <article><span class="records-meta-icon">${uiIcon('calendar')}</span><div><b>${completedSeasons}</b><small>Temporadas analizadas</small></div></article>
    <article><span class="records-meta-icon">${uiIcon('users')}</span><div><b>${DATA.participants.length}</b><small>Perfiles históricos</small></div></article>`;

  $('recordGrid').innerHTML=DATA.records.map((record,index)=>{
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
        <div class="record-value"><b>${record.value}</b><small>${recordUnit(record.title)}</small></div>
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
        points:row?.points||0
      };
    });
    return {
      name,
      sourceIndex,
      matchdays,
      played:matchdays.filter(day=>day.played).length,
      total:matchdays.reduce((sum,day)=>sum+day.points,0)
    };
  }).sort((a,b)=>b.total-a.total||b.played-a.played||a.sourceIndex-b.sourceIndex);
}

function renderChampions(){
  const publishedCount=CHAMPIONS_PUBLISHED_MATCHDAYS.length;
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
      return `<div class="champions-score-row champions-score-grid">
        <span class="champions-rank">${index+1}</span>
        <div class="champions-team-cell team-profile-link" ${profileTriggerAttrs(team.name)}>
          <img src="${imageMap()[team.name]||''}" alt="Foto de ${safeName}">
          <b>${safeName}</b>
        </div>
        ${points}
        <strong class="champions-total">${team.total.toLocaleString('es')}</strong>
      </div>`;
    }).join('');
    return `<article class="group champions-group">
      <header class="champions-group-head">
        <span class="champions-group-icon">${uiIcon('shield')}</span>
        <div><h3>${group.name}</h3><small>5 competidores · ida y vuelta</small></div>
        <span class="champions-round-count">${publishedCount}/${CHAMPIONS_MATCHDAY_COUNT}</span>
      </header>
      <div class="champions-score-scroll" tabindex="0" aria-label="Tabla de ${group.name}. Desliza horizontalmente para consultar las ocho jornadas.">
        <div class="champions-score-table">
          <div class="champions-score-head champions-score-grid">
            <span>#</span>
            <span>Participante</span>
            ${headerDays}
            <span>Total</span>
          </div>
          ${rows}
        </div>
      </div>
      <footer class="champions-group-footer"><span>Clasifican los 2 primeros</span><span>Total automático</span></footer>
    </article>`;
  }).join('');
  $('bracket').innerHTML=DATA.champions.knockout.map(r=>`<article class="round"><h3 class="group-title">${uiIcon('trophy')}<span>${r.round}</span></h3><div class="empty-match">Pendiente de clasificación</div><div class="empty-match">Pendiente de clasificación</div></article>`).join('');
}
function renderNews(){$('newsGrid').innerHTML=DATA.news.map(n=>`<article class="news-card icon-card"><div class="card-label-row"><span>${n.date}</span><span class="record-icon news">${uiIcon('news')}</span></div><h3>${n.title}</h3><p>${n.text}</p></article>`).join('')}

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
    badge:matchday?`JORNADA ${matchday}`:'PRETEMPORADA'
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
      x:387,
      label:'MÁXIMO GOLEADOR',
      name:leaderName(goals),
      value:goals.value?`${goals.value} ${goals.value===1?'GOL':'GOLES'}`:'SIN GOLES',
      tone:'#91f188'
    },
    {
      x:714,
      label:'MÁS CLEAN SHEETS',
      name:leaderName(cleanSheets),
      value:cleanSheets.value?`${cleanSheets.value} ${cleanSheets.value===1?'CLEAN SHEET':'CLEAN SHEETS'}`:'SIN CLEAN SHEETS',
      tone:'#e7ca69'
    }
  ];
  metrics.forEach(metric=>{
    fillRounded(ctx,metric.x,1022,306,164,24,'rgba(7,30,34,.88)');
    strokeRounded(ctx,metric.x,1022,306,164,24,`${metric.tone}35`,2);
    drawCardText(ctx,metric.label,metric.x+153,1061,264,15,11,850,'center','#819b9e');
    drawCardText(ctx,metric.name,metric.x+153,1105,264,20,13,850,'center','#f0f7f3');
    drawCardText(ctx,metric.value,metric.x+153,1154,264,29,20,900,'center',metric.tone);
  });
  drawShareCardFooter(ctx);
  return true;
}

async function drawStandingsShareCard(ctx,matchday){
  await drawShareCardBase(ctx,{
    eyebrow:'CLASIFICACIÓN GENERAL',
    title:'TOP 10 DE LA TEMPORADA',
    subtitle:'Tabla acumulada después de la jornada seleccionada.',
    badge:matchday?`HASTA J${matchday}`:'PRETEMPORADA'
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
    badge:matchday?`JORNADA ${matchday}`:'PRETEMPORADA'
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
  drawCardText(ctx,'PARTICIPANTE',126,399,260,15,12,850,'left','#78aaa7');
  for(let day=1;day<=8;day++)drawCardText(ctx,`J${day}`,475+(day-1)*65,399,50,14,11,850,'center','#78aaa7');
  drawCardText(ctx,'TOTAL',1000,399,80,14,11,850,'center','#91f188');

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
    drawCardText(ctx,player.name,205,y+71,225,24,15,850,'left','#eff7f4');
    player.matchdays.forEach((day,dayIndex)=>{
      const center=475+dayIndex*65;
      fillRounded(ctx,center-22,y+41,44,44,12,day.played?'rgba(80,230,208,.085)':'rgba(255,255,255,.025)');
      drawCardText(ctx,day.played?day.points.toLocaleString('es'):'—',center,y+70,38,15,10,850,'center',day.played?'#7feadd':'#50696f');
    });
    drawCardText(ctx,player.total.toLocaleString('es'),1000,y+73,74,25,18,900,'center',index<2?'#91f188':'#79e2d7');
  }

  fillRounded(ctx,160,1177,760,58,22,'rgba(231,202,105,.055)');
  strokeRounded(ctx,160,1177,760,58,22,'rgba(231,202,105,.15)',2);
  drawCardText(ctx,'CLASIFICAN LOS 2 PRIMEROS · TOTAL AUTOMÁTICO',540,1214,700,17,13,850,'center','#d8c36f');
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
  renderNews();
  setupShareCardStudio();

  const syncPublishedData=()=>{
    syncLiveCurrentStats();
    syncChampionsStats();
  };
  syncPublishedData();
  window.setInterval(()=>{
    if(document.visibilityState==='visible')syncPublishedData();
  },60000);
  window.addEventListener('online',syncPublishedData);
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible')syncPublishedData();
  });

  document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
  document.addEventListener('click',e=>{
    const team=e.target.closest('[data-profile-player]');
    if(team)openPlayer(team.dataset.profilePlayer);
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
  setupPWA();
  const launchSection=new URLSearchParams(location.search).get('section');
  if(['home','current','matchdays','seasons','players','history','records','champions','cards','news'].includes(launchSection)){
    requestAnimationFrame(()=>go(launchSection));
  }
}
init();
