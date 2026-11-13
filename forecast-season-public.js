/* One read-only season feed; news and health load independently for the selected club. */
(() => {
 'use strict';
 const section=document.getElementById('forecasts');if(!section)return;
 const host=document.getElementById('forecastPublicBody'),status=document.getElementById('forecastPublicStatus'),retry=document.getElementById('forecastPublicReload');
 const round=window.CubanForecastRoundCore,legacy=window.CubanForecastPublishCore,teams=round.config.teams;
 let selected='real-madrid',sequence=0,active=false,controller,rows=[],catalog=null,context=null,loading=false;
 const requested=new URL(location.href).searchParams.get('forecast_team');if(teams.some(t=>t.id===requested))selected=requested;
 const date=value=>value?new Intl.DateTimeFormat('es',{dateStyle:'short',timeStyle:'short',timeZone:'America/New_York'}).format(new Date(value))+' Miami':'pendiente';
 function buttonState(){for(const b of section.querySelectorAll('[data-forecast-team]'))b.setAttribute('aria-pressed',String(b.dataset.forecastTeam===selected));}
 function stopContext(){context?.stop?.();context=null;}
 function show(){
  stopContext();host.replaceChildren();status.removeAttribute('title');buttonState();
  if(loading){status.textContent='Consultando las publicaciones vigentes.';return;}
  context=window.CubanForecastContext?.createLazy(selected,catalog,{signal:controller?.signal});
  try{
   const row=rows.find(r=>r.team===selected);
   if(!row){status.textContent='No se pudo verificar la publicación actual. Pulsa Actualizar.';return;}
   const labels={published:'Publicado',ready:'Actualización pendiente de publicación',blocked:'Última revisión bloqueada',withdrawn:'Publicación retirada',pending:'Actualización pendiente'};
   status.textContent=row.status==='published'&&row.published_at?'Publicado: '+date(row.published_at):labels[row.status]+' · Última comprobación: '+date(row.checked_at);
   status.title='Última comprobación: '+date(row.checked_at)+(row.published_at?' · Publicación visible: '+date(row.published_at):'');
   if(!row.payload||row.status==='withdrawn')return;
   if(row.payload.schema_version===1){if(row.team!=='real-madrid')throw Error();legacy.validate(row.payload);}else{round.validate(row.payload);if(row.payload.team!==row.team)throw Error();}
   window.CubanForecastPitch.render(host,row.payload,catalog,{publishedAt:row.published_at,playerContext:context});
   if(!catalog)status.textContent+=' · Fotos no disponibles; se conservan nombres y explicaciones.';
  }catch{host.replaceChildren();status.textContent='No se pudo verificar la publicación actual. Reintenta para consultar el once vigente.';}
  finally{context?.renderClub(host);context?.attach(host);context?.start();}
 }
 const nav=section.querySelector('.forecast-clubs'),list=document.createElement('div');list.className='forecast-club-list';
 for(const team of [...teams].sort((a,b)=>a.name.localeCompare(b.name,'es'))){
  const b=document.createElement('button'),img=document.createElement('img'),name=document.createElement('span');b.type='button';b.dataset.forecastTeam=team.id;b.setAttribute('aria-controls','forecastPublicBody');b.title=team.name;b.setAttribute('aria-label',team.name);
  if(team.id==='real-madrid')b.id='forecastTeamMadrid';img.src=team.crest;img.alt='';img.width=28;img.height=32;img.decoding='async';img.addEventListener('error',()=>img.remove(),{once:true});name.textContent=team.name;
  b.append(img,name);b.addEventListener('click',()=>{if(selected!==team.id){selected=team.id;show();}document.dispatchEvent(new CustomEvent('forecast:team-selected',{detail:{team:selected}}));});list.append(b);
 }
 const caption=document.createElement('span');caption.className='forecast-clubs-caption';caption.textContent='LaLiga · Próximo partido de cada equipo · 20 clubes';nav.replaceChildren(list,caption);buttonState();
 async function load(){
  stopContext();controller?.abort();controller=new AbortController();const current=++sequence,currentController=controller,signal=controller.signal;
  host.replaceChildren();rows=[];loading=true;status.textContent='Consultando las publicaciones vigentes.';retry.disabled=true;section.setAttribute('aria-busy','true');
  const timeout=setTimeout(()=>currentController.abort(),15000);
  try{
   const config=window.CUBAN_LEAGUE_SUPABASE;if(!config?.url||!config.publishableKey)throw Error();
   const url=new URL(config.url+'/rest/v1/forecast_season_public');url.search=new URLSearchParams({select:'team,payload,published_at,checked_at,status,attempted_fixture_key',limit:'20'});
   const [forecastResult,catalogResult]=await Promise.allSettled([
    fetch(url,{headers:{apikey:config.publishableKey},cache:'no-store',signal}).then(async response=>{if(!response.ok)throw Error();return response.json();}),
    catalog?Promise.resolve(catalog):window.CubanLeaguePlayerCatalog.load()
   ]);
   if(current!==sequence||!active)return;
   if(catalogResult.status==='fulfilled')catalog=catalogResult.value;
   if(forecastResult.status==='rejected')throw Error();const data=forecastResult.value;
   if(!Array.isArray(data)||data.length!==20||new Set(data.map(r=>r.team)).size!==20||data.some(r=>!teams.some(t=>t.id===r.team)||!['published','ready','blocked','withdrawn','pending'].includes(r.status)||[r.checked_at,r.published_at].some(d=>d!==null&&!Number.isFinite(Date.parse(d)))))throw Error();
   if(current!==sequence||!active)return;rows=data;
   if(current!==sequence||!active)return;
  }catch{if(current===sequence&&active)rows=[];}
  finally{clearTimeout(timeout);if(current===sequence&&active){loading=false;retry.disabled=false;section.setAttribute('aria-busy','false');show();}}
 }
 function observe(){const next=document.body.dataset.section==='forecasts'&&document.body.dataset.forecastView!=='history';if(next&&!active){active=true;sequence++;load();}else if(!next&&active){active=false;sequence++;stopContext();controller?.abort();host.replaceChildren();rows=[];loading=false;retry.disabled=false;section.setAttribute('aria-busy','false');}}
 document.addEventListener('forecast:team-selected',e=>{if(teams.some(t=>t.id===e.detail?.team)&&selected!==e.detail.team){selected=e.detail.team;buttonState();if(active)show();}});
 retry.addEventListener('click',()=>{if(active)load();});document.addEventListener('visibilitychange',()=>{if(active&&!document.hidden)load();});new MutationObserver(observe).observe(document.body,{attributes:true,attributeFilter:['data-section','data-forecast-view']});observe();
})();
