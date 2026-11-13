(()=>{
  'use strict';
  const LABELS={home:'Inicio',current:'Clasificación',matchdays:'Jornadas',players:'Jugadores',history:'Historia',cup:'Copa',champions:'Champions',rules:'Reglas',cards:'Tarjetas','second-division':'Segunda división',forecasts:'Alineaciones probables',news:'Noticias'};
  const $=id=>document.getElementById(id);
  const number=value=>Number.isFinite(Number(value))?Math.max(0,Math.trunc(Number(value))):0;
  const format=value=>number(value).toLocaleString('es');
  let client=null,people=[],days=1,generation=0,bound=false;
  function date(value){
    const d=new Date(value);
    return value&&!Number.isNaN(d.getTime())?new Intl.DateTimeFormat('es',{timeZone:'America/New_York',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(d):'Sin actividad';
  }
  function cell(row,text,tag='td'){const el=document.createElement(tag);el.textContent=text;row.append(el);return el;}
  function render(payload){
    $('audienceProfilesCount').textContent=format(payload.identifiedProfiles);
    $('audienceIdentifiedVisits').textContent=format(payload.identifiedVisits);
    $('audienceGuestVisits').textContent=format(payload.unidentifiedVisits);
    const profiles=Array.isArray(payload.profiles)?payload.profiles:[];
    const sections=Array.isArray(payload.sections)?payload.sections.filter(row=>Object.hasOwn(LABELS,row.id)):[];
    const max=Math.max(1,...sections.map(row=>number(row.visits)));
    const rows=document.createDocumentFragment();
    for(const profile of profiles){
      const person=people.find(p=>p.id===Number(profile.id));
      if(!person)continue;
      const row=document.createElement('tr');
      const name=cell(row,person.name,'th');name.scope='row';
      cell(row,format(profile.visits)).className='audience-count';
      cell(row,format(profile.activeDays));
      cell(row,date(profile.lastSeen));rows.append(row);
    }
    $('audienceProfilesEmpty').hidden=rows.childNodes.length>0;
    $('audienceProfilesTable').hidden=rows.childNodes.length===0;
    $('audienceProfilesRows').replaceChildren(rows);
    const bars=document.createDocumentFragment();
    for(const section of sections){
      const li=document.createElement('li');
      const title=document.createElement('div'),label=document.createElement('span'),count=document.createElement('b');
      label.textContent=LABELS[section.id];count.textContent=`${format(section.visits)} ${number(section.visits)===1?'visita':'visitas'}`;
      title.append(label,count);
      const bar=document.createElement('div');bar.className='audience-bar';bar.setAttribute('aria-hidden','true');
      const fill=document.createElement('span');fill.style.width=`${Math.round(number(section.visits)/max*100)}%`;bar.append(fill);
      li.append(title,bar);bars.append(li);
    }
    $('audienceSections').replaceChildren(bars);$('audienceSectionsEmpty').hidden=sections.length>0;
    $('audienceStatus').textContent=`Actualizado ${date(payload.generatedAt)} · Miami`;
    $('audienceRange').textContent=days===1?'Hoy · Miami':`Últimos ${days} días · Miami`;
    $('audienceError').hidden=true;$('audienceData').hidden=false;
  }
  async function refresh(){
    if(!client)return false;
    const current=++generation,scope=days;
    $('audienceStatus').textContent='Consultando actividad…';$('audienceData').setAttribute('aria-busy','true');
    // Never label old numbers as the newly selected period.
    $('audienceData').hidden=true;
    try{
      const {data,error}=await client.rpc('get_site_audience',{p_days:scope});
      if(current!==generation)return false;
      if(error)throw error;
      if(!data||data.days!==scope)throw new Error('Periodo inesperado');
      render(data);return true;
    }catch{
      if(current!==generation)return false;
      $('audienceData').hidden=true;$('audienceError').hidden=false;
      $('audienceStatus').textContent='No se pudo cargar el detalle de audiencia.';return false;
    }finally{if(current===generation)$('audienceData').setAttribute('aria-busy','false');}
  }
  async function load(options){
    if(!$('audienceDetail'))return false;
    client=options.client;people=options.participants||[];
    if(!bound){
      bound=true;
      $('audienceFilters').addEventListener('click',event=>{
        const button=event.target.closest('button[data-days]');if(!button)return;
        days=Number(button.dataset.days);
        for(const item of $('audienceFilters').querySelectorAll('button'))item.setAttribute('aria-pressed',String(item===button));
        refresh();
      });
      $('audienceRetry').onclick=refresh;
    }
    return refresh();
  }
  function reset(){
    generation++;client=null;people=[];
    if(!$('audienceDetail'))return;
    $('audienceData').hidden=true;$('audienceError').hidden=true;
    $('audienceProfilesRows').replaceChildren();$('audienceSections').replaceChildren();
    $('audienceStatus').textContent='Inicia sesión para consultar la audiencia.';
  }
  window.CubanAudienceAdmin=Object.freeze({load,reset});
})();
