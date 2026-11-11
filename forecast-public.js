/* Read-only public snapshots. Lazy section entry, no persisted responses or browser writes. */
(() => {
 'use strict';
 const section=document.getElementById('forecasts');if(!section)return;
 const host=document.getElementById('forecastPublicBody'),status=document.getElementById('forecastPublicStatus'),retry=document.getElementById('forecastPublicReload');
 const round=window.CubanForecastRoundCore,legacy=window.CubanForecastPublishCore,teams=round?.config.teams;
 let selected='real-madrid',sequence=0,active=false,controller,roundRows=[],pilotRows=[],catalog=null,roundFailed=false,pilotFailed=false;
 const requested=new URL(location.href).searchParams.get('forecast_team');if(teams?.some(t=>t.id===requested))selected=requested;
 function buttonState(){for(const b of section.querySelectorAll('[data-forecast-team]'))b.setAttribute('aria-pressed',String(b.dataset.forecastTeam===selected));}
 function show(){
  host.replaceChildren();buttonState();
  try{
   const row=round?round.choose(selected,roundRows,pilotRows):pilotRows[0];
   if(!row){status.textContent=(selected==='real-madrid'?pilotFailed:roundFailed)?'No se pudo verificar la publicación actual. Reintenta.':'Todavía no hay una previsión publicada para este equipo.';return;}
   if(!round)legacy.validate(row.payload);
   window.CubanForecastPitch.render(host,row.payload,catalog,{publishedAt:row.published_at});
   status.textContent=catalog?'Toca un jugador para conocer la decisión.':'No se pudieron cargar las fotos. El once conserva los nombres y las explicaciones.';
  }catch{host.replaceChildren();status.textContent='No se pudo verificar la publicación actual. Reintenta para consultar el once vigente.';}
 }
 if(teams){
  const nav=section.querySelector('.forecast-clubs'),list=document.createElement('div');list.className='forecast-club-list';
  for(const team of [...teams].sort((a,b)=>a.name.localeCompare(b.name,'es'))){
   const b=document.createElement('button'),img=document.createElement('img'),name=document.createElement('span');b.type='button';b.dataset.forecastTeam=team.id;b.setAttribute('aria-controls','forecastPublicBody');b.title=team.name;b.setAttribute('aria-label',team.name);
   if(team.id==='real-madrid')b.id='forecastTeamMadrid';img.src=team.crest;img.alt='';img.width=28;img.height=32;img.decoding='async';img.addEventListener('error',()=>img.remove(),{once:true});name.textContent=team.name;
   b.append(img,name);b.addEventListener('click',()=>{selected=team.id;show();});list.append(b);
  }
  const caption=document.createElement('span');caption.className='forecast-clubs-caption';caption.textContent='LaLiga · Jornada 13 · 20 equipos';nav.replaceChildren(list,caption);buttonState();
 }else document.getElementById('forecastTeamMadrid')?.addEventListener('click',()=>{if(!host.firstChild)load();});
 async function read(table,query,signal){
  const config=window.CUBAN_LEAGUE_SUPABASE;if(!config?.url||!config.publishableKey)throw Error();
  const url=new URL(config.url+'/rest/v1/'+table);url.search=new URLSearchParams(query);
  const response=await fetch(url,{headers:{apikey:config.publishableKey},cache:'no-store',signal});if(!response.ok)throw Error();
  const rows=await response.json();if(!Array.isArray(rows)||rows.length>Number(query.limit))throw Error();return rows;
 }
 async function load(){
  controller?.abort();controller=new AbortController();const current=++sequence,currentController=controller,signal=controller.signal;
  host.replaceChildren();roundRows=[];pilotRows=[];status.textContent='Consultando las publicaciones vigentes.';retry.disabled=true;section.setAttribute('aria-busy','true');
  const timeout=setTimeout(()=>currentController.abort(),15000);
  try{
   const results=await Promise.allSettled([read('forecast_public',{fixture_key:'eq.'+legacy.FIXTURE,select:'revision_id,published_at,payload',limit:'1'},signal),round?read('forecast_round_public',{select:'team,published_at,payload',limit:'20'},signal):Promise.resolve([])]);
   if(current!==sequence||!active)return;
   pilotFailed=results[0].status!=='fulfilled';roundFailed=results[1].status!=='fulfilled';
   pilotRows=pilotFailed?[]:results[0].value;roundRows=roundFailed?[]:results[1].value;
   if(roundRows.some(r=>!teams?.some(t=>t.id===r.team)||r.team==='real-madrid'||r.payload?.team!==r.team)||new Set(roundRows.map(r=>r.team)).size!==roundRows.length){roundRows=[];roundFailed=true;}
   if(!catalog)try{catalog=await window.CubanLeaguePlayerCatalog.load();}catch{/* Initials retain a usable XI. */}
   if(current!==sequence||!active)return;show();
  }catch{if(current===sequence&&active)status.textContent='No se pudo verificar la publicación actual. Reintenta.';}
  finally{clearTimeout(timeout);if(current===sequence){retry.disabled=false;section.setAttribute('aria-busy','false');}}
 }
 function observe(){const next=document.body.dataset.section==='forecasts';if(next&&!active){active=true;load();}else if(!next&&active){active=false;sequence++;controller?.abort();host.replaceChildren();roundRows=[];pilotRows=[];retry.disabled=false;section.setAttribute('aria-busy','false');}}
 retry.addEventListener('click',load);document.addEventListener('visibilitychange',()=>{if(active&&!document.hidden)load();});new MutationObserver(observe).observe(document.body,{attributes:true,attributeFilter:['data-section']});observe();
})();
