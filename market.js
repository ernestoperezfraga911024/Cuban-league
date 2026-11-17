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
 const clauseDate=s=>`${Number(s.slice(8,10))} ${['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][Number(s.slice(5,7))-1]}`;
 const names={PT:'Porteros',DF:'Defensas',MC:'Centrocampistas',DL:'Delanteros'};
 const state={view:'players',historyView:'ranking',participant:null,search:'',owner:'all',position:'all',sort:'value',metric:'made',limit:40,eventLimit:20,info:false};
 let cached=null,cachedAt=0,pending=null,active=false,sequence=0;
 const teamRequests=new WeakMap(),rivalCaptures=new WeakMap();
 const pointStore=window.CubanLeaguePlayerPoints?.store;
 const pointFormat=new Intl.NumberFormat('es-ES',{maximumFractionDigits:0});
 function pointsContent(id){
  const snapshot=pointStore?.snapshot(),model=snapshot?.model;
  if(!model)return snapshot?.status==='error'?'Puntos no disponibles':'Consultando puntos…';
  const player=model.playersByMisterId.get(String(id));
  if(!player)return 'Sin puntos registrados';
  if(player.points===null)return 'Puntos pendientes de verificar';
  const n=player.matchdays.length,bonus=player.captainBonus;
  return `<b>${escape(pointFormat.format(player.points))} pts en liga</b><small>${n} ${n===1?'jornada':'jornadas'}${bonus===null?' · Bonus pendiente':bonus?` · ${bonus>0?'+':''}${escape(pointFormat.format(bonus))} bonus`:''}${player.provisional?' · Provisional':''}</small>`;
 }
 function playerPoints(id){return `<span class="market-player-points" data-player-points="${escape(id)}">${pointsContent(id)}</span>`;}
 function refreshPoints(){
  document.querySelectorAll('[data-player-points]').forEach(el=>{el.innerHTML=pointsContent(el.dataset.playerPoints);});
  document.querySelectorAll('[data-player-points-note]').forEach(el=>{
   const partial=pointStore?.snapshot().model?.partial;
   el.textContent='Puntos de los XI publicados en Cuban League. El bonus de capitán va separado.'+(partial?' Hay jornadas con datos incompletos.':'');
  });
 }
 function loadPoints(force=false){if(pointStore)void pointStore.readRows({force}).catch(()=>{});}
 const pointsNote=()=>'<p class="market-points-note" data-player-points-note>Puntos de los XI publicados en Cuban League. El bonus de capitán va separado.</p>';
 pointStore?.subscribe(refreshPoints);
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
 function price(n,digits=2,sign=''){
  if(n===null)return '<span class="market-price-empty">—</span>';
  const label=sign+(n>=1000000?millionFormats[digits].format(n/1000000)+' M €':money(n)),exact=sign+money(n);
  return `<details class="market-price"><summary aria-label="${escape(exact)}. Ver importe exacto" title="${escape(exact)}">${escape(label)}</summary><span class="market-price-exact">${escape(exact)}</span></details>`;
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
  return `<div class="market-table-wrap"><table class="market-table"><thead><tr><th scope="col">Futbolista</th><th scope="col">Valor</th><th scope="col">Cláusula</th></tr></thead><tbody>${players.map(x=>`<tr><th scope="row"><div class="market-player">${photo(x)}<div><strong>${escape(x.name)}</strong><span>${escape(x.position)} · ${escape(x.club)}</span>${showOwner?`<span class="market-owner${x.ownerId===null?' is-free':''}">${escape(owners.get(x.ownerId)||'Libre')}</span>`:''}${playerPoints(x.id)}</div></div></th><td>${compact?price(x.value):escape(money(x.value))}</td><td>${compact?price(x.clause):escape(money(x.clause))}</td></tr>`).join('')}</tbody></table></div>`;
 }
 function playerResults(){
  const target=document.getElementById('marketResults');if(!target||!cached)return;
  const players=core.select(cached,state);
  target.innerHTML=`<p class="market-result-count" role="status">${players.length} ${players.length===1?'futbolista':'futbolistas'}</p>${pointsNote()}${players.length?rows(cached,players.slice(0,state.limit),true,true):'<p class="market-empty">No hay futbolistas con estos filtros.</p>'}${players.length>state.limit?`<button type="button" class="market-more" data-market-action="more">Ver más <span aria-hidden="true">›</span><small>${Math.min(state.limit,players.length)} de ${players.length}</small></button>`:''}`;
  refreshPoints();
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
  return `<ul class="market-rivals">${target.top.map(rival=>`<li class="market-rival"><div class="market-rival-heading">${participantPhoto(rival)}<strong>${escape(rival.name)}</strong><span>${rival.count} ${rival.count===1?'clausulazo':'clausulazos'}</span></div><ul class="market-rival-players" aria-label="Futbolistas que ${escape(rival.name)} le fichó a ${escape(target.name)}">${rival.events.map(event=>`<li><div><strong>${escape(players.get(event.playerId).name)}</strong>${event.date?`<time datetime="${event.date}" title="${event.date.split('-').reverse().join('/')}" aria-label="${event.date.split('-').reverse().join('/')}">${clauseDate(event.date)}</time>`:'<span class="market-no-date">Fecha no disponible</span>'}</div><div class="market-rival-price">${price(event.amount)}</div></li>`).join('')}</ul></li>`).join('')}</ul>`;
 }
 function participantDetails(p,id){
  const target=rivalRows(p).find(row=>row.id===id);
  return target?rivalDetails(p,target):'';
 }
 function toggleParticipant(id){
  const next=state.participant===id?null:id;
  section.querySelectorAll('[data-market-row]').forEach(row=>{
   const open=row.dataset.marketRow===next,body=row.querySelector('.market-ranking-detail');
   row.classList.toggle('is-expanded',open);
   row.querySelector('[data-market-participant]').setAttribute('aria-expanded',String(open));
   body.hidden=!open;
   if(open&&!body.childElementCount)body.innerHTML=participantDetails(cached,next);
  });
  state.participant=next;
 }
 function expensiveHistory(p){
  const events=core.topClauses(p),players=new Map(p.players.map(player=>[player.id,player])),managers=new Map(p.managers.map(manager=>[manager.id,manager]));
  const party=(label,manager)=>`<div><span>${label}</span>${participantPhoto(manager)}<strong>${escape(manager.name)}</strong></div>`;
  return `<div class="market-rivals-intro"><h4>Top 10 operaciones más caras</h4><p>Los mayores importes pagados por cláusula en el historial registrado. Los empates comparten puesto.</p></div>${events.length?`<ol class="market-expensive" aria-label="Operaciones de mayor importe">${events.map(event=>`<li><span class="market-rank" aria-label="Puesto ${event.rank}">${event.rank}</span><div class="market-expensive-main"><div class="market-expensive-heading"><div class="market-event-player">${photo(players.get(event.playerId))}<div><strong>${escape(players.get(event.playerId).name)}</strong>${event.date?`<time datetime="${event.date}">${event.date.split('-').reverse().join('/')}</time>`:'<span>Fecha no disponible</span>'}</div></div><div class="market-expensive-amount">${price(event.amount)}</div></div><div class="market-expensive-parties">${party('Pagó',managers.get(event.to))}${party('Cobró',managers.get(event.from))}</div></div></li>`).join('')}</ol>`:'<p class="market-empty">Todavía no hay clausulazos registrados.</p>'}`;
 }
 function historyView(p){
  const metricLabels={made:'Dados',received:'Recibidos',spent:'Gastado',collected:'Cobrado'};
  const history=state.historyView==='events';
  const info=`<div id="marketHistoryInfo" class="market-notice"${state.info?'':' hidden'}><strong>Sobre estos datos</strong><p>Cobertura parcial: ${p.history.events.length} clausulazos registrados${p.schemaVersion===2?' como mínimo':''}. El historial puede no incluir toda la temporada. Solo se cuentan operaciones identificadas como «Cláusula», sin duplicar coincidencias entre fuentes.</p><small>Revisado el ${escape(date(p.history.observedAt))}, hora de Miami. En el historial cronológico, las operaciones sin fecha aparecen al final.</small></div>`;
  const tabs=`<div class="market-clause-tabs" role="group" aria-label="Análisis de clausulazos"><button type="button" data-market-history="ranking" aria-pressed="${state.historyView==='ranking'}">Ranking</button><button type="button" data-market-history="expensive" aria-pressed="${state.historyView==='expensive'}">Más caras</button></div>`;
  const toolbar=`<div class="market-history-toolbar">${history?'<h3>Historial</h3>':tabs}<div class="market-history-actions"><button type="button" class="market-info-button" data-market-action="info" aria-label="Información sobre el historial" aria-expanded="${state.info}" aria-controls="marketHistoryInfo">${icon('info')}</button><button type="button" class="market-history-toggle" data-market-history="${history?'ranking':'events'}" aria-label="${history?'Volver al ranking':'Ver historial de operaciones'}">${icon('clock')}${history?'Ranking':'Historial'}</button></div></div>${info}`;
  if(history){
   const owners=new Map(p.managers.map(m=>[m.id,m.name])),players=new Map(p.players.map(x=>[x.id,x]));
   const events=p.history.events.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')||a.reference.localeCompare(b.reference));
   return toolbar+`<p class="market-result-count">${events.length} operaciones registradas</p><ul class="market-events">${events.slice(0,state.eventLimit).map(e=>`<li><div class="market-event-player">${photo(players.get(e.playerId))}<div><strong>${escape(players.get(e.playerId).name)}</strong><span>${escape(owners.get(e.from))} → ${escape(owners.get(e.to))}</span>${e.date?`<time datetime="${e.date}">${e.date.split('-').reverse().join('/')}</time>`:'<span>Fecha no disponible</span>'}</div></div><div class="market-event-amount">${price(e.amount)}</div></li>`).join('')}</ul>${events.length>state.eventLimit?`<button type="button" class="market-more" data-market-action="events">Ver más operaciones <small>${Math.min(state.eventLimit,events.length)} de ${events.length}</small></button>`:''}${events.length?'':'<p class="market-empty">Todavía no hay clausulazos registrados.</p>'}`;
  }

  if(state.historyView==='expensive')return toolbar+expensiveHistory(p);
  return toolbar+`<div class="market-positions market-metrics" role="group" aria-label="Ordenar ranking de clausulazos">${Object.entries(metricLabels).map(([key,label])=>`<button type="button" data-market-metric="${key}" aria-pressed="${state.metric===key}">${label}</button>`).join('')}</div><ol class="market-ranking" aria-label="Ranking por ${metricLabels[state.metric].toLowerCase()}">${core.rank(p,state.metric).map(m=>`<li class="market-ranking-item${state.participant===m.id?' is-expanded':''}" data-market-row="${m.id}"><span class="market-rank">${m.rank}</span>${participantPhoto(m)}<div class="market-ranking-main"><div class="market-ranking-name"><button type="button" class="market-participant-toggle" data-market-participant="${m.id}" aria-expanded="${state.participant===m.id}" aria-controls="marketParticipant${m.id}"><strong>${escape(m.name)}</strong><span class="market-participant-chevron" aria-hidden="true">›</span></button><div class="market-ranking-value">${state.metric==='made'||state.metric==='received'?`<b>${m[state.metric]}</b>`:price(m[state.metric],1)}</div></div><small>${state.metric==='made'?m.received+' recibidos':state.metric==='received'?m.made+' dados':m.made+' dados · '+m.received+' recibidos'}</small><div class="market-ranking-money"><div><span>Gastado</span>${price(m.spent,1)}</div><div><span>Cobrado</span>${price(m.collected,1)}</div><div class="market-balance ${m.net>0?'is-positive':m.net<0?'is-negative':'is-zero'}"><span title="Cobrado menos gastado">Balance</span>${price(Math.abs(m.net),1,m.net>0?'+':m.net<0?'−':'')}</div></div></div><div id="marketParticipant${m.id}" class="market-ranking-detail" role="region" aria-label="Clausulazos recibidos por ${escape(m.name)}"${state.participant===m.id?'':' hidden'}>${state.participant===m.id?participantDetails(p,m.id):''}</div></li>`).join('')}</ol>`;
 }
 function render(){
  if(!cached){host.innerHTML='<p class="market-empty">El mercado todavía no tiene una captura publicada.</p>';return;}
  section.querySelectorAll('[data-market-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.marketView===state.view)));
  host.innerHTML=(state.view==='players'?playerView(cached):historyView(cached))+(state.view==='players'&&Date.now()-Date.parse(cached.capturedAt)>86400000?'<p class="market-stale">Datos de hace más de 24 horas. Los valores pueden haber cambiado.</p>':'');
  if(state.view==='players'){document.getElementById('marketOwner').value=state.owner;document.getElementById('marketSort').value=state.sort;playerResults();}
 }
 async function load(force=false){
  if(state.view==='players')loadPoints(force);
  const current=++sequence;host.innerHTML='<p class="market-empty" role="status">Consultando el mercado…</p>';section.setAttribute('aria-busy','true');
  try{await read(force);if(current===sequence&&active)render();}
  catch{if(current===sequence&&active)host.innerHTML='<p class="market-empty" role="alert">No se pudo cargar el mercado. Pulsa Actualizar para reintentar.</p>';}
  finally{if(current===sequence)section.setAttribute('aria-busy','false');}
 }
 async function showTeam(target,participantId,force=false){
  if(!target)return;
  loadPoints(force);
  const token={};teamRequests.set(target,token);target.innerHTML='<p class="market-empty" role="status">Consultando equipo actual…</p>';target.setAttribute('aria-busy','true');
  try{
   const p=await read(force);if(teamRequests.get(target)!==token||!target.isConnected)return;
   const manager=p?.managers.find(m=>m.participantId===Number(participantId));
   if(!manager){target.innerHTML='<p class="market-empty">Todavía no hay una plantilla actual publicada para este participante.</p>';return;}
   const players=p.players.filter(x=>x.ownerId===manager.id),value=players.reduce((total,x)=>total+x.value,0);
   target.innerHTML=`<div class="market-team-summary"><div><strong>${players.length}</strong><span>Futbolistas</span></div><div><strong>${escape(money(value))}</strong><span>Valor de plantilla</span></div></div>${stamp(p)}${pointsNote()}<p class="market-team-note">Plantilla completa en el momento de la captura. No es la alineación de una jornada.</p>${core.positions.map(pos=>{const group=players.filter(x=>x.position===pos).sort((a,b)=>b.value-a.value||a.name.localeCompare(b.name,'es'));return group.length?`<h3 class="market-group-title">${names[pos]} <span>${group.length}</span></h3>${rows(p,group,false)}`:'';}).join('')}${players.length?'':'<p class="market-empty">Este participante no tenía futbolistas en esta captura.</p>'}`;
   refreshPoints();
  }catch{if(teamRequests.get(target)===token&&target.isConnected){target.innerHTML='<p class="market-empty" role="alert">No se pudo cargar la plantilla.</p>';const b=document.createElement('button');b.type='button';b.className='market-more';b.textContent='Reintentar';b.onclick=()=>showTeam(target,participantId,true);target.append(b);}}
  finally{if(teamRequests.get(target)===token)target.setAttribute('aria-busy','false');}
 }
 document.addEventListener('click',e=>{if(e.target.closest('.hero-photo .actions [data-go="market"][data-market-view="history"]'))state.view='history';},true);
 section.addEventListener('input',e=>{if(e.target.id==='marketSearch'){state.search=e.target.value;state.limit=40;playerResults();}});
 section.addEventListener('change',e=>{if(e.target.id==='marketOwner')state.owner=e.target.value;else if(e.target.id==='marketSort')state.sort=e.target.value;else return;state.limit=40;playerResults();});
 section.addEventListener('click',e=>{
  const row=e.target.closest('[data-market-row]');
  if(row&&!e.target.closest('.market-ranking-detail,details.market-price')){toggleParticipant(row.dataset.marketRow);return;}
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.marketAction==='reload'){load(true);return;}
  if(b.dataset.marketView){state.view=b.dataset.marketView;if(state.view==='players')loadPoints();render();return;}
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
 section.addEventListener('toggle',e=>{if(e.target.matches('details.market-price')&&e.target.open)section.querySelectorAll('details.market-price[open]').forEach(other=>{if(other!==e.target)other.open=false;});},true);
 section.addEventListener('keydown',e=>{if(e.key==='Escape')section.querySelectorAll('details.market-price[open]').forEach(detail=>{detail.open=false;detail.querySelector('summary').focus();});});
 window.CubanLeagueMarket={showTeam};observe();
})();
