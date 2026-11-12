/* Public club news and explicit, player-specific health observations. */
(() => {
 'use strict';
 const labels={doubt:'En duda',injured:'Lesionado',available:'Disponible'};
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 const date=s=>s!=null&&Number.isFinite(new Date(s).getTime())?new Intl.DateTimeFormat('es',{dateStyle:'short',timeStyle:'short',timeZone:'America/New_York'}).format(new Date(s))+' Miami':'';
 const safeUrl=s=>{try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
 function validRow(r){const p=r?.payload;return r?.visible!==false&&p?.season==='2026-27'&&typeof r.key==='string'&&typeof p.team==='string'&&typeof p.title==='string'&&typeof p.summary==='string'&&Array.isArray(p.players)&&p.players.every(x=>x&&typeof x.id==='string'&&typeof x.name==='string')&&Array.isArray(p.sources)&&p.sources.length>0&&p.sources.every(s=>s&&typeof s.name==='string'&&safeUrl(s.url));}
 async function load(signal){
  const c=window.CUBAN_LEAGUE_SUPABASE;if(!c?.url||!c.publishableKey)throw Error('Noticias no disponibles');
  const rows=[];
  // Read every visible event, including older injuries. Never cache a withdrawn event.
  for(let offset=0;offset<2000;offset+=100){
   const u=new URL(c.url+'/rest/v1/news_public');u.search=new URLSearchParams({select:'key,payload,published_at,updated_at,visible',visible:'eq.true',order:'updated_at.desc,key.asc',limit:'100',offset:String(offset)});
   const response=await fetch(u,{headers:{apikey:c.publishableKey},cache:'no-store',signal});if(!response.ok)throw Error('Noticias no disponibles');
   const page=await response.json();if(!Array.isArray(page)||page.some(r=>!validRow(r)))throw Error('Noticias incompletas');rows.push(...page);if(page.length<100)return rows;
  }
  throw Error('La consulta de noticias está incompleta');
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
  const p=row.payload,box=el('details',null,'fc-story');box.append(el('summary',p.title));if(p.certainty==='rumor')box.append(el('strong','Rumor','fc-story-tag'));box.append(el('p',p.summary));
  if(p.impact)box.append(el('p',p.impact,'fc-impact'));
  const links=el('div',null,'fc-sources');for(const s of p.sources){const a=el('a',s.name);a.href=safeUrl(s.url);a.target='_blank';a.rel='noopener noreferrer';links.append(a);}
  box.append(links,el('small','Información: '+p.sources.map(s=>s.published_label||date(s.published_at)||'Fecha no indicada').filter((x,i,a)=>a.indexOf(x)===i).join(' · ')));return box;
 }
 function create(team,rows,catalog,unavailable=false){
  const clubRows=rows.filter(r=>validRow(r)&&r.payload.team===team).sort((a,b)=>Date.parse(b.updated_at)-Date.parse(a.updated_at));
  const playerRows=id=>clubRows.filter(r=>r.payload.players.some(p=>p.id===id));
  return {
   rosterAvailable:Array.isArray(catalog?.players),
   roster:(catalog?.players||[]).filter(p=>p.active&&p.clubId===team).map(p=>({id:p.id,name:p.displayName,position:p.position})),
   badge(player){const h=health(clubRows,player.id);if(!h||h.status==='available')return null;const b=el('span',h.status==='injured'?'+':'?','fc-health '+h.status);b.title=labels[h.status]+' · Información del '+h.event_date.split('-').reverse().join('/');b.setAttribute('role','img');b.setAttribute('aria-label',labels[h.status]);return b;},
   detail(player){const box=el('section',null,'fc-player-context'),h=health(clubRows,player.id),related=playerRows(player.id);box.append(el('h4','Su situación'));
    if(unavailable){box.append(el('p','No se pudieron cargar las noticias. Pulsa Actualizar.'));return box;}
    if(h){box.append(el('strong',labels[h.status],'fc-health-label '+h.status),el('p',h.detail),el('small','Información del '+h.event_date.split('-').reverse().join('/')+' · Revisada: '+date(Math.max(...h.row.payload.sources.map(s=>Date.parse(s.fetched_at))))));}
    else if(!related.length)box.append(el('p','Sin novedades publicadas.'));
    else box.append(el('p','Últimas noticias del jugador.'));
    const shown=related.slice(0,5);if(h&&!shown.includes(h.row))shown.push(h.row);
    for(const [i,row] of shown.entries()){const item=story(row);if(i===0&&!h)item.open=true;box.append(item);}return box;
   },
   renderClub(host){const box=el('section',null,'fc-club-news');box.append(el('h3','Noticias del equipo'));
    if(unavailable)box.append(el('p','No se pudieron cargar las noticias. Pulsa Actualizar.'));
    else if(!clubRows.length)box.append(el('p','Sin noticias publicadas por ahora.'));
    else {for(const row of clubRows.slice(0,5))box.append(story(row));if(clubRows.length>5){const more=el('details',null,'fc-more');more.append(el('summary','Ver '+(clubRows.length-5)+' noticias anteriores'));for(const row of clubRows.slice(5))more.append(story(row));box.append(more);}}
    host.append(box);
   }
  };
 }
 window.CubanForecastContext={load,create,health,validRow};
})();
