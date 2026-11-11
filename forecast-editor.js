/* Admin commands only. A saved immutable revision is required before publication. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id),core=()=>window.CubanForecastPublishCore;
  let client,authorized=false,generation=0,operation=0,catalog=null,state=null,sourceKey=null,readyId=null,readyPublished=false,busy=false,pending=null,initialized=false;
  const fields=[];
  function el(tag,text){const n=document.createElement(tag);if(text!=null)n.textContent=text;return n;}
  function message(text){$('forecastEditorStatus').textContent=text;}
  function roster(){return new Map(catalog.players.filter(p=>p.clubId==='real-madrid').map(p=>[p.id,p]));}
  function controls(){
    for(const n of $('forecastEditor').querySelectorAll('button,input,select,textarea'))n.disabled=busy||!!pending;
    $('forecastCommandRetry').hidden=!pending;$('forecastCommandRetry').disabled=busy;
    $('forecastPublish').disabled=busy||!!pending||!readyId||!$('forecastPublishConfirm').checked;
    $('forecastRestore').disabled=busy||!!pending||!readyId||!readyPublished||!$('forecastPublishConfirm').checked;
    $('forecastWithdraw').disabled=busy||!!pending||!state?.current_revision;
    $('forecastSaveRevision').disabled=busy||!!pending||!sourceKey;
    for(const f of fields)f.alt.disabled=busy||!!pending||Number(f.prob.value)>=70;
  }
  function reset(){
    generation++;operation++;authorized=false;busy=false;pending=null;state=null;sourceKey=null;readyId=null;catalog=null;fields.length=0;
    if(!$('forecastEditor'))return;
    $('forecastEditor').hidden=true;$('forecastEditPlayers').replaceChildren();$('forecastSavedRevisions').replaceChildren();$('forecastPreview').replaceChildren();
    $('forecastPublicNote').value='';$('forecastPublishConfirm').checked=false;message('');controls();
  }
  async function rpc(name,args){const r=await client.rpc(name,args);if(r.error)throw r.error;return r.data;}
  function explain(error){
    if(error?.code==='42501'||[401,403].includes(error?.status)){reset();return 'Sesión vencida o acceso denegado. Inicia sesión de nuevo.';}
    if(['PGRST202','42883','42P01'].includes(error?.code))return 'La publicación aún no está habilitada en la base de datos. El visor privado sigue disponible.';
    if(error?.code==='40001')return 'Otra sesión ha cambiado el estado. Conservamos tus campos: recarga el historial y revisa antes de guardar de nuevo.';
    if(error?.code==='22023'||error?.code==='54000')return error.message;
    return 'No se pudo completar la operación. Comprueba la conexión y reintenta.';
  }
  function fillState(next){
    state=next;
    const select=$('forecastSavedRevisions'),chosen=select.value;select.replaceChildren(new Option('Seleccionar revisión guardada',''));
    for(const r of state.revisions)select.add(new Option('#'+r.id+' · '+window.CubanForecastPitch.date(r.created_at)+(r.id===state.current_revision?' · PUBLICADA':r.ever_published?' · Publicada anteriormente':' · Privada'),r.id));
    if([...select.options].some(x=>x.value===chosen))select.value=chosen;
    $('forecastPublicationState').textContent=state.current_revision?'Publicación vigente: revisión #'+state.current_revision+'.':'No hay una previsión pública.';
  }
  function invalidate(){readyId=null;readyPublished=false;$('forecastPublishConfirm').checked=false;$('forecastPreview').replaceChildren();message('Cambios sin guardar. Guarda una revisión para generar la vista previa.');controls();}
  function selectPlayer(value){
    const s=el('select');s.add(new Option('Seleccionar…',''));
    for(const p of roster().values())s.add(new Option(p.displayName,p.id));s.value=value||'';return s;
  }
  function form(players,note){
    fields.length=0;const fragment=document.createDocumentFragment();
    for(let slot=1;slot<=11;slot++){
      const p=players.find(x=>x.slot===slot)||{},box=el('fieldset');box.className='fp-edit-player';box.append(el('legend',slot+'. '+core().SLOTS[slot-1]));
      const grid=el('div');grid.className='fp-edit-grid';
      const id=selectPlayer(p.id),prob=el('input'),alt=selectPlayer(p.alternative_id),reason=el('textarea');
      prob.type='number';prob.min='0';prob.max='100';prob.step='1';prob.value=p.probability??'';reason.value=p.reason||'';reason.maxLength=800;
      for(const [label,input] of [['Jugador',id],['Porcentaje',prob],['Alternativa si <70',alt]]){const l=el('label',label);l.append(input);grid.append(l);}
      const why=el('label','Motivo público');why.append(reason);box.append(grid,why);fragment.append(box);fields.push({slot,id,prob,alt,reason});
    }
    $('forecastEditPlayers').replaceChildren(fragment);$('forecastPublicNote').value=note;controls();
  }
  async function refresh(){
    if(!authorized||busy||pending)return;const g=generation,op=++operation;busy=true;controls();
    try{const next=await rpc('get_forecast_publication',{p_revision_id:null});if(g!==generation||op!==operation||!authorized)return;fillState(next);message('Historial actualizado. Guardar no cambia la publicación vigente.');}
    catch(e){if(g===generation)message(explain(e));}
    finally{if(g===generation){busy=false;controls();}}
  }
  async function open(row=null){
    if(!authorized||busy||pending)return;
    if(sourceKey&&(!readyId)&&!$('forecastEditor').hidden&&!window.confirm('Abrir otra versión descartará los campos sin guardar. ¿Continuar?'))return;
    const g=generation,op=++operation;busy=true;$('forecastEditor').hidden=false;message('Cargando catálogo e historial…');controls();
    try{
      const [next,data]=await Promise.all([rpc('get_forecast_publication',{p_revision_id:null}),window.CubanLeaguePlayerCatalog.load()]);
      if(g!==generation||op!==operation||!authorized)return;catalog=data;fillState(next);
      sourceKey=null;readyId=null;readyPublished=false;fields.length=0;$('forecastEditPlayers').replaceChildren();$('forecastPreview').replaceChildren();$('forecastPublicNote').value='';$('forecastPublishConfirm').checked=false;
      if(row){
        const players=core().fromDraft(row.payload);core().candidates(players,new Set(roster().keys()));
        // Recheck the original assessment in the editor; SQL checks it again on save.
        for(const p of row.payload.proposal.players)if(window.CubanForecastCore.evaluate(p.assessment).probability!==p.probability)throw Error('Evaluación inconsistente.');
        sourceKey=row.run_key;form(players,row.payload.limitations.join(' ').slice(0,1200));
        message('Revisa cada jugador, bajas, porcentajes y la nota pública. Los cambios manuales quedarán identificados.');
      }else message('Elige una revisión guardada, o abre «Editar y preparar» en un borrador con método editorial v1.');
    }catch(e){if(g===generation)message(explain(e));}
    finally{if(g===generation){busy=false;controls();}}
  }
  async function loadRevision(){
    const id=Number($('forecastSavedRevisions').value);if(!id||!authorized||busy||pending)return;
    if(sourceKey&&!readyId&&!window.confirm('Se descartarán los campos sin guardar. ¿Abrir esta revisión?'))return;
    const g=generation,op=++operation;busy=true;controls();
    try{
      const next=await rpc('get_forecast_publication',{p_revision_id:id});if(g!==generation||op!==operation||!authorized)return;
      if(next.version!==state.version)throw {code:'40001'};
      const r=next.revision;if(!r)throw Error('Revisión inexistente');core().validate(r.payload);
      sourceKey=r.source_key;readyId=r.id;readyPublished=!!state.revisions.find(x=>x.id===r.id)?.ever_published;
      form(r.payload.players.map(p=>({...p,alternative_id:p.alternative?.id??null})),r.payload.note);
      $('forecastPublishConfirm').checked=false;window.CubanForecastPitch.render($('forecastPreview'),r.payload,catalog,{preview:true});message('Vista previa de la revisión #'+r.id+'. Publicar requiere tu confirmación.');
    }catch(e){if(g===generation)message(explain(e));}
    finally{if(g===generation){busy=false;controls();}}
  }
  async function send(request){
    const g=generation;busy=true;pending=request;controls();message('Procesando '+request.p_action+'…');
    try{
      const result=await rpc('command_forecast_publication',request);
      if(g!==generation||!authorized)return;
      pending=null;readyId=null;$('forecastPublishConfirm').checked=false;
      // Command already succeeded even if a following read fails. Never retry it as a new save.
      state={...state,version:result.version,current_revision:result.current_revision};
      message(result.action==='save'?'Revisión #'+result.revision_id+' guardada en privado. Cárgala para revisar y publicar.':result.action==='withdraw'?'Publicación retirada. El historial privado se conserva.':'Revisión #'+result.revision_id+' publicada.');
      try{const next=await rpc('get_forecast_publication',{p_revision_id:null});if(g!==generation||!authorized)return;fillState(next);$('forecastSavedRevisions').value=String(result.revision_id||'');}
      catch{message('La operación se completó. Recarga el historial para verificar su estado actual.');}
    }catch(e){
      if(g!==generation)return;
      // Unknown transport outcome: retain EXACT command UUID and parameters for safe retry.
      if(['22023','23505','40001','42501','54000','PGRST202','42883','42P01'].includes(e?.code)||/^22/.test(e?.code||''))pending=null;
      message(explain(e)+(pending?' Resultado sin confirmar: usa «Reintentar la misma operación».':''));
    }finally{if(g===generation){busy=false;controls();}}
  }
  function command(action){
    if(!authorized||busy||pending||!state)return;
    try{
      const request={p_action:action,p_expected_version:state.version,p_request_id:crypto.randomUUID(),p_source_key:null,p_players:null,p_note:null,p_revision_id:null};
      if(action==='save'){
        if(!sourceKey)throw Error('Abre un borrador primero.');
        request.p_source_key=sourceKey;request.p_note=$('forecastPublicNote').value.trim();
        if(request.p_note.length<10||request.p_note.length>1200)throw Error('Escribe una nota pública de 10 a 1200 caracteres.');
        request.p_players=fields.map(f=>({id:f.id.value,slot:f.slot,probability:f.prob.value===''?NaN:Number(f.prob.value),alternative_id:Number(f.prob.value)>=70?null:f.alt.value,reason:f.reason.value.trim()}));
        core().candidates(request.p_players,new Set(roster().keys()));
      }else if(action==='withdraw'){
        if(!state.current_revision||!window.confirm('¿Retirar la previsión de la página pública? El historial se conserva.'))return;
      }else{
        if(!readyId||!$('forecastPublishConfirm').checked||(action==='restore'&&!readyPublished))return;
        if(!window.confirm('¿'+(action==='restore'?'Restaurar':'Publicar')+' la revisión #'+readyId+' para todos los visitantes?'))return;
        request.p_revision_id=readyId;
      }
      send(request);
    }catch(e){message(e.message);}
  }
  function init(options){
    client=options.client;if(initialized||!$('forecastEditor'))return;initialized=true;
    $('forecastManage').addEventListener('click',()=>open());$('forecastHistoryReload').addEventListener('click',refresh);$('forecastLoadRevision').addEventListener('click',loadRevision);
    $('forecastEditPlayers').addEventListener('input',invalidate);$('forecastPublicNote').addEventListener('input',invalidate);
    $('forecastPublishConfirm').addEventListener('change',controls);
    $('forecastSavedRevisions').addEventListener('change',()=>{
      readyId=null;readyPublished=false;$('forecastPublishConfirm').checked=false;$('forecastPreview').replaceChildren();
      message('Pulsa «Abrir revisión» para ver y confirmar la versión seleccionada.');controls();
    });
    for(const [id,action] of [['forecastSaveRevision','save'],['forecastPublish','publish'],['forecastRestore','restore'],['forecastWithdraw','withdraw']])$(id).addEventListener('click',()=>command(action));
    $('forecastCommandRetry').addEventListener('click',()=>{if(pending&&!busy&&authorized)send(pending);});
  }
  window.CubanForecastEditor={init,open,reset,authorize(){authorized=true;}};
})();
