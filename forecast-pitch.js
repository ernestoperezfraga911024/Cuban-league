/* Shared renderer: public page and admin preview use exactly the same component. */
(() => {
  'use strict';
  const core=window.CubanForecastPublishCore;
  function el(tag,text,cls){const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;}
  function date(value){return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('es',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Madrid'}).format(new Date(value))+' · Madrid':'No consta';}
  function portrait(player,catalog){
    const frame=el('span',null,'fp-portrait');frame.setAttribute('aria-hidden','true');
    const fallback=el('span',player.name.split(/\s+/).slice(0,2).map(s=>s[0]).join(''),'fp-initials');frame.append(fallback);
    // Identity-based lookup only: never use a URL from a publication payload.
    const photo=catalog?.playersById?.get(player.id)?.photo;
    if(photo && (/^catalog\/faces\/[a-z0-9-]+\.webp$/.test(photo)||/^https:\/\/cdn-mister\.mundodeportivo\.com\/file\/cdn-common\/players\/\d+\.png(?:\?version=\d+)?$/.test(photo))){
      const img=el('img');img.alt='';img.width=96;img.height=96;img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';
      img.addEventListener('load',()=>{fallback.hidden=true;});img.addEventListener('error',()=>{img.remove();fallback.hidden=false;},{once:true});img.src=photo;frame.append(img);
    }
    return frame;
  }
  function render(host,payload,catalog,{preview=false,publishedAt=null,playerContext=null}={}){
    const round=window.CubanForecastRoundCore,extended=[2,3,4].includes(payload?.schema_version);
    const p=extended?round.validate(payload):core.validate(payload);host.replaceChildren();
    const teamInfo=id=>round.config.teams.find(t=>t.id===id);
    const slotLabel=slot=>extended?round.label(p.formation,slot):core.SLOTS[slot-1];
    const shell=el('article',null,'fp-card');
    const header=el('header',null,'fp-match');
    header.append(el('span',preview?'VISTA PREVIA · SIN PUBLICAR':'CUBAN LEAGUE · PREVISIÓN EDITORIAL','fp-eyebrow'));
    const match=el('span',null,'fp-match-title');
    for(const [name,crest] of (extended?[p.home,p.away].map(id=>[teamInfo(id).name,id]):[['Real Madrid','real-madrid'],['Celta','celta-vigo']])){
      const team=el('span',null,'fp-match-team'),image=el('img');image.src='catalog/crests/'+crest+'.webp';image.alt='';image.width=24;image.height=28;image.decoding='async';image.addEventListener('error',()=>image.remove(),{once:true});team.append(image,el('span',name));
      if(match.children.length)match.append(el('span','vs','fp-versus'));match.append(team);
    }
    const title=el('h2');title.append(match);header.append(title);
    header.append(el('p',extended?'LaLiga · Jornada '+p.matchday+' · '+teamInfo(p.team).name:'LaLiga · Jornada 13 · Bernabéu','fp-meta'),el('p',date(p.kickoff_at),'fp-kickoff'));
    const status=el('p',core.freshness(p),'fp-notice');header.append(status);
    shell.append(header);
    const layout=el('div',null,'fp-layout'), field=el('div',null,'fp-field');
    field.setAttribute('aria-label','Once propuesto de '+(extended?teamInfo(p.team).name:'Real Madrid')+', '+p.formation);
    field.append(el('span',p.formation,'fp-formation'));
    const markings=el('span',null,'fp-markings');markings.setAttribute('aria-hidden','true');field.append(markings);
    const detail=el('section',null,'fp-detail');detail.tabIndex=-1;detail.setAttribute('aria-live','polite');
    let selectedButton=null;
    function show(player,button,moveFocus=true){
      if(selectedButton)selectedButton.setAttribute('aria-pressed','false');selectedButton=button;button.setAttribute('aria-pressed','true');
      detail.replaceChildren(el('span','EL JUGADOR','fp-eyebrow'),portrait(player,catalog),el('h3',player.name),el('p',player.slot?slotLabel(player.slot):({PT:'Portero',DF:'Defensa',MC:'Centrocampista',DL:'Delantero'}[player.position]||''),'fp-meta'));
      if(player.slot)detail.append(el('b',player.probability+'% de titularidad estimada','fp-detail-prob'),el('p',player.reason));
      if(playerContext)detail.append(playerContext.detail(player));
      if(player.alternative){const a=el('div',null,'fp-alternative');a.append(portrait(player.alternative,catalog),el('span','Alternativa: '+player.alternative.name));detail.append(a);}
      if(player.slot)detail.append(el('p',player.method==='editorial-v3'?(p.sources.find(s=>s.id==='predicted11')?.ballots>0?'Predicted11 30% · FutbolFantasy 30% · Jornada Perfecta 20% · Comuniate 20%.':'Sin onces completos de Predicted11: FutbolFantasy 42,86% · Jornada Perfecta 28,57% · Comuniate 28,57%.'):player.method==='editorial-v2'?'Fuentes 80% · Rol 20% · Ajustes por contexto.':player.method==='editorial-v1'?'Método editorial v1.':'Revisión editorial manual.','fp-meta'));
      if(player.slot)detail.append(el('small','Estimación editorial provisional.','fp-meta'));
      if(moveFocus){const back=el('button',player.slot?'Volver al campo':'Volver a la plantilla','fp-link');back.type='button';back.addEventListener('click',()=>button.focus());detail.append(back);detail.focus({preventScroll:true});try{detail.scrollIntoView?.({block:'nearest',behavior:'auto'});}catch{/* Cosmetic only. */}}
    }
    let first=null;
    for(const slots of (extended?round.lines(p.formation).reverse():[[11],[8,9,10],[6,7],[2,3,4,5],[1]])){
      const row=el('div',null,'fp-line');
      for(const slot of slots){
        const player=p.players.find(x=>x.slot===slot),button=el('button',null,'fp-player'+(player.probability<70?' fp-uncertain':''));
        button.type='button';button.setAttribute('data-player-id',player.id);button.setAttribute('aria-pressed','false');
        button.setAttribute('aria-label',player.name+', '+slotLabel(slot)+', '+player.probability+' por ciento. Ver explicación.');
        button.append(portrait(player,catalog),el('span',player.name,'fp-name'),el('b',player.probability+'%','fp-prob'));
        const badge=playerContext?.badge(player);if(badge){button.append(badge);button.setAttribute('aria-label',button.getAttribute('aria-label')+' '+badge.getAttribute('aria-label')+'.');}
        if(player.alternative)button.append(el('small','Alt. '+player.alternative.name,'fp-alt-name'));
        button.addEventListener('click',()=>show(player,button));row.append(button);if(!first)first={player,button};
      }
      field.append(row);
    }
    show(first.player,first.button,false);layout.append(field,detail);shell.append(layout);
    if(playerContext){
      const squad=el('section',null,'fp-squad');squad.append(el('h3','Resto de la plantilla'),el('p','Jugadores fuera del once previsto. Toca su foto para ver su situación.'));
      const others=playerContext.roster.filter(x=>!p.players.some(y=>y.id===x.id));
      if(!playerContext.rosterAvailable)squad.append(el('p','No se pudo cargar la plantilla. Pulsa Actualizar.'));
      else if(!others.length)squad.append(el('p','No hay más jugadores en la plantilla.'));
      for(const [position,label] of [['PT','Porteros'],['DF','Defensas'],['MC','Centrocampistas'],['DL','Delanteros']]){
        const group=others.filter(x=>x.position===position);if(!group.length)continue;
        squad.append(el('h4',label));const line=el('div',null,'fp-reserves');
        for(const player of group){const b=el('button',null,'fp-reserve');b.type='button';b.setAttribute('data-player-id',player.id);b.setAttribute('aria-pressed','false');b.setAttribute('aria-label',player.name+'. Ver situación');b.append(portrait(player,catalog),el('span',player.name,'fp-name'));const badge=playerContext.badge(player);if(badge){b.append(badge);b.setAttribute('aria-label',player.name+'. '+badge.getAttribute('aria-label')+'. Ver situación');}b.addEventListener('click',()=>show(player,b));line.append(b);}squad.append(line);
      }
      const legend=el('div',null,'fp-squad-legend');legend.append(el('span','? En duda','doubt'),el('span','+ Lesionado','injured'));squad.append(legend);shell.append(squad);
    }
    const footer=el('div',null,'fp-evidence');const context=el('details',null,'fp-context');context.append(el('summary','Criterio y contexto del once'),el('p',p.note));footer.append(context);
    context.append(el('p','Porcentajes editoriales provisionales, aún no calibrados. Se refieren a salir de titular.','fp-meta'));
    context.append(el('p','Lectura más antigua: '+date(p.evidence_at)+(publishedAt?' · Publicado: '+date(publishedAt):''),'fp-meta'));
    const sources=el('details');sources.append(el('summary','Fuentes y fechas de consulta'));
    for(const s of p.sources){const block=el('p'),a=el('a',s.id);a.href=extended?round.sourceUrl(s):core.sourceUrl(s);a.target='_blank';a.rel='noopener noreferrer';block.append(a,el('span',' · Consultada: '+date(s.fetched_at)+' · Actualización de la fuente: '+date(s.source_updated_at)));if(s.id==='predicted11')block.append(el('span',s.ballots>0?' · '+s.ballots+' onces completos de autores únicos':' · Sin pronósticos utilizables; no aporta al cálculo'));sources.append(block);}
    sources.append(el('p','Consultar una fuente no confirma cuándo fue actualizada. Las posiciones representan esta propuesta táctica.','fp-meta'));footer.append(sources);shell.append(footer);host.append(shell);
  }
  window.CubanForecastPitch={render,date};
})();
