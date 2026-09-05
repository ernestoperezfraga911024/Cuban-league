/* Shared, dependency-free import rules. Included unchanged in the extension. */
(function (root) {
  'use strict';
  const key = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  function number(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim().replace(/−/g, '-').replace(',', '.');
    return /^[+-]?\d+(?:\.\d+)?$/.test(text) && Number.isFinite(Number(text)) ? Number(text) : null;
  }
  function points(raw, pending = false) {
    const text = String(raw ?? '').trim();
    if (pending) return { value: 0, status: 'pending', didPlay: null };
    if (['-', '—', '–'].includes(text)) return { value: 0, status: 'did-not-play', didPlay: false };
    const value = number(text);
    if (value === null) throw new Error('Puntuación ausente o ilegible. No se sustituye por cero.');
    return { value, status: 'scored', didPlay: true };
  }
  function statistics(detailed, position) {
    const read = (name, field = 'value') => number(detailed?.[name]?.[field]);
    const count = name => { const v = read(name); return Number.isInteger(v) && v >= 0 ? v : null; };
    const minutes = count('minutesPlayed');
    const goals = count('goals');
    const red = count('redCard');
    const secondYellow = count('doubleYellowCard');
    const conceded = count('goalsAgainst');
    const rating = read('goalsAgainst', 'rating');
    return {
      goals,
      cleanSheet: position !== 'PT' ? 0 : minutes === null || conceded === null || rating === null
        ? null : minutes > 0 && conceded === 0 && rating > 0 ? 1 : 0,
      redCard: red === null || secondYellow === null ? null : red > 0 || secondYellow > 0 ? 1 : 0
    };
  }
  function sumKnown(players, field) {
    return players.some(player => player[field] === null || player[field] === undefined)
      ? null : players.reduce((sum, player) => sum + player[field], 0);
  }
  function summarize(lineup, officialPoints, negative = false) {
    if (negative) {
      if (officialPoints !== 0) throw new Error('Saldo negativo con puntuación distinta de cero.');
      return { points: 0, goals: 0, cleanSheets: 0, redCards: 0, negativeBalanceNoScore: true, lineup: [], warnings: [] };
    }
    if (lineup.length !== 11) throw new Error('La captura debe contener los 11 puestos.');
    if (!Number.isInteger(officialPoints)) throw new Error('El total de Mister no es válido.');
    const seen = new Set();
    let captains = 0;
    for (const p of lineup) {
      if (!['PT', 'DF', 'MC', 'DL'].includes(p.position)) throw new Error('Posición ilegible.');
      if (!p.isEmpty) {
        if (!/^\d+$/.test(p.misterPlayerId) || seen.has(p.misterPlayerId)) throw new Error('Jugador duplicado o sin identidad.');
        seen.add(p.misterPlayerId);
      }
      if (p.isCaptain) {
        captains++;
        if (p.isEmpty || ![1.5, 2, 3].includes(p.captainMultiplier)) throw new Error('Capitán no válido.');
      }
      if (p.didPlay === false && p.displayedPoints !== 0) throw new Error('Quien no jugó debe tener cero puntos.');
      if (!Number.isFinite(p.displayedPoints)) throw new Error('Faltan puntos de un puesto.');
    }
    if (captains > 1) throw new Error('Hay más de un capitán.');
    const total = lineup.reduce((sum, p) => sum + p.displayedPoints, 0);
    const warnings = [];
    if (Math.abs(total - officialPoints) > 0.01) warnings.push(`Las tarjetas suman ${total}; la tabla de Mister indica ${officialPoints}. Revisar antes de publicar.`);
    const pending = lineup.filter(p => p.status === 'pending').length;
    if (pending) warnings.push(`${pending} jugadores pendientes: los ceros son provisionales.`);
    const goals = sumKnown(lineup, 'goals');
    const cleanSheets = sumKnown(lineup, 'cleanSheet');
    const redCards = sumKnown(lineup, 'redCard');
    if ([goals, cleanSheets, redCards].includes(null)) warnings.push('Faltan estadísticas: se dejan campos sin completar para revisión.');
    return { points: officialPoints, goals, cleanSheets, redCards, negativeBalanceNoScore: false, lineup, warnings };
  }
  // Compare only editable sporting data, excluding timestamps, publication and DB revisions.
  function canonical(row) {
    if (!row) return null;
    return JSON.stringify({
      points: row.points ?? null, goals: row.goals ?? null, clean_sheets: row.clean_sheets ?? null,
      red_cards: row.red_cards ?? null, negative_balance_no_score: row.negative_balance_no_score === true,
      lineup: (row.lineup || []).map(p => ({ slot: p.slot_number, id: p.player_id, name: p.player_name,
        club: p.club_id, position: p.position, points: p.displayed_points ?? null,
        captain: p.is_captain === true, multiplier: p.captain_multiplier || 1 })).sort((a, b) => a.slot - b.slot)
    });
  }
  function hasData(row) {
    return row && (row.negative_balance_no_score || row.lineup?.length || ['points', 'goals', 'clean_sheets', 'red_cards'].some(f => row[f] !== null && row[f] !== undefined));
  }
  function conflict(current, incoming, baseline, protectExisting) {
    if (!hasData(current) || canonical(current) === canonical(incoming)) return false;
    return baseline ? canonical(current) !== canonical(baseline) : protectExisting;
  }
  const api = { key, number, points, statistics, summarize, canonical, conflict };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CubanMisterImportCore = api;
})(typeof globalThis === 'object' ? globalThis : this);
