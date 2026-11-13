(function(r,f){if(typeof module==='object'&&module.exports)module.exports=f(require('./forecast-round-config.js'),require('./forecast-publish-core.js'));else r.CubanForecastRoundCore=f(r.CubanForecastRoundConfig,r.CubanForecastPublishCore);})(typeof globalThis!=='undefined'?globalThis:this,function(config,legacy){
  'use strict';
  const formations=['4-2-3-1','4-4-2','4-3-3','3-5-2','5-3-2','3-4-3','3-4-2-1'];
  function fixture(team){return config.fixtures.find(f=>f.home===team||f.away===team);}
  function lines(formation){if(!formations.includes(formation))throw Error('Sistema desconocido.');let slot=2;return [[1],...formation.split('-').map(n=>Array.from({length:Number(n)},()=>slot++))];}
  function position(formation,slot){const rows=lines(formation);return slot===1?'GK':rows[1].includes(slot)?'DF':rows.at(-1).includes(slot)?'FW':'MF';}
  function label(formation,slot){return {GK:'Portería',DF:'Defensa',MF:'Centro del campo',FW:'Ataque'}[position(formation,slot)];}
  function validate(p){
    if([3,4].includes(p?.schema_version)){
      if(p.schema_version===4&&!['editorial-v3','editorial-v4','editorial-v5'].includes(p.method_version))throw Error('Método editorial incompleto.');
      const ids=new Set(config.teams.map(t=>t.id));
      if(p.season!=='2026-27'||!Number.isInteger(p.matchday)||p.matchday<13||p.matchday>38||!ids.has(p.home)||!ids.has(p.away)||p.home===p.away||![p.home,p.away].includes(p.team)||p.opponent!==(p.team===p.home?p.away:p.home)||!new RegExp('^laliga-2026-27-j'+p.matchday+'-[a-z0-9-]{3,100}$').test(p.fixture_key)||!Number.isFinite(Date.parse(p.kickoff_at))||Date.parse(p.kickoff_at)<Date.parse('2026-07-01T00:00:00Z')||Date.parse(p.kickoff_at)>=Date.parse('2027-07-01T04:00:00Z'))throw Error('Partido de temporada incompleto.');
      return validatePlayers(p);
    }
    const f=fixture(p?.team);
    if(!f||p.schema_version!==2||p.fixture_key!==f.key||p.home!==f.home||p.away!==f.away||p.opponent!==(p.team===f.home?f.away:f.home)||p.matchday!==13||p.kickoff_at!==f.kickoff_at||p.probability_kind!=='editorial_uncalibrated'||typeof p.note!=='string'||p.note.length<10||p.note.length>1200)throw Error('Partido incompleto.');
    return validatePlayers(p);
  }
  function sourceUrl(s){
    if(s?.id!=='predicted11')return legacy.sourceUrl(s);
    try{const u=new URL(s.url);return u.origin==='https://www.predicted11.com'&&!u.username&&!u.password&&u.pathname.startsWith('/es/laliga/')?u.href:'';}catch{return '';}
  }
  function validatePlayers(p){
    const v3=p.schema_version===4,sourceIds=v3?['futbolfantasy','jornadaperfecta','comuniate','predicted11']:['futbolfantasy','jornadaperfecta','comuniate'];
    if(p.probability_kind!=='editorial_uncalibrated'||typeof p.note!=='string'||p.note.length<10||p.note.length>1200)throw Error('Contexto incompleto.');
    lines(p.formation);
    if(!Array.isArray(p.sources)||p.sources.length!==sourceIds.length||new Set(p.sources.map(s=>s.id)).size!==sourceIds.length||p.sources.some(s=>!sourceIds.includes(s.id)||!sourceUrl(s)||!Number.isFinite(Date.parse(s.fetched_at))||(s.source_updated_at!==null&&!Number.isFinite(Date.parse(s.source_updated_at)))))throw Error('Fuentes incompletas.');
    if(v3){const s=p.sources.find(s=>s.id==='predicted11');if(!['read','pending','unavailable'].includes(s.status)||!Number.isInteger(s.ballots)||s.ballots<0||s.ballots>14||(s.status==='read')!==(s.ballots>0))throw Error('Recuento Predicted11 incompleto.');}
    if(Date.parse(p.evidence_at)!==Math.min(...p.sources.map(s=>Date.parse(s.fetched_at))))throw Error('Fechas inconsistentes.');
    const roster=new Set();
    for(const x of p.players||[]){
      if(!/^[a-z0-9-]+$/.test(x.id)||typeof x.name!=='string'||!x.name.trim()||x.name.length>120||x.method!==(v3?p.method_version:'editorial-v2')||x.position!==position(p.formation,x.slot))throw Error('Jugador inválido.');
      roster.add(x.id);
      if(x.alternative){if(!/^[a-z0-9-]+$/.test(x.alternative.id)||typeof x.alternative.name!=='string'||!x.alternative.name.trim()||x.alternative.name.length>120)throw Error('Alternativa inválida.');roster.add(x.alternative.id);}else if(x.alternative!==null)throw Error('Alternativa ausente.');
    }
    if(Object.hasOwn(p,'candidates')){
      if(p.schema_version!==4||!['editorial-v4','editorial-v5'].includes(p.method_version)||!Array.isArray(p.candidates)||p.candidates.length>39)throw Error('Candidatos incompletos.');
      const seen=new Set(p.players.map(x=>x.id));
      for(const c of p.candidates){
        if(!c||typeof c.id!=='string'||!/^[a-z0-9-]+$/.test(c.id)||seen.has(c.id)||typeof c.name!=='string'||!c.name.trim()||c.name.length>120||c.method!==p.method_version||!Number.isInteger(c.probability)||c.probability<5||c.probability>95||typeof c.reason!=='string'||c.reason.trim().length<10||c.reason.length>800||Object.hasOwn(c,'slot')||Object.hasOwn(c,'alternative'))throw Error('Candidato inválido.');
        seen.add(c.id);
      }
      if(p.players.some(x=>x.alternative&&!p.candidates.some(c=>c.id===x.alternative.id&&c.name===x.alternative.name)))throw Error('Alternativa sin evaluación.');
    }
    legacy.candidates((p.players||[]).map(x=>({...x,alternative_id:x.alternative?.id??null})),roster);return p;
  }
  function choose(team,roundRows,pilotRows){
    const round=roundRows.find(r=>r.team===team),pilot=team==='real-madrid'?pilotRows[0]:null;
    // Madrid keeps its single existing authority, including manual withdrawal.
    const row=team==='real-madrid'?pilot:round;
    if(!row)return null;(row.payload.schema_version===2?validate:legacy.validate)(row.payload);return row;
  }
  return {config,formations,fixture,lines,position,label,validate,choose,sourceUrl};
});
