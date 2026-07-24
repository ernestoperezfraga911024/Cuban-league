const APP_VERSION='38-20260724';
let DATA;
let LIVE_MATCHDAY_ROWS=[];
let PUBLISHED_MATCHDAYS=[];
let SELECTED_MATCHDAY=null;
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

function renderHomeLive(){
  if(!$('homeLiveTitle'))return;
  const latest=PUBLISHED_MATCHDAYS.length?PUBLISHED_MATCHDAYS[PUBLISHED_MATCHDAYS.length-1]:null;
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
function renderRecords(){$('recordGrid').innerHTML=DATA.records.map(r=>`<article class="record icon-card"><div class="card-label-row"><span>${r.title}</span><span class="record-icon">${uiIcon('trophy')}</span></div><h3>${r.value}</h3><p>${playerInline(r.player)}</p></article>`).join('');$('awardGrid').innerHTML=DATA.awards.map(a=>`<article class="record icon-card"><div class="card-label-row"><span>${a.title}</span><span class="record-icon award">${uiIcon('star')}</span></div><h3>${playerInline(a.player)}</h3><p>${a.text}</p></article>`).join('')}
function renderChampions(){$('groupGrid').innerHTML=DATA.champions.groups.map(g=>`<article class="group"><h3 class="group-title">${uiIcon('shield')}<span>${g.name}</span></h3>${g.teams.map((t,i)=>`<div class="group-team team-profile-link" ${profileTriggerAttrs(t)}><span class="pos">${i+1}</span><img src="${imageMap()[t]||''}" alt="Foto de ${t}"><b>${t}</b><small>Ver ficha</small></div>`).join('')}</article>`).join('');$('bracket').innerHTML=DATA.champions.knockout.map(r=>`<article class="round"><h3 class="group-title">${uiIcon('trophy')}<span>${r.round}</span></h3><div class="empty-match">Pendiente de clasificación</div><div class="empty-match">Pendiente de clasificación</div></article>`).join('')}
function renderNews(){$('newsGrid').innerHTML=DATA.news.map(n=>`<article class="news-card icon-card"><div class="card-label-row"><span>${n.date}</span><span class="record-icon news">${uiIcon('news')}</span></div><h3>${n.title}</h3><p>${n.text}</p></article>`).join('')}

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

async function init(){DATA=await(await fetch(`data.json?v=${APP_VERSION}`,{cache:'no-store'})).json();renderCurrent();renderMatchdayCenter();renderHomeLive();renderGeneral();renderPoints();renderPalmares();renderSeasons();renderSeasonChampions();renderPlayers();renderRecords();renderChampions();renderNews();syncLiveCurrentStats();window.setInterval(()=>{if(document.visibilityState==='visible')syncLiveCurrentStats()},60000);window.addEventListener('online',()=>syncLiveCurrentStats());document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')syncLiveCurrentStats()});document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
document.addEventListener('click',e=>{
  const team=e.target.closest('[data-profile-player]');
  if(team){openPlayer(team.dataset.profilePlayer)}
});
document.addEventListener('keydown',e=>{
  const team=e.target.closest?.('[data-profile-player]');
  if(team&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openPlayer(team.dataset.profilePlayer)}
  if(e.key==='Escape'&&!$('playerModal').hidden)closePlayer();
  else if(e.key==='Escape'&&!$('installModal').hidden)closeInstallGuide();
});
document.querySelectorAll('.navtab').forEach(b=>b.onclick=()=>go(b.dataset.section));document.querySelectorAll('.subtab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.subtab,.history-panel').forEach(x=>x.classList.remove('active'));b.classList.add('active');$(`${b.dataset.hist}Table`).classList.add('active')});$('sortGeneral').onchange=e=>renderGeneral(e.target.value);$('playerSearch').oninput=e=>renderPlayers(e.target.value);$('closeModal').onclick=closePlayer;$('playerModal').onclick=e=>{if(e.target.id==='playerModal')closePlayer()};$('share').onclick=()=>navigator.share?navigator.share({title:'Cuban League',url:location.href}):navigator.clipboard.writeText(location.href);setupPWA();const launchSection=new URLSearchParams(location.search).get('section');if(['home','current','matchdays','seasons','players','history','records','champions','news'].includes(launchSection))requestAnimationFrame(()=>go(launchSection))}init();
