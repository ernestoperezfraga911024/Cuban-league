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
  let host=null,model=null,selected='',frame=0,raf=0,lastTime=null,playing=false,resize=null,bound=false;
  const $=selector=>host?.querySelector(selector);
  const motion=root.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reduced=()=>motion?.matches===true;
  function stop(){
    if(raf)root.cancelAnimationFrame(raf);raf=0;lastTime=null;playing=false;
    const button=$('[data-mg-play]');if(button){button.textContent=frame>=((model?.frames.length||1)-1)?'↻ Reproducir':'▶ Reproducir';button.setAttribute('aria-pressed','false');}
  }
  function photo(p){
    const src=/^(https:\/\/|[a-z0-9][a-z0-9_.\/-]*$)/i.test(p.photo)?p.photo:'';
    return `<span class="mg-avatar"><span aria-hidden="true">${escape(p.name.slice(0,1))}</span>${src?`<img src="${escape(src)}" loading="lazy" decoding="async" alt="">`:''}</span>`;
  }
  const dates=days=>days.map(day=>`J${day}`).join(' · ');
  function board(title,entries,kind,description,tone=''){
    const top=entries.filter(p=>p.rank<=3);
    return `<article class="mg-card ${tone}"><header><h3>${title}</h3><p>${description}</p></header>${top.length?`<ol class="mg-ranking">${top.map(p=>{
      const record=kind==='best'||kind==='worst'?p[kind]:null;
      const value=record?record.points:kind==='streaks'?p.bestRun:p[kind];
      const detail=record?dates(record.days):kind==='streaks'?`J${p.bestStart}–J${p.bestEnd}`:kind==='wins'?'jornadas ganadas':'jornadas en primer lugar';
      const trigger=record?`data-matchday-lineup-player="${escape(p.name)}" data-matchday="${record.days[0]}" aria-label="Ver alineación de ${escape(p.name)} en J${record.days[0]}"`:`data-profile-player="${escape(p.name)}" aria-label="Ver perfil de ${escape(p.name)}"`;
      return `<li><span class="mg-rank">${p.rank}</span><button type="button" class="mg-person" ${trigger}>${photo(p)}<span><b>${escape(p.name)}</b><small>${detail}</small></span></button><span class="mg-value"><b>${number.format(value)}</b><small>${record?'puntos':kind==='streaks'?'seguidas':'jornadas'}</small></span></li>`;
    }).join('')}</ol>`:'<p class="mg-empty">Sin registros todavía.</p>'}${top.length>3?'<p class="mg-note">Se incluyen los empates en el corte del top 3.</p>':''}</article>`;
  }
  function render(nextHost,nextModel,status){
    host=nextHost;if(!host)return;
    if(!bound){
      host.addEventListener('click',onClick);host.addEventListener('input',onInput);host.addEventListener('change',onChange);
      host.addEventListener('error',e=>{if(e.target.tagName==='IMG')e.target.hidden=true;},true);
      root.document.addEventListener('visibilitychange',()=>{if(root.document.hidden)stop();});
      motion?.addEventListener?.('change',()=>{stop();update();});
      if(root.ResizeObserver){resize=new root.ResizeObserver(()=>{if(model?.latest&&!host.hidden){draw();update();}});resize.observe(host);}
      bound=true;
    }
    if(model===nextModel&&host.firstElementChild){updateStatus(status);return;}
    stop();const previousSeason=model?.season;model=nextModel;
    if(previousSeason!==model.season||!model.people.some(p=>p.name===selected))selected='';
    frame=Math.max(0,model.frames.length-1);
    delete host.dataset.mgIndex;delete host.dataset.mgSelected;
    host.innerHTML=`<div class="mg-heading"><div><span class="mg-kicker">TEMPORADA ${escape(model.season)}</span><h2>La temporada, de un vistazo</h2></div><span class="mg-stamp">${model.latest?`Hasta J${model.latest}`:'Sin jornadas'}</span></div><p data-mg-status class="mg-status" role="status"></p>${model.latest?`
      <section class="mg-card mg-race"><header class="mg-race-head"><div><span class="mg-kicker">EVOLUCIÓN DE LA GENERAL</span><h3>La carrera por la liga</h3></div><button type="button" data-mg-expand aria-expanded="false">Ampliar</button></header>
      <p class="mg-note">1.º arriba · Posición acumulada al cierre de cada jornada</p>
      <label class="mg-picker">Destacar participante<select data-mg-person aria-label="Destacar participante"><option value="">Todos los participantes</option>${model.people.map(p=>`<option value="${escape(p.name)}">${escape(p.name)}</option>`).join('')}</select></label>
      <div class="mg-chart" data-mg-chart></div>
      <div class="mg-controls"><button type="button" data-mg-play aria-pressed="false">↻ Reproducir</button><output data-mg-day></output><button type="button" data-mg-end>Ver final</button></div>
      <label class="mg-slider">Recorrer jornadas<input data-mg-range type="range" min="0" max="${model.frames.length-1}" value="${frame}" step="1" aria-label="Jornada de la gráfica"></label>
      <p data-mg-detail class="mg-detail" aria-live="polite"></p>
      <p class="mg-note">Toca una línea para destacarla. Usa el selector y la barra para consultar sus puntos.</p>
      <details class="mg-chart-data"><summary>Ver posiciones y puntos de esta jornada</summary><div data-mg-table></div></details>
      </section>
      <div class="mg-grid">${board('Las mejores jornadas',model.best,'best','La mejor puntuación de cada participante.','mg-best')}${board('Las peores jornadas',model.worst,'worst','La menor puntuación de cada participante.','mg-worst')}</div>
      <div class="mg-grid">${board('Más jornadas ganadas',model.wins,'wins','Los empates a puntos cuentan como victoria compartida.')}${board('Más jornadas como líder',model.leads,'leads','Veces primero en la general, aunque no sean consecutivas.')}</div>
      <div class="mg-grid">${board('Mayor racha de liderazgo',model.streaks,'streaks','Jornadas consecutivas primero en la general.')}<article class="mg-card mg-active"><span class="mg-kicker">RACHA ACTIVA DEL LÍDER</span>${model.active?`${photo(model.active)}<h3>${escape(model.active.name)}</h3><div class="mg-big">${model.active.run}<span>${model.active.run===1?'jornada':'jornadas'} seguidas</span></div><p>Desde J${model.active.runStart} hasta J${model.latest}</p>`:'<h3>Sin racha verificable</h3><p>Se necesitan resultados completos desde J1.</p>'}</article></div>
      <p class="mg-note">Solo temporada actual. Los lideratos respetan el orden y los desempates de la clasificación oficial. Los récords compartidos conservan el mismo puesto.</p>`:'<div class="mg-card mg-empty"><h3>Aquí empieza la carrera</h3><p>El resumen aparecerá cuando haya jornadas publicadas.</p></div>'}`;
    if(model.latest){$('[data-mg-person]').value=selected;draw();update();}
    updateStatus(status);
  }
  function updateStatus(status){
    const node=$('[data-mg-status]');if(!node)return;
    const notes=[];
    if(status==='loading')notes.push('Consultando resultados publicados…');
    if(status==='error')notes.push('No se pudieron consultar los resultados.');
    if(status==='stale')notes.push('Sin conexión: se conservan los últimos resultados recibidos.');
    if(model.incomplete)notes.push('Datos incompletos: los récords y victorias son parciales; la gráfica y los lideratos se muestran solo hasta el último cierre completo desde J1.');
    if(model.provisional)notes.push('Provisional: hay partidos aplazados. Los registros se actualizarán al corregir los resultados.');
    node.textContent=notes.join(' ');node.hidden=!notes.length;
    if(!model.latest){
      const title=$('.mg-empty h3'),copy=$('.mg-empty p');
      if(title)title.textContent=status==='loading'?'Cargando el resumen':status==='error'?'Resumen no disponible':'Aquí empieza la carrera';
      if(copy)copy.textContent=status==='error'?'Vuelve a intentarlo cuando se restablezca la conexión.':status==='loading'?'Esperando resultados publicados…':'El resumen aparecerá cuando haya jornadas publicadas.';
    }
  }
  function geometry(){
    const width=Math.max(260,$('[data-mg-chart]')?.clientWidth||600);
    const height=$('.mg-race')?.classList.contains('is-expanded')?560:360;
    return {width,height,left:32,right:width-22,top:20,bottom:height-36};
  }
  function coordinates(g,index,position){
    return {x:model.frames.length===1?(g.left+g.right)/2:g.left+(g.right-g.left)*index/(model.frames.length-1),y:g.top+(g.bottom-g.top)*(position-1)/Math.max(1,model.people.length-1)};
  }
  function draw(){
    const chart=$('[data-mg-chart]');if(!chart||!model.latest)return;
    const g=geometry(),ticks=[...new Set([1,5,10,15,model.people.length])].filter(n=>n<=model.people.length);
    const grid=ticks.map(n=>{const p=coordinates(g,0,n);return `<line x1="${g.left}" x2="${g.right}" y1="${p.y}" y2="${p.y}" class="mg-gridline"/><text x="4" y="${p.y+4}">${n}º</text>`;}).join('');
    const labelIndices=[...new Set([0,Math.round((model.latest-1)/4),Math.round((model.latest-1)/2),Math.round((model.latest-1)*3/4),model.latest-1])];
    const labels=labelIndices.map(i=>`<text x="${coordinates(g,i,1).x}" y="${g.height-10}" text-anchor="middle">J${i+1}</text>`).join('');
    const lines=model.people.map(p=>{
      let pen=false;const path=model.frames.map((f,i)=>{const row=f.table.find(r=>r.name===p.name);if(!row){pen=false;return ''; }const pos=coordinates(g,i,row.position);const command=pen?'L':'M';pen=true;return `${command}${pos.x},${pos.y}`;}).join(' ');
      return `<path data-mg-line="${p.order}" d="${path}" stroke="${p.color}"/><circle data-mg-dot="${p.order}" r="4.5" fill="${p.color}"/>`;
    }).join('');
    chart.innerHTML=`<svg viewBox="0 0 ${g.width} ${g.height}" width="100%" height="${g.height}" role="img" aria-label="Recorrido de posiciones de los participantes. Consulta valores con el selector o la tabla inferior."><defs><clipPath id="mg-reveal"><rect data-mg-clip x="0" y="0" width="${g.width}" height="${g.height}"/></clipPath></defs>${grid}${labels}<g clip-path="url(#mg-reveal)" class="mg-lines">${lines}</g><line data-mg-cursor y1="${g.top}" y2="${g.bottom}" class="mg-cursor"/></svg>`;
  }
  function update(){
    if(!model?.latest||!$('[data-mg-chart]'))return;
    const g=geometry(),index=Math.min(model.frames.length-1,Math.floor(frame)),fraction=frame-index;
    const current=model.frames[index],next=model.frames[index+1]||current;
    const x=coordinates(g,frame,1).x;
    $('[data-mg-clip]')?.setAttribute('width',String(x+6));
    $('[data-mg-cursor]')?.setAttribute('x1',String(x));$('[data-mg-cursor]')?.setAttribute('x2',String(x));
    for(const p of model.people){
      const line=$(`[data-mg-line="${p.order}"]`),dot=$(`[data-mg-dot="${p.order}"]`);
      const focused=!selected||p.name===selected;
      line?.setAttribute('opacity',focused?'.9':'.12');line?.setAttribute('stroke-width',p.name===selected?'3.5':'1.8');
      const a=current.table.find(r=>r.name===p.name),b=next.table.find(r=>r.name===p.name);
      if(!a||(!b&&fraction>0)){dot?.setAttribute('visibility','hidden');continue;}
      const pos=coordinates(g,frame,a.position+(b?b.position-a.position:0)*fraction);
      dot?.setAttribute('visibility','visible');dot?.setAttribute('cx',String(pos.x));dot?.setAttribute('cy',String(pos.y));dot?.setAttribute('opacity',focused?'1':'.2');
    }
    const day=$('[data-mg-day]');day.textContent=`Jornada ${current.day}`;
    $('[data-mg-range]').value=String(index);$('[data-mg-range]').setAttribute('aria-valuetext',`Jornada ${current.day}`);
    const play=$('[data-mg-play]');play.disabled=reduced()||model.frames.length<2;
    if(reduced())play.textContent='Movimiento reducido';
    if(host.dataset.mgIndex===String(index)&&host.dataset.mgSelected===selected)return;
    host.dataset.mgIndex=String(index);host.dataset.mgSelected=selected;
    const row=current.table.find(r=>r.name===selected),person=model.people.find(p=>p.name===selected);
    $('[data-mg-detail]').textContent=!current.complete?'Jornada sin clasificación acumulada verificable.':row?`${person.name} · ${row.position}.º · ${number.format(row.points)} puntos acumulados${current.provisional?' · provisional':''}`:`J${current.day} · ${current.provisional?'Clasificación provisional':'Clasificación acumulada'} · Selecciona un participante`;
    $('[data-mg-table]').innerHTML=current.table.length?`<table><caption>Clasificación acumulada · J${current.day}${current.provisional?' · provisional':''}</caption><thead><tr><th scope="col">#</th><th scope="col">Participante</th><th scope="col">Puntos</th></tr></thead><tbody>${current.table.map(r=>`<tr><td>${r.position}</td><th scope="row">${escape(r.name)}</th><td>${number.format(r.points)}</td></tr>`).join('')}</tbody></table>`:'<p>Sin datos completos para esta jornada.</p>';
  }
  function tick(time){
    raf=0;
    if(!playing||host.hidden||root.document.hidden||root.document.body.dataset.section!=='matchdays'){stop();return;}
    if(lastTime!==null)frame=Math.min(model.frames.length-1,frame+Math.min(time-lastTime,100)/850);
    lastTime=time;update();
    if(frame>=model.frames.length-1){stop();return;}
    raf=root.requestAnimationFrame(tick);
  }
  function onClick(event){
    if(event.target.closest('[data-mg-play]')){
      if(playing){stop();return;}if(reduced()||model.frames.length<2)return;
      if(frame>=model.frames.length-1)frame=0;playing=true;lastTime=null;
      $('[data-mg-play]').textContent='Ⅱ Pausar';$('[data-mg-play]').setAttribute('aria-pressed','true');update();raf=root.requestAnimationFrame(tick);
    }else if(event.target.closest('[data-mg-end]')){stop();frame=model.frames.length-1;update();}
    else if(event.target.closest('[data-mg-expand]')){
      stop();const open=$('.mg-race').classList.toggle('is-expanded');
      const button=$('[data-mg-expand]');button.textContent=open?'Reducir':'Ampliar';button.setAttribute('aria-expanded',String(open));draw();update();
    }else if(event.target.closest('[data-mg-chart]')){
      const svg=$('svg'),rect=svg.getBoundingClientRect(),g=geometry();if(!rect.width)return;
      const x=(event.clientX-rect.left)*g.width/rect.width,y=(event.clientY-rect.top)*g.height/rect.height;
      const index=Math.max(0,Math.min(Math.floor(frame),Math.round((x-g.left)/(g.right-g.left)*(model.frames.length-1))));
      const table=model.frames[index].table;if(!table.length)return;
      const closest=[...table].sort((a,b)=>Math.abs(coordinates(g,index,a.position).y-y)-Math.abs(coordinates(g,index,b.position).y-y))[0];
      stop();selected=closest.name;frame=index;$('[data-mg-person]').value=selected;update();
    }
  }
  function onInput(event){if(event.target.matches('[data-mg-range]')){stop();frame=Number(event.target.value);update();}}
  function onChange(event){if(event.target.matches('[data-mg-person]')){selected=event.target.value;update();}}
  root.CubanMatchdayGeneral={build,render,stop};
})(typeof window==='undefined'?globalThis:window);
