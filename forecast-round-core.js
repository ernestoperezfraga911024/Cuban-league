(function(r,f){if(typeof module==='object'&&module.exports)module.exports=f(require('./forecast-round-config.js'),require('./forecast-publish-core.js'));else r.CubanForecastRoundCore=f(r.CubanForecastRoundConfig,r.CubanForecastPublishCore);})(typeof globalThis!=='undefined'?globalThis:this,function(config,legacy){
  'use strict';
  const formations=['4-2-3-1','4-4-2','4-3-3','3-5-2','5-3-2','3-4-3','3-4-2-1'];
  function fixture(team){return config.fixtures.find(f=>f.home===team||f.away===team);}
  function lines(formation){if(!formations.includes(formation))throw Error('Sistema desconocido.');let slot=2;return [[1],...formation.split('-').map(n=>Array.from({length:Number(n)},()=>slot++))];}
  function position(formation,slot){const rows=lines(formation);return slot===1?'GK':rows[1].includes(slot)?'DF':rows.at(-1).includes(slot)?'FW':'MF';}
  function label(formation,slot){return {GK:'Portería',DF:'Defensa',MF:'Centro del campo',FW:'Ataque'}[position(formation,slot)];}
  function validate(p){
    const f=fixture(p?.team);
    if(!f||p.schema_version!==2||p.fixture_key!==f.key||p.home!==f.home||p.away!==f.away||p.opponent!==(p.team===f.home?f.away:f.home)||p.matchday!==13||p.kickoff_at!==f.kickoff_at||p.probability_kind!=='editorial_uncalibrated'||typeof p.note!=='string'||p.note.length<10||p.note.length>1200)throw Error('Partido incompleto.');
    lines(p.formation);
    if(!Array.isArray(p.sources)||p.sources.length!==3||new Set(p.sources.map(s=>s.id)).size!==3||p.sources.some(s=>!legacy.sourceUrl(s)||!Number.isFinite(Date.parse(s.fetched_at))||(s.source_updated_at!==null&&!Number.isFinite(Date.parse(s.source_updated_at)))))throw Error('Fuentes incompletas.');
    if(Date.parse(p.evidence_at)!==Math.min(...p.sources.map(s=>Date.parse(s.fetched_at))))throw Error('Fechas inconsistentes.');
    const roster=new Set();
    for(const x of p.players||[]){
      if(!/^[a-z0-9-]+$/.test(x.id)||typeof x.name!=='string'||!x.name.trim()||x.name.length>120||x.method!=='editorial-v2'||x.position!==position(p.formation,x.slot))throw Error('Jugador inválido.');
      roster.add(x.id);
      if(x.alternative){if(!/^[a-z0-9-]+$/.test(x.alternative.id)||typeof x.alternative.name!=='string'||!x.alternative.name.trim()||x.alternative.name.length>120)throw Error('Alternativa inválida.');roster.add(x.alternative.id);}else if(x.alternative!==null)throw Error('Alternativa ausente.');
    }
    legacy.candidates((p.players||[]).map(x=>({...x,alternative_id:x.alternative?.id??null})),roster);return p;
  }
  function choose(team,roundRows,pilotRows){
    const round=roundRows.find(r=>r.team===team),pilot=team==='real-madrid'?pilotRows[0]:null;
    // Madrid keeps its single existing authority, including manual withdrawal.
    const row=team==='real-madrid'?pilot:round;
    if(!row)return null;(row.payload.schema_version===2?validate:legacy.validate)(row.payload);return row;
  }
  return {config,formations,fixture,lines,position,label,validate,choose};
});
