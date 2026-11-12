/* Authenticated season controls: one-click publication, explicit per-club results. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id),teams=window.CubanForecastRoundCore.config.teams;
 let client,authorized=false,initialized=false,generation=0,busy=false,pending=null,state=null;
 const date=value=>value?new Intl.DateTimeFormat('es',{dateStyle:'short',timeStyle:'short',timeZone:'America/New_York'}).format(new Date(value)):'—';
 function el(tag,text,cls){const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;}
 function message(text){$('forecastSeasonStatus').textContent=text;}
 function controls(){
  for(const b of $('forecastSeason').querySelectorAll('button'))if(!b.closest('#forecastHistoryAdmin'))b.disabled=!authorized||busy||!!pending||b.dataset.unavailable==='true';
  $('forecastSeasonRetry').hidden=!pending;$('forecastSeasonRetry').disabled=!authorized||busy;
  $('forecastSeasonPublish').disabled=!authorized||busy||!!pending||!state?.teams.some(t=>t.ready&&!t.paused);
  for(const mode of ['manual','automatic'])$(mode==='manual'?'forecastSeasonManual':'forecastSeasonAuto').setAttribute('aria-pressed',String(state?.mode===mode));
 }
 function reset(){window.CubanForecastHistoryAdmin?.reset();generation++;authorized=false;busy=false;pending=null;state=null;if(!$('forecastSeason'))return;$('forecastSeasonRows').replaceChildren();$('forecastSeasonPreview').replaceChildren();$('forecastSeasonSummary').textContent='';message('Abre el apartado para consultar el estado de los 20 equipos.');controls();}
 async function rpc(name,args={}){const r=await client.rpc(name,args);if(r.error)throw r.error;return r.data;}
 function error(e){
  if(e?.code==='42501'||[401,403].includes(e?.status)){reset();return 'Sesión vencida o acceso denegado. Inicia sesión de nuevo.';}
  if(e?.code==='40001')return 'El estado cambió. Actualiza antes de continuar.';
  if(['22023','23505','54000'].includes(e?.code))return String(e.message);
  return 'No se pudo confirmar el resultado. Usa Reintentar para consultar el mismo comando sin duplicarlo.';
 }
 async function read(g){
  const next=await rpc('get_forecast_season');
  if(g!==generation||!authorized)return;
  if(!next||!Number.isSafeInteger(next.version)||!['manual','automatic'].includes(next.mode)||!Array.isArray(next.teams)||next.teams.length!==20||new Set(next.teams.map(t=>t.team)).size!==20||next.teams.some(t=>!teams.some(x=>x.id===t.team)))throw Error('Estado incompleto');
  state=next;
  const r=next.last_run,results=r?.results||[],done=results.filter(x=>['published','ready','blocked'].includes(x.outcome));
  const counts=kind=>results.filter(x=>x.outcome===kind).length;
  $('forecastSeasonSummary').textContent=r?'Último turno: '+date(r.slot_at)+' Miami · '+done.length+'/'+r.expected.length+' equipos resueltos · '+counts('published')+' publicados · '+counts('ready')+' listos · '+counts('blocked')+' bloqueados'+(done.length<r.expected.length?' · '+(r.finished_at?'Incompleto':'En proceso o interrumpido'):''):'Todavía no hay una ejecución programada registrada. Inicio: 12/11/2026 a las 09:00 de Miami.';
  const labels={pending:'Pendiente',saved:'Entrega pendiente',published:'Publicado',ready:'Listo para publicar',blocked:'Bloqueado'};
  const rows=$('forecastSeasonRows');rows.replaceChildren();
  for(const t of [...next.teams].sort((a,b)=>teams.find(x=>x.id===a.team).name.localeCompare(teams.find(x=>x.id===b.team).name,'es'))){
   const club=teams.find(x=>x.id===t.team),row=el('div',null,'fs-team'),identity=el('div',null,'fs-identity'),img=el('img');img.src=club.crest;img.alt='';img.width=24;img.height=28;img.addEventListener('error',()=>img.remove(),{once:true});identity.append(img,el('b',club.name));
   const detail=el('div',null,'fs-team-detail');detail.append(el('span',t.paused?'Retirado · publicación automática pausada':t.outcome==='ready'&&!t.ready?'Lectura caducada':labels[t.outcome]||'Pendiente','fs-state'),el('small','Consulta: '+date(t.checked_at)+' · Publicado: '+date(t.published_at)+' · Miami'));
   if(t.reason)detail.append(el('small',t.reason,'fs-reason'));
   const actions=el('div',null,'fs-actions');
   if(t.preview){const preview=el('button','Ver once');preview.type='button';preview.addEventListener('click',async()=>{const gen=generation;try{const catalog=await window.CubanLeaguePlayerCatalog.load();if(gen!==generation||!authorized)return;window.CubanForecastPitch.render($('forecastSeasonPreview'),t.preview,catalog,{preview:true});$('forecastSeasonPreviewBox').open=true;}catch{if(gen===generation)message('No se pudo abrir la vista previa.');}});actions.append(preview);}
   const publish=el('button','Publicar');publish.type='button';publish.dataset.unavailable=String(!t.ready);publish.addEventListener('click',()=>command('publish',t.team));actions.append(publish);
   if(t.published_at){const withdraw=el('button','Retirar');withdraw.type='button';withdraw.addEventListener('click',()=>command('withdraw',t.team));actions.append(withdraw);}
   row.append(identity,detail,actions);rows.append(row);
  }
  controls();
 }
 async function reload(){if(!authorized||busy||pending)return;busy=true;controls();const g=generation;try{await read(g);if(g===generation)message('Estado consultado. Las fechas corresponden a lecturas reales; este botón no relee las fuentes.');}catch(e){if(g===generation)message(error(e));}finally{if(g===generation){busy=false;controls();}}}
 async function send(request){
  if(!authorized||busy)return;busy=true;pending=request;controls();const g=generation;
  try{
   const result=await rpc('command_forecast_season',request);if(g!==generation||!authorized)return;
   if(!result||!['mode_changed','processed','withdrawn'].includes(result.outcome))throw Error('Resultado incompleto');
   pending=null;state=null;
   const text=result.outcome==='mode_changed'?(result.mode==='automatic'?'Automático activado para los 20 equipos.':'Manual activado: las próximas lecturas esperan Publicar.'):result.outcome==='withdrawn'?'Publicación retirada. Ese equipo queda pausado hasta que publiques otra lectura.':(result.teams||[]).filter(t=>t.outcome==='published').length+' publicados · '+(result.teams||[]).filter(t=>t.outcome==='unchanged').length+' sin cambios · '+(result.teams||[]).filter(t=>t.outcome==='blocked').length+' bloqueados.';
   try{await read(g);if(g===generation)message(text);}catch(e){if(g===generation)message(text+' No se pudo refrescar el estado; no repitas la publicación.');}
  }catch(e){if(g===generation){if(['40001','22023','23505','54000'].includes(e?.code)){pending=null;if(e.code==='40001')state=null;}message(error(e));}}
  finally{if(g===generation){busy=false;controls();}}
 }
 function command(action,team=null){if(!authorized||busy||pending||!state)return;send({p_action:action,p_expected_version:state.version,p_request_id:crypto.randomUUID(),p_team:team});}
 function init(options){client=options.client;window.CubanForecastHistoryAdmin?.init(options);if(initialized||!$('forecastSeason'))return;initialized=true;$('forecastTool').addEventListener('toggle',()=>{if(authorized&&$('forecastTool').open&&!state)reload();});$('forecastSeasonReload').addEventListener('click',reload);$('forecastSeasonAuto').addEventListener('click',()=>command('automatic'));$('forecastSeasonManual').addEventListener('click',()=>command('manual'));$('forecastSeasonPublish').addEventListener('click',()=>command('publish'));$('forecastSeasonRetry').addEventListener('click',()=>{if(pending)send(pending);});controls();}
 window.CubanForecastSeason={init,reset,authorize(){authorized=true;window.CubanForecastHistoryAdmin?.authorize();controls();if($('forecastTool').open)reload();}};
})();
