'use strict';
// Mechanical assembly only. The reviewer must inspect current captured bodies for
// fixture, probable/official status, identities and source-supported alternatives.
// Medical status belongs to the independent FF icon feed, never this calculation.
const {evaluate, selectAuthors, aggregate} = require('../../forecast-predicted11-method.js');
const {isDeepStrictEqual: same} = require('node:util');
const {orderSelection} = require('./lineup-layout.cjs');
const BASE = ['futbolfantasy','jornadaperfecta','comuniate'];
const SHAPES = ['4-2-3-1','4-4-2','4-3-3','3-5-2','5-3-2','3-4-3','3-4-2-1'];
class EvidenceFailure extends Error {
  constructor(message) { super(message); this.name = 'EvidenceFailure'; }
}
const requireThat = (ok, message) => { if (!ok) throw new EvidenceFailure(message); };
const fixtureOf = f => {
  const instant = typeof f?.kickoff_at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.0+)?(?:Z|[+-]\d{2}:\d{2})$/.test(f.kickoff_at) ? Date.parse(f.kickoff_at) : NaN;
  requireThat(Number.isFinite(instant) && instant % 1000 === 0, 'Fecha del partido inválida: requiere zona horaria y segundos exactos');
  return Object.fromEntries(['key','home','away','matchday','kickoff_at'].map(k =>
    [k,k === 'kickoff_at' ? new Date(instant).toISOString().replace('.000Z','Z') : f[k]]));
};
const probability = n => n === null || Number.isInteger(n) && n >= 0 && n <= 100;

// PostgreSQL jsonb text inserts one space after structural commas and colons.
// Count those separators outside strings so the local 64 KiB gate agrees with SQL.
function jsonbByteLength(value) {
  const text=JSON.stringify(value); let spaces=0,quoted=false,escaped=false;
  for(const c of text){
    if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}
    else if(c==='"')quoted=true;
    else if(c===','||c===':')spaces++;
  }
  return Buffer.byteLength(text)+spaces;
}

