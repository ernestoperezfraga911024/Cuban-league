/* Isolated, lazy read. This component cannot publish or modify a forecast. */
(() => {
 'use strict';
 const core=window.CubanSetPiecesCore,teams=window.CubanForecastRoundConfig?.teams;if(!core||!teams)return;
 const FEED='https://raw.githubusercontent.com/ernestoperezfraga911024/Cuban-league/set-pieces-feed/set-pieces.json';
 let saved=null,inflight=null,readAt=0,unverified=false;
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 const date=value=>new Intl.DateTimeFormat('es',{dateStyle:'short',timeStyle:'short',timeZone:'America/New_York'}).format(new Date(value))+' Miami';
 async function request(url){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
  try{const response=await fetch(url,{cache:'no-store',credentials:'omit',signal:controller.signal});if(!response.ok)throw Error();const text=await response.text();if(text.length>150000)throw Error();return core.validate(JSON.parse(text),teams);}finally{clearTimeout(timeout);}
 }
 async function load(force=false){
  if(inflight)return inflight;if(!force&&saved&&Date.now()-readAt<300000)return saved;
  inflight=(async()=>{
   try{saved=await request(FEED);unverified=false;}
   catch{unverified=true;if(!saved)saved=await request('data/set-pieces.json');}
   readAt=Date.now();return saved;
  })();try{return await inflight;}finally{inflight=null;}
 }
 function portrait(player,catalog,team){
  const box=el('span',null,'sp-avatar'),initials=player.name.split(/\s+/).slice(0,2).map(s=>s[0]).join('');box.textContent=initials;
  const known=catalog?.playersById?.get(player.player_id);
  // Source photos and cross-club matches are never used.
  if(known?.clubId===team&&known.photo&&(/^(?:\.\/)?catalog\/[a-zA-Z0-9_./-]+$/.test(known.photo)||/^https:\/\/cdn-mister\.mundodeportivo\.com\/file\/cdn-common\/players\/\d+\.png(?:\?version=\d+)?$/.test(known.photo))){
   const image=el('img');image.src=known.photo;image.alt='';image.width=36;image.height=36;image.loading='lazy';image.decoding='async';image.addEventListener('error',()=>image.remove(),{once:true});box.append(image);
  }
  return box;
 }
 function mount(host,team,catalog){
  if(!teams.some(t=>t.id===team))return;
  const box=el('details',null,'sp-panel'),summary=el('summary'),heading=el('span'),title=el('strong','Balón parado'),sub=el('small','Penaltis y faltas');heading.append(title,sub);summary.append(heading,el('span','＋','sp-toggle'));box.append(summary);
  const body=el('div',null,'sp-body'),status=el('p','Abre para consultar los encargados.','sp-status'),content=el('div'),reload=el('button','Actualizar','sp-refresh');reload.type='button';status.setAttribute('role','status');body.append(status,content,reload);box.append(body);host.append(box);
  let rendered=false,loading=false;
  function render(data){
   content.replaceChildren();
   const roles=core.model(data,team),stale=roles.some(r=>r.stale);
   status.textContent=(unverified?'No se pudo comprobar la última publicación. Mostrando la referencia guardada. ':stale?'Una fuente está pendiente de revisión. ':'')+'Consulta: '+date(data.checked_at);
   status.classList.toggle('sp-warning',unverified||stale);
   for(const role of roles){
    const row=el('section',null,'sp-role');row.append(el('h3',role.label));
    if(role.conflict)row.append(el('p','Las fuentes difieren sobre el encargado.','sp-conflict'));
    const list=el('ul',null,'sp-players');
    for(const p of role.players){
     const li=el('li'),text=el('span',null,'sp-player-text');li.append(portrait(p,catalog,team));text.append(el('strong',p.name));
     const attribution=p.preferred?'Preferencia de Comuniate':p.sources.some(s=>s.id==='jornadaperfecta')?'Candidato habitual':'Ha lanzado según Comuniate';
     text.append(el('small',attribution));if(p.sources.length===2)text.append(el('small','Citado en ambas fuentes','sp-agreement'));li.append(text);list.append(li);
    }
    if(!role.players.length)row.append(el('p','Información pendiente.','sp-note'));else row.append(list);content.append(row);
   }
   content.append(el('p','Referencias orientativas: dependen de quién esté en el campo. Los candidatos no tienen un orden confirmado.','sp-note'));
   const sources=el('details',null,'sp-sources');sources.append(el('summary','Fuentes y fechas'));
   for(const source of data.sources){const p=el('p'),a=el('a',core.SOURCES[source.id].name);a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';p.append(a,el('span',' · Consultada: '+date(source.fetched_at)+(source.ok?'':' · Lectura pendiente')));sources.append(p);}
   sources.append(el('p','La fecha de consulta no acredita que el autor haya actualizado su lista.'));content.append(sources);
  }
  async function update(force=false){
   if(loading)return;loading=true;reload.disabled=true;status.textContent='Consultando balón parado…';
   try{const data=await load(force);if(!box.isConnected)return;render(data);rendered=true;}
   catch{if(box.isConnected)status.textContent='No se pudo consultar balón parado. Pulsa Actualizar para reintentar.';}
   finally{loading=false;reload.disabled=false;}
  }
  box.addEventListener('toggle',()=>{summary.querySelector('.sp-toggle').textContent=box.open?'−':'＋';if(box.open&&!rendered)update();});reload.addEventListener('click',()=>update(true));
 }
 window.CubanSetPieces={mount};
})();
