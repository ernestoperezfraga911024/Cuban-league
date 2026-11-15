/* One lazy, read-only capture powers Mercado and every Equipo actual panel. */
(()=>{
 'use strict';
 const core=window.CubanLeagueMarketCore,section=document.getElementById('market'),host=document.getElementById('marketBody');
 if(!core||!section||!host)return;
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const moneyFormat=new Intl.NumberFormat('es-ES',{maximumFractionDigits:0});
 const millionFormats={1:new Intl.NumberFormat('es-ES',{minimumFractionDigits:1,maximumFractionDigits:1}),2:new Intl.NumberFormat('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})};
 const money=n=>n===null?'—':moneyFormat.format(n)+' €';
 const date=s=>new Intl.DateTimeFormat('es-ES',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'}).format(new Date(s));
 const names={PT:'Porteros',DF:'Defensas',MC:'Centrocampistas',DL:'Delanteros'};
 const state={view:'players',historyView:'ranking',search:'',owner:'all',position:'all',sort:'value',metric:'made',limit:40,eventLimit:20,info:false};
 let cached=null,cachedAt=0,pending=null,active=false,sequence=0;
 const teamRequests=new WeakMap(),rivalCaptures=new WeakMap();
 async function read(force=false){
  if(pending)return pending;
  if(!force&&cached&&Date.now()-cachedAt<120000)return cached;
  pending=(async()=>{
   const c=window.CUBAN_LEAGUE_SUPABASE;if(!c?.url||!c.publishableKey)throw Error('unavailable');
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
   try{
    const url=new URL(c.url+'/rest/v1/mister_market_public');
    url.search=new URLSearchParams({league_id:'eq.649733',season:'eq.2026-27',select:'payload',limit:'1'});
    const response=await fetch(url,{headers:{apikey:c.publishableKey},cache:'no-store',signal:controller.signal});
    if(!response.ok)throw Error('unavailable');
    const rows=await response.json();if(!Array.isArray(rows)||rows.length>1)throw Error('invalid_response');
    cached=rows.length?core.validate(rows[0].payload):null;cachedAt=Date.now();return cached;
   }catch(error){cached=null;cachedAt=0;throw error;}
   finally{clearTimeout(timer);}
  })();
  try{return await pending;}finally{pending=null;}
 }
 const icon=name=>`<svg class="market-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${({search:'<circle cx="10.8" cy="10.8" r="7.3"/><path d="m16 16 5 5"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>'})[name]}</svg>`;
 function price(n,digits=2){
  if(n===null)return '<span class="market-price-empty">—</span>';
  const label=n>=1000000?millionFormats[digits].format(n/1000000)+' M €':money(n);
  return `<details class="market-price"><summary aria-label="${escape(money(n))}. Ver importe exacto" title="${escape(money(n))}">${escape(label)}</summary><span class="market-price-exact">${escape(money(n))}</span></details>`;
 }
 function participantPhoto(m){
  // Reuse the catalog already loaded by app.js, matched by stable participant ID.
  const participant=typeof DATA!=='undefined'?DATA?.participants?.find(p=>p.id===m.participantId):null;
  const shield=participant?.shield;
  if(typeof shield==='string'&&/^[\w/-]+\.(?:png|jpe?g|webp|svg)$/i.test(shield))return `<img class="market-participant-logo" src="${escape(shield)}" width="46" height="46" alt="" loading="lazy" decoding="async">`;
  return `<span class="market-participant-fallback" aria-hidden="true">${escape(m.name.slice(0,2).toUpperCase())}</span>`;
 }
 function photo(p){return p.photo?`<img src="${escape(p.photo)}" width="46" height="50" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:'<span class="market-avatar" aria-hidden="true">⚽</span>';}
 function stamp(p){return `<p class="market-updated">Captura del ${escape(date(p.capturedAt))} · hora de Miami</p>${Date.now()-Date.parse(p.capturedAt)>86400000?'<p class="market-notice">Esta captura tiene más de 24 horas. Los valores y propietarios pueden haber cambiado.</p>':''}`;}
 function rows(p,players,showOwner=true,compact=false){
  const owners=new Map(p.managers.map(m=>[m.id,m.name]));
  return `<div class="market-table-wrap"><table class="market-table"><thead><tr><th scope="col">Futbolista</th><th scope="col">Valor</th><th scope="col">Cláusula</th></tr></thead><tbody>${players.map(x=>`<tr><th scope="row"><div class="market-player">${photo(x)}<div><strong>${escape(x.name)}</strong><span>${escape(x.position)} · ${escape(x.club)}</span>${showOwner?`<span class="market-owner${x.ownerId===null?' is-free':''}">${escape(owners.get(x.ownerId)||'Libre')}</span>`:''}</div></div></th><td>${compact?price(x.value):escape(money(x.value))}</td><td>${compact?price(x.clause):escape(money(x.clause))}</td></tr>`).join('')}</tbody></table></div>`;
 }
 function playerResults(){
  const target=document.getElementById('marketResults');if(!target||!cached)return;
  const players=core.select(cached,state);
  target.innerHTML=`<p class="market-result-count" role="status">${players.length} ${players.length===1?'futbolista':'futbolistas'}</p>${players.length?rows(cached,players.slice(0,state.limit),true,true):'<p class="market-empty">No hay futbolistas con estos filtros.</p>'}${players.length>state.limit?`<button type="button" class="market-more" data-market-action="more">Ver más <span aria-hidden="true">›</span><small>${Math.min(state.limit,players.length)} de ${players.length}</small></button>`:''}`;
 }
 function playerView(p){
  return `<div class="market-filters"><label class="market-search"><span class="market-sr-only">Buscar por nombre, club o participante</span>${icon('search')}<input id="marketSearch" type="search" placeholder="Buscar futbolista" value="${escape(state.search)}" autocomplete="off"></label><label>Propietario<select id="marketOwner"><option value="all">Todos</option><option value="free">Libres</option>${p.managers.slice().sort((a,b)=>a.name.localeCompare(b.name,'es')).map(m=>`<option value="${m.id}">${escape(m.name)}</option>`).join('')}</select></label><label>Ordenar por<select id="marketSort"><option value="value">Mayor valor</option><option value="clause">Mayor cláusula</option><option value="name">Nombre</option></select></label></div><div class="market-positions" role="group" aria-label="Filtrar por posición">${[['all','Todos'],...core.positions.map(pos=>[pos,pos])].map(([id,label])=>`<button type="button" data-market-position="${id}" aria-pressed="${state.position===id}">${label}</button>`).join('')}</div><div id="marketResults"></div>`;
 }
 function rivalRows(p){
  if(!rivalCaptures.has(p))rivalCaptures.set(p,core.clauseRivals(p));
  return rivalCaptures.get(p);
 }
 function rivalDetails(p,target){
  if(!target.top.length)return '<p class="market-empty">Sin clausulazos recibidos en el historial registrado.</p>';
  const players=new Map(p.players.map(player=>[player.id,player]));
  return `<ul class="market-rivals">${target.top.map(rival=>`<li class="market-rival"><div class="market-rival-heading">${participantPhoto(rival)}<strong>${escape(rival.name)}</strong><span>${rival.count} ${rival.count===1?'clausulazo':'clausulazos'}</span></div><ul class="market-rival-players" aria-label="Futbolistas que ${escape(rival.name)} le fichó a ${escape(target.name)}">${rival.events.map(event=>`<li><div><strong>${escape(players.get(event.playerId).name)}</strong>${event.date?`<time datetime="${event.date}">${event.date.split('-').reverse().join('/')}</time>`:'<span>Fecha no disponible</span>'}</div><div class="market-rival-price">${price(event.amount)}</div></li>`).join('')}</ul></li>`).join('')}</ul>`;
 }
 function participantsHistory(p){
  return `<div class="market-rivals-intro"><h4>Quién te ha hecho más clausulazos</h4><p>Abre un participante para ver sus tres principales rivales y los futbolistas que le quitaron.</p></div><div class="market-targets">${rivalRows(p).map(target=>`<details class="market-target" data-market-target="${target.id}"><summary>${participantPhoto(target)}<span class="market-target-name"><strong>${escape(target.name)}</strong><span>${target.top.length?target.top.map(rival=>escape(rival.name)).join(' · '):'Sin clausulazos registrados'}</span></span><span class="market-target-total"><b>${target.received}</b><span>recibidos</span></span><span class="market-target-chevron" aria-hidden="true">›</span></summary><div class="market-target-body"></div></details>`).join('')}</div><p class="market-rivals-note">Según el historial registrado. En caso de empate se ordena por nombre y se muestran hasta tres rivales.</p>`;
 }
 function historyView(p){
  const metricLabels={made:'Dados',received:'Recibidos',spent:'Gastado',collected:'Cobrado'};
  const history=state.historyView==='events';
  const info=`<div id="marketHistoryInfo" class="market-notice"${state.info?'':' hidden'}><strong>Sobre estos datos</strong><p>Cobertura parcial: ${p.history.events.length} clausulazos registrados${p.schemaVersion===2?' como mínimo':''}. El historial puede no incluir toda la temporada. Solo se cuentan operaciones identificadas como «Cláusula», sin duplicar coincidencias entre fuentes.</p><small>Revisado el ${escape(date(p.history.observedAt))}, hora de Miami. Las operaciones sin fecha aparecen al final.</small></div>`;
  const toolbar=`<div class="market-history-toolbar"><h3>${history?'Historial':state.historyView==='participants'?'Por participante':'Ranking'}</h3><div><button type="button" class="market-info-button" data-market-action="info" aria-label="Información sobre el historial" aria-expanded="${state.info}" aria-controls="marketHistoryInfo">${icon('info')}</button><button type="button" class="market-history-toggle" data-market-history="${history?'ranking':'events'}" aria-label="${history?'Volver al ranking':'Ver historial de operaciones'}">${icon('clock')}${history?'Ranking':'Historial'}</button></div></div>${info}`;
  if(history){
   const owners=new Map(p.managers.map(m=>[m.id,m.name])),players=new Map(p.players.map(x=>[x.id,x]));
   const events=p.history.events.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')||a.reference.localeCompare(b.reference));
   return toolbar+`<p class="market-result-count">${events.length} operaciones registradas</p><ul class="market-events">${events.slice(0,state.eventLimit).map(e=>`<li><div class="market-event-player">${photo(players.get(e.playerId))}<div><strong>${escape(players.get(e.playerId).name)}</strong><span>${escape(owners.get(e.from))} → ${escape(owners.get(e.to))}</span>${e.date?`<time datetime="${e.date}">${e.date.split('-').reverse().join('/')}</time>`:'<span>Fecha no disponible</span>'}</div></div><div class="market-event-amount">${price(e.amount)}</div></li>`).join('')}</ul>${events.length>state.eventLimit?`<button type="button" class="market-more" data-market-action="events">Ver más operaciones <small>${Math.min(state.eventLimit,events.length)} de ${events.length}</small></button>`:''}${events.length?'':'<p class="market-empty">Todavía no hay clausulazos registrados.</p>'}`;
  }
  const tabs=`<div class="market-clause-tabs" role="group" aria-label="Análisis de clausulazos"><button type="button" data-market-history="ranking" aria-pressed="${state.historyView==='ranking'}">Ranking</button><button type="button" data-market-history="participants" aria-pressed="${state.historyView==='participants'}">Por participante</button></div>`;
  if(state.historyView==='participants')return toolbar+tabs+participantsHistory(p);
  return toolbar+tabs+`<div class="market-positions market-metrics" role="group" aria-label="Ordenar ranking de clausulazos">${Object.entries(metricLabels).map(([key,label])=>`<button type="button" data-market-metric="${key}" aria-pressed="${state.metric===key}">${label}</button>`).join('')}</div><ol class="market-ranking" aria-label="Ranking por ${metricLabels[state.metric].toLowerCase()}">${core.rank(p,state.metric).map(m=>`<li><span class="market-rank">${m.rank}</span>${participantPhoto(m)}<div class="market-ranking-main"><div class="market-ranking-name"><strong>${escape(m.name)}</strong><div class="market-ranking-value">${state.metric==='made'||state.metric==='received'?`<b>${m[state.metric]}</b>`:price(m[state.metric],1)}</div></div><small>${state.metric==='made'?m.received+' recibidos':state.metric==='received'?m.made+' dados':m.made+' dados · '+m.received+' recibidos'}</small><div class="market-ranking-money"><div><span>Pagado</span>${price(m.spent,1)}</div><div><span>Cobrado</span>${price(m.collected,1)}</div></div></div></li>`).join('')}</ol>`;
 }
 function render(){
  if(!cached){host.innerHTML='<p class="market-empty">El mercado todavía no tiene una captura publicada.</p>';return;}
  section.querySelectorAll('[data-market-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.marketView===state.view)));
  host.innerHTML=(state.view==='players'?playerView(cached):historyView(cached))+(state.view==='players'&&Date.now()-Date.parse(cached.capturedAt)>86400000?'<p class="market-stale">Datos de hace más de 24 horas. Los valores pueden haber cambiado.</p>':'');
  if(state.view==='players'){document.getElementById('marketOwner').value=state.owner;document.getElementById('marketSort').value=state.sort;playerResults();}
 }
 async function load(force=false){
  const current=++sequence;host.innerHTML='<p class="market-empty" role="status">Consultando el mercado…</p>';section.setAttribute('aria-busy','true');
  try{await read(force);if(current===sequence&&active)render();}
  catch{if(current===sequence&&active)host.innerHTML='<p class="market-empty" role="alert">No se pudo cargar el mercado. Pulsa Actualizar para reintentar.</p>';}
  finally{if(current===sequence)section.setAttribute('aria-busy','false');}
 }
 async function showTeam(target,participantId,force=false){
  if(!target)return;
  const token={};teamRequests.set(target,token);target.innerHTML='<p class="market-empty" role="status">Consultando equipo actual…</p>';target.setAttribute('aria-busy','true');
  try{
   const p=await read(force);if(teamRequests.get(target)!==token||!target.isConnected)return;
   const manager=p?.managers.find(m=>m.participantId===Number(participantId));
   if(!manager){target.innerHTML='<p class="market-empty">Todavía no hay una plantilla actual publicada para este participante.</p>';return;}
   const players=p.players.filter(x=>x.ownerId===manager.id),value=players.reduce((total,x)=>total+x.value,0);
   target.innerHTML=`<div class="market-team-summary"><div><strong>${players.length}</strong><span>Futbolistas</span></div><div><strong>${escape(money(value))}</strong><span>Valor de plantilla</span></div></div>${stamp(p)}<p class="market-team-note">Plantilla completa en el momento de la captura. No es la alineación de una jornada.</p>${core.positions.map(pos=>{const group=players.filter(x=>x.position===pos).sort((a,b)=>b.value-a.value||a.name.localeCompare(b.name,'es'));return group.length?`<h3 class="market-group-title">${names[pos]} <span>${group.length}</span></h3>${rows(p,group,false)}`:'';}).join('')}${players.length?'':'<p class="market-empty">Este participante no tenía futbolistas en esta captura.</p>'}`;
  }catch{if(teamRequests.get(target)===token&&target.isConnected){target.innerHTML='<p class="market-empty" role="alert">No se pudo cargar la plantilla.</p>';const b=document.createElement('button');b.type='button';b.className='market-more';b.textContent='Reintentar';b.onclick=()=>showTeam(target,participantId,true);target.append(b);}}
  finally{if(teamRequests.get(target)===token)target.setAttribute('aria-busy','false');}
 }
 section.addEventListener('input',e=>{if(e.target.id==='marketSearch'){state.search=e.target.value;state.limit=40;playerResults();}});
 section.addEventListener('change',e=>{if(e.target.id==='marketOwner')state.owner=e.target.value;else if(e.target.id==='marketSort')state.sort=e.target.value;else return;state.limit=40;playerResults();});
 section.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.marketAction==='reload'){load(true);return;}
  if(b.dataset.marketView){state.view=b.dataset.marketView;render();return;}
  if(b.dataset.marketHistory){state.historyView=b.dataset.marketHistory;state.info=false;render();(section.querySelector(`[data-market-history="${state.historyView}"]`)||section.querySelector('[data-market-history]'))?.focus();return;}
  if(b.dataset.marketAction==='info'){state.info=!state.info;document.getElementById('marketHistoryInfo').hidden=!state.info;b.setAttribute('aria-expanded',String(state.info));return;}
  if(b.dataset.marketPosition){state.position=b.dataset.marketPosition;state.limit=40;section.querySelectorAll('[data-market-position]').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.marketPosition===state.position)));playerResults();return;}
  if(b.dataset.marketMetric){state.metric=b.dataset.marketMetric;render();section.querySelector(`[data-market-metric="${state.metric}"]`)?.focus();return;}
  if(b.dataset.marketAction==='more'){state.limit+=40;playerResults();section.querySelector('[data-market-action="more"]')?.focus();}
  if(b.dataset.marketAction==='events'){state.eventLimit+=20;render();section.querySelector('[data-market-action="events"]')?.focus();}
 });
 function observe(){const next=document.body.dataset.section==='market';if(next&&!active){active=true;load();}else if(!next&&active){active=false;sequence++;section.setAttribute('aria-busy','false');}}
 new MutationObserver(observe).observe(document.body,{attributes:true,attributeFilter:['data-section']});
 document.addEventListener('visibilitychange',()=>{if(active&&!document.hidden)load();});
 section.addEventListener('toggle',e=>{
  const detail=e.target;if(!cached||!detail.matches('details[data-market-target]')||!detail.open)return;
  const body=detail.querySelector('.market-target-body');if(body.childElementCount)return;
  const target=rivalRows(cached).find(row=>row.id===detail.dataset.marketTarget);if(target)body.innerHTML=rivalDetails(cached,target);
 },true);
 section.addEventListener('toggle',e=>{if(e.target.matches('details.market-price')&&e.target.open)section.querySelectorAll('details.market-price[open]').forEach(other=>{if(other!==e.target)other.open=false;});},true);
 section.addEventListener('keydown',e=>{if(e.key==='Escape')section.querySelectorAll('details.market-price[open]').forEach(detail=>{detail.open=false;detail.querySelector('summary').focus();});});
 window.CubanLeagueMarket={showTeam};observe();
})();
