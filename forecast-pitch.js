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
  function render(host,payload,catalog,{preview=false,publishedAt=null}={}){
    const p=core.validate(payload);host.replaceChildren();
    const shell=el('article',null,'fp-card');
    const header=el('header',null,'fp-match');
    header.append(el('span',preview?'VISTA PREVIA · SIN PUBLICAR':'CUBAN LEAGUE · PREVISIÓN EDITORIAL','fp-eyebrow'));
    const match=el('span',null,'fp-match-title');
    for(const [name,crest] of [['Real Madrid','real-madrid'],['Celta','celta-vigo']]){
      const team=el('span',null,'fp-match-team'),image=el('img');image.src='catalog/crests/'+crest+'.webp';image.alt='';image.width=24;image.height=28;image.decoding='async';image.addEventListener('error',()=>image.remove(),{once:true});team.append(image,el('span',name));
      if(match.children.length)match.append(el('span','vs','fp-versus'));match.append(team);
    }
    const title=el('h2');title.append(match);header.append(title);
    header.append(el('p','LaLiga · Jornada 13 · Bernabéu','fp-meta'),el('p',date(p.kickoff_at),'fp-kickoff'));
    const status=el('p',core.freshness(p),'fp-notice');header.append(status);
    shell.append(header);
    const layout=el('div',null,'fp-layout'), field=el('div',null,'fp-field');
    field.setAttribute('aria-label','Once propuesto del Real Madrid, 4-2-3-1');
    field.append(el('span','4–2–3–1','fp-formation'));
    const markings=el('span',null,'fp-markings');markings.setAttribute('aria-hidden','true');field.append(markings);
    const detail=el('section',null,'fp-detail');detail.tabIndex=-1;detail.setAttribute('aria-live','polite');
    let selectedButton=null;
    function show(player,button,moveFocus=true){
      if(selectedButton)selectedButton.setAttribute('aria-pressed','false');selectedButton=button;button.setAttribute('aria-pressed','true');
      detail.replaceChildren(el('span','LA DECISIÓN','fp-eyebrow'),portrait(player,catalog),el('h3',player.name),el('p',core.SLOTS[player.slot-1],'fp-meta'),el('b',player.probability+'% de titularidad estimada','fp-detail-prob'),el('p',player.reason));
      if(player.alternative){const a=el('div',null,'fp-alternative');a.append(portrait(player.alternative,catalog),el('span','Alternativa: '+player.alternative.name));detail.append(a);}
      detail.append(el('p',player.method==='editorial-v2'?'Fuentes 80% · Rol 20% · Ajustes por contexto.':player.method==='editorial-v1'?'Método editorial v1.':'Revisión editorial manual.','fp-meta'));
      detail.append(el('p','Estimación provisional no calibrada. No mide minutos ni garantiza que juegue.','fp-meta'));
      if(moveFocus){const back=el('button','Volver al campo','fp-link');back.type='button';back.addEventListener('click',()=>button.focus());detail.append(back);detail.focus({preventScroll:true});try{detail.scrollIntoView?.({block:'nearest',behavior:'auto'});}catch{/* Cosmetic only. */}}
    }
    let first=null;
    for(const slots of [[11],[8,9,10],[6,7],[2,3,4,5],[1]]){
      const row=el('div',null,'fp-line');
      for(const slot of slots){
        const player=p.players.find(x=>x.slot===slot),button=el('button',null,'fp-player'+(player.probability<70?' fp-uncertain':''));
        button.type='button';button.setAttribute('aria-pressed','false');
        button.setAttribute('aria-label',player.name+', '+core.SLOTS[slot-1]+', '+player.probability+' por ciento. Ver explicación.');
        button.append(portrait(player,catalog),el('span',player.name,'fp-name'),el('b',player.probability+'%','fp-prob'));
        if(player.alternative)button.append(el('small','↳ '+player.alternative.name,'fp-alt-name'));
        button.addEventListener('click',()=>show(player,button));row.append(button);if(!first)first={player,button};
      }
      field.append(row);
    }
    show(first.player,first.button,false);layout.append(field,detail);shell.append(layout);
    const footer=el('div',null,'fp-evidence');const context=el('details',null,'fp-context');context.append(el('summary','Criterio y contexto del once'),el('p',p.note));footer.append(context);
    context.append(el('p','Estimaciones editoriales no calibradas. Las tres fuentes orientan el cálculo; no garantizan el once ni son una votación. Los porcentajes no tienen que sumar 100 por posición.','fp-meta'));
    context.append(el('p','Lectura más antigua: '+date(p.evidence_at)+(publishedAt?' · Publicado: '+date(publishedAt):''),'fp-meta'));
    const sources=el('details');sources.append(el('summary','Fuentes y fechas de consulta'));
    for(const s of p.sources){const block=el('p'),a=el('a',s.id);a.href=core.sourceUrl(s);a.target='_blank';a.rel='noopener noreferrer';block.append(a,el('span',' · Consultada: '+date(s.fetched_at)+' · Actualización de la fuente: '+date(s.source_updated_at)));sources.append(block);}
    sources.append(el('p','Consultar una fuente no confirma cuándo fue actualizada. Las posiciones representan esta propuesta táctica.','fp-meta'));footer.append(sources);shell.append(footer);host.append(shell);
  }
  window.CubanForecastPitch={render,date};
})();
