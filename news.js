/* Noticias: lazy, paginated read-only feed. No prediction or fantasy mutations. */
(()=>{'use strict';
 const section=document.getElementById('news');if(!section)return;
 const $=id=>document.getElementById(id),PAGE_SIZE=40;
 const labels={press:'Ruedas de prensa',injury:'Bajas',recovery:'Recuperaciones',training:'Entrenamientos',rotation:'Rotaciones',transfer:'Fichajes'},states={confirmed:'Confirmado',reported:'Información publicada',doubt:'En duda',rumor:'Rumor · Sin confirmar'};
 let rows=[],catalog,catalogPromise,statusRow,statusKnown=false,team='',category='',selected='',active=false,generation=0,controller,cursor=null,hasMore=false,loading=false,dayTimer,renderedToday='';
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 const date=s=>s&&Number.isFinite(Date.parse(s))?new Intl.DateTimeFormat('es',{dateStyle:'short',timeStyle:'short',timeZone:'America/New_York'}).format(new Date(s))+' Miami':'No consta hora exacta';
 // Group only by the persisted source day. Import and consultation times are not publication dates.
 const dayFormat=new Intl.DateTimeFormat('es',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
 const todayFormat=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'America/New_York'});
 function todayKey(){const parts=Object.fromEntries(todayFormat.formatToParts(new Date()).map(p=>[p.type,p.value]));return parts.year+'-'+parts.month+'-'+parts.day;}
 function validDay(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;}
 function dayHeading(group,today){const day=group.dataset.day,heading=group.querySelector('.cn-day-heading');heading.replaceChildren();
  if(day==='unknown'){heading.append(el('span','Sin fecha confirmada','cn-day-title'));return;}
  const d=new Date(day+'T12:00:00Z'),yesterday=new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10),relative=day===today?'Hoy':day===yesterday?'Ayer':'',full=dayFormat.format(d);
  if(relative)heading.append(el('span',relative,'cn-day-title'));
  const time=el('time',relative?full:full.charAt(0).toUpperCase()+full.slice(1),relative?'cn-day-date':'cn-day-title');time.dateTime=day;heading.append(time);
 }
 function refreshDayLabels(){const today=todayKey();if(today===renderedToday)return;renderedToday=today;for(const group of $('newsList').querySelectorAll('.cn-day'))dayHeading(group,today);}
 function url(s){try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
 function image(src,cls){const n=el('img',null,cls);n.src=src;n.alt='';n.loading='lazy';n.decoding='async';n.addEventListener('error',()=>n.remove(),{once:true});return n;}
 function button(text,fn,pressed){const b=el('button',text);b.type='button';b.setAttribute('aria-pressed',String(!!pressed));b.addEventListener('click',fn);return b;}
 const more=el('button','Ver más noticias','cn-more');more.id='newsMore';more.type='button';more.hidden=true;more.addEventListener('click',()=>{if(active&&!loading&&hasMore)load({append:true});});$('newsList').after(more);
 $('newsReload').title='Vuelve a consultar las noticias ya publicadas';

 function detail(r){const p=r.payload,box=el('div',null,'cn-detail');box.append(el('span',states[p.certainty],'cn-state '+p.certainty),el('h3',p.title));
  for(const [heading,text] of [['Qué pasó',p.summary],['Para la próxima jornada',p.impact]]){box.append(el('h4',heading),el('p',text));if(heading==='Para la próxima jornada')box.append(el('small','Lectura fantasy · interpretación editorial'));}
  box.append(el('h4','Evolución de la noticia'));const events=el('ol',null,'cn-timeline');for(const e of p.timeline||[]){const li=el('li');li.append(el('time',date(e.at)),el('span',e.text));events.append(li);}box.append(events,el('h4','Fuentes y fechas'));
  for(const s of p.sources){const a=el('a','Leer en '+s.name+' ↗');a.href=url(s.url);a.target='_blank';a.rel='noopener noreferrer';box.append(a,el('small','Publicada: '+(s.published_at?date(s.published_at):(s.published_label||'No consta'))+' · Consultada: '+date(s.fetched_at)));}
  return box;
 }
 function filter(nextTeam,nextCategory){selected='';renderSelection();if(nextTeam===team&&nextCategory===category)return;team=nextTeam;category=nextCategory;rows=[];cursor=null;hasMore=false;loading=true;show();load({refreshStatus:false});}
 function showFilters(){
  $('newsClubs').replaceChildren(button('Todos',()=>filter('',category),!team));
  for(const c of catalog?.clubs||[]){const b=button('',()=>filter(c.id,category),team===c.id);b.title=c.name;b.setAttribute('aria-label',c.name);if(c.crest)b.append(image(c.crest,'cn-crest'));b.append(el('span',c.name));$('newsClubs').append(b);}
  $('newsFilters').replaceChildren();for(const [id,label] of [['','Todas'],...Object.entries(labels)])$('newsFilters').append(button(label,()=>filter(team,id),category===id));
  // Counts from one page would misrepresent the full archive. These shortcuts open the complete category filter.
  $('newsHighlights').replaceChildren();for(const id of ['press','injury','recovery']){const b=button('',()=>filter(team,id),category===id);b.append(el('strong',labels[id]),el('span','Consultar noticias'));$('newsHighlights').append(b);}
 }
 function show(){
  showFilters();$('newsList').replaceChildren();$('newsDetail').replaceChildren();
  $('newsCount').textContent=rows.length+' noticias'+(hasMore?' cargadas · hay más':'');more.hidden=!hasMore;more.disabled=loading;
  if(!rows.length){$('newsList').append(el('p',loading?'Consultando noticias…':'No hay noticias publicadas para este filtro.','cn-empty'));renderSelection();return;}
  const groups=new Map(),today=todayKey();renderedToday=today;
  for(const r of rows){const day=r.news_day||'unknown';if(!groups.has(day)){const group=el('section',null,'cn-day'),heading=el('h3',null,'cn-day-heading');group.dataset.day=day;heading.id='news-day-'+day;group.setAttribute('aria-labelledby',heading.id);group.append(heading);dayHeading(group,today);groups.set(day,group);}
   const p=r.payload,article=el('article',null,'cn-row'),b=el('button',null,'cn-open');b.type='button';b.setAttribute('aria-expanded',String(selected===r.key));b.setAttribute('aria-controls','news-inline-'+r.key);b.addEventListener('click',()=>{selected=selected===r.key?'':r.key;renderSelection();});
   const person=catalog?.playersById.get(p.players[0]?.id),club=catalog?.clubsById.get(p.team);const art=el('span',null,'cn-art');if(person?.photo)art.append(image(person.photo,'cn-face'));else art.append(el('span',p.category==='press'?'🎙':'◉','cn-symbol'));if(club?.crest)art.append(image(club.crest,'cn-crest'));b.append(art);
   const copy=el('span',null,'cn-copy');copy.append(el('small',labels[p.category]+' · '+states[p.certainty],'cn-label '+p.certainty),el('strong',p.title),el('span',p.summary,'cn-excerpt'),el('small',[...new Set(p.sources.map(s=>s.name))].join(' · ')));b.append(copy,el('span','⌄','cn-chevron'));article.append(b);const inline=el('div',null,'cn-inline');inline.id='news-inline-'+r.key;inline.hidden=selected!==r.key;article.dataset.key=r.key;article.append(inline);groups.get(day).append(article);}
  for(const [day,group] of [...groups].sort(([a],[b])=>a==='unknown'?1:b==='unknown'?-1:b.localeCompare(a)))$('newsList').append(group);
  renderSelection();
 }
 function renderSelection(){for(const node of $('newsList').querySelectorAll('.cn-row')){const match=node.dataset.key===selected;node.classList.toggle('selected',match);node.querySelector('button')?.setAttribute('aria-expanded',String(match));const inline=node.querySelector('.cn-inline');if(inline){inline.hidden=!match;inline.replaceChildren();if(match)inline.append(detail(rows.find(r=>r.key===selected)));}}const aside=$('newsDetail'),r=rows.find(r=>r.key===selected);aside.replaceChildren();aside.hidden=!r;aside.closest('.cn-layout').classList.toggle('has-selection',!!r);if(r)aside.append(detail(r));}
 function statusText(){
  const s=statusRow,p=s?.progress,integer=n=>Number.isInteger(n)&&n>=0;
  const valid=p&&integer(p.teams_expected)&&p.teams_expected>0&&integer(p.teams_reviewed)&&p.teams_reviewed<=p.teams_expected&&integer(p.pending);
  const parts=[];
  if(valid){
   const complete=p.status==='complete'&&p.teams_reviewed===p.teams_expected&&p.pending===0;
   parts.push((complete?'Revisión completa':p.status==='partial'?'Cobertura parcial':'Revisión en curso')+': '+p.teams_reviewed+'/'+p.teams_expected+' clubes revisados');
   if(integer(p.teams_partial)&&p.teams_partial)parts.push(p.teams_partial+' clubes con fuentes incompletas');
   if(p.pending)parts.push(p.pending+' pendientes');
   if(integer(p.new)&&integer(p.updated))parts.push(p.new+' nuevas · '+p.updated+' actualizadas');
   if(integer(p.ready)&&p.ready)parts.push(p.ready+(p.status==='complete'||p.status==='partial'?' quedaron listas sin publicar al cierre':' listas sin publicar'));
   if(s.checked_at)parts.push('Último cierre: '+date(s.checked_at));
  }else if(s?.checked_at){parts.push('Fuentes consultadas: '+date(s.checked_at));if(s.result==='partial')parts.push('Cobertura parcial: alguna fuente no estuvo disponible.');}
  else parts.push('Primera actualización pendiente.');
  if(s?.checked_at&&Date.now()-Date.parse(s.checked_at)>18*3600000)parts.push('La última revisión finalizada tiene más de 18 horas.');
  return parts.join(' · ');
 }
 function validRow(r){const p=r?.payload;return (r?.news_day===null||validDay(r?.news_day))&&typeof r?.key==='string'&&/^[a-z0-9-]{8,140}$/.test(r.key)&&typeof r.updated_at==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(r.updated_at)&&Number.isFinite(Date.parse(r.updated_at))&&p&&Object.hasOwn(labels,p.category)&&Object.hasOwn(states,p.certainty)&&typeof p.title==='string'&&typeof p.summary==='string'&&typeof p.impact==='string'&&Array.isArray(p.players)&&Array.isArray(p.sources)&&p.sources.length>0&&p.sources.every(s=>s&&url(s.url))&&(!team||p.team===team)&&(!category||p.category===category);}
 function feedPath(after){const params=new URLSearchParams({select:'key,payload,published_at,updated_at,news_day',visible:'eq.true',order:'news_day.desc.nullslast,updated_at.desc,key.asc',limit:String(PAGE_SIZE+1)});if(team)params.set('payload->>team','eq.'+team);if(category)params.set('payload->>category','eq.'+category);
  if(after){const tail='updated_at.lt.'+after.updated_at+',and(updated_at.eq.'+after.updated_at+',key.gt.'+after.key+')';if(after.news_day===null){params.set('news_day','is.null');params.set('or','('+tail+')');}else params.set('or','(news_day.lt.'+after.news_day+',news_day.is.null,and(news_day.eq.'+after.news_day+',or('+tail+')))');}return 'news_public?'+params;}

 async function load({append=false,refreshStatus=true}={}){
  controller?.abort();controller=new AbortController();const local=controller,g=++generation,after=append?cursor:null;const timer=setTimeout(()=>local.abort(),15000);
  loading=true;$('newsReload').disabled=true;more.disabled=true;more.textContent=append?'Cargando noticias…':'Ver más noticias';$('newsStatus').textContent=append?'Consultando noticias anteriores…':'Consultando noticias publicadas…';selected='';renderSelection();
  try{const c=window.CUBAN_LEAGUE_SUPABASE;if(!c?.url||!c.publishableKey)throw Error();
   const fetchRows=async(path,signal=local.signal)=>{const r=await fetch(c.url+'/rest/v1/'+path,{headers:{apikey:c.publishableKey},cache:'no-store',signal});if(!r.ok)throw Error();const data=await r.json();if(signal.aborted)throw Error();return data;};
   if(!catalogPromise)catalogPromise=window.CubanLeaguePlayerCatalog.load().catch(e=>{catalogPromise=null;throw e;});
   // Coverage is independent of the articles: a slow status request must not delay a usable feed.
   let statusPending=(!append&&refreshStatus)||!statusKnown,statusFailed=false,feedSucceeded=false;
   const renderStatus=()=>{$('newsStatus').textContent=statusText()+(statusPending?' Comprobando cobertura…':statusFailed?' No se pudo consultar el estado de la revisión.':'');};
   if(statusPending){
    const statusController=new AbortController(),abortStatus=()=>statusController.abort();local.signal.addEventListener('abort',abortStatus,{once:true});const statusTimer=setTimeout(abortStatus,3000);
    // SELECT * also accepts the old status table before the additive progress column is deployed.
    fetchRows('news_status?select=*&limit=1',statusController.signal).then(data=>{if(!Array.isArray(data))throw Error();return data;}).catch(()=>null).then(data=>{if(g!==generation||!active||local.signal.aborted)return;statusPending=false;statusFailed=data===null;if(data!==null){statusRow=data[0];statusKnown=true;}if(feedSucceeded)renderStatus();}).finally(()=>{clearTimeout(statusTimer);local.signal.removeEventListener('abort',abortStatus);});
   }
   const [page,cat]=await Promise.all([fetchRows(feedPath(after)),catalogPromise]);
   if(g!==generation||!active)return;if(local.signal.aborted)throw Error();
   if(!Array.isArray(page)||page.length>PAGE_SIZE+1||page.some(r=>!validRow(r)))throw Error();
   const visible=page.slice(0,PAGE_SIZE);hasMore=page.length>PAGE_SIZE;cursor=visible.length?{news_day:visible.at(-1).news_day,updated_at:visible.at(-1).updated_at,key:visible.at(-1).key}:after;
   const merged=new Map((append?rows:[]).map(r=>[r.key,r]));for(const r of visible)merged.set(r.key,r);rows=[...merged.values()];catalog=cat;
   show();feedSucceeded=true;renderStatus();
  }catch{if(g===generation&&active){show();if(!rows.length)$('newsList').replaceChildren();$('newsStatus').textContent=(rows.length?'No se pudieron actualizar las noticias. Se conservan las noticias cargadas para este filtro.':'No se pudieron consultar las noticias.')+' Pulsa '+(append?'Ver más noticias':'Actualizar')+' para reintentar.';}}
  finally{clearTimeout(timer);if(g===generation){loading=false;$('newsReload').disabled=false;more.disabled=false;more.textContent='Ver más noticias';}}
 }
 function observe(){const next=document.body.dataset.section==='news';if(next&&!active){active=true;dayTimer=setInterval(refreshDayLabels,60000);load();}else if(!next&&active){active=false;clearInterval(dayTimer);generation++;controller?.abort();loading=false;selected='';renderSelection();$('newsReload').disabled=false;more.disabled=false;}}
 $('newsReload').addEventListener('click',()=>{if(active)load();});document.addEventListener('visibilitychange',()=>{if(active&&!document.hidden){refreshDayLabels();load();}});new MutationObserver(observe).observe(document.body,{attributes:true,attributeFilter:['data-section']});observe();
})();
