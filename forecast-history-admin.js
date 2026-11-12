/* Historical comparisons have their own one-click approval and retry identity. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id),teams=window.CubanForecastRoundCore.config.teams;
 let client,authorized=false,initialized=false,busy=false,state=null,pending=null,generation=0;
 function message(text){$('forecastHistoryAdminStatus').textContent=text;}
 function controls(){if(!$('forecastHistoryAdmin'))return;$('forecastHistoryPublish').disabled=!authorized||busy||!!pending||!state?.ready.length;$('forecastHistoryAdminReload').disabled=!authorized||busy||!!pending;$('forecastHistoryAdminRetry').hidden=!pending;$('forecastHistoryAdminRetry').disabled=!authorized||busy;}
 function reset(){generation++;authorized=false;busy=false;state=null;pending=null;if(!$('forecastHistoryAdmin'))return;$('forecastHistoryAdminRows').replaceChildren();$('forecastHistoryAdminSummary').textContent='Las comparaciones se consultan al abrir este apartado.';message('');controls();}
 async function rpc(name,args={}){const result=await client.rpc(name,args);if(result.error)throw result.error;return result.data;}
 function error(e){if(e?.code==='42501'||[401,403].includes(e?.status)){reset();return 'Sesión vencida o acceso denegado.';}if(e?.code==='40001')return 'El historial cambió. Actualiza antes de publicar.';if(['22023','23505','54000'].includes(e?.code))return String(e.message);return 'No se pudo confirmar el resultado. Reintentar conserva la misma publicación y evita duplicados.';}
 async function read(g){
  const next=await rpc('get_forecast_history_admin');if(g!==generation||!authorized)return;
  if(!next||!Array.isArray(next.ready)||next.ready.length>520||!Number.isInteger(next.pending_count)||next.pending_count<0||next.ready.some(r=>!teams.some(t=>t.id===r.team)||typeof r.fixture_key!=='string'||!Number.isInteger(r.matchday)||r.matchday<13||r.matchday>38||!Number.isSafeInteger(r.version)||r.version<1||(r.hits!==null&&(!Number.isInteger(r.hits)||r.hits<0||r.hits>11))||!['initial','final',null].includes(r.verification_stage))||new Set(next.ready.map(r=>r.fixture_key+'|'+r.team)).size!==next.ready.length)throw Error('Historial incompleto');
  state=next;$('forecastHistoryAdminSummary').textContent=next.ready.length+' resultados listos para publicar · '+next.pending_count+' comparaciones pendientes de completar.';$('forecastHistoryAdminRows').replaceChildren();
  for(const row of next.ready){const tag=document.createElement('span');tag.textContent=teams.find(t=>t.id===row.team).name+' · J'+row.matchday+' · '+(row.hits===null?'Sin pronóstico comparable':row.hits+'/11')+(row.verification_stage==='initial'?' · Inicial':'');$('forecastHistoryAdminRows').append(tag);}controls();
 }
 async function reload(){if(!authorized||busy||pending)return;busy=true;controls();const g=generation;try{await read(g);if(g===generation)message('Los resultados pendientes respetan el modo Manual y los equipos retirados.');}catch(e){if(g===generation){state=null;$('forecastHistoryAdminRows').replaceChildren();message(error(e));}}finally{if(g===generation){busy=false;controls();}}}
 async function send(request){
  if(!authorized||busy)return;busy=true;pending=request;controls();const g=generation;
  try{
   const result=await rpc('publish_forecast_history',request);if(g!==generation||!authorized)return;
   if(!result||result.outcome!=='processed'||!Array.isArray(result.results)||result.results.length!==request.p_expected.length||result.results.some(r=>!['published','unchanged'].includes(r.outcome)||!request.p_expected.some(x=>x.fixture_key===r.fixture_key&&x.team===r.team))||new Set(result.results.map(r=>r.fixture_key+'|'+r.team)).size!==result.results.length)throw Error('Resultado incompleto');
   pending=null;state=null;const text=result.results.filter(r=>r.outcome==='published').length+' resultados publicados · '+result.results.filter(r=>r.outcome==='unchanged').length+' sin cambios.';
   try{await read(g);if(g===generation)message(text);}catch{if(g===generation)message(text+' No se pudo refrescar el estado; no repitas la publicación.');}
  }catch(e){if(g===generation){if(['40001','22023','23505','54000'].includes(e?.code)){pending=null;state=null;}message(error(e));}}
  finally{if(g===generation){busy=false;controls();}}
 }
 function publish(){if(!authorized||busy||pending||!state?.ready.length)return;send({p_expected:state.ready.map(r=>({fixture_key:r.fixture_key,team:r.team,version:r.version})),p_request_id:crypto.randomUUID()});}
 function init(options){client=options.client;if(initialized||!$('forecastHistoryAdmin'))return;initialized=true;$('forecastTool').addEventListener('toggle',()=>{if(authorized&&$('forecastTool').open&&!state)reload();});$('forecastHistoryPublish').addEventListener('click',publish);$('forecastHistoryAdminReload').addEventListener('click',reload);$('forecastHistoryAdminRetry').addEventListener('click',()=>{if(pending)send(pending);});controls();}
 window.CubanForecastHistoryAdmin={init,reset,authorize(){authorized=true;controls();if($('forecastTool').open)reload();}};
})();
