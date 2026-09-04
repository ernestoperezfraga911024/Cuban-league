(() => {
  'use strict';

  if (window.__CUBAN_LEAGUE_MISTER_IMPORT_RUNNING__) return;
  window.__CUBAN_LEAGUE_MISTER_IMPORT_RUNNING__ = true;

  const ENDPOINT = 'https://pyahosamoisqcbpvzwka.supabase.co/functions/v1/mister-import-collector';
  const IMPORT_VERSION = 2;
  const parameters = new URLSearchParams(window.location.search);
  const requestId = parameters.get('cuban_request') || '';
  let token = parameters.get('cuban_token') || '';
  const matchday = Number(parameters.get('cuban_matchday'));
  const gameweekId = Number(parameters.get('gw'));

  ['cuban_request', 'cuban_token', 'cuban_matchday'].forEach(name => parameters.delete(name));
  const cleanQuery = parameters.toString();
  try {
    history.replaceState(null, '', window.location.pathname + (cleanQuery ? '?' + cleanQuery : '') + window.location.hash);
  } catch {}

  const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const isVisible = element => Boolean(element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length));
  const text = element => String(element?.textContent || '').trim();
  const pointValue = raw => {
    const cleaned = String(raw || '').trim().replace(/−/g, '-').replace(',', '.');
    if (!cleaned || cleaned === '-' || cleaned === '—') return 0;
    const value = Number(cleaned.replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(value)) throw new Error('Mister mostró una puntuación que no se pudo leer.');
    return value;
  };
  const statValue = (stats, key, field = 'value') => {
    const entry = stats?.[key];
    const raw = entry && typeof entry === 'object' ? entry[field] : entry;
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
  };
  const waitFor = async (check, timeout = 12000, interval = 120) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const value = check();
      if (value) return value;
      await sleep(interval);
    }
    throw new Error('Mister tardó demasiado en cargar uno de los datos.');
  };

  const overlay = document.createElement('aside');
  overlay.id = 'cuban-league-mister-import-progress';
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.innerHTML = `
    <style>
      #cuban-league-mister-import-progress{position:fixed;z-index:2147483647;right:18px;bottom:18px;width:min(390px,calc(100vw - 36px));box-sizing:border-box;padding:18px;border:1px solid rgba(255,255,255,.18);border-radius:18px;background:#071b33;color:#fff;box-shadow:0 22px 60px rgba(0,0,0,.38);font:600 14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      #cuban-league-mister-import-progress strong{display:block;margin-bottom:6px;font-size:16px}
      #cuban-league-mister-import-progress p{margin:0;color:#d9e8f7}
      #cuban-league-mister-import-progress .cuban-import-meter{height:7px;margin-top:13px;overflow:hidden;border-radius:99px;background:rgba(255,255,255,.12)}
      #cuban-league-mister-import-progress .cuban-import-meter i{display:block;width:3%;height:100%;border-radius:inherit;background:#21d07a;transition:width .25s ease}
      #cuban-league-mister-import-progress.success{background:#073622}
      #cuban-league-mister-import-progress.error{background:#4b1520}
    </style>
    <strong>Importando a Cuban League</strong>
    <p>Comprobando la jornada…</p>
    <div class="cuban-import-meter"><i></i></div>
  `;
  document.documentElement.appendChild(overlay);
  const progressText = overlay.querySelector('p');
  const progressBar = overlay.querySelector('i');
  const setProgress = (message, percent = 3) => {
    progressText.textContent = message;
    progressBar.style.width = Math.max(3, Math.min(100, percent)) + '%';
  };

  const reportFailure = async message => {
    overlay.classList.add('error');
    setProgress(message, 100);
    try {
      if (requestId && token) {
        await fetch(ENDPOINT, {
          method: 'POST',
          mode: 'cors',
          credentials: 'omit',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId, token, error: message })
        });
      }
    } catch {}
    token = '';
    window.__CUBAN_LEAGUE_MISTER_IMPORT_RUNNING__ = false;
  };

  const closePlayerPopup = async () => {
    const statsNode = document.querySelector('#overlay.show #popup-content [data-stats]');
    if (!statsNode) return;
    const close = document.querySelector('#overlay.show .popup-close');
    if (close) close.click();
    await waitFor(() => !document.querySelector('#overlay.show #popup-content [data-stats]'), 7000);
  };

  const readPlayerStats = async (card, position, cache) => {
    const playerId = String(card.dataset.id_player || '');
    const cacheKey = playerId + ':' + gameweekId;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    const rawPoints = text(card.querySelector('.info .points, .points'));
    if (rawPoints === '-' || rawPoints === '—') {
      const empty = { goals: 0, cleanSheet: 0, redCard: 0, fullName: '' };
      cache.set(cacheKey, empty);
      return empty;
    }
    if (!card.classList.contains('btn-player-gw')) {
      throw new Error('No se pudo abrir la ficha de ' + text(card.querySelector('.name')) + '.');
    }

    await closePlayerPopup();
    card.click();
    const statsButton = await waitFor(() => {
      const candidates = [...document.querySelectorAll('#overlay.show #popup-content [data-stats]')];
      return candidates.find(element => Number(element.dataset.id_gameweek) === gameweekId) || null;
    }, 14000);

    let detailed = {};
    try {
      detailed = JSON.parse(statsButton.getAttribute('data-marca_stats_rating_detailed_filtered') || '{}');
    } catch {
      throw new Error('Mister devolvió estadísticas incompletas de ' + text(card.querySelector('.name')) + '.');
    }

    const minutes = statValue(detailed, 'minutesPlayed');
    const goalsAgainst = statValue(detailed, 'goalsAgainst');
    const cleanSheetRating = statValue(detailed, 'goalsAgainst', 'rating');
    const result = {
      goals: Math.max(0, Math.trunc(statValue(detailed, 'goals'))),
      cleanSheet: position === 'PT' && minutes > 0 && goalsAgainst === 0 && cleanSheetRating > 0 ? 1 : 0,
      redCard: statValue(detailed, 'redCard') > 0 || statValue(detailed, 'doubleYellowCard') > 0 ? 1 : 0,
      fullName: String(statsButton.dataset.name || '').trim()
    };
    cache.set(cacheKey, result);
    await closePlayerPopup();
    return result;
  };

  const run = async () => {
    if (window.location.hostname !== 'mister.mundodeportivo.com') {
      throw new Error('Abre este ayudante dentro de mister.mundodeportivo.com.');
    }
    if (!/^[0-9a-f-]{36}$/i.test(requestId) || !/^[0-9a-f]{64}$/.test(token)
        || !Number.isInteger(matchday) || matchday < 1 || matchday > 38
        || !Number.isInteger(gameweekId) || gameweekId <= 0) {
      throw new Error('La solicitud de Cuban League es inválida o ya fue usada. Iníciala otra vez desde el panel.');
    }

    const jornadaButton = [...document.querySelectorAll('button[data-tab="gameweek"]')]
      .find(element => isVisible(element) && /jornada/i.test(text(element)));
    if (!jornadaButton?.classList.contains('active')) {
      jornadaButton?.click();
      await waitFor(() => jornadaButton.classList.contains('active'), 7000);
    }

    const selectedDay = [...document.querySelectorAll('a[data-partial][href*="/standings?gw="]')]
      .find(element => isVisible(element) && element.classList.contains('selected'));
    if (!selectedDay || text(selectedDay).replace(/\s+/g, '').toUpperCase() !== ('J' + matchday)) {
      throw new Error('Mister no tiene seleccionada la Jornada ' + matchday + '.');
    }
    const selectedUrl = new URL(selectedDay.href, window.location.href);
    if (Number(selectedUrl.searchParams.get('gw')) !== gameweekId) {
      throw new Error('El identificador de la jornada de Mister no coincide.');
    }

    const managerLinks = [...document.querySelectorAll('a.btn.btn-sw-link.user[href^="users/"]')]
      .filter(isVisible);
    if (managerLinks.length !== 20) {
      throw new Error('Se esperaban 20 participantes y Mister mostró ' + managerLinks.length + '.');
    }

    const managers = managerLinks.map(link => {
      const href = String(link.getAttribute('href') || '');
      const managerId = href.match(/users\/(\d+)/)?.[1] || '';
      const pointsNode = [...link.children].find(child => child.classList?.contains('points'));
      return {
        link,
        managerId,
        name: text(link.querySelector('.info .name')),
        points: pointValue(pointsNode?.childNodes?.[0]?.textContent || text(pointsNode)),
        negativeBalanceNoScore: /saldo negativo,\s*no punt[uú]a/i.test(text(link.querySelector('.info .played')))
      };
    });
    if (managers.some(manager => !manager.managerId || !manager.name)) {
      throw new Error('No se pudo identificar a todos los participantes de Mister.');
    }

    const statsCache = new Map();
    const output = [];
    const positionsByLine = ['DL', 'MC', 'DF', 'PT'];

    for (let managerIndex = 0; managerIndex < managers.length; managerIndex += 1) {
      const manager = managers[managerIndex];
      setProgress('Leyendo ' + manager.name + ' (' + (managerIndex + 1) + '/20)…', 7 + (managerIndex / managers.length) * 84);
      await closePlayerPopup();

      if (manager.negativeBalanceNoScore) {
        if (manager.points !== 0) {
          throw new Error(manager.name + ' aparece con saldo negativo, pero Mister no muestra 0 puntos.');
        }
        output.push({
          misterManagerId: manager.managerId,
          name: manager.name,
          points: 0,
          goals: 0,
          cleanSheets: 0,
          redCards: 0,
          negativeBalanceNoScore: true,
          lineup: []
        });
        setProgress(manager.name + ': saldo negativo detectado, todo queda en 0.', 7 + ((managerIndex + 1) / managers.length) * 84);
        continue;
      }

      manager.link.click();

      const cards = await waitFor(() => {
        const found = [...document.querySelectorAll(
          '.team-lineup .lineup-starting a.lineup-player[data-id_manager="' + manager.managerId + '"][data-id_gameweek="' + gameweekId + '"]'
        )].filter(isVisible);
        return found.length === 11 ? found : null;
      }, 15000);

      const lineup = [];
      let goals = 0;
      let cleanSheets = 0;
      let redCards = 0;
      const visibleLines = [...document.querySelectorAll('.team-lineup .lineup-starting > .line')]
        .filter(line => isVisible(line) && line.querySelector(
          'a.lineup-player[data-id_manager="' + manager.managerId + '"][data-id_gameweek="' + gameweekId + '"]'
        ));

      if (visibleLines.length !== 4) {
        throw new Error('No se pudo leer la formación de ' + manager.name + '.');
      }

      for (let lineIndex = 0; lineIndex < visibleLines.length; lineIndex += 1) {
        const position = positionsByLine[lineIndex];
        const lineCards = [...visibleLines[lineIndex].querySelectorAll(
          'a.lineup-player[data-id_manager="' + manager.managerId + '"][data-id_gameweek="' + gameweekId + '"]'
        )].filter(isVisible);

        for (const card of lineCards) {
          const rawPoints = text(card.querySelector('.info .points, .points'));
          const captainNode = card.querySelector('.captain-badge__multiplier');
          const multiplier = captainNode
            ? Number(text(captainNode).toLowerCase().replace('x', '').replace(',', '.'))
            : 1;
          if (captainNode && ![1.5, 2, 3].includes(multiplier)) {
            throw new Error('El multiplicador del capitán de ' + manager.name + ' no es válido.');
          }

          const ownStats = await readPlayerStats(card, position, statsCache);
          goals += ownStats.goals;
          cleanSheets += ownStats.cleanSheet;
          redCards += ownStats.redCard;
          const teamLogo = card.querySelector('img.team-logo');
          const misterClubId = String(teamLogo?.src || '').match(/teams\/(\d+)/)?.[1] || '';

          lineup.push({
            slotNumber: lineup.length + 1,
            misterPlayerId: String(card.dataset.id_player || ''),
            playerName: text(card.querySelector('.name')),
            fullName: ownStats.fullName,
            misterClubId,
            position,
            displayedPoints: pointValue(rawPoints),
            isCaptain: Boolean(captainNode),
            captainMultiplier: captainNode ? multiplier : 1,
            didPlay: rawPoints !== '-' && rawPoints !== '—'
          });
        }
      }

      if (lineup.length !== 11) {
        throw new Error('La alineación de ' + manager.name + ' tiene ' + lineup.length + ' jugadores.');
      }
      const lineupTotal = lineup.reduce((sum, player) => sum + player.displayedPoints, 0);
      if (Math.abs(lineupTotal - manager.points) > 0.01) {
        throw new Error('Los puntos visibles de ' + manager.name + ' suman ' + lineupTotal + ', pero Mister muestra ' + manager.points + '.');
      }

      output.push({
        misterManagerId: manager.managerId,
        name: manager.name,
        points: manager.points,
        goals,
        cleanSheets,
        redCards,
        negativeBalanceNoScore: false,
        lineup
      });
    }

    setProgress('Enviando la captura segura al panel…', 94);
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId,
        token,
        payload: {
          schemaVersion: IMPORT_VERSION,
          source: 'mister.mundodeportivo.com',
          capturedAt: new Date().toISOString(),
          matchday,
          gameweekId,
          managers: output
        }
      })
    });
    const answer = await response.json().catch(() => ({}));
    if (!response.ok || answer.ok !== true) {
      throw new Error(answer.error || 'Cuban League no aceptó la captura.');
    }

    token = '';
    overlay.classList.add('success');
    setProgress('Listo. Vuelve al panel: allí se validará y guardará el borrador. No se ha publicado nada.', 100);
    window.__CUBAN_LEAGUE_MISTER_IMPORT_RUNNING__ = false;
  };

  run().catch(error => {
    reportFailure(String(error?.message || error || 'No se pudo completar la importación.'));
  });
})();
