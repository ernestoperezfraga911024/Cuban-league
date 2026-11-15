/* One lazy, read-only capture powers Mercado and every Equipo actual panel. */
(()=>{
 'use strict';
 const core=window.CubanLeagueMarketCore,section=document.getElementById('market'),host=document.getElementById('marketBody');
 if(!core||!section||!host)return;
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>n===null?'—':new Intl.NumberFormat('es-ES',{maximumFractionDigits:0}).format(n)+' €';
 const date=s=>new Intl.DateTimeFormat('es-ES',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'}).format(new Date(s));
 const names={PT:'Porteros',DF:'Defensas',MC:'Centrocampistas',DL:'Delanteros'};
 const state={view:'players',search:'',owner:'all',position:'all',sort:'value',metric:'made',limit:40,eventLimit:20};
 let cached=null,cachedAt=0,pending=null,active=false,sequence=0;
 const teamRequests=new WeakMap();
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
 function photo(p){return p.photo?`<img src="${escape(p.photo)}" width="36" height="42" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:'<span class="market-avatar" aria-hidden="true">⚽</span>';}
 function stamp(p){return `<p class="market-updated">Captura del ${escape(date(p.capturedAt))} · hora de Miami</p>${Date.now()-Date.parse(p.capturedAt)>86400000?'<p class="market-notice">Esta captura tiene más de 24 horas. Los valores y propietarios pueden haber cambiado.</p>':''}`;}
 function rows(p,players,showOwner=true){
  const owners=new Map(p.managers.map(m=>[m.id,m.name]));
  return `<div class="market-table-wrap"><table class="market-table"><thead><tr><th scope="col">Futbolista</th><th scope="col">Valor</th><th scope="col">Cláusula</th></tr></thead><tbody>${players.map(x=>`<tr><th scope="row"><div class="market-player">${photo(x)}<div><strong>${escape(x.name)}</strong><span>${escape(x.position)} · ${escape(x.club)}</span>${showOwner?`<span class="market-owner${x.ownerId===null?' is-free':''}">${escape(owners.get(x.ownerId)||'Libre')}</span>`:''}</div></div></th><td>${escape(money(x.value))}</td><td>${escape(money(x.clause))}</td></tr>`).join('')}</tbody></table></div>`;
 }
 function playerResults(){
  const target=document.getElementById('marketResults');if(!target||!cached)return;
  const players=core.select(cached,state);
  target.innerHTML=`<p class="market-result-count" role="status">${players.length} futbolistas${state.owner==='all'?' · '+cached.players.filter(p=>p.ownerId===null).length+' libres':''}</p>${players.length?rows(cached,players.slice(0,state.limit)):'<p class="market-empty">No hay futbolistas con estos filtros.</p>'}${players.length>state.limit?`<button type="button" class="market-more" data-market-action="more">Ver más (${Math.min(state.limit,players.length)} de ${players.length})</button>`:''}`;
 }
 function playerView(p){
  return `<div class="market-filters"><label class="market-search">Buscar futbolista<input id="marketSearch" type="search" placeholder="Nombre, club o participante" value="${escape(state.search)}" autocomplete="off"></label><label>Propietario<select id="marketOwner"><option value="all">Todos los equipos</option><option value="free">Libres</option>${p.managers.slice().sort((a,b)=>a.name.localeCompare(b.name,'es')).map(m=>`<option value="${m.id}">${escape(m.name)}</option>`).join('')}</select></label><label>Ordenar por<select id="marketSort"><option value="value">Mayor valor</option><option value="clause">Mayor cláusula</option><option value="name">Nombre</option></select></label></div><div class="market-positions" role="group" aria-label="Filtrar por posición">${[['all','Todos'],...core.positions.map(pos=>[pos,pos])].map(([id,label])=>`<button type="button" data-market-position="${id}" aria-pressed="${state.position===id}">${label}</button>`).join('')}</div><div id="marketResults"></div>`;
 }
 function historyView(p){
  const metricLabels={made:'Dados',received:'Recibidos',spent:'Gastado',collected:'Cobrado'},owners=new Map(p.managers.map(m=>[m.id,m.name])),players=new Map(p.players.map(x=>[x.id,x]));
  const events=p.history.events.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')||a.reference.localeCompare(b.reference));
  return `<div class="market-notice"><strong>Historial recuperado · ${events.length} clausulazos${p.schemaVersion===2?' como mínimo':''}</strong><p>Cobertura parcial. Conservamos las fichas y el portal de Mister sin sumar sus coincidencias dos veces. Las operaciones sin fecha se muestran al final. Este ranking no representa necesariamente toda la temporada.</p><small>Revisado el ${escape(date(p.history.observedAt))}, hora de Miami. Solo se cuentan operaciones identificadas como «Cláusula».</small></div><div class="market-positions" role="group" aria-label="Ordenar ranking de clausulazos">${Object.entries(metricLabels).map(([key,label])=>`<button type="button" data-market-metric="${key}" aria-pressed="${state.metric===key}">${label}</button>`).join('')}</div><ol class="market-ranking">${core.rank(p,state.metric).map(m=>`<li><span class="market-rank">${m.rank}</span><div><strong>${escape(m.name)}</strong><small>${m.made} dados · ${m.received} recibidos</small><small>Gastado ${escape(money(m.spent))} · Cobrado ${escape(money(m.collected))}</small></div><b>${escape(state.metric==='made'||state.metric==='received'?m[state.metric]:money(m[state.metric]))}</b></li>`).join('')}</ol><h3 class="market-history-title">Operaciones recuperadas</h3><ul class="market-events">${events.slice(0,state.eventLimit).map(e=>`<li><div><strong>${escape(players.get(e.playerId).name)}</strong><span>${escape(owners.get(e.from))} → ${escape(owners.get(e.to))}</span>${e.date?`<time datetime="${e.date}">${e.date.split('-').reverse().join('/')}</time>`:'<span>Fecha no disponible</span>'}</div><b>${escape(money(e.amount))}</b></li>`).join('')}</ul>${events.length>state.eventLimit?`<button type="button" class="market-more" data-market-action="events">Ver más operaciones (${Math.min(state.eventLimit,events.length)} de ${events.length})</button>`:''}`;
 }
 function render(){
  if(!cached){host.innerHTML='<p class="market-empty">El mercado todavía no tiene una captura publicada.</p>';return;}
  section.querySelectorAll('[data-market-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.marketView===state.view)));
  host.innerHTML=stamp(cached)+(state.view==='players'?playerView(cached):historyView(cached));
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
  if(b.dataset.marketPosition){state.position=b.dataset.marketPosition;state.limit=40;section.querySelectorAll('[data-market-position]').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.marketPosition===state.position)));playerResults();return;}
  if(b.dataset.marketMetric){state.metric=b.dataset.marketMetric;render();section.querySelector(`[data-market-metric="${state.metric}"]`)?.focus();return;}
  if(b.dataset.marketAction==='more'){state.limit+=40;playerResults();section.querySelector('[data-market-action="more"]')?.focus();}
  if(b.dataset.marketAction==='events'){state.eventLimit+=20;render();section.querySelector('[data-market-action="events"]')?.focus();}
 });
 function observe(){const next=document.body.dataset.section==='market';if(next&&!active){active=true;load();}else if(!next&&active){active=false;sequence++;section.setAttribute('aria-busy','false');}}
 new MutationObserver(observe).observe(document.body,{attributes:true,attributeFilter:['data-section']});
 document.addEventListener('visibilitychange',()=>{if(active&&!document.hidden)load();});
 window.CubanLeagueMarket={showTeam};observe();
})();
