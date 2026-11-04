/* V200: read-only club contributions, built only when the Clubes tab opens. */
(() => {
  'use strict';
  const text=value=>String(value??'').trim();
  const fold=value=>text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const number=value=>value==null||typeof value==='boolean'||text(value)===''?NaN:Number(text(value).replace(',','.'));
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const image=value=>/^https:\/\/[^\s<>"']+$/i.test(text(value))||(/^[\w./-]+$/.test(text(value))&&!text(value).includes('..')&&!text(value).startsWith('/'))?text(value):'';
  const fmt=value=>Number.isFinite(value)?new Intl.NumberFormat('es',{maximumFractionDigits:0}).format(value).replace(/^-/, '−'):'—';
  const equal=(a,b)=>Math.abs(a-b)<1e-9;
  const fresh=()=>({clubs:new Map(),published:0,analyzed:0,invalid:0,ambiguous:0,negative:0,unknownBonus:0,unknownClub:0,unknownPoints:0,emptyPoints:0,adjustments:0,unavailablePoints:0,officialPoints:0,bonus:0,postponed:new Set()});
  const bucket=(key,name,crest='')=>({key,name,crest,points:0,bonus:0,appearances:0,days:new Set(),players:new Map(),managers:new Map()});
  function build({rows=[],participants=[],season='',clubs=[],captainAdjustment,isEmpty,publishedMatchdays=[]}={}){
    const people=participants.filter(p=>p.active!==false).map(p=>({name:text(p.name),shield:image(p.shield)}));
    const names=new Set(people.map(p=>p.name));
    const byId=new Map(clubs.map(c=>[text(c.id),c]));
    const byName=new Map();
    clubs.forEach(c=>{const key=fold(c.name);byName.set(key,byName.has(key)?null:c);});
    const scopes=new Map(['',...names].map(name=>[name,[fresh(),fresh()]]));
    const days=new Set(publishedMatchdays.filter(d=>Number.isInteger(d)&&d>0));
    const grouped=new Map();
    for(const row of rows){
      const name=text(row?.participant_name),day=number(row?.matchday);
      if(!names.has(name)||!Number.isInteger(day)||day<1||row.published===false||(row.season&&row.season!==season))continue;
      days.add(day);
      const key=JSON.stringify([name,day]);
      if(!grouped.has(key))grouped.set(key,[]);
      grouped.get(key).push(row);
    }
    const targets=name=>[...scopes.get(''),...scopes.get(name)];
    const selected=[];
    for(const group of grouped.values()){
      const latest=Math.max(...group.map(r=>Date.parse(r.updated_at)||0));
      const candidates=group.filter(r=>(Date.parse(r.updated_at)||0)===latest);
      const signature=r=>JSON.stringify([r.points,r.lineup,r.negative_balance_no_score,r.has_postponed_matches]);
      if(new Set(candidates.map(signature)).size>1){targets(text(group[0].participant_name)).forEach(s=>s.ambiguous++);continue;}
      selected.push(candidates[0]);
    }
    selected.sort((a,b)=>number(a.matchday)-number(b.matchday));
    for(const row of selected){
      const name=text(row.participant_name),day=number(row.matchday),official=number(row.points);
      const all=targets(name);
      all.forEach(s=>{s.published++;if(Number.isFinite(official))s.officialPoints+=official;if(row.has_postponed_matches===true)s.postponed.add(day);});
      if(row.negative_balance_no_score===true&&official===0){all.forEach(s=>s.negative++);continue;}
      let raw=row.lineup;
      if(typeof raw==='string'){try{raw=JSON.parse(raw);}catch{raw=null;}}
      const players=Array.isArray(raw)?raw:Array.isArray(raw?.players)?raw.players:[];
      const slots=new Set(),identities=new Set();
      let valid=players.length===11&&Number.isFinite(official)&&row.negative_balance_no_score!==true;
      const normalized=players.map(p=>{
        const empty=Boolean(isEmpty?.(p)),slot=number(p?.slot_number),points=number(p?.displayed_points);
        const id=text(p?.player_id),playerName=text(p?.player_name),position=text(p?.position).toUpperCase();
        const identity=id||fold(playerName);
        if(!Number.isInteger(slot)||slot<1||slot>11||slots.has(slot)||!Number.isFinite(points)||!['PT','DF','MC','DL'].includes(position)||(!empty&&(!playerName||identities.has(identity))))valid=false;
        slots.add(slot);if(!empty)identities.add(identity);
        const captain=p?.is_captain===true||p?.is_captain==='true';
        if(empty&&captain)valid=false;
        const bonus=captain?captainAdjustment?.(p):0;
        // Only the club stored in this appearance establishes its identity.
        // The current player catalogue is never used to infer an old club.
        const storedId=text(p?.club_id),storedName=text(p?.club_name);
        const catalogClub=storedId?byId.get(storedId):byName.get(fold(storedName));
        const clubKey=storedId?`id:${storedId}`:catalogClub?`id:${text(catalogClub.id)}`:storedName?`name:${fold(storedName)}`:'';
        return {empty,points,captain,bonus:Number.isFinite(bonus)?bonus:null,key:identity,name:playerName,position,
          clubKey,clubName:storedName||catalogClub?.name||(storedId?`Club ${storedId}`:''),crest:image(catalogClub?.crest)};
      });
      if(normalized.filter(p=>p.captain).length>1)valid=false;
      if(!valid){all.forEach(s=>{s.invalid++;if(Number.isFinite(official))s.unavailablePoints+=official;});continue;}
      const total=normalized.reduce((n,p)=>n+p.points,0),knownBonus=normalized.every(p=>p.bonus!==null);
      for(let mode=0;mode<2;mode++){
        const relevant=[scopes.get('')[mode],scopes.get(name)[mode]];
        if(mode&&!knownBonus){relevant.forEach(s=>{s.unknownBonus++;s.unavailablePoints+=official;});continue;}
        relevant.forEach(s=>{s.analyzed++;s.adjustments+=official-total;});
        for(const p of normalized){
          const points=p.points-(mode?p.bonus:0);
          relevant.forEach(s=>{
            if(p.empty){s.emptyPoints+=points;return;}
            s.bonus+=p.bonus??0;
            if(!p.clubKey){s.unknownClub++;s.unknownPoints+=points;return;}
            if(!s.clubs.has(p.clubKey))s.clubs.set(p.clubKey,bucket(p.clubKey,p.clubName,p.crest));
            const c=s.clubs.get(p.clubKey);c.name=p.clubName;c.crest=p.crest||c.crest;
            c.points+=points;c.bonus+=p.bonus??0;c.appearances++;c.days.add(day);
            if(p.bonus===null)c.bonusUnknown=true;
            if(!c.players.has(p.key))c.players.set(p.key,{key:p.key,name:p.name,position:p.position,points:0,bonus:0,appearances:0,best:null});
            const player=c.players.get(p.key);player.name=p.name;player.points+=points;player.bonus+=p.bonus??0;player.appearances++;
            if(p.bonus===null)player.bonusUnknown=true;
            if(!player.best||points>player.best.points)player.best={points,day,participant:name};
            if(!c.managers.has(name))c.managers.set(name,{name,points:0,appearances:0});
            const manager=c.managers.get(name);manager.points+=points;manager.appearances++;
          });
        }
      }
    }
    return {season,people,scopes,days:[...days].sort((a,b)=>a-b)};
  }
  function select(model,{participant='',withoutBonus=false,sort='points'}={}){
    const selected=model.scopes.has(participant)?participant:'';
    const scope=model.scopes.get(selected)[withoutBonus?1:0];
    const clubs=[...scope.clubs.values()].map(c=>({...c,average:c.points/c.appearances,eligible:c.appearances>=5&&c.days.size>=3}));
    const value=c=>sort==='average'?c.average:c.points;
    clubs.sort((a,b)=>value(b)-value(a)||a.name.localeCompare(b.name,'es'));
    let rank=0;clubs.forEach((c,i)=>{if(!i||!equal(value(c),value(clubs[i-1])))rank=i+1;c.rank=rank;});
    const leaders=(records,valueFor)=>{
      if(!records.length)return [];
      const maximum=Math.max(...records.map(valueFor));return records.filter(c=>equal(valueFor(c),maximum));
    };
    const expected=model.days.length*(selected?1:model.people.length);
    return {scope,clubs,selected,expected,missing:Math.max(0,expected-scope.published-scope.ambiguous),
      partial:scope.published<expected||scope.invalid>0||scope.unknownBonus>0||scope.unknownClub>0,
      support:leaders(clubs.filter(c=>c.points>0),c=>c.points),performance:leaders(clubs.filter(c=>c.eligible),c=>c.average),used:leaders(clubs,c=>c.appearances)};
  }
  const state={season:null,participant:'',withoutBonus:false,sort:'points'};
  const contexts=new WeakMap();
  const label=items=>items.length?items.map(c=>c.name).join(' · '):'Sin muestra suficiente';
  const crest=c=>`<span class="cs-crest" aria-hidden="true">${image(c.crest)?`<img src="${escape(image(c.crest))}" loading="lazy" alt="">`:'⚽'}</span>`;
  function rowsWithMore(items,renderItem,limit=5){
    return `<ol class="cs-detail-list">${items.slice(0,limit).map(renderItem).join('')}</ol>${items.length>limit?`<details class="cs-more"><summary>Ver ${items.length-limit} más</summary><ol class="cs-detail-list" start="${limit+1}">${items.slice(limit).map(renderItem).join('')}</ol></details>`:''}`;
  }
  function detail(c,selected,withoutBonus){
    const players=[...c.players.values()].sort((a,b)=>b.points-a.points||a.name.localeCompare(b.name,'es'));
    const managers=[...c.managers.values()].sort((a,b)=>b.points-a.points||a.name.localeCompare(b.name,'es'));
    return `<div class="cs-detail-head"><b>Quién aporta los puntos</b><span>${withoutBonus?'Sin bonus':'Bonus incluido'}</span></div>${rowsWithMore(players,p=>`<li><div><b>${escape(p.name)}</b><small>${escape(p.position)} · ${p.appearances} apariciones · ${p.bonusUnknown?'Bonus no verificable':`${withoutBonus?'Bonus retirado':'Bonus'}: ${fmt(p.bonus)}`}</small><button type="button" class="cs-best" data-matchday-lineup-player="${escape(p.best.participant)}" data-matchday="${p.best.day}" aria-haspopup="dialog" aria-label="Ver alineación de ${escape(p.best.participant)} en la jornada ${p.best.day}">Mejor: J${p.best.day} · ${fmt(p.best.points)} pts${selected?'':` · ${escape(p.best.participant)}`} ↗</button></div><strong>${fmt(p.points)}<small>pts</small></strong></li>`)}
      ${!selected?`<div class="cs-detail-head"><b>Mayor aportación por participante</b></div>${rowsWithMore(managers,p=>`<li><button type="button" class="cs-manager" data-profile-player="${escape(p.name)}" aria-label="Ver perfil de ${escape(p.name)}">${escape(p.name)}<small>${p.appearances} apariciones</small></button><strong>${fmt(p.points)}<small>pts</small></strong></li>`,3)}`:''}`;
  }
  function paint(host,model,focusId){
    const view=select(model,state),s=view.scope;
    state.participant=view.selected;
    const warnings=[view.partial?'Parcial: faltan datos para completar el desglose.':'',s.postponed.size?`Provisional · Aplazados en ${[...s.postponed].sort((a,b)=>a-b).map(d=>'J'+d).join(', ')}.`:''].filter(Boolean);
    host.innerHTML=`<header class="cs-heading"><div><span>TEMPORADA ${escape(model.season)}</span><h3>De dónde vienen tus puntos</h3></div><small>${s.analyzed} XI analizados</small></header>
      <div class="cs-controls"><label>Participante<select id="clubParticipant"><option value="">Toda la liga</option>${model.people.map(p=>`<option value="${escape(p.name)}"${p.name===view.selected?' selected':''}>${escape(p.name)}</option>`).join('')}</select></label><label>Ordenar por<select id="clubSort"><option value="points"${state.sort==='points'?' selected':''}>Puntos aportados</option><option value="average"${state.sort==='average'?' selected':''}>Puntos por aparición</option></select></label><label class="cs-switch"><input id="clubNoBonus" type="checkbox"${state.withoutBonus?' checked':''}><span>Sin bonus de capitán</span></label></div>
      <p class="cs-context" role="status">${escape(view.selected||'Toda la liga')} · ${state.withoutBonus?'Sin bonus':'Bonus incluido'}${warnings.length?`<span class="cs-warning">${escape(warnings.join(' '))}</span>`:''}</p>
      ${view.clubs.length?`<div class="cs-insights"><div><span>Principal apoyo</span><b>${escape(label(view.support))}</b></div><div><span>Mejor rendimiento*</span><b>${escape(label(view.performance))}</b></div><div><span>Más utilizado</span><b>${escape(label(view.used))}</b></div></div><div class="cs-table"><div class="cs-columns"><span>Club · apariciones</span><span>Puntos</span><span>Pts/ap.</span></div>${view.clubs.map((c,i)=>`<details class="cs-club" data-club-index="${i}"><summary aria-label="${escape(c.name)}: ${fmt(c.points)} puntos, ${fmt(c.average)} por aparición. Ver futbolistas"><span class="cs-club-name"><i>${c.rank}</i>${crest(c)}<span><b>${escape(c.name)}</b><small>${c.appearances} apariciones · ${c.days.size} jornadas</small></span></span><strong>${fmt(c.points)}</strong><span class="cs-average">${fmt(c.average)}<i aria-hidden="true">⌄</i></span></summary><div class="cs-detail"></div></details>`).join('')}</div>`:`<p class="cs-empty">${model.days.length?'No hay XI completos con club identificado para esta selección.':'Todavía no hay jornadas publicadas.'}</p>`}
      <details class="cs-method"><summary>Qué se cuenta y qué queda fuera</summary><p>Una aparición es un futbolista en un XI publicado. Se conservan ceros y negativos. Los clubes son los registrados en cada jornada, no los de la plantilla actual. El promedio incluye todas las apariciones; *el destacado exige 5 apariciones en al menos 3 jornadas. Los empates comparten puesto. La mejor actuación muestra una de ellas si hay empate.</p><p>${state.withoutBonus?'Se resta solo el bonus verificable del capitán, con el redondeo de la liga.':'Los puntos incluyen el bonus del capitán.'} No se modifica ninguna clasificación. Los XI sin puntuación por saldo negativo no aportan puntos ni apariciones al análisis.</p><dl><div><dt>XI analizados</dt><dd>${s.analyzed}</dd></div><div><dt>Jornadas sin puntuar por saldo negativo</dt><dd>${s.negative}</dd></div><div><dt>XI incompletos o inválidos</dt><dd>${s.invalid}</dd></div><div><dt>Registros ausentes o ambiguos</dt><dd>${view.missing+s.ambiguous}</dd></div><div><dt>XI sin bonus verificable (excluidos en este modo)</dt><dd>${s.unknownBonus}</dd></div><div><dt>Apariciones sin club</dt><dd>${s.unknownClub}</dd></div><div><dt>Puntos sin club identificado</dt><dd>${fmt(s.unknownPoints)}</dd></div><div><dt>Penalizaciones de huecos</dt><dd>${fmt(s.emptyPoints)}</dd></div><div><dt>Ajustes: total oficial menos suma del XI</dt><dd>${fmt(s.adjustments)}</dd></div><div><dt>Puntos oficiales sin XI analizable</dt><dd>${fmt(s.unavailablePoints)}</dd></div></dl><p>Huecos, ajustes y registros no analizables nunca se atribuyen a un club. Las cifras se redondean solo al mostrar; el orden utiliza los valores exactos.</p></details>`;
    contexts.set(host,{model,view});
    if(focusId)host.querySelector(`#${focusId}`)?.focus({preventScroll:true});
  }
  function render(host,model){
    if(state.season!==model.season){state.season=model.season;state.participant='';state.withoutBonus=false;state.sort='points';}
    if(!contexts.has(host)){
      host.addEventListener('change',e=>{
        if(e.target.id==='clubParticipant')state.participant=e.target.value;
        else if(e.target.id==='clubSort')state.sort=e.target.value==='average'?'average':'points';
        else if(e.target.id==='clubNoBonus')state.withoutBonus=e.target.checked;
        else return;
        paint(host,contexts.get(host).model,e.target.id);
      });
      host.addEventListener('toggle',e=>{
        if(!e.target.matches('.cs-club')||!e.target.open)return;
        const target=e.target.querySelector('.cs-detail');if(target.childNodes.length)return;
        const {view}=contexts.get(host),club=view.clubs[Number(e.target.dataset.clubIndex)];
        if(club)target.innerHTML=detail(club,view.selected,state.withoutBonus);
      },true);
      host.addEventListener('error',e=>{if(e.target.tagName==='IMG'){e.target.hidden=true;e.target.parentNode.append('⚽');}},true);
    }
    paint(host,model);
  }
  window.CubanClubStats={build,select,render};
})();
