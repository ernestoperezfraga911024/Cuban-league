/* One-click publication. All writes are guarded and validated again by Postgres. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  let client,authorized=false,generation=0,busy=false,pending=null,state=null,initialized=false,loaded=false;
  function message(text){$('forecastDeliveryStatus').textContent=text;}
  function controls(){
    for(const node of $('forecastDelivery').querySelectorAll('button'))node.disabled=!authorized||busy||!!pending;
    $('forecastQuickPublish').disabled=!authorized||busy||!!pending||state?.readiness!=='ready';
    $('forecastDeliveryRetry').hidden=!pending;$('forecastDeliveryRetry').disabled=!authorized||busy;
    for(const mode of ['manual','automatic']){
      const b=$(mode==='manual'?'forecastModeManual':'forecastModeAuto');
      b.setAttribute('aria-pressed',String(state?.mode===mode));
      b.disabled=b.disabled||state?.mode===mode||!state;
    }
  }
  function reset(){
    generation++;authorized=false;busy=false;pending=null;state=null;loaded=false;
    if(!$('forecastDelivery'))return;
    $('forecastDeliveryPreview').replaceChildren();$('forecastDeliverySummary').textContent='';message('Abre el apartado para consultar la última lectura.');controls();
  }
  async function rpc(name,args={}){const r=await client.rpc(name,args);if(r.error)throw r.error;return r.data;}
  function explain(e){
    if(e?.code==='42501'||[401,403].includes(e?.status)){reset();return 'Sesión vencida o acceso denegado. Inicia sesión de nuevo.';}
    if(e?.code==='40001')return 'El estado cambió en otra sesión. Pulsa Actualizar estado antes de continuar.';
    if(['22023','54000','23505'].includes(e?.code))return e.message;
    if(['PGRST202','42883','42P01'].includes(e?.code))return 'Este flujo todavía no está disponible. El editor avanzado sigue accesible.';
    return 'No se pudo confirmar el resultado. Comprueba la conexión.';
  }
  async function read(g){
    const next=await rpc('get_forecast_delivery');
    if(g!==generation||!authorized)return;
    if(!next||!Number.isSafeInteger(next.version)||!['manual','automatic'].includes(next.mode)||!['ready','published','blocked'].includes(next.readiness))throw Error('Respuesta incompleta');
    let catalog;
    if(next.preview){window.CubanForecastPublishCore.validate(next.preview);catalog=await window.CubanLeaguePlayerCatalog.load();}
    if(g!==generation||!authorized)return;
    state=next;loaded=true;
    const label=next.readiness==='ready'?'Once listo para publicar':next.readiness==='published'?'Esta lectura ya está publicada':'Última lectura bloqueada';
    $('forecastDeliverySummary').textContent=label+(next.created_at?' · '+window.CubanForecastPitch.date(next.created_at):'')+'. '+
      (next.mode==='automatic'?'Las próximas lecturas válidas se publican automáticamente.':'Las próximas lecturas quedan listas para pulsar Publicar.');
    $('forecastDeliveryPreview').replaceChildren();
    if(next.preview)window.CubanForecastPitch.render($('forecastDeliveryPreview'),next.preview,catalog,{preview:true});
    message(next.readiness==='blocked'?[next.reason,...(next.limitations||[])].filter(Boolean).join(' '):next.readiness==='published'?'La publicación conserva su fecha real.':'No necesitas editar ni guardar. Publicar hará ambas operaciones de forma segura.');
    controls();
  }
  async function refresh(){
    if(!authorized||busy||pending)return;
    const g=generation;busy=true;state=null;controls();message('Consultando estado…');
    try{await read(g);}catch(e){if(g===generation){$('forecastDeliveryPreview').replaceChildren();$('forecastDeliverySummary').textContent='';message(explain(e));}}
    finally{if(g===generation){busy=false;controls();}}
  }
  async function send(request){
    const g=generation;busy=true;pending=request;controls();message('Aplicando cambio…');
    try{
      const result=await rpc('command_forecast_delivery',request);
      if(g!==generation||!authorized)return;
      if(!result||!['mode_changed','published','unchanged'].includes(result.outcome))throw Error('Respuesta incompleta');
      pending=null;state=null;
      const success=result.outcome==='mode_changed'?(result.mode==='automatic'?'Modo automático activado.':'Modo manual activado: solo Publicar.'):
        result.outcome==='unchanged'?'Esta lectura ya estaba publicada.':'Once publicado correctamente.';
      window.dispatchEvent(new Event('forecast-delivery-changed'));
      try{await read(g);if(g===generation&&authorized)message(success);}
      catch(e){if(g===generation)message(success+' '+explain(e)+' Actualiza el estado; no repitas la publicación.');}
    }catch(e){
      if(g!==generation)return;
      if(['23505','40001','42501','54000','PGRST202','42883','42P01'].includes(e?.code)||/^22/.test(e?.code||'')){pending=null;state=null;}
      message(explain(e)+(pending?' Usa Reintentar para repetir exactamente la misma operación.':''));
    }finally{if(g===generation){busy=false;controls();}}
  }
  function command(action){
    if(!authorized||busy||pending||!state||(action==='publish'&&state.readiness!=='ready'))return;
    send({p_action:action,p_expected_version:state.version,p_request_id:crypto.randomUUID(),p_source_key:action==='publish'?state.source_key:null});
  }
  function init(options){
    client=options.client;if(initialized||!$('forecastDelivery'))return;initialized=true;
    $('forecastDeliveryReload').addEventListener('click',refresh);
    $('forecastQuickPublish').addEventListener('click',()=>command('publish'));
    $('forecastModeManual').addEventListener('click',()=>command('manual'));
    $('forecastModeAuto').addEventListener('click',()=>command('automatic'));
    $('forecastDeliveryRetry').addEventListener('click',()=>{if(authorized&&!busy&&pending)send(pending);});
    $('forecastTool').addEventListener('toggle',()=>{if(authorized&&$('forecastTool').open&&!loaded)refresh();});
    window.addEventListener('forecast-publication-changed',()=>{loaded=false;if($('forecastTool').open)refresh();});
    controls();
  }
  window.CubanForecastDelivery={init,reset,refresh,authorize(){authorized=true;if($('forecastTool')?.open&&!loaded)refresh();else controls();}};
})();
