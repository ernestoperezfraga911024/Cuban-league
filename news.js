/* Noticias: lazy, read-only public feed. No prediction or fantasy mutations. */
(()=>{'use strict';
 const section=document.getElementById('news');if(!section)return;
 const $=id=>document.getElementById(id),labels={press:'Ruedas de prensa',injury:'Bajas',recovery:'Recuperaciones',training:'Entrenamientos',rotation:'Rotaciones',transfer:'Fichajes'},states={confirmed:'Confirmado',reported:'Información publicada',doubt:'En duda',rumor:'Rumor · Sin confirmar'};
 let rows=[],catalog,team='',category='',selected='',active=false,generation=0,controller;
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 const date=s=>s&&Number.isFinite(Date.parse(s))?new Intl.DateTimeFormat('es',{dateStyle:'short',timeStyle:'short',timeZone:'America/New_York'}).format(new Date(s))+' Miami':'No consta hora exacta';
 function url(s){try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
 function image(src,cls){const n=el('img',null,cls);n.src=src;n.alt='';n.loading='lazy';n.decoding='async';n.addEventListener('error',()=>n.remove(),{once:true});return n;}
 function button(text,fn,pressed){const b=el('button',text);b.type='button';b.setAttribute('aria-pressed',String(!!pressed));b.addEventListener('click',fn);return b;}
 function detail(r){const p=r.payload,box=el('div',null,'cn-detail');box.append(el('span',states[p.certainty],'cn-state '+p.certainty),el('h3',p.title));
  for(const [heading,text] of [['Qué pasó',p.summary],['Para la próxima jornada',p.impact]]){box.append(el('h4',heading),el('p',text));if(heading==='Para la próxima jornada')box.append(el('small','Lectura fantasy · interpretación editorial'));}
  box.append(el('h4','Evolución de la noticia'));const events=el('ol',null,'cn-timeline');for(const e of p.timeline||[]){const li=el('li');li.append(el('time',date(e.at)),el('span',e.text));events.append(li);}box.append(events,el('h4','Fuentes y fechas'));
  for(const s of p.sources){const a=el('a','Leer en '+s.name+' ↗');a.href=url(s.url);a.target='_blank';a.rel='noopener noreferrer';box.append(a,el('small','Publicada: '+(s.published_at?date(s.published_at):(s.published_label||'No consta'))+' · Consultada: '+date(s.fetched_at)));}
  return box;
 }
 function show(){
  selected='';
  $('newsClubs').replaceChildren(button('Todos',()=>{team='';show();},!team));
  for(const c of catalog?.clubs||[]){const b=button('',()=>{team=c.id;show();},team===c.id);b.title=c.name;b.setAttribute('aria-label',c.name);if(c.crest)b.append(image(c.crest,'cn-crest'));b.append(el('span',c.name));$('newsClubs').append(b);}
  $('newsFilters').replaceChildren();for(const [id,label] of [['','Todas'],...Object.entries(labels)])$('newsFilters').append(button(label,()=>{category=id;show();},category===id));
  const filtered=rows.filter(r=>(!team||r.payload.team===team)&&(!category||r.payload.category===category));
  $('newsHighlights').replaceChildren();for(const id of ['press','injury','recovery']){const count=rows.filter(r=>(!team||r.payload.team===team)&&r.payload.category===id).length;const b=button('',()=>{category=id;show();},category===id);b.append(el('strong',labels[id]),el('span',count+' novedades disponibles'));$('newsHighlights').append(b);}
  $('newsList').replaceChildren();$('newsDetail').replaceChildren();$('newsCount').textContent=filtered.length+' noticias';
  if(!filtered.length){$('newsList').append(el('p','No hay noticias publicadas para este filtro.','cn-empty'));renderSelection();return;}
  for(const r of filtered){const p=r.payload,article=el('article',null,'cn-row'),b=el('button',null,'cn-open');b.type='button';b.setAttribute('aria-expanded',String(selected===r.key));b.setAttribute('aria-controls','news-inline-'+r.key);b.addEventListener('click',()=>{selected=selected===r.key?'':r.key;renderSelection();});
   const person=catalog?.playersById.get(p.players[0]?.id),club=catalog?.clubsById.get(p.team);const art=el('span',null,'cn-art');if(person?.photo)art.append(image(person.photo,'cn-face'));else art.append(el('span',p.category==='press'?'🎙':'◉','cn-symbol'));if(club?.crest)art.append(image(club.crest,'cn-crest'));b.append(art);
   const copy=el('span',null,'cn-copy');copy.append(el('small',labels[p.category]+' · '+states[p.certainty],'cn-label '+p.certainty),el('strong',p.title),el('span',p.summary,'cn-excerpt'),el('small',[...new Set(p.sources.map(s=>s.name))].join(' · ')));b.append(copy,el('span','⌄','cn-chevron'));article.append(b);const inline=el('div',null,'cn-inline');inline.id='news-inline-'+r.key;inline.hidden=selected!==r.key;if(selected===r.key)inline.append(detail(r));article.dataset.key=r.key;article.append(inline);$('newsList').append(article);}
  renderSelection();
 }
 function renderSelection(){for(const node of $('newsList').children){const match=node.dataset.key===selected;node.classList.toggle('selected',match);node.querySelector('button')?.setAttribute('aria-expanded',String(match));const inline=node.querySelector('.cn-inline');if(inline){inline.hidden=!match;inline.replaceChildren();if(match)inline.append(detail(rows.find(r=>r.key===selected)));}}const aside=$('newsDetail'),r=rows.find(r=>r.key===selected);aside.replaceChildren();aside.hidden=!r;aside.closest('.cn-layout').classList.toggle('has-selection',!!r);if(r)aside.append(detail(r));}
 async function load(){controller?.abort();controller=new AbortController();const local=controller,g=++generation;const timer=setTimeout(()=>local.abort(),15000);$('newsReload').disabled=true;$('newsStatus').textContent='Consultando noticias publicadas…';rows=[];selected='';$('newsList').replaceChildren();renderSelection();
  try{const c=window.CUBAN_LEAGUE_SUPABASE;if(!c?.url||!c.publishableKey)throw Error();
   const fetchRows=async(path)=>{const r=await fetch(c.url+'/rest/v1/'+path,{headers:{apikey:c.publishableKey},cache:'no-store',signal:local.signal});if(!r.ok)throw Error();return r.json();};
   const [data,status,cat]=await Promise.all([fetchRows('news_public?select=key,payload,published_at,updated_at&order=updated_at.desc&limit=80'),fetchRows('news_status?select=checked_at,coverage,result&limit=1'),window.CubanLeaguePlayerCatalog.load()]);
   if(g!==generation||!active)return;if(!Array.isArray(data)||!Array.isArray(status))throw Error();
   if(data.some(r=>!r.key||!r.payload||!labels[r.payload.category]||!states[r.payload.certainty]||!Array.isArray(r.payload.players)||!Array.isArray(r.payload.sources)||!r.payload.sources.length||r.payload.sources.some(s=>!url(s.url))))throw Error();
   rows=data;catalog=cat;show();const s=status[0];$('newsStatus').textContent=s?.checked_at?'Última revisión: '+date(s.checked_at)+(s.result==='partial'?' · Cobertura parcial: alguna fuente no estuvo disponible.':' · Revisión completada.'):'Primera actualización pendiente.';
   if(s?.checked_at&&Date.now()-Date.parse(s.checked_at)>18*3600000)$('newsStatus').textContent+=' La revisión lleva más de 18 horas sin actualizarse.';
  }catch{if(g===generation&&active){rows=[];$('newsList').replaceChildren();$('newsDetail').replaceChildren();$('newsStatus').textContent='No se pudieron consultar las noticias. Pulsa Actualizar para reintentar.';}}
  finally{clearTimeout(timer);if(g===generation)$('newsReload').disabled=false;}
 }
 function observe(){const next=document.body.dataset.section==='news';if(next&&!active){active=true;load();}else if(!next&&active){active=false;generation++;controller?.abort();selected='';renderSelection();$('newsReload').disabled=false;}}
 $('newsReload').addEventListener('click',()=>{if(active)load();});document.addEventListener('visibilitychange',()=>{if(active&&!document.hidden)load();});new MutationObserver(observe).observe(document.body,{attributes:true,attributeFilter:['data-section']});observe();
})();