function compile(packet, review, roster, window) {
  const f = review.fixture, team = packet.team;
  requireThat(f && f.season === '2026-27' && [f.home,f.away].includes(team), 'Partido revisado inválido');
  const expected = fixtureOf(f);
  const byId = new Map(roster.map(p => [p.id,p]));
  requireThat(byId.size === roster.length && roster.every(p => p.team === team), 'Roster ajeno o duplicado');
  const exclusions = review.exclusions || [];
  const limitations = [...(review.limitations || [])];
  const checkTime = value => {
    const n = Date.parse(value);
    requireThat(Number.isFinite(n) && n >= Date.parse(window.notBefore) && n < Date.parse(window.expiresAt) &&
      n <= Date.parse(window.observedAt) + 300000 && n >= Date.parse(window.observedAt) - 7200000, 'Evidencia fuera de la ventana real');
    return n;
  };
  const resolve = name => {
    const exact = roster.filter(p => p.name === name);
    const id = review.identities?.[name] ?? (exact.length === 1 ? exact[0].id : null);
    requireThat(byId.has(id), team + ': identidad sin resolver: ' + name);
    return id;
  };
  const registered = [], sources = [], union = new Set();
  for (const id of BASE) {
    const r = review.sources?.[id], match = packet.docs[id];
    const page = packet.docs[id === 'comuniate' ? 'comuniate_team' : id];
    requireThat(r && page && match, team + ': falta fuente ' + id);
    checkTime(match.fetched_at); checkTime(page.fetched_at);
    requireThat(/^[a-f0-9]{64}$/.test(match.sha256) && /^[a-f0-9]{64}$/.test(page.sha256) && r.fixture_sha256 === match.sha256 && r.lineup_sha256 === page.sha256 &&
      r.season === f.season && same(fixtureOf(r.observed_fixture), expected), team + ': calendario no contrastado en cuerpo de ' + id);
    requireThat(r.forecast === true, 'Once oficial disponible: no sustituir el pronóstico (' + team + ', ' + id + ')');
    requireThat(r.alternatives_complete === true && Array.isArray(r.alternatives), team + ': alternativas sin revisar en ' + id);
    if(id==='comuniate'){
      const captured=packet.comuniate_alternatives;
      requireThat(captured && captured.sha256===page.sha256 && captured.url===page.url && captured.fetched_at===page.fetched_at && Array.isArray(captured.players),team+': falta control de alternativas de Comuniate');
      for(const alt of captured.players){
        requireThat(typeof alt.name==='string' && alt.name.trim() && probability(alt.probability),team+': alternativa de Comuniate ilegible');
        requireThat(r.alternatives.some(a=>a.name===alt.name && a.probability===alt.probability),team+': alternativa de Comuniate omitida o modificada: '+alt.name);
      }
    }
    const observed = packet.observations[id];
    requireThat(observed?.length === 11 && new Set(observed.map(p => p.name)).size === 11, team + ': once incompleto de ' + id);
    const starters = observed.map(p => p.name), starter_ids = starters.map(resolve);
    requireThat(new Set(starter_ids).size === 11, team + ': identidades duplicadas en ' + id);
    const observations = observed.map(p => ({player_id: resolve(p.name), prediction:'starter', probability:p.probability}));
    for (const alt of r.alternatives) {
      let player_id;
      try { player_id = resolve(alt.name); } catch (error) {
        const excluded = exclusions.find(e => e.source === id && e.name === alt.name && typeof e.reason === 'string' && e.reason.length >= 10);
        if (!excluded) throw error;
        limitations.push(`${id}: candidato opcional ${alt.name} excluido: ${excluded.reason}`);
        continue;
      }
      observations.push({player_id, prediction:'alternative', probability:alt.probability});
    }
    requireThat(new Set(observations.map(o => o.player_id)).size === observations.length && observations.every(o => probability(o.probability)), id + ': observación duplicada o porcentaje inválido');
    observations.forEach(o => union.add(o.player_id));
    registered.push({id,url:match.url,fetched_at:match.fetched_at,fixture_verified:true,observed_fixture:expected});
    const source_updated_at=r.source_updated_at ?? null;
    requireThat(source_updated_at===null || Number.isFinite(Date.parse(source_updated_at)) && Date.parse(source_updated_at)<=Date.parse(page.fetched_at)+300000, id+': fecha editorial inválida');
    sources.push({id,url:page.url,status:'read',fetched_at:page.fetched_at,source_updated_at,fixture_verified:true,
      observed_fixture:expected,starters,starter_ids,player_observations:observations});
  }
  const p11docs = Object.entries(packet.docs).filter(([k]) => k.startsWith('p11')).map(([,d]) => d);
  const p11review = review.predicted11;
  let rankings = [], predictions = [], votes = {ballots:0,counts:new Map()}, verified = false;
  if (p11review?.fixture_verified === true) {
    const match = packet.docs.p11match;
    requireThat(match && /^[a-f0-9]{64}$/.test(match.sha256) && p11review.fixture_sha256 === match.sha256 && p11review.season === f.season &&
      same(fixtureOf(p11review.observed_fixture),expected), 'Partido Predicted11 no coincide');
    requireThat(same(fixtureOf(packet.expected_fixture),expected), 'Predicted11 consultado para otro partido');
    rankings = packet.rankings;
    requireThat(rankings.length === 2 && new Set(rankings.map(r => r.kind)).size === 2, 'Faltan ambos rankings P11');
    const authors = selectAuthors(rankings.find(r => r.kind === 'club')?.authors, rankings.find(r => r.kind === 'global')?.authors);
    for (const p of packet.predictions) {
      const author = authors.find(a => a.id === p.author_id);
      requireThat(author && p.url === author.url, 'Pronóstico ajeno al ranking');
      const status = p.status === 'complete_unvalidated' ? 'read' : p.status === 'mismatch' ? 'unavailable' : p.status;
      const names = status === 'read' ? p.data.participacion.map(x => x.nombre.trim()) : [];
      const ids = names.map(resolve); // An unknown player in a complete P11 ballot is mandatory, never a false absent vote.
      const fetched_at = p.ballot_fetched_at || p.fetched_at || p.attempted_at;
      checkTime(fetched_at);
      if (p.fetched_at) checkTime(p.fetched_at);
      predictions.push({author_id:p.author_id,url:p.url,fetched_at,status,source_updated_at:null,
        observed_fixture:expected,starters:names,starter_ids:ids});
    }
    votes = aggregate(authors,predictions,new Set(byId.keys()));
    for (const id of votes.counts.keys()) union.add(id);
    verified = true;
  } else {
    requireThat(typeof p11review?.reason === 'string' && p11review.reason.length >= 10, 'Falta explicar ausencia de Predicted11');
    limitations.push('Predicted11 no disponible: ' + p11review.reason);
  }
  const times = [...p11docs.map(d => d.fetched_at), ...packet.predictions.flatMap(p => [p.fetched_at,p.ballot_fetched_at,p.attempted_at].filter(Boolean)), packet.p11_attempted_at].filter(Boolean);
  requireThat(times.length > 0, 'Predicted11 no consultado');
  times.forEach(checkTime);
  const p11time = new Date(Math.min(...times.map(Date.parse))).toISOString();
  sources.push({id:'predicted11',url:packet.docs.p11match?.url || 'https://www.predicted11.com/es/laliga/',
    status:verified ? votes.ballots ? 'read' : 'pending' : 'unavailable',fetched_at:p11time,source_updated_at:null,
    fixture_verified:verified,observed_fixture:expected,rankings,predictions,player_observations:[]});
  const chosen = review.selection;
  requireThat(SHAPES.includes(chosen?.formation) && chosen.players?.length === 11 && new Set(chosen.players.map(p => p.id)).size === 11, 'Selección requiere once y formación admitida');
  const selected = new Set(chosen.players.map(p => p.id));
  requireThat([...selected].every(id => byId.has(id) && union.has(id)), 'Titular ajeno o sin señal de las fuentes');
  const ordered = orderSelection(packet,chosen,resolve);
  const all = [...union];
  requireThat(all.length <= 50, 'Más de 39 candidatos: requiere revisión');
  for (const s of sources) s.player_observations = all.map(id => s.id === 'predicted11' ? {
    player_id:id,prediction:votes.ballots ? 'consensus' : 'not_available',probability:null,
    votes:votes.ballots ? votes.counts.get(id) || 0 : null,ballots:votes.ballots,
  } : s.player_observations.find(o => o.player_id === id) || {player_id:id,prediction:'not_listed',probability:null});
  const oldest = Math.min(...sources.map(s => checkTime(s.fetched_at)));
  const hours = (Date.parse(f.kickoff_at) - oldest) / 3600000;
  requireThat(hours > 0, 'El encuentro ya comenzó');
  const evaluated = new Map();
  for (const id of all) {
    const assessment = {method:'editorial-v6',sources:sources.map(s => {
      const {player_id,...o} = s.player_observations.find(o => o.player_id === id);
      return {id:s.id,...o,reason:s.id === 'predicted11' ? `${o.ballots} onces completos; ${o.votes ?? 'sin'} votos.` :
        `${o.prediction}; ${o.probability === null ? 'sin porcentaje publicado' : o.probability + '% de titularidad observado'}.`,refs:[s.url]};
    })};
    const probability = evaluate(assessment).probability;
    evaluated.set(id,{id,name:byId.get(id).name,probability,reason:'Cálculo de titularidad según las fuentes y votos observados.',assessment});
  }
  const shape = chosen.formation.split('-').map(Number);
  const missingAlternatives=ordered.players.filter(choice=>evaluated.get(choice.id).probability<70&&
    (!evaluated.has(choice.alternative_id)||selected.has(choice.alternative_id)));
  requireThat(!missingAlternatives.length,missingAlternatives.map(choice=>{
    const player=evaluated.get(choice.id);
    return `${team}: falta alternativa evaluada para ${player.name} (${player.probability}%)`;
  }).join('; '));
  const players = ordered.players.map((choice,i) => {
    const player = evaluated.get(choice.id), slot = i + 1;
    let alternative = null;
    if (player.probability < 70) {
      requireThat(evaluated.has(choice.alternative_id) && !selected.has(choice.alternative_id), `${team}: falta alternativa evaluada para ${player.name} (${player.probability}%)`);
      alternative = {id:choice.alternative_id,name:byId.get(choice.alternative_id).name};
    }
    return {...player,slot,position:slot === 1 ? 'GK' : slot <= 1 + shape[0] ? 'DF' : slot > 11 - shape.at(-1) ? 'FW' : 'MF',alternative};
  });
  const candidates = all.filter(id => !selected.has(id)).map(id => evaluated.get(id));
  const disagreements = all.filter(id => new Set(sources.slice(0,3).map(s => s.starter_ids.includes(id))).size > 1).length;
  limitations.push(`Lecturas actuales; evidencia más antigua ${new Date(oldest).toISOString()}. Antelación ${hours.toFixed(1)} h. ${disagreements} jugadores con desacuerdo entre fuentes base. P11: ${votes.ballots} onces completos, ${predictions.filter(p => p.status !== 'read').length} sin once útil. Estimaciones editoriales provisionales no calibradas.`);
  requireThat(limitations.join(' ').length >= 10 && limitations.join(' ').length <= 1200, 'Limitaciones fuera de tamaño');
  const payload = {schema_version:4,season:f.season,team,fixture_key:f.key,home:f.home,away:f.away,
    opponent:team === f.home ? f.away : f.home,matchday:f.matchday,kickoff_at:expected.kickoff_at,
    probability_kind:'editorial_uncalibrated',publication_allowed:false,status:'draft',method_version:'editorial-v6',
    limitations,sources,proposal:{formation:chosen.formation,players,candidates}};
  requireThat(jsonbByteLength(payload) <= 65536, 'Payload supera 64 KiB en formato JSONB del servidor');
  return {fixture:{...expected,season:f.season,sources:registered},payload,layout:ordered.audit};
}
function concreteBlock(packet,failure) {
  requireThat(BASE.includes(failure?.source) && ['official','fixture','identity','lineup','access'].includes(failure?.kind) &&
    typeof failure.detail === 'string' && failure.detail.length >= 10, 'Bloqueo sin fallo concreto por club y fuente');
  const doc=packet.docs[failure.source], error=packet.errors?.find(e=>e.source===failure.source || failure.source==='comuniate' && e.source==='comuniate_team');
  requireThat(failure.kind==='access' ? !!error : !!doc && /^[a-f0-9]{64}$/.test(doc.sha256) && failure.sha256===doc.sha256, 'Bloqueo sin evidencia de esta ejecución');
  const checks=BASE.map(id=>{
    const page=packet.docs[id],err=packet.errors?.find(e=>e.source===id || id==='comuniate' && e.source==='comuniate_team');
    return {id,url:page?.url || (err ? packet.expected_fixture.source_urls[id] : null),
      fetched_at:page?.fetched_at || err?.attempted_at || null,
      status:id===failure.source && failure.kind==='access' ? 'unavailable' : page ? (id===failure.source && failure.kind==='fixture' ? 'mismatch':'read') : err ? 'unavailable':'not_read'};
  });
  return {reason:`${packet.team}, ${failure.source}: ${failure.kind==='official'?'Once oficial disponible: no sustituir el pronóstico. ':''}${failure.detail}`,checks};
}
module.exports = {compile,EvidenceFailure,fixtureOf,concreteBlock,jsonbByteLength};
