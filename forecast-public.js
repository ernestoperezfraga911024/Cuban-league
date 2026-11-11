/* Read only the published snapshot on section entry; never persist API responses. */
(() => {
  'use strict';
  const section=document.getElementById('forecasts');if(!section)return;
  const host=document.getElementById('forecastPublicBody'),status=document.getElementById('forecastPublicStatus'),retry=document.getElementById('forecastPublicReload');
  let sequence=0,active=false,controller;
  async function load(){
    controller?.abort();controller=new AbortController();const current=++sequence,currentController=controller,signal=controller.signal;
    host.replaceChildren();status.textContent='Consultando la publicación vigente…';retry.disabled=true;section.setAttribute('aria-busy','true');
    const timeout=setTimeout(()=>currentController.abort(),15000);
    try{
      const config=window.CUBAN_LEAGUE_SUPABASE;
      if(!config?.url||!config.publishableKey)throw Error();
      const url=new URL(config.url+'/rest/v1/forecast_public');
      url.search=new URLSearchParams({fixture_key:'eq.'+window.CubanForecastPublishCore.FIXTURE,select:'revision_id,published_at,payload',limit:'1'});
      const response=await fetch(url,{headers:{apikey:config.publishableKey},cache:'no-store',signal});
      if(!response.ok)throw Error();const rows=await response.json();
      if(current!==sequence||!active)return;
      if(!Array.isArray(rows)||rows.length>1)throw Error();
      if(!rows.length){status.textContent='Todavía no hay una previsión publicada para este partido.';return;}
      window.CubanForecastPublishCore.validate(rows[0].payload);
      let catalog=null;try{catalog=await window.CubanLeaguePlayerCatalog.load();}catch{/* Initials keep the XI usable. */}
      if(current!==sequence||!active)return;
      window.CubanForecastPitch.render(host,rows[0].payload,catalog,{publishedAt:rows[0].published_at});
      status.textContent=catalog?'Toca un jugador para conocer la decisión.':'No se pudieron cargar las fotos. El once conserva los nombres y las explicaciones.';
    }catch{if(current===sequence&&active)status.textContent='No se pudo verificar la publicación actual. Reintenta para consultar el once vigente.';}
    finally{clearTimeout(timeout);if(current===sequence){retry.disabled=false;section.setAttribute('aria-busy','false');}}
  }
  function observe(){
    const next=document.body.dataset.section==='forecasts';
    if(next&&!active){active=true;load();}
    else if(!next&&active){active=false;sequence++;controller?.abort();host.replaceChildren();retry.disabled=false;section.setAttribute('aria-busy','false');}
  }
  document.getElementById('forecastTeamMadrid')?.addEventListener('click',()=>{if(!host.firstChild)load();else{try{host.scrollIntoView?.({block:'nearest',behavior:'auto'});}catch{/* Cosmetic only. */}}});
  retry.addEventListener('click',load);
  document.addEventListener('visibilitychange',()=>{if(active&&!document.hidden)load();});
  new MutationObserver(observe).observe(document.body,{attributes:true,attributeFilter:['data-section']});observe();
})();
