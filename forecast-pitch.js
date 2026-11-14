/* Shared renderer: public page and admin preview use exactly the same component. */
(() => {
  'use strict';
  const core=window.CubanForecastPublishCore;
  let sheetSequence=0;
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
  function sourceSummary(player,sources){
    if(!Array.isArray(player.source_summary)||player.source_summary.length>4||new Set(player.source_summary.map(s=>s?.id)).size!==player.source_summary.length)return null;
    const names={futbolfantasy:'FutbolFantasy',comuniate:'Comuniate',jornadaperfecta:'Jornada Perfecta',predicted11:'Predicted11'};
    const list=el('ul',null,'fp-source-list');
    for(const id of Object.keys(names)){
      const s=player.source_summary.find(s=>s?.id===id),source=sources.find(s=>s.id===id);if(!s||!source)continue;
      let message,value,hint;
      if(id==='predicted11'){
        if(s.probability!==null||s.ballots!==source.ballots||!Number.isInteger(s.ballots)||s.ballots<0||s.ballots>14)continue;
        if(s.ballots===0&&s.prediction==='not_available'&&s.votes===null){message='Sin onces completos disponibles en esta lectura.';value='Sin onces';hint='No aporta al cálculo';}
        else if(s.ballots>0&&s.prediction==='consensus'&&Number.isInteger(s.votes)&&s.votes>=0&&s.votes<=s.ballots){message='Aparece en '+s.votes+' de '+s.ballots+' onces completos.';value=s.votes+' de '+s.ballots;hint='onces completos';}
        else continue;
      }else{
        if(!['starter','alternative','not_listed'].includes(s.prediction)||(s.probability!==null&&(!Number.isInteger(s.probability)||s.probability<0||s.probability>100)))continue;
        const signal={starter:'Lo incluye en el once',alternative:'Lo propone como alternativa',not_listed:'No figura en su propuesta'}[s.prediction];
        message=s.probability===null?signal+'.':s.probability+'% de titularidad. '+signal+'.';
        const short={starter:'En el once',alternative:'Alternativa',not_listed:'No figura'}[s.prediction];
        value=s.probability===null?short:s.probability+'%';
        hint=s.probability===null?(s.prediction==='not_listed'?'En esta propuesta':'Sin porcentaje publicado'):short;
      }
      const item=el('li'),mark=el('span',({futbolfantasy:'FF',comuniate:'C',jornadaperfecta:'JP',predicted11:'P11'})[id],'fp-source-mark');
      item.setAttribute('aria-label',names[id]+': '+message);mark.setAttribute('aria-hidden','true');
      const reading=el('span',null,'fp-source-reading');reading.append(el('b',value),el('small',hint));
      item.append(mark,el('strong',names[id]),reading);list.append(item);
    }
    if(!list.children.length)return null;
    const block=el('section',null,'fp-source-summary');block.append(el('h4','Qué dicen las fuentes'),list);return block;
  }
  function render(host,payload,catalog,{preview=false,publishedAt=null,playerContext=null}={}){
    const round=window.CubanForecastRoundCore,extended=[2,3,4].includes(payload?.schema_version);
    const validated=extended?round.validate(payload):core.validate(payload);
    const p=window.CubanForecastLayoutRepair?.apply(validated,{publishedAt}) || validated;host.replaceChildren();
    const estimates=new Map((p.candidates||[]).map(c=>[c.id,c]));
    const teamInfo=id=>round.config.teams.find(t=>t.id===id);
    const slotLabel=slot=>extended?round.label(p.formation,slot):core.SLOTS[slot-1];
    const shell=el('article',null,'fp-card');
    const header=el('header',null,'fp-match');
    if(preview)header.append(el('span','VISTA PREVIA · SIN PUBLICAR','fp-eyebrow'));
    header.append(el('p','LaLiga · Jornada '+(extended?p.matchday:13),'fp-meta'));
    const match=el('span',null,'fp-match-title');
    for(const [name,crest] of (extended?[p.home,p.away].map(id=>[teamInfo(id).name,id]):[['Real Madrid','real-madrid'],['Celta','celta-vigo']])){
      const team=el('span',null,'fp-match-team'),image=el('img');image.src='catalog/crests/'+crest+'.webp';image.alt='';image.width=72;image.height=84;image.decoding='async';image.addEventListener('error',()=>image.style.visibility='hidden',{once:true});team.append(image,el('span',name));
      if(match.children.length)match.append(el('span','vs','fp-versus'));match.append(team);
    }
    const title=el('h2');title.append(match);header.append(title);
    header.append(el('p',new Intl.DateTimeFormat('es',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Madrid'}).format(new Date(p.kickoff_at))+' · Madrid','fp-kickoff'));
    shell.append(header);
    const layout=el('div',null,'fp-layout'),pitch=el('div',null,'fp-pitch'),field=el('div',null,'fp-field');
    const pitchHeading=el('div',null,'fp-pitch-heading');
    pitchHeading.append(el('h3',extended?teamInfo(p.team).name:'Real Madrid'),el('span',p.formation,'fp-formation'));pitch.append(pitchHeading);
    field.setAttribute('aria-label','Once propuesto de '+(extended?teamInfo(p.team).name:'Real Madrid')+', '+p.formation);
    const markings=el('span',null,'fp-markings');markings.setAttribute('aria-hidden','true');field.append(markings);
    for(const end of ['top','bottom']){const area=el('span',null,'fp-penalty fp-penalty-'+end);area.append(el('span',null,'fp-goal-area'),el('span',null,'fp-penalty-arc'));markings.append(area);}
    // A native modal stays inside the host so lazy player context retains its lifecycle.
    // The browser owns focus isolation and releases it even if a refresh removes the host.
    const detail=el('dialog',null,'fp-detail');detail.hidden=true;detail.tabIndex=-1;
    const titleId='fp-player-title-'+(++sheetSequence);detail.setAttribute('aria-labelledby',titleId);
    let selectedButton=null,returnScroll=null;
    function close(){
      if(!selectedButton)return;
      const button=selectedButton;if(button)button.setAttribute('aria-pressed','false');
      selectedButton=null;if(detail.open&&typeof detail.close==='function')detail.close();
      detail.removeAttribute('open');detail.hidden=true;detail.replaceChildren();detail.style.removeProperty('--fp-drag-y');layout.classList.remove('has-selection');
      if(button?.isConnected){
        button.focus({preventScroll:true});
        if(returnScroll&&(window.scrollX!==returnScroll.x||window.scrollY!==returnScroll.y))window.scrollTo({left:returnScroll.x,top:returnScroll.y,behavior:'instant'});
      }
      returnScroll=null;
    }
    detail.addEventListener('cancel',event=>{event.preventDefault();close();});
    detail.addEventListener('close',()=>{if(!detail.open)close();});
    detail.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();close();}
      if(event.key==='Tab'){
        const controls=[...detail.querySelectorAll('button:not([disabled]),a[href],summary,[tabindex="0"]')].filter(node=>{
          const folded=node.closest('details:not([open])');return !folded||folded.querySelector('summary')===node;
        });
        const first=controls[0],last=controls[controls.length-1];
        if(event.shiftKey&&(document.activeElement===first||document.activeElement===detail)){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    });
    let backdropDown=false;
    const outside=event=>{const r=detail.getBoundingClientRect();return event.target===detail&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom);};
    detail.addEventListener('pointerdown',event=>{backdropDown=outside(event);});
    detail.addEventListener('click',event=>{if(backdropDown&&outside(event))close();backdropDown=false;});
    function show(player,button){
      if(selectedButton===button){close();return;}
      if(!selectedButton)returnScroll={x:window.scrollX,y:window.scrollY};
      if(selectedButton)selectedButton.setAttribute('aria-pressed','false');selectedButton=button;button.setAttribute('aria-pressed','true');
      detail.hidden=false;layout.classList.add('has-selection');
      const toolbar=el('div',null,'fp-sheet-toolbar'),grip=el('button',null,'fp-sheet-grip'),dismiss=el('button','×','fp-sheet-close');
      grip.type=dismiss.type='button';grip.setAttribute('aria-label','Cerrar ficha del jugador');dismiss.setAttribute('aria-label','Cerrar ficha');
      grip.append(el('span'));grip.addEventListener('click',close);dismiss.addEventListener('click',close);
      let drag=null;
      grip.addEventListener('pointerdown',event=>{if(event.button!==0)return;drag={x:event.clientX,y:event.clientY};grip.setPointerCapture?.(event.pointerId);});
      grip.addEventListener('pointermove',event=>{if(drag)detail.style.setProperty('--fp-drag-y',Math.min(140,Math.max(0,event.clientY-drag.y))+'px');});
      grip.addEventListener('pointerup',event=>{if(drag&&event.clientY-drag.y>60&&Math.abs(event.clientX-drag.x)<80)close();drag=null;detail.style.removeProperty('--fp-drag-y');});
      grip.addEventListener('pointercancel',()=>{drag=null;detail.style.removeProperty('--fp-drag-y');});
      toolbar.append(grip,dismiss);
      const hero=el('header',null,'fp-detail-hero'),identity=el('div',null,'fp-detail-identity'),name=el('h3',player.name);
      name.id=titleId;
      identity.append(el('span','EL JUGADOR','fp-eyebrow'),name,el('p',player.slot?slotLabel(player.slot):({PT:'Portero',DF:'Defensa',MC:'Centrocampista',DL:'Delantero'}[player.position]||''),'fp-detail-position'));
      const club=extended?teamInfo(p.team):{name:'Real Madrid',crest:'catalog/crests/real-madrid.webp'},clubLine=el('p',null,'fp-detail-club'),crest=el('img');
      crest.src=club.crest;crest.alt='';crest.width=18;crest.height=22;crest.addEventListener('error',()=>crest.remove(),{once:true});clubLine.append(crest,el('span',club.name));identity.append(clubLine);
      if(Number.isInteger(player.probability)){
        const metric=el('div',null,'fp-detail-prob');metric.append(el('b',player.probability+'%'),el('span',' de titularidad estimada'));identity.append(metric);
      }
      hero.append(identity,portrait(player,catalog));detail.replaceChildren(toolbar,hero);
      if(Number.isInteger(player.probability)){
        const summary=sourceSummary(player,p.sources);
        if(summary)detail.append(summary);
        if(!summary||player.reason!=='Estimación de titularidad según las fuentes y votos observados.')detail.append(el('p',player.reason,'fp-detail-reason'));
      }
      if(playerContext)detail.append(playerContext.detail(player));
      if(player.alternative){
        const a=el('section',null,'fp-alternative');a.append(el('h4','Alternativa'));
        const pair=el('div',null,'fp-alternative-pair');
        for(const person of [player,{...player.alternative,...estimates.get(player.alternative.id)}]){
          const side=el('div',null,'fp-alternative-player'),copy=el('div',null,'fp-alternative-copy');
          copy.append(el('b',person.name));if(Number.isInteger(person.probability))copy.append(el('strong',person.probability+'%'));
          else copy.append(el('small','Sin estimación'));
          side.append(portrait(person,catalog),copy);if(pair.children.length){const swap=el('span','↔','fp-alternative-arrow');swap.setAttribute('aria-hidden','true');pair.append(swap);}pair.append(side);
        }
        a.append(pair,el('small','Estimaciones individuales de titularidad.','fp-meta'));detail.append(a);
      }
      if(Number.isInteger(player.probability)){
        const method=el('details',null,'fp-detail-method');method.append(el('summary','Cómo se calcula'));
        method.append(el('p','Peso en el cálculo: '+(['editorial-v3','editorial-v4','editorial-v5'].includes(player.method)?(p.sources.find(s=>s.id==='predicted11')?.ballots>0?'Predicted11 30% · FutbolFantasy 30% · Jornada Perfecta 20% · Comuniate 20%.':'Sin onces completos de Predicted11: FutbolFantasy 42,86% · Jornada Perfecta 28,57% · Comuniate 28,57%.'):player.method==='editorial-v2'?'Fuentes 80% · Rol 20% · Ajustes por contexto.':player.method==='editorial-v1'?'Método editorial v1.':'Revisión editorial manual.'),'fp-meta'));
        method.append(el('p','Lectura más antigua: '+date(p.evidence_at),'fp-meta'));detail.append(method,el('small','Estimación editorial provisional.','fp-detail-note'));
      }
      const footer=el('div',null,'fp-sheet-footer'),back=el('button',player.slot?'Volver al campo':'Volver a la plantilla','fp-link');back.type='button';back.addEventListener('click',close);footer.append(back);detail.append(footer);
      if(!detail.open){if(typeof detail.showModal==='function')detail.showModal();else{detail.setAttribute('open','');detail.setAttribute('role','dialog');detail.setAttribute('aria-modal','true');}}
      detail.scrollTop=0;detail.focus({preventScroll:true});
    }
    for(const slots of (extended?round.lines(p.formation).reverse():[[11],[8,9,10],[6,7],[2,3,4,5],[1]])){
      const row=el('div',null,'fp-line');
      for(const slot of slots){
        const player=p.players.find(x=>x.slot===slot),button=el('button',null,'fp-player'+(player.probability<70?' fp-uncertain':''));
        button.type='button';button.setAttribute('data-player-id',player.id);button.setAttribute('aria-pressed','false');
        button.setAttribute('aria-label',player.name+', '+slotLabel(slot)+', '+player.probability+' por ciento. Ver explicación.');
        button.append(portrait(player,catalog),el('span',player.name,'fp-name'),el('b',player.probability+'%','fp-prob'));
        const badge=playerContext?.badge(player);if(badge){button.append(badge);button.setAttribute('aria-label',button.getAttribute('aria-label')+' '+badge.getAttribute('aria-label')+'.');}
        if(player.alternative)button.append(el('small','Alt. '+player.alternative.name+(estimates.has(player.alternative.id)?' · '+estimates.get(player.alternative.id).probability+'%':''),'fp-alt-name'));
        button.addEventListener('click',()=>show(player,button));row.append(button);
      }
      field.append(row);
    }
    pitch.append(field);layout.append(pitch,detail);shell.append(layout);
    if(playerContext||estimates.size){
      const squad=el('section',null,'fp-squad');squad.append(el('h3','Resto de la plantilla'),el('p','Jugadores fuera del once previsto. Toca su foto para ver su situación.'));
      const roster=playerContext?.roster||catalog?.players?.filter(x=>x.active&&x.clubId===p.team).map(x=>({id:x.id,name:x.displayName,position:x.position}))||[];
      const others=roster.filter(x=>!p.players.some(y=>y.id===x.id)).map(x=>({...x,...estimates.get(x.id)}));
      if(!(playerContext?playerContext.rosterAvailable:Array.isArray(catalog?.players)))squad.append(el('p','No se pudo cargar la plantilla. Pulsa Actualizar.'));
      else if(!others.length)squad.append(el('p','No hay más jugadores en la plantilla.'));
      for(const [position,label] of [['PT','Porteros'],['DF','Defensas'],['MC','Centrocampistas'],['DL','Delanteros']]){
        const group=others.filter(x=>x.position===position);if(!group.length)continue;
        squad.append(el('h4',label));const line=el('div',null,'fp-reserves');
        for(const player of group){const b=el('button',null,'fp-reserve');b.type='button';b.setAttribute('data-player-id',player.id);b.setAttribute('aria-pressed','false');b.setAttribute('aria-label',player.name+'. Ver situación');b.append(portrait(player,catalog),el('span',player.name,'fp-name'));if(Number.isInteger(player.probability)){b.classList.toggle('fp-uncertain',player.probability<70);b.append(el('b',player.probability+'%','fp-prob'));b.setAttribute('aria-label',player.name+', '+player.probability+' por ciento de titularidad. Ver explicación');}const badge=playerContext?.badge(player);if(badge){b.append(badge);b.setAttribute('aria-label',b.getAttribute('aria-label')+'. '+badge.getAttribute('aria-label')+'.');}b.addEventListener('click',()=>show(player,b));line.append(b);}squad.append(line);
      }
      const legend=el('div',null,'fp-squad-legend');legend.append(el('span','? En duda','doubt'),el('span','+ Lesionado','injured'));squad.append(legend);shell.append(squad);
    }
    const footer=el('div',null,'fp-evidence');const context=el('details',null,'fp-context');context.append(el('summary','Criterio y contexto del once'),el('p',p.note));footer.append(context);
    context.append(el('p',core.freshness(p),'fp-meta'));
    context.append(el('p','Porcentajes editoriales provisionales, aún no calibrados. Se refieren a salir de titular.','fp-meta'));
    context.append(el('p','Lectura más antigua: '+date(p.evidence_at)+(publishedAt?' · Publicado: '+date(publishedAt):''),'fp-meta'));
    const sources=el('details');sources.append(el('summary','Fuentes y fechas de consulta'));
    for(const s of p.sources){const block=el('p'),a=el('a',s.id);a.href=extended?round.sourceUrl(s):core.sourceUrl(s);a.target='_blank';a.rel='noopener noreferrer';block.append(a,el('span',' · Consultada: '+date(s.fetched_at)+' · Actualización de la fuente: '+date(s.source_updated_at)));if(s.id==='predicted11')block.append(el('span',s.ballots>0?' · '+s.ballots+' onces completos de autores únicos':' · Sin pronósticos utilizables; no aporta al cálculo'));sources.append(block);}
    sources.append(el('p','Consultar una fuente no confirma cuándo fue actualizada. Las posiciones representan esta propuesta táctica.','fp-meta'));footer.append(sources);shell.append(footer);host.append(shell);
  }
  window.CubanForecastPitch={render,date};
})();
