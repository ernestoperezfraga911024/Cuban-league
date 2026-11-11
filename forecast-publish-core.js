(function(root,factory){
  const api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  else root.CubanForecastPublishCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const FIXTURE='laliga-2026-27-j13-real-madrid-celta';
  const SLOTS=['Portería','Lateral izquierdo','Central izquierdo','Central derecho','Lateral derecho',
    'Pivote izquierdo','Pivote derecho','Extremo izquierdo','Mediapunta','Extremo derecho','Delantero'];
  const domains={futbolfantasy:'www.futbolfantasy.com',jornadaperfecta:'www.jornadaperfecta.com',comuniate:'www.comuniate.com'};
  function sourceUrl(source){
    try{const u=new URL(source.url);return u.protocol==='https:' && u.hostname===domains[source.id] && !u.username && !u.password && !u.port ? u.href : '';}
    catch{return '';}
  }
  function candidates(players,roster){
    if(!Array.isArray(players)||players.length!==11||new Set(players.map(p=>p.id)).size!==11||new Set(players.map(p=>p.slot)).size!==11)
      throw Error('El once necesita 11 jugadores y puestos distintos.');
    for(const p of players){
      if(!Number.isInteger(p.slot)||p.slot<1||p.slot>11||!roster.has(p.id)) throw Error('Selecciona un jugador del catálogo en cada puesto.');
      if(!Number.isInteger(p.probability)||p.probability<0||p.probability>100) throw Error('Los porcentajes deben ser enteros entre 0 y 100.');
      if(typeof p.reason!=='string'||p.reason.trim().length<10||p.reason.trim().length>800) throw Error('Cada jugador necesita un motivo de 10 a 800 caracteres.');
      if(p.probability<70){
        if(!roster.has(p.alternative_id)||players.some(x=>x.id===p.alternative_id)) throw Error('Cada porcentaje bajo 70 necesita una alternativa fuera del once.');
      }else if(p.alternative_id!==null) throw Error('Desde 70 la alternativa debe ser null.');
    }
    return players;
  }
  function validate(p){
    if(!p||p.schema_version!==1||p.fixture_key!==FIXTURE||p.team!=='real-madrid'||p.opponent!=='celta'||p.matchday!==13
      ||p.kickoff_at!=='2026-11-21T20:00:00Z'||p.formation!=='4-2-3-1'||p.probability_kind!=='editorial_uncalibrated'
      ||typeof p.note!=='string'||p.note.length<10||p.note.length>1200) throw Error('Publicación incompleta.');
    if(!Array.isArray(p.sources)||p.sources.length!==3||new Set(p.sources.map(s=>s.id)).size!==3
      ||p.sources.some(s=>!sourceUrl(s)||!Number.isFinite(Date.parse(s.fetched_at))
      ||(s.source_updated_at!==null&&!Number.isFinite(Date.parse(s.source_updated_at))))) throw Error('Fuentes incompletas.');
    const earliest=Math.min(...p.sources.map(s=>Date.parse(s.fetched_at)));
    if(Date.parse(p.evidence_at)!==earliest) throw Error('Fecha de evidencia inconsistente.');
    const roster=new Set();
    for(const x of p.players||[]){
      if(!/^[a-z0-9-]+$/.test(x.id)||typeof x.name!=='string'||!x.name.trim()||x.name.length>120
        ||!['editorial-v1','editorial-manual-v1'].includes(x.method)
        ||x.position!==(x.slot===1?'GK':x.slot<=5?'DF':x.slot<=10?'MF':'FW')) throw Error('Jugador ilegible.');
      roster.add(x.id);
      if(x.alternative){
        if(!/^[a-z0-9-]+$/.test(x.alternative.id)||typeof x.alternative.name!=='string'||!x.alternative.name.trim()||x.alternative.name.length>120) throw Error('Alternativa ilegible.');
        roster.add(x.alternative.id);
      }else if(x.alternative!==null) throw Error('Falta alternativa explícita.');
    }
    candidates(p.players.map(x=>({...x,alternative_id:x.alternative?.id??null})),roster);
    return p;
  }
  function fromDraft(p){
    if(p?.status!=='draft'||p.method_version!=='editorial-v1') throw Error('Esta versión necesita una nueva lectura con método editorial v1.');
    return p.proposal.players.map(x=>({id:x.id,slot:x.slot,probability:x.probability,alternative_id:x.alternative?.id??null,reason:x.reason}));
  }
  function freshness(p,now=Date.now()){
    const hours=(now-Date.parse(p.evidence_at))/3600000;
    if(now>=Date.parse(p.kickoff_at)) return 'Archivo de una previsión anterior al partido. No es el once oficial.';
    if(p.sources.some(s=>Date.parse(s.fetched_at)>now+300000)) return 'La fecha de las fuentes requiere revisión.';
    if(hours>24) return 'Lectura de hace más de 24 horas. Puede haber novedades posteriores.';
    return 'Previsión provisional. El once oficial puede ser distinto.';
  }
  return {FIXTURE,SLOTS,sourceUrl,candidates,validate,fromDraft,freshness};
});
