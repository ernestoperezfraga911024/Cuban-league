/* Independent validation shared by the admin panel and the Mister extension. */
(function (root) {
  'use strict';
  const LEAGUE_ID = '978196';
  const key = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const idOK = value => typeof value === 'string' && /^\d{1,20}$/.test(value);
  function avatarUrl(value) {
    if (typeof value !== 'string' || value.length > 2048 || /[\s<>"'\\]/.test(value)) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.port
        || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(url.hostname)) return null;
      url.hash = '';
      return url.href;
    } catch { return null; }
  }
  function lineup(rows) {
    if (!Array.isArray(rows) || rows.length !== 11) throw new Error('La alineación debe contener los 11 puestos.');
    const ids = new Set();
    let captains = 0;
    const result = rows.map((p, i) => {
      if (!p || p.slot !== i + 1 || !['PT','DF','MC','DL'].includes(p.position)
        || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 120
        || !Number.isFinite(p.points) || Math.abs(p.points) > 1000 || !Number.isInteger(p.points * 2)
        || !['scored','pending','did-not-play','empty'].includes(p.status)
        || typeof p.captain !== 'boolean' || ![1,1.5,2,3].includes(p.multiplier))
        throw new Error('Hay un puesto ilegible en la alineación.');
      if (p.status === 'empty') {
        if (p.id !== '' || p.points !== -4 || p.captain) throw new Error('Posición vacía no válida.');
      } else {
        if (!idOK(p.id) || ids.has(p.id)) throw new Error('Jugador duplicado o sin identidad.');
        ids.add(p.id);
      }
      if (['pending','did-not-play'].includes(p.status) && p.points !== 0) throw new Error('Estado y puntos contradictorios.');
      if (p.captain) {
        captains++;
        if (p.multiplier === 1) throw new Error('Multiplicador de capitán ilegible.');
      } else if (p.multiplier !== 1) throw new Error('Multiplicador sin capitán.');
      return { slot:p.slot, id:p.id, name:p.name.trim(), position:p.position, points:p.points,
        status:p.status, captain:p.captain, multiplier:p.multiplier };
    });
    if (captains > 1 || result.filter(p => p.position === 'PT').length !== 1) throw new Error('Formación o capitán no válido.');
    return result;
  }
  function validate(payload, season) {
    const day = payload?.matchday;
    const general = payload?.kind === 'general' && day === 0;
    if (!payload || payload.version !== 1 || payload.league?.id !== LEAGUE_ID || payload.season !== season
      || !(general || (payload.kind === 'matchday' && Number.isInteger(day) && day >= 1 && day <= 38)))
      throw new Error('La captura no corresponde a la tabla solicitada de Segunda.');
    if (!Number.isFinite(Date.parse(payload.capturedAt))) throw new Error('La fecha de captura no es válida.');
    if (!general && (!Number.isSafeInteger(payload.gameweekId) || payload.gameweekId < 1 || !idOK(payload.excludedManagerId)))
      throw new Error('La jornada o la cuenta de administrador no está identificada.');
    if (!Array.isArray(payload.managers) || payload.managers.length < 2 || payload.managers.length > 100)
      throw new Error('La clasificación está vacía o incompleta.');
    const ids = new Set();
    const managers = payload.managers.map((row, i) => {
      if (!row || !idOK(row.id) || ids.has(row.id) || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 120
        || !Number.isSafeInteger(row.points) || Math.abs(row.points) > 1000000 || row.rank !== i + 1)
        throw new Error('Hay participantes duplicados, puntos ilegibles o posiciones incompletas.');
      ids.add(row.id);
      if (i && payload.managers[i - 1].points < row.points) throw new Error('La tabla no está ordenada por puntos.');
      const clean = { id:row.id, name:row.name.trim(), points:row.points, rank:row.rank };
      const avatar = avatarUrl(row.avatarUrl);
      if (avatar) clean.avatarUrl = avatar;
      if (!general && row.id !== payload.excludedManagerId) {
        if (typeof row.negativeBalance !== 'boolean') throw new Error('Falta el estado del participante.');
        clean.negativeBalance = row.negativeBalance;
        if (row.negativeBalance) {
          if (row.points !== 0 || !Array.isArray(row.lineup) || row.lineup.length) throw new Error('Saldo negativo con puntuación o alineación contradictoria.');
          clean.lineup = [];
        } else clean.lineup = lineup(row.lineup);
      }
      return clean;
    });
    if (!general && !ids.has(payload.excludedManagerId)) throw new Error('Falta la cuenta de administrador en la captura.');
    return { version:1, league:{id:LEAGUE_ID}, kind:payload.kind, matchday:day, season, capturedAt:payload.capturedAt,
      ...(!general ? {gameweekId:payload.gameweekId, excludedManagerId:payload.excludedManagerId} : {}), managers };
  }
  function standings(payload, excludedId) {
    if (!excludedId || payload.managers.filter(row => row.id === excludedId).length !== 1)
      throw new Error('Identifica la cuenta de administrador que no compite.');
    return payload.managers.filter(row => row.id !== excludedId).map((row, i) => ({ ...row, rank:i + 1 }));
  }
  function suggestedExclusion(payload) {
    const candidates = payload.managers.filter(row => key(row.name) === 'ernesto');
    return candidates.length === 1 ? candidates[0].id : '';
  }
  function points(value) {
    const text = String(value ?? '').trim().replace(/−/g, '-').replace(/\s+(?:pts?\.?|puntos)$/i, '');
    if (/^[+-]?\d+$/.test(text)) return Number(text);
    if (/^[+-]?\d{1,3}(?:[.,\s]\d{3})+$/.test(text)) return Number(text.replace(/[.,\s]/g, ''));
    throw new Error('Hay un total ilegible. No se sustituye por cero.');
  }
  const api = { LEAGUE_ID, validate, lineup, standings, suggestedExclusion, points, avatarUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CubanSecondDivisionCore = api;
})(typeof globalThis === 'object' ? globalThis : this);
