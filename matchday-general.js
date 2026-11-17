/* Read-only season overview. No requests, storage writes or league-rule changes. */
(function(root){
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=new Intl.NumberFormat('es',{maximumFractionDigits:2});
  const colors=['#80e6a4','#ffce73','#80cfff','#e7a3ff','#ff9a9a','#66e1d8','#c5d982','#b6b7ff','#ffc09a','#f39cce','#7ec5b7','#c6a382','#97bbef','#d5e3a6','#d6a5ae','#b0e0e6','#c4b8e4','#e4d2a5','#a9cb94','#e5b6d4'];
  function ranked(entries,value,ascending=false){
    const sorted=[...entries].sort((a,b)=>(ascending?1:-1)*(value(a)-value(b))||a.order-b.order);
    let previous,rank=0;
    return sorted.map((entry,index)=>{const score=value(entry);if(index===0||score!==previous)rank=index+1;previous=score;return {...entry,rank};});
  }
  function build({participants,rows,standings,season}){
    const people=participants.map((p,order)=>({name:p.name,photo:p.photo||'',order,color:colors[order%colors.length]}));
    const names=new Set(people.map(p=>p.name)),byDay=new Map();
    for(const row of rows){
      if(!names.has(row.participantName)||!Number.isInteger(row.matchday)||row.matchday<1||row.matchday>38)continue;
      if(!byDay.has(row.matchday))byDay.set(row.matchday,new Map());
      const map=byDay.get(row.matchday);
      // Duplicate identities are ambiguous, not extra points or extra wins.
      map.set(row.participantName,map.has(row.participantName)?null:row);
    }
    const latest=Math.max(0,...byDay.keys());
    const metrics=new Map(people.map(p=>[p.name,{...p,best:null,worst:null,wins:0,leads:0,run:0,runStart:null,bestRun:0,bestStart:null,bestEnd:null}]));
    const frames=[];let completePrefix=true,provisional=false,incomplete=false;
    for(let day=1;day<=latest;day++){
      const map=byDay.get(day)||new Map();
      const valid=[...map.values()].filter(r=>r&&typeof r.points==='number'&&Number.isFinite(r.points));
      const complete=people.length>0&&valid.length===people.length;
      completePrefix=completePrefix&&complete;
      incomplete=incomplete||!complete;
      provisional=provisional||valid.some(r=>r.hasPostponedMatches);
      const maximum=valid.length?Math.max(...valid.map(r=>r.points)):null;
      for(const row of valid){
        const m=metrics.get(row.participantName);
        for(const [key,better] of [['best',(a,b)=>a>b],['worst',(a,b)=>a<b]]){
          if(!m[key]||better(row.points,m[key].points))m[key]={points:row.points,days:[day]};
          else if(row.points===m[key].points)m[key].days.push(day);
        }
        if(row.points===maximum)m.wins++;
      }
      // Reuse the official comparator/accumulation supplied by the application.
      // Missing rounds never become zero or a fabricated cumulative leader.
      const table=completePrefix?standings(day).map(p=>({name:p.name,position:p.position,points:p.points})):[];
      const leader=table.find(p=>p.position===1)?.name;
      for(const m of metrics.values()){
        if(m.name===leader){
          m.leads++;if(m.run===0)m.runStart=day;m.run++;
          if(m.run>m.bestRun){m.bestRun=m.run;m.bestStart=m.runStart;m.bestEnd=day;}
        }else{m.run=0;m.runStart=null;}
      }
      frames.push({day,table,complete:completePrefix,provisional});
    }
    const all=[...metrics.values()];
    return {season,people,frames,latest,provisional,incomplete,
      best:ranked(all.filter(p=>p.best),p=>p.best.points),
      worst:ranked(all.filter(p=>p.worst),p=>p.worst.points,true),
      wins:ranked(all.filter(p=>p.wins>0),p=>p.wins),
      leads:ranked(all.filter(p=>p.leads>0),p=>p.leads),
      streaks:ranked(all.filter(p=>p.bestRun>0),p=>p.bestRun),
      active:all.find(p=>p.run>0)||null};
  }
  let host=null,model=null;
  const $=selector=>host?.querySelector(selector);
  function photo(p){
    const src=/^(https:\/\/|[a-z0-9][a-z0-9_.\/-]*$)/i.test(p.photo)?p.photo:'';
    return `<span class="mg-avatar"><span aria-hidden="true">${escape(p.name.slice(0,1))}</span>${src?`<img src="${escape(src)}" loading="lazy" decoding="async" alt="">`:''}</span>`;
  }
  const dates=days=>days.map(day=>`J${day}`).join(' · ');
  const scoreOf=(p,kind)=>kind==='best'||kind==='worst'?p[kind].points:kind==='streaks'?p.bestRun:p[kind];
  const detailOf=(p,kind)=>kind==='best'||kind==='worst'?dates(p[kind].days):kind==='streaks'?(p.bestStart===p.bestEnd?`J${p.bestStart}`:`J${p.bestStart}–J${p.bestEnd}`):'';
  function trigger(p,kind){
    const record=kind==='best'||kind==='worst'?p[kind]:null;
    return record?`data-matchday-lineup-player="${escape(p.name)}" data-matchday="${record.days[0]}" aria-label="Ver alineación de ${escape(p.name)} en J${record.days[0]}"`:`data-profile-player="${escape(p.name)}" aria-label="Ver perfil de ${escape(p.name)}"`;
  }
  // Both points charts share a zero-based scale, extended for real negative scores.
  function pointsScale(){
    const values=[...model.best.map(p=>p.best.points),...model.worst.map(p=>p.worst.points)];
    const low=Math.min(0,...values),high=Math.max(100,...values),raw=(high-low)/3;
    const magnitude=10**Math.floor(Math.log10(raw));
    const step=[1,2,5,10].map(n=>n*magnitude).find(n=>n>=raw);
    const min=Math.floor(low/step)*step,max=Math.ceil(high/step)*step;
    const ticks=[];for(let n=min;n<=max;n+=step)ticks.push(n);
    return {min,max,ticks};
  }
  const position=(value,scale)=>(value-scale.min)/(scale.max-scale.min)*100;
  function axis(scale){
    return `<div class="mg-axis" aria-hidden="true">${scale.ticks.map(value=>`<span style="--mg-pos:${position(value,scale)}%">${number.format(value)}</span>`).join('')}</div>`;
  }
  function bar(value,scale){
    const zero=position(0,scale),end=position(value,scale);
    return `<span class="mg-track" aria-hidden="true" style="--mg-zero:${zero}%;--mg-start:${Math.min(zero,end)}%;--mg-size:${Math.abs(end-zero)}%;--mg-end:${end}%"><span class="mg-zero"></span><span class="mg-bar"></span><span class="mg-dot"></span></span>`;
  }
  function icon(kind){
    return kind==='wins'?'<svg class="mg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M7 3h10v6a5 5 0 0 1-10 0V3Zm0 2H3v3a4 4 0 0 0 4 4m10-7h4v3a4 4 0 0 1-4 4M12 14v6m-4 1h8"/></svg>':'<span class="mg-icon mg-icon-bars" aria-hidden="true"><i></i><i></i><i></i></span>';
  }
  function board(title,entries,kind,tone=''){
    const top=entries.filter(p=>p.rank<=3),records=kind==='best'||kind==='worst';
    const maximum=Math.max(1,...top.map(p=>scoreOf(p,kind)));
    const step=Math.max(1,Math.ceil(maximum/4)),max=Math.ceil(maximum/step)*step;
    const scale=records?pointsScale():{min:0,max,ticks:Array.from({length:max/step+1},(_,i)=>i*step)};
    const item=p=>{
      const value=scoreOf(p,kind),detail=detailOf(p,kind);
      return `<li><span class="mg-rank">${p.rank}</span><button type="button" class="mg-person" ${trigger(p,kind)}>${photo(p)}<span><b>${escape(p.name)}</b>${detail?`<small>${detail}</small>`:''}</span></button>${bar(value,scale)}<b class="mg-value">${number.format(value)}</b></li>`;
    };
    const column=p=>{
      const value=scoreOf(p,kind),detail=detailOf(p,kind);
      return `<li class="mg-column"><div class="mg-column-plot" style="--mg-height:${position(value,scale)}%"><b class="mg-value">${number.format(value)}</b><span class="mg-column-bar" aria-hidden="true"></span></div><button type="button" class="mg-person" ${trigger(p,kind)}>${photo(p)}<span><b>${escape(p.name)}</b>${detail?`<small>${detail}</small>`:''}<small class="mg-column-rank">Puesto ${p.rank}</small></span></button></li>`;
    };
    const chart=records?`<ol class="mg-ranking">${top.slice(0,3).map(item).join('')}</ol><div class="mg-score-axis">${axis(scale)}</div>`:`<div class="mg-columns"><div class="mg-column-grid" aria-hidden="true">${scale.ticks.map(value=>`<span style="--mg-level:${position(value,scale)}%"><i>${value}</i></span>`).join('')}</div><ol>${top.slice(0,3).map(column).join('')}</ol></div>`;
    return `<section class="mg-section ${tone} mg-${kind}" aria-label="${title}"><header><h3>${icon(kind)}${title}</h3><span>${records?'Puntos':kind==='streaks'?'Seguidas':'Jornadas'}</span></header>${top.length?chart:'<p class="mg-empty">Sin registros.</p>'}${top.length>3?`<details class="mg-ties"><summary>${top.length-3} más empatados en el top 3</summary><ol class="mg-ranking">${top.slice(3).map(item).join('')}</ol></details>`:''}</section>`;
  }
  function streak(active){
    if(!active)return '<div class="mg-live"><span>Racha actual: sin cierre completo verificable.</span></div>';
    return `<div class="mg-live"><button type="button" class="mg-person" ${trigger(active,'leads')}>${photo(active)}<span><small>Racha del líder</small><b>${escape(active.name)}</b></span></button><span class="mg-live-value"><b>${active.run}</b><small>${active.run===1?'jornada seguida':'jornadas seguidas'}</small></span><div class="mg-timeline" aria-label="${active.run} ${active.run===1?'jornada consecutiva':'jornadas consecutivas'}, de J${active.runStart} a J${model.latest}"><span>J${active.runStart}</span><span class="mg-timeline-marks" aria-hidden="true">${Array.from({length:active.run},()=>'<i></i>').join('')}</span>${active.run>1?`<span>J${model.latest}</span>`:''}</div></div>`;
  }
  function render(nextHost,nextModel,status){
    if(!nextHost)return;
    if(host!==nextHost){
      host=nextHost;
      host.addEventListener('error',e=>{if(e.target.tagName==='IMG')e.target.hidden=true;},true);
    }
    if(model===nextModel&&host.firstElementChild){updateStatus(status);return;}
    model=nextModel;
    const active=model.active;
    host.innerHTML=`<div class="mg-heading"><div><span class="mg-kicker">TEMPORADA ${escape(model.season)}</span><h2>Resumen de temporada</h2></div><span class="mg-stamp">${model.latest?`J1–J${model.latest}`:'Sin jornadas'}</span></div>
      <p data-mg-status class="mg-status" role="status"></p>
      ${model.latest?`<div class="mg-sheet">
      ${streak(active)}
      <div class="mg-grid">${board('Mejores jornadas',model.best,'best','mg-best')}${board('Peores jornadas',model.worst,'worst','mg-worst')}${board('Jornadas ganadas',model.wins,'wins')}${board('Jornadas como líder',model.leads,'leads')}${board('Racha más larga de liderazgo',model.streaks,'streaks')}</div>
      </div><details class="mg-help"><summary>Cómo se calculan estos datos</summary><p>Una mejor y peor marca por participante. Los empates comparten puesto y las victorias semanales se comparten a igual puntuación. Los lideratos y rachas respetan la clasificación general y sus desempates. Solo temporada actual; los registros se actualizan al corregir resultados.</p></details>`:'<div class="mg-empty"><h3>Sin jornadas publicadas</h3><p>El resumen aparecerá cuando haya resultados.</p></div>'}`;
    updateStatus(status);
  }
  function updateStatus(status){
    const node=$('[data-mg-status]');if(!node)return;
    const notes=[];
    if(status==='loading')notes.push('Consultando resultados publicados…');
    if(status==='error')notes.push('No se pudieron consultar los resultados.');
    if(status==='stale')notes.push('Sin conexión: últimos resultados recibidos.');
    if(model.incomplete)notes.push('Datos parciales. Lideratos solo hasta el último cierre completo desde J1.');
    if(model.provisional)notes.push('Provisional · Hay partidos aplazados.');
    node.textContent=notes.join(' ');node.hidden=!notes.length;
    if(!model.latest){
      const title=$('.mg-empty h3'),copy=$('.mg-empty p');
      if(title)title.textContent=status==='loading'?'Cargando el resumen':status==='error'?'Resumen no disponible':'Sin jornadas publicadas';
      if(copy)copy.textContent=status==='error'?'Vuelve a intentarlo cuando se restablezca la conexión.':status==='loading'?'Esperando resultados publicados…':'El resumen aparecerá cuando haya jornadas publicadas.';
    }
  }
  root.CubanMatchdayGeneral={build,render};
})(typeof window==='undefined'?globalThis:window);
