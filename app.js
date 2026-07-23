let DATA;const $=id=>document.getElementById(id);const imageMap=()=>Object.fromEntries(DATA.participants.map(p=>[p.name,p.shield]));const statMap=()=>Object.fromEntries(DATA.general.map(p=>[p.name,p]));
function teamCell(name){return `<div class="team team-profile-link" data-profile-player="${name.replace(/"/g,'&quot;')}"><img src="${imageMap()[name]||''}" alt=""><span class="name">${name}</span></div>`}
function go(id){document.querySelectorAll('.page,.navtab').forEach(x=>x.classList.remove('active'));$(id).classList.add('active');document.querySelector(`.navtab[data-section="${id}"]`)?.classList.add('active');scrollTo({top:document.querySelector('main').offsetTop-100,behavior:'smooth'})}
function renderCurrent(){const rows=[...DATA.participants].sort((a,b)=>b.points-a.points||a.id-b.id);$('updated').textContent=DATA.lastUpdated;$('currentRows').innerHTML=rows.map((p,i)=>`<div class="row"><span class="pos">${i+1}</span>${teamCell(p.name)}<span class="center">${p.played}</span><span class="num">${p.points}</span></div>`).join('')}
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
const rows=first.map(r=>`<div class="season-result-row ${r.position===1?'season-winner':''}"><span class="season-pos">${r.position===1?'🏆':r.position+'º'}</span>${teamCell(r.name)}<span class="season-points">${r.points.toLocaleString()} pts</span></div>`).join('');
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
return `<article class="champion-history-card">${img?`<img src="${img}" alt="">`:`<div class="champion-placeholder">🏆</div>`}<div><span>${c.season}</span><h3>${c.name}</h3><p>${c.points?c.points.toLocaleString()+' puntos':'El campeón de esta edición no aparece identificado en las capturas disponibles.'}</p></div></article>`
}).join('')
}
function renderPlayers(filter=''){const stats=statMap();$('playerGrid').innerHTML=DATA.participants.filter(p=>p.name.toLowerCase().includes(filter.toLowerCase())).map(p=>{const s=stats[p.name]||{};return `<article class="player-card" data-player="${p.name}"><img src="${p.shield}"><h3>${p.name}</h3><small>${s.label||'Participante'}</small><p>${s.points?.toLocaleString()||0} puntos · ${s.podiums||0} podios</p></article>`}).join('');document.querySelectorAll('.player-card').forEach(c=>c.onclick=()=>openPlayer(c.dataset.player))}
function getPlayerHistory(name){
  const archive=DATA.historicalTables?.seasonArchive||[];
  return archive.map(s=>{
    const row=(s.results||[]).find(r=>r.name===name);
    if(!row)return {season:s.season,division:null,position:null,points:null};
    return {season:s.season,division:row.division,position:row.position,points:row.points};
  }).filter(x=>x.season!=='2026/27');
}
function ordinal(n){return n?`${n}º`:'—'}
function profileMetrics(name){
  const h=getPlayerHistory(name);
  const first=h.filter(x=>x.division===1&&x.position!=null);
  const positions=first.map(x=>x.position);
  const points=first.map(x=>x.points).filter(x=>x!=null);
  const best=first.length?[...first].sort((a,b)=>a.position-b.position||b.points-a.points)[0]:null;
  const worst=first.length?[...first].sort((a,b)=>b.position-a.position||a.points-b.points)[0]:null;
  const avgPos=positions.length?positions.reduce((a,b)=>a+b,0)/positions.length:null;
  const bestPoints=points.length?Math.max(...points):null;
  return {history:h,first,best,worst,avgPos,bestPoints};
}
function buildEvolutionSVG(first){
  if(!first.length)return `<div class="profile-no-data">Sin temporadas en Primera División para graficar.</div>`;
  const W=720,H=250,padL=42,padR=18,padT=22,padB=46;
  const maxPos=Math.max(20,...first.map(x=>x.position));
  const x=(i)=>first.length===1?(W/2):padL+i*((W-padL-padR)/(first.length-1));
  const y=(p)=>padT+((p-1)/(maxPos-1))*(H-padT-padB);
  const pts=first.map((d,i)=>`${x(i)},${y(d.position)}`).join(' ');
  const grid=[1,5,10,15,20].filter(v=>v<=maxPos).map(v=>{
    const yy=y(v);return `<line x1="${padL}" y1="${yy}" x2="${W-padR}" y2="${yy}" class="evo-grid"/><text x="8" y="${yy+4}" class="evo-axis">${v}º</text>`
  }).join('');
  const labels=first.map((d,i)=>`<text x="${x(i)}" y="${H-18}" text-anchor="middle" class="evo-label">${d.season.slice(2)}</text>`).join('');
  const dots=first.map((d,i)=>`<circle cx="${x(i)}" cy="${y(d.position)}" r="6" class="evo-dot"/><text x="${x(i)}" y="${y(d.position)-11}" text-anchor="middle" class="evo-value">${d.position}º</text>`).join('');
  return `<div class="evolution-chart-scroll"><svg class="evolution-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución histórica de posiciones">${grid}<polyline points="${pts}" class="evo-line"/>${dots}${labels}</svg></div>`;
}
function openPlayer(name){
  const p=DATA.participants.find(x=>x.name===name);
  if(!p)return;
  const s=statMap()[name]||{};
  const m=profileMetrics(name);
  const progression=m.history.map(x=>x.division===1?ordinal(x.position):'2ª').join(' → ');
  const seasonRows=m.history.map(x=>{
    const isWinner=x.division===1&&x.position===1;
    return `<div class="profile-season-row ${isWinner?'profile-season-champion':''}">
      <span>${x.season}</span>
      <b>${x.division===1?(isWinner?'🏆 Campeón':ordinal(x.position)):'2ª División'}</b>
      <span>${x.points!=null?x.points.toLocaleString()+' pts':'—'}</span>
    </div>`
  }).join('');
  $('modalContent').innerHTML=`
    <section class="profile-hero">
      <img src="${p.shield}" class="profile-avatar" alt="">
      <div class="profile-identity">
        <span class="eyebrow">${s.label||'PARTICIPANTE'}</span>
        <h2>${name}</h2>
        <p>${s.description||'Historial de la Cuban League.'}</p>
      </div>
    </section>

    <section class="profile-major-stats">
      <article><b>${s.titles||0}</b><span>Títulos</span></article>
      <article><b>${s.seconds||0}</b><span>Subcampeonatos</span></article>
      <article><b>${s.podiums||0}</b><span>Podios</span></article>
      <article><b>${s.points?.toLocaleString()||0}</b><span>Puntos históricos</span></article>
    </section>

    <section class="profile-section">
      <div class="profile-section-head"><div><span class="eyebrow">TRAYECTORIA</span><h3>Evolución por temporada</h3></div></div>
      <div class="progression-strip">${progression||'Sin historial'}</div>
      ${buildEvolutionSVG(m.first)}
    </section>

    <section class="profile-detail-grid">
      <article><span>Mejor temporada</span><b>${m.best?`${m.best.season} · ${ordinal(m.best.position)}`:'—'}</b><small>${m.best?.points!=null?m.best.points.toLocaleString()+' pts':''}</small></article>
      <article><span>Peor temporada en 1ª</span><b>${m.worst?`${m.worst.season} · ${ordinal(m.worst.position)}`:'—'}</b><small>${m.worst?.points!=null?m.worst.points.toLocaleString()+' pts':''}</small></article>
      <article><span>Promedio de posición</span><b>${m.avgPos?m.avgPos.toFixed(1)+'º':'—'}</b><small>Solo temporadas en 1ª</small></article>
      <article><span>Mayor puntuación</span><b>${m.bestPoints!=null?m.bestPoints.toLocaleString():'—'}</b><small>Puntos en una temporada</small></article>
      <article><span>Temporadas en 1ª</span><b>${m.first.length}</b><small>De ${m.history.length} temporadas históricas</small></article>
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
    return `<div class="hist-legend-item"><span class="hist-color" style="background:${color}"></span><img src="${p?.shield||''}" alt=""><b>${name}</b></div>`;
  }).join('');

  host.innerHTML=`<div class="hist-legend">${legend}</div>
    <div class="hist-svg-scroll">
      <svg viewBox="0 0 ${W} ${H}" style="min-width:${W}px" class="historical-svg" role="img" aria-label="Comparación histórica de posiciones">
        ${grid}${series}${seasons}
      </svg>
    </div>`;
}
function renderRecords(){$('recordGrid').innerHTML=DATA.records.map(r=>`<article class="record"><span>${r.title}</span><h3>${r.value}</h3><p>${r.player}</p></article>`).join('');$('awardGrid').innerHTML=DATA.awards.map(a=>`<article class="record"><span>${a.title}</span><h3>${a.player}</h3><p>${a.text}</p></article>`).join('')}
function renderChampions(){$('groupGrid').innerHTML=DATA.champions.groups.map(g=>`<article class="group"><h3>${g.name}</h3>${g.teams.map((t,i)=>`<div class="group-team"><span class="pos">${i+1}</span><img src="${imageMap()[t]||''}"><b>${t}</b></div>`).join('')}</article>`).join('');$('bracket').innerHTML=DATA.champions.knockout.map(r=>`<article class="round"><h3>${r.round}</h3><div class="empty-match">Pendiente de clasificación</div><div class="empty-match">Pendiente de clasificación</div></article>`).join('')}
function renderNews(){$('newsGrid').innerHTML=DATA.news.map(n=>`<article class="news-card"><span>${n.date}</span><h3>${n.title}</h3><p>${n.text}</p></article>`).join('')}
async function init(){DATA=await(await fetch('data.json?v=19-20260723',{cache:'no-store'})).json();renderCurrent();renderGeneral();renderPoints();renderPalmares();renderSeasons();renderSeasonChampions();renderPlayers();renderRecords();renderChampions();renderNews();document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
document.addEventListener('click',e=>{
  const team=e.target.closest('[data-profile-player]');
  if(team){openPlayer(team.dataset.profilePlayer)}
});document.querySelectorAll('.navtab').forEach(b=>b.onclick=()=>go(b.dataset.section));document.querySelectorAll('.subtab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.subtab,.history-panel').forEach(x=>x.classList.remove('active'));b.classList.add('active');$(`${b.dataset.hist}Table`).classList.add('active')});$('sortGeneral').onchange=e=>renderGeneral(e.target.value);$('playerSearch').oninput=e=>renderPlayers(e.target.value);$('closeModal').onclick=()=>$('playerModal').hidden=true;$('playerModal').onclick=e=>{if(e.target.id==='playerModal')$('playerModal').hidden=true};$('share').onclick=()=>navigator.share?navigator.share({title:'Cuban League',url:location.href}):navigator.clipboard.writeText(location.href)}init();