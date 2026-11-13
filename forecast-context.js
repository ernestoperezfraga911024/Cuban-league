/* Public club news and explicit, player-specific health observations. */
(() => {
 'use strict';
 const labels={doubt:'En duda',injured:'Lesionado',available:'Disponible'};
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 const date=s=>s!=null&&Number.isFinite(new Date(s).getTime())?new Intl.DateTimeFormat('es',{dateStyle:'short',timeStyle:'short',timeZone:'America/New_York'}).format(new Date(s))+' Miami':'';
 const safeUrl=s=>{try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
 function validRow(r){const p=r?.payload;return r?.visible!==false&&p?.season==='2026-27'&&typeof r.key==='string'&&typeof p.team==='string'&&typeof p.title==='string'&&typeof p.summary==='string'&&Array.isArray(p.players)&&p.players.every(x=>x&&typeof x.id==='string'&&typeof x.name==='string')&&Array.isArray(p.sources)&&p.sources.length>0&&p.sources.every(s=>s&&typeof s.name==='string'&&safeUrl(s.url));}
 const iso=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
 const identity=s=>typeof s==='string'&&/^[a-z0-9-]{1,140}$/.test(s);
 function assertTeam(team){if(!identity(team)||window.CubanForecastRoundCore?.config?.teams&&!window.CubanForecastRoundCore.config.teams.some(t=>t.id===team))throw Error('Equipo no válido');}
 async function request(table,params,signal){
  if(signal?.aborted)throw Error('Consulta cancelada');
  const c=window.CUBAN_LEAGUE_SUPABASE;if(!c?.url||!c.publishableKey)throw Error('Conexión no disponible');
  const u=new URL(c.url+'/rest/v1/'+table);u.search=new URLSearchParams(params);
  const response=await fetch(u,{headers:{apikey:c.publishableKey},cache:'no-store',signal});if(!response.ok)throw Error('Consulta no disponible');
  const data=await response.json();if(signal?.aborted)throw Error('Consulta cancelada');return data;
 }
 async function newsPage(team,signal,{after=null,playerId=null,pageSize=5,medical=false}={}){
  assertTeam(team);if(!Number.isInteger(pageSize)||pageSize<1||pageSize>100||playerId!==null&&!identity(playerId))throw Error('Consulta no válida');
  const params={select:'key,payload,published_at,updated_at,visible',visible:'eq.true','payload->>team':'eq.'+team,order:'updated_at.desc,key.asc',limit:String(pageSize+1)};
  if(playerId)params['payload->players']='cs.'+JSON.stringify([{id:playerId}]);
  else if(medical)params['payload->players']='cs.'+JSON.stringify([{health:{}}]);
  if(after){if(!identity(after.key)||!iso.test(after.updated_at)||!Number.isFinite(Date.parse(after.updated_at)))throw Error('Cursor no válido');params.or='(updated_at.lt.'+after.updated_at+',and(updated_at.eq.'+after.updated_at+',key.gt.'+after.key+'))';}
  const page=await request('news_public',params,signal);
  if(!Array.isArray(page)||page.length>pageSize+1||page.some(r=>!validRow(r)||r.payload.team!==team||!identity(r.key)||!iso.test(r.updated_at)||!Number.isFinite(Date.parse(r.updated_at))||playerId&&!r.payload.players.some(p=>p.id===playerId)||medical&&!r.payload.players.some(p=>p.health&&typeof p.health==='object'&&!Array.isArray(p.health))))throw Error('Noticias incompletas');
  if(new Set(page.map(r=>r.key)).size!==page.length)throw Error('Noticias duplicadas');
  const rows=page.slice(0,pageSize),last=rows.at(-1),cursor=last?{key:last.key,updated_at:last.updated_at}:after;
  if(after&&last&&cursor.key===after.key&&cursor.updated_at===after.updated_at)throw Error('La paginación no avanzó');
  return {rows,cursor,hasMore:page.length>pageSize};
 }
 async function load(team,signal,options){return newsPage(team,signal,options);}
 async function loadHealthNews(team,signal){
  // Every dated health event for this club, including availability. No age cutoff:
  // a long injury remains relevant even after it leaves the recent-news page.
  const rows=[],seen=new Set();let after=null;
  do{
   const page=await newsPage(team,signal,{after,pageSize:100,medical:true});
   for(const row of page.rows){if(seen.has(row.key))throw Error('Historial físico incompleto');seen.add(row.key);rows.push(row);}
   if(!page.hasMore)return rows;after=page.cursor;
  }while(!signal?.aborted);
  throw Error('Consulta cancelada');
 }

 function validHealth(r){
  const p=r?.payload,s=p?.source;
  return typeof r?.team==='string'&&typeof r?.player_id==='string'&&r.team===p?.team&&r.player_id===p?.id&&p.season==='2026-27'
   &&Number.isInteger(p.matchday)&&p.matchday>=13&&p.matchday<=38&&Object.hasOwn(labels,p.status)
   &&typeof p.name==='string'&&typeof p.detail==='string'&&p.detail.trim().length>=10&&p.detail.length<=500
   &&s?.id==='futbolfantasy'&&/^https:\/\/www\.futbolfantasy\.com\/(laliga\/)?equipos\/[a-z0-9-]+\/?$/.test(s.url)
   &&Number.isFinite(Date.parse(s.fetched_at))&&Date.parse(s.fetched_at)<=Date.now()+300000
   &&Number.isFinite(Date.parse(r.published_at));
 }
 async function loadHealth(team,signal){
  assertTeam(team);const rows=[],seen=new Set();let after=null;
  do{
   const params={select:'team,player_id,payload,published_at',team:'eq.'+team,order:'player_id.asc',limit:'200'};if(after)params.player_id='gt.'+after;
   const page=await request('forecast_health_public',params,signal);
   if(!Array.isArray(page)||page.length>200||page.some(r=>!validHealth(r)||r.team!==team||!identity(r.player_id)))throw Error('Estado físico incompleto');
   for(const row of page){if(seen.has(row.player_id))throw Error('Estado físico duplicado');seen.add(row.player_id);rows.push(row);}
   if(page.length<200)return rows;after=page.at(-1).player_id;
  }while(!signal?.aborted);
  throw Error('Consulta cancelada');
 }

 function currentHealth(rows,id,physical){
  const article=health(rows,id),direct=physical.find(r=>r.player_id===id&&validHealth(r));
  if(!direct)return article;
  const p=direct.payload,at=Date.parse(p.source.fetched_at);
  // A new article can supersede a snapshot only with a verifiably later event.
  // Its import/refresh time alone never turns older reporting into newer evidence.
  if(article&&(article.event_date>new Date(at).toISOString().slice(0,10)||article.row.payload.sources.some(s=>article.refs.includes(s.url)&&Date.parse(s.source_updated_at||s.published_at)>at)))return article;
  return {status:p.status,detail:p.detail,refs:[p.source.url],fetched_at:p.source.fetched_at,event_date:p.event_date||null,direct:true};
 }
 function health(rows,id,now=Date.now()){
  const entries=[];
  for(const row of rows){if(!validRow(row)||row.payload.category==='transfer'||row.payload.certainty==='rumor')continue;const h=row.payload.players.find(p=>p.id===id)?.health;
   if(!h||!Object.hasOwn(labels,h.status)||!/^\d{4}-\d{2}-\d{2}$/.test(h.event_date)||!Number.isFinite(Date.parse(h.event_date))||new Date(h.event_date).toISOString().slice(0,10)!==h.event_date||typeof h.detail!=='string'||h.detail.trim().length<10||h.detail.length>500||!Array.isArray(h.refs)||!h.refs.length||!h.refs.every(url=>row.payload.sources.some(s=>s.url===url)))continue;
   const fetched=Math.max(...row.payload.sources.map(s=>Date.parse(s.fetched_at)));
   if(!Number.isFinite(fetched)||!Number.isFinite(Date.parse(row.updated_at))||Date.parse(h.event_date)>fetched+86400000||Date.parse(h.event_date)>now+86400000)continue;
   entries.push({row,status:h.status,event_date:h.event_date,detail:h.detail,refs:h.refs});
  }
  entries.sort((a,b)=>b.event_date.localeCompare(a.event_date)||Date.parse(b.row.updated_at)-Date.parse(a.row.updated_at));
  return entries[0]||null;
 }
 function story(row){
  const p=row.payload,box=el('details',null,'fc-story');box.dataset.newsKey=row.key;box.append(el('summary',p.title));if(p.certainty==='rumor')box.append(el('strong','Rumor','fc-story-tag'));box.append(el('p',p.summary));
  if(p.impact)box.append(el('p',p.impact,'fc-impact'));
  const links=el('div',null,'fc-sources');for(const s of p.sources){const a=el('a',s.name);a.href=safeUrl(s.url);a.target='_blank';a.rel='noopener noreferrer';links.append(a);}
  box.append(links,el('small','Información: '+p.sources.map(s=>s.published_label||date(s.published_at)||'Fecha no indicada').filter((x,i,a)=>a.indexOf(x)===i).join(' · ')));return box;
 }
 function create(team,rows,catalog,unavailable=false,physical=[],healthUnavailable=false){
  const clubRows=rows.filter(r=>validRow(r)&&r.payload.team===team).sort((a,b)=>Date.parse(b.updated_at)-Date.parse(a.updated_at));
  const physicalRows=physical.filter(r=>r.team===team);
  const state=id=>currentHealth(clubRows,id,physicalRows);
  const playerRows=id=>clubRows.filter(r=>r.payload.players.some(p=>p.id===id));
  return {
   rosterAvailable:Array.isArray(catalog?.players),
   roster:(catalog?.players||[]).filter(p=>p.active&&p.clubId===team).map(p=>({id:p.id,name:p.displayName,position:p.position})),
   badge(player){const h=state(player.id);if(!h||h.status==='available')return null;const b=el('span',h.status==='injured'?'+':'?','fc-health '+h.status);b.title=labels[h.status]+' · Información del '+(h.direct?date(h.fetched_at):h.event_date.split('-').reverse().join('/'));b.setAttribute('role','img');b.setAttribute('aria-label',labels[h.status]);return b;},
   detail(player){const box=el('section',null,'fc-player-context'),h=state(player.id),related=playerRows(player.id);box.append(el('h4','Su situación'));
    if(healthUnavailable)box.append(el('small','No se pudo consultar el estado físico de FutbolFantasy.'));
    if(unavailable)box.append(el('p','No se pudieron cargar las noticias. Pulsa Actualizar.'));
    if(h){box.append(el('strong',labels[h.status],'fc-health-label '+h.status),el('p',h.detail));
     if(h.direct){const a=el('a','FutbolFantasy');a.href=h.refs[0];a.target='_blank';a.rel='noopener noreferrer';box.append(a,el('small','Revisado: '+date(h.fetched_at)));}
     else box.append(el('small','Información del '+h.event_date.split('-').reverse().join('/')+' · Revisada: '+date(Math.max(...h.row.payload.sources.map(s=>Date.parse(s.fetched_at))))));
    }
    else if(!related.length)box.append(el('p','Sin novedades publicadas.'));
    else box.append(el('p','Últimas noticias del jugador.'));
    const shown=related.slice(0,5);if(h?.row&&!shown.includes(h.row))shown.push(h.row);
    for(const row of shown)box.append(story(row));return box;
   },
   renderClub(host){const box=el('section',null,'fc-club-news');box.append(el('h3','Noticias del equipo'));
    if(unavailable)box.append(el('p','No se pudieron cargar las noticias. Pulsa Actualizar.'));
    else if(!clubRows.length)box.append(el('p','Sin noticias publicadas por ahora.'));
    else {for(const row of clubRows.slice(0,5))box.append(story(row));if(clubRows.length>5){const more=el('details',null,'fc-more');more.append(el('summary','Ver '+(clubRows.length-5)+' noticias anteriores'));for(const row of clubRows.slice(5))more.append(story(row));box.append(more);}}
    host.append(box);
   }
  };
 }

 function createLazy(team,catalog,{signal}={}){
  assertTeam(team);
  const controller=new AbortController(),life=controller.signal,abort=()=>controller.abort();
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const makePage=()=>({rows:[],cursor:null,hasMore:false,busy:false,error:false,appendFailed:false,status:'idle'});
  const club=makePage(),players=new Map(),views=new Set(),clubViews=new Set(),baseLabels=new WeakMap();
  const medical={rows:[],physical:[],status:'idle',error:false};
  let host=null,started=false;
  const roster=(catalog?.players||[]).filter(p=>p.active&&p.clubId===team).map(p=>({id:p.id,name:p.displayName,position:p.position}));
  const state=id=>medical.status==='ready'?currentHealth(medical.rows,id,medical.physical):null;
  const active=box=>!life.aborted&&box.isConnected&&host?.contains(box);
  function action(text,key,fn,disabled=false){const b=el('button',text,'fc-load-more');b.type='button';b.dataset.contextAction=key;b.disabled=disabled;b.addEventListener('click',fn);return b;}
  function preserve(box,render){
   const opened=new Set([...box.querySelectorAll('.fc-story[open]')].map(n=>n.dataset.newsKey)),focused=document.activeElement,inside=box.contains(focused);
   const actionKey=inside?focused.dataset?.contextAction:null,storyKey=inside?focused.closest('.fc-story')?.dataset.newsKey:null,href=inside&&focused.tagName==='A'?focused.getAttribute('href'):null;
   const scroller=box.closest('.fp-detail'),scrollTop=scroller?.scrollTop;
   box.replaceChildren();render();for(const n of box.querySelectorAll('.fc-story'))if(opened.has(n.dataset.newsKey))n.open=true;
   if(inside){let replacement=actionKey?[...box.querySelectorAll('[data-context-action]')].find(n=>n.dataset.contextAction===actionKey):null;
    if(!replacement&&storyKey){const storyNode=[...box.querySelectorAll('.fc-story')].find(n=>n.dataset.newsKey===storyKey);replacement=href?[...storyNode?.querySelectorAll('a')||[]].find(n=>n.getAttribute('href')===href):storyNode?.querySelector('summary');}
    if(replacement&&!replacement.disabled)replacement.focus({preventScroll:true});else if(focused?.tagName==='BUTTON'){box.tabIndex=-1;box.focus({preventScroll:true});}
   }
   if(scroller&&scrollTop!==undefined)scroller.scrollTop=scrollTop;
  }
  async function withTimeout(fn){
   const child=new AbortController(),cancel=()=>child.abort();if(life.aborted)cancel();else life.addEventListener('abort',cancel,{once:true});
   const timer=setTimeout(cancel,15000);
   try{const result=await fn(child.signal);if(child.signal.aborted)throw Error('Consulta cancelada');return result;}
   finally{child.abort();clearTimeout(timer);life.removeEventListener('abort',cancel);}
  }
  function badge(player){const h=state(player.id);if(!h||h.status==='available')return null;const b=el('span',h.status==='injured'?'+':'?','fc-health '+h.status);b.title=labels[h.status]+' · Información del '+(h.direct?date(h.fetched_at):h.event_date.split('-').reverse().join('/'));b.setAttribute('role','img');b.setAttribute('aria-label',labels[h.status]);return b;}
  function refreshBadges(){
   if(life.aborted||!host?.isConnected)return;
   for(const button of host.querySelectorAll('.fp-player[data-player-id],.fp-reserve[data-player-id]')){
    if(!baseLabels.has(button))baseLabels.set(button,button.getAttribute('aria-label')||'');
    button.querySelectorAll('.fc-health').forEach(n=>n.remove());button.setAttribute('aria-label',baseLabels.get(button));
    const b=badge({id:button.dataset.playerId});if(b){button.append(b);button.setAttribute('aria-label',baseLabels.get(button)+' '+b.getAttribute('aria-label')+'.');}
   }
  }
  function healthNotice(box){
   if(medical.status==='idle'||medical.status==='loading')box.append(el('p','Comprobando estado físico…','fc-context-status'));
   else if(medical.error){box.append(el('p','No se pudo verificar todo el estado físico. La ausencia de un aviso no confirma disponibilidad.','fc-context-status'));box.append(action('Reintentar estado físico','retry-health',loadMedical));}
  }
  function pageControls(box,page,playerId){
   if(page.error){box.append(el('p',page.rows.length?'No se pudieron cargar más noticias. Se conservan las ya consultadas.':'No se pudieron cargar las noticias.','fc-context-status'));box.append(action('Reintentar noticias',playerId?'retry-player-'+playerId:'retry-club',()=>loadPage(page,playerId,page.appendFailed),page.busy));}
   else if(page.hasMore)box.append(action(page.busy?'Cargando noticias…':'Ver más noticias',playerId?'more-player-'+playerId:'more-club',()=>loadPage(page,playerId,true),page.busy));
  }
  function renderPlayer(box,player){
   const page=players.get(player.id),h=state(player.id);
   preserve(box,()=>{
    box.append(el('h4','Su situación'));healthNotice(box);
    if(h){box.append(el('strong',labels[h.status],'fc-health-label '+h.status),el('p',h.detail));
     if(h.direct){const a=el('a','FutbolFantasy');a.href=h.refs[0];a.target='_blank';a.rel='noopener noreferrer';box.append(a,el('small','Revisado: '+date(h.fetched_at)));}
     else box.append(el('small','Información del '+h.event_date.split('-').reverse().join('/')+' · Revisada: '+date(Math.max(...h.row.payload.sources.map(s=>Date.parse(s.fetched_at))))));
    }
    if(page.status==='idle'||page.status==='loading')box.append(el('p','Consultando noticias del jugador…','fc-context-status'));
    else if(!page.rows.length&&!page.error&&!h)box.append(el('p','Sin novedades publicadas.'));
    const shown=[...page.rows];if(h?.row&&!shown.some(r=>r.key===h.row.key))shown.push(h.row);
    for(const row of shown)box.append(story(row));pageControls(box,page,player.id);
   });
  }
  function renderClubView(box){preserve(box,()=>{
   box.append(el('h3','Noticias del equipo'));healthNotice(box);
   if(club.status==='idle'||club.status==='loading')box.append(el('p','Consultando noticias del equipo…','fc-context-status'));
   else if(!club.rows.length&&!club.error)box.append(el('p','Sin noticias publicadas por ahora.'));
   for(const row of club.rows)box.append(story(row));pageControls(box,club,null);
  });}
  function refresh(){
   if(life.aborted)return;refreshBadges();
   for(const view of views){if(active(view.box))renderPlayer(view.box,view.player);else if(!view.box.isConnected)views.delete(view);}
   for(const box of clubViews){if(active(box))renderClubView(box);else if(!box.isConnected)clubViews.delete(box);}
  }
  async function loadPage(page,playerId=null,append=false){
   if(life.aborted||page.busy)return;page.busy=true;page.error=false;page.appendFailed=append;if(!page.rows.length)page.status='loading';refresh();
   try{const next=await withTimeout(s=>load(team,s,{after:append?page.cursor:null,playerId,pageSize:append?20:5}));if(life.aborted)return;
    const merged=new Map((append?page.rows:[]).map(r=>[r.key,r]));for(const row of next.rows)merged.set(row.key,row);
    page.rows=[...merged.values()];page.cursor=next.cursor;page.hasMore=next.hasMore;page.status='ready';
   }catch{if(!life.aborted){page.error=true;page.status=page.rows.length?'ready':'error';}}
   finally{page.busy=false;if(!life.aborted)refresh();}
  }
  async function loadMedical(){
   if(life.aborted||medical.status==='loading')return;medical.status='loading';medical.error=false;refresh();
   try{const [articles,physical]=await withTimeout(s=>Promise.all([loadHealthNews(team,s),loadHealth(team,s)]));if(life.aborted)return;medical.rows=articles;medical.physical=physical;medical.status='ready';}
   catch{if(!life.aborted){medical.rows=[];medical.physical=[];medical.status='error';medical.error=true;}}
   finally{if(!life.aborted)refresh();}
  }
  return {
   rosterAvailable:Array.isArray(catalog?.players),roster,badge,
   detail(player){if(!players.has(player.id))players.set(player.id,makePage());const box=el('section',null,'fc-player-context');views.add({box,player});renderPlayer(box,player);const page=players.get(player.id);if(page.status==='idle')queueMicrotask(()=>{if(active(box))loadPage(page,player.id);});return box;},
   renderClub(parent){const box=el('section',null,'fc-club-news');clubViews.add(box);renderClubView(box);parent.append(box);},
   attach(parent){host=parent;refreshBadges();},
   start(){if(started||life.aborted)return;started=true;loadPage(club);loadMedical();},
   stop(){abort();signal?.removeEventListener('abort',abort);views.clear();clubViews.clear();host=null;}
  };
 }
 window.CubanForecastContext={load,loadHealthNews,loadHealth,create,createLazy,health,currentHealth,validHealth,validRow};
})();
