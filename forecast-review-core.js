(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CubanForecastCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const METHOD = 'editorial-v1';
  const required = { role: { established: 85, preferred: 75, contested: 55 },
    availability: { clear: 0, concern: -15, unknown: -10 },
    rotation: { low: 0, possible: -10, high: -20 },
    agreement: { consistent: 0, disputed: -10 },
    quality: { primary: 0, secondary: -5, limited: -10 },
    horizon: { near: 0, medium: -5, distant: -10 } };
  function evaluate(evidence) {
    if (evidence?.method === 'editorial-v2') return (typeof module === 'object' && module.exports ? require('./forecast-source-method.js') : globalThis.CubanForecastSourceMethod).evaluate(evidence);
    if (!evidence || evidence.method !== METHOD) throw Error('Método desconocido');
    const trace = [];
    for (const [key, values] of Object.entries(required)) {
      const item = evidence[key];
      if (!item || !Object.hasOwn(values, item.value) || !String(item.reason || '').trim()
          || !Array.isArray(item.refs) || !item.refs.length
          || item.refs.some(ref => typeof ref !== 'string' || !/^https:\/\//.test(ref))) {
        throw Error('Evidencia incompleta: ' + key);
      }
      trace.push({ factor: key, value: item.value, points: values[item.value], reason: item.reason, refs: [...item.refs] });
    }
    if (evidence.confirmed_out !== false) throw Error('La disponibilidad debe revisarse; una baja confirmada no entra en el once');
    const probability = Math.max(5, Math.min(90, trace.reduce((sum, item) => sum + item.points, 0)));
    return { method: METHOD, probability_kind: 'editorial_uncalibrated', probability, trace };
  }
  function comparison(current, previous) {
    if (!previous) return { message: 'Primera versión comparable', changes: [] };
    if (current.fixture_key !== previous.fixture_key || current.team !== previous.team)
      return { message: 'Las versiones pertenecen a partidos distintos', changes: [] };
    if (current.status !== 'draft' || previous.status !== 'draft')
      return { message: 'No se compara un once con un intento bloqueado', changes: [] };
    const before = new Map(previous.proposal.players.map(p => [p.id, p]));
    const after = new Map(current.proposal.players.map(p => [p.id, p]));
    const changes = [];
    for (const p of after.values()) {
      const old = before.get(p.id);
      if (!old) changes.push({ name: p.name, change: 'Entra', reason: p.reason });
      else {
        const details = [];
        if (old.probability !== p.probability) details.push(old.probability + '% → ' + p.probability + '%');
        if ((old.alternative?.id || '') !== (p.alternative?.id || '')) details.push('Alternativa: ' + (old.alternative?.name || '—') + ' → ' + (p.alternative?.name || '—'));
        if (old.position !== p.position) details.push(old.position + ' → ' + p.position);
        if (old.reason !== p.reason) details.push('Explicación revisada');
        if (details.length) changes.push({ name: p.name, change: details.join(' · '), reason: p.reason });
      }
    }
    for (const p of before.values()) if (!after.has(p.id)) changes.push({ name: p.name, change: 'Sale', reason: 'Consultar el análisis de la nueva versión' });
    return { message: changes.length ? 'Cambios registrados; no implican por sí solos nueva evidencia' : 'Sin cambios en jugadores, porcentajes, alternativas ni motivos', changes };
  }
  function assessment(player) {
    if (!player.assessment) return { label: 'Estimación original del piloto · sin método reproducible', trace: [] };
    try {
      const result = evaluate(player.assessment);
      if (result.probability !== player.probability) throw Error('Discrepancia');
      return { label: (result.method === 'editorial-v2' ? 'Método editorial v2 · fuentes 80%, rol 20%' : 'Método editorial v1') + ' · estimación no calibrada', trace: result.trace };
    } catch { return { label: 'Evaluación inconsistente: requiere revisión', trace: [] }; }
  }
  function applyMethod(payload) {
    if (payload?.status !== 'draft' || payload.publication_allowed !== false || payload.proposal?.formation !== '4-2-3-1') throw Error('Solo borrador privado 4-2-3-1');
    const players = payload.proposal.players;
    if (!Array.isArray(players) || players.length !== 11 || new Set(players.map(p => p.id)).size !== 11) throw Error('Once inválido');
    for (const [position, count] of Object.entries({GK:1, DF:4, MF:5, FW:1}))
      if (players.filter(p => p.position === position).length !== count) throw Error('Distribución inválida');
    const method = players[0]?.assessment?.method;
    if (!['editorial-v1','editorial-v2'].includes(method) || players.some(p => p.assessment?.method !== method)) throw Error('Métodos mezclados o incompletos');
    const prepared = players.map(p => {
      const result = evaluate(p.assessment);
      const alternative = result.probability < 70 ? p.alternative : null;
      if (result.probability < 70 && (!alternative?.id || !alternative?.name || players.some(x => x.id === alternative.id))) throw Error('Falta alternativa fuera del once: ' + p.name);
      return {...p, probability: result.probability, alternative};
    });
    return {...payload, method_version: method, probability_kind: 'editorial_uncalibrated', proposal: {...payload.proposal, players: prepared}};
  }
  return { METHOD, evaluate, applyMethod, comparison, assessment };
});
