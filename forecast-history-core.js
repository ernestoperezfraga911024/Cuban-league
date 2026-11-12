(function(r,f){if(typeof module==='object'&&module.exports)module.exports=f(require('./forecast-round-core.js'));else r.CubanForecastHistoryCore=f(r.CubanForecastRoundCore);})(typeof globalThis!=='undefined'?globalThis:this,function(round){
 'use strict';
 const teams=new Set(round.config.teams.map(t=>t.id));
 const time=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
 const id=v=>typeof v==='string'&&/^[a-z0-9-]+$/.test(v);
 function fixtureIdentity(r){const known=round.config.fixtures.find(f=>f.key===r.fixture_key);return known?known.home===r.home&&known.away===r.away&&r.matchday===13:r.fixture_key==='laliga-2026-27-j'+r.matchday+'-'+r.home+'-'+r.away;}
 function base(r){
  if(!r||!teams.has(r.team)||r.season!=='2026-27'||!Number.isInteger(r.matchday)||r.matchday<13||r.matchday>38||!teams.has(r.home)||!teams.has(r.away)||r.home===r.away||![r.home,r.away].includes(r.team)||!fixtureIdentity(r)||!time(r.kickoff_at)||!['pending','evaluated','no_prediction'].includes(r.status)||!['initial','final',null].includes(r.verification_stage))throw Error('Partido histórico incompleto.');
  if(r.status==='evaluated'?!Number.isInteger(r.hits)||r.hits<0||r.hits>11||r.verification_stage===null:r.hits!==null)throw Error('Resultado histórico incompleto.');
  return r;
 }
 function rows(data,details=false){
  if(!Array.isArray(data)||data.length>520)throw Error('Historial incompleto.');
  const seen=new Set();
  for(const r of data){base(r);const key=r.fixture_key+'|'+r.team;if(seen.has(key))throw Error('Partido duplicado.');seen.add(key);if(details)detail(r);}
  return data;
 }
 function detail(r){
  base(r);
  if(!time(r.cutoff_at)||Date.parse(r.cutoff_at)>Date.parse(r.kickoff_at)-7200000||r.verified_at!==null&&!time(r.verified_at)||r.published_at!==null&&!time(r.published_at))throw Error('Fechas históricas incompletas.');
  if(r.prediction!==null){const p=round.validate(r.prediction);if(p.team!==r.team||p.fixture_key!==r.fixture_key||p.home!==r.home||p.away!==r.away||p.matchday!==r.matchday||Date.parse(p.kickoff_at)!==Date.parse(r.kickoff_at)||!time(r.prediction_published_at)||Date.parse(r.prediction_published_at)>Date.parse(r.cutoff_at))throw Error('Pronóstico fuera del cierre.');}
  else if(r.prediction_published_at!==null)throw Error('Falta el pronóstico.');
  for(const key of ['official_starters','correct_ids','missed_ids','unexpected_starters'])if(!Array.isArray(r[key]))throw Error('Comparación incompleta.');
  const names=xs=>xs.every(x=>id(x.id)&&typeof x.name==='string'&&x.name.trim()&&x.name.length<=120)&&new Set(xs.map(x=>x.id)).size===xs.length;
  if(!names(r.official_starters)||!names(r.unexpected_starters))throw Error('Titulares inválidos.');
  if(r.status==='evaluated'){
   if(!r.prediction||r.official_starters.length!==11||!time(r.verified_at)||!sourceUrl(r.source_url))throw Error('Once real incompleto.');
   const official=new Set(r.official_starters.map(x=>x.id)),predicted=new Set(r.prediction.players.map(x=>x.id));
   const correct=[...predicted].filter(x=>official.has(x)),missed=[...predicted].filter(x=>!official.has(x)),unexpected=[...official].filter(x=>!predicted.has(x));
   const same=(a,b)=>a.length===b.length&&new Set(a).size===a.length&&a.every(x=>b.includes(x));
   if(r.hits!==correct.length||!same(r.correct_ids,correct)||!same(r.missed_ids,missed)||!same(r.unexpected_starters.map(x=>x.id),unexpected))throw Error('Aciertos inconsistentes.');
  }else if(r.correct_ids.length||r.missed_ids.length||r.unexpected_starters.length)throw Error('Un partido pendiente no tiene aciertos.');
  return r;
 }
 function sourceUrl(value){try{const u=new URL(value);return u.origin==='https://www.futbolfantasy.com'&&!u.username&&!u.password&&/^\/partidos\/[a-zA-Z0-9_-]+\/?$/.test(u.pathname)&&!u.search&&!u.hash?u.href:'';}catch{return '';}}
 function aggregate(data,team,matchday=null){
  const selected=data.filter(r=>r.team===team&&(matchday===null||r.matchday===matchday));
  const evaluated=selected.filter(r=>r.status==='evaluated');const hits=evaluated.reduce((n,r)=>n+r.hits,0);
  return {hits,matches:evaluated.length,total:evaluated.length*11,percentage:evaluated.length?100*hits/(11*evaluated.length):null,pending:selected.filter(r=>r.status==='pending').length,unscored:selected.filter(r=>r.status==='no_prediction').length,initial:evaluated.filter(r=>r.verification_stage==='initial').length};
 }
 function percentage(v){return v===null?'—':new Intl.NumberFormat('es',{minimumFractionDigits:1,maximumFractionDigits:1}).format(v)+'%';}
 return {rows,detail,aggregate,percentage,sourceUrl};
});
