(() => {
  'use strict';
  const core = globalThis.CubanMisterImportCore;
  const visible = e => Boolean(e && (e.offsetWidth || e.offsetHeight || e.getClientRects().length));
  const text = e => String(e?.textContent || '').trim();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let stopped = false;
  let running = false;
  let activeId = null;
  let panel;
  async function send(type, input) {
    const answer = await chrome.runtime.sendMessage({ type, input });
    if (!answer?.ok) throw new Error(answer?.error || 'La extensión dejó de responder.');
    return answer;
  }
  function show(message, error = false) {
    if (!panel) {
      panel = document.createElement('aside');
      panel.id = 'cuban-mister-extension-progress';
      panel.setAttribute('role', 'status');
      panel.setAttribute('aria-live', 'polite');
      Object.assign(panel.style, {position:'fixed',zIndex:'2147483647',right:'16px',bottom:'16px',
        width:'min(370px, calc(100vw - 64px))',padding:'18px',borderRadius:'16px',background:'#071b33',
        color:'#fff',boxShadow:'0 12px 40px #0008',font:'600 14px/1.5 system-ui',border:'1px solid #ffffff40'});
      document.documentElement.append(panel);
    }
    panel.style.background = error ? '#541a27' : '#071b33';
    panel.textContent = 'Cuban League · ' + message;
  }
  async function wait(check, message, timeout = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (stopped) throw new Error('Importación cancelada.');
      const result = check();
      if (result) return result;
      await sleep(150);
    }
    throw new Error(message + ' Si hay un anuncio, ciérralo y repite la importación.');
  }
  function league() {
    const link = document.querySelector('a.active[href*="action/change?id_community="]');
    const id = link ? new URL(link.href).searchParams.get('id_community') : null;
    if (!id || !/^\d+$/.test(id)) throw new Error('No se pudo identificar la liga activa. Abre tu liga en Mister.');
    return { id, name: text(link).replace(/\s+/g, ' ') };
  }
  function dayLinks() {
    return [...document.querySelectorAll('a[data-partial][href*="/standings?gw="]')].filter(visible);
  }
  function managerLinks() {
    return [...document.querySelectorAll('a.btn.btn-sw-link.user[href^="users/"]')].filter(visible);
  }
  function identity(link) {
    return { id: link.getAttribute('href')?.match(/users\/(\d+)/)?.[1] || '', name: text(link.querySelector('.info .name')) };
  }
  async function discover(job) {
    activeId = job.id;
    show('Comprobando liga y Jornada ' + job.matchday + '…');
    await wait(() => document.querySelector('button[data-tab="gameweek"]'), 'Inicia sesión en Mister y vuelve a importar.', 20000);
    const selectedLeague = league();
    const tab = document.querySelector('button[data-tab="gameweek"]');
    if (!tab.classList.contains('active')) tab.click();
    await wait(() => tab.classList.contains('active') && dayLinks().length, 'No cargó el calendario de Mister.');
    const calendar = dayLinks().map(link => ({
      matchday: Number(text(link).match(/^J\s*(\d+)$/i)?.[1]),
      gameweekId: Number(new URL(link.href).searchParams.get('gw'))
    })).filter(day => Number.isInteger(day.matchday) && day.matchday > 0 && day.gameweekId > 0);
    const requested = calendar.find(day => day.matchday === job.matchday);
    if (!requested) throw new Error('Mister todavía no muestra la Jornada ' + job.matchday + ' en esta liga. No se puede importar hasta que esté disponible.');
    const day = dayLinks().find(link => text(link).replace(/\s/g, '') === 'J' + job.matchday);
    if (!day.classList.contains('selected')) day.click();
    await wait(() => dayLinks().some(link => link.classList.contains('selected')
      && Number(new URL(link.href).searchParams.get('gw')) === requested.gameweekId), 'No se seleccionó la jornada solicitada.');
    await wait(() => managerLinks().length === 20, 'Mister no ha mostrado los 20 participantes.');
    if (league().id !== selectedLeague.id) throw new Error('La liga cambió durante la lectura.');
    const managers = managerLinks().map(identity);
    if (new Set(managers.map(m => m.id)).size !== 20 || managers.some(m => !m.id || !m.name)) throw new Error('No se identificaron los 20 participantes.');
    await send('DISCOVERED', { id: job.id, discovery: { league: selectedLeague, calendar, managers, gameweekId: requested.gameweekId } });
    show('Liga y jornada identificadas. El panel está preparando la captura.');
  }
  async function closeStats() {
    const close = [...document.querySelectorAll('#overlay.show button.popup-close')].find(visible);
    if (close) {
      close.click();
      await wait(() => ![...document.querySelectorAll('#overlay.show button.popup-close')].some(visible), 'No se pudo cerrar la ficha.');
    }
  }
  async function statistics(card, position, gameweekId) {
    await closeStats();
    card.click();
    const button = await wait(() => [...document.querySelectorAll('#overlay.show #popup-content [data-stats]')]
      .find(e => Number(e.dataset.id_gameweek) === gameweekId), 'No se pudo leer la ficha de ' + text(card.querySelector('.name')) + '.');
    let detailed = null;
    try { detailed = JSON.parse(button.getAttribute('data-marca_stats_rating_detailed_filtered') || 'null'); } catch {}
    const result = { ...core.statistics(detailed, position), fullName: String(button.dataset.name || '') };
    await closeStats();
    return result;
  }
  function assertContext(job) {
    if (stopped) throw new Error('Importación cancelada.');
    if (league().id !== job.discovery.league.id) throw new Error('La liga activa cambió. La captura se detuvo.');
    const day = dayLinks().find(link => link.classList.contains('selected'));
    if (!day || Number(new URL(day.href).searchParams.get('gw')) !== job.discovery.gameweekId) throw new Error('La jornada activa cambió. La captura se detuvo.');
  }
  async function collect(job) {
    if (running) return;
    running = true;
    activeId = job.id;
    const gameweekId = job.discovery.gameweekId;
    const capturedStartedAt = new Date().toISOString();
    const output = [];
    const cache = new Map();
    const warnings = [];
    try {
      for (let index = 0; index < job.discovery.managers.length; index++) {
        assertContext(job);
        const manager = job.discovery.managers[index];
        const progress = `Leyendo ${manager.name} (${index + 1}/20). Mantén abierta esta pestaña.`;
        show(progress);
        await send('PROGRESS', { id: job.id, progress });
        const link = managerLinks().find(link => identity(link).id === manager.id);
        if (!link) throw new Error('Falta ' + manager.name + ' en la tabla.');
        const node = [...link.children].find(e => e.classList.contains('points'));
        const officialPoints = core.number(String(node?.childNodes[0]?.textContent || '').trim());
        if (!Number.isInteger(officialPoints)) throw new Error('No se pudo leer el total de ' + manager.name + '.');
        const negative = /saldo negativo,\s*no punt[uú]a/i.test(text(link.querySelector('.info .played')));
        if (negative) {
          output.push({name: manager.name, misterManagerId: manager.id, ...core.summarize([], officialPoints, true)});
          continue;
        }
        await closeStats();
        link.click();
        const selector = '.team-lineup .lineup-starting a.lineup-player[data-id_manager="' + manager.id + '"][data-id_gameweek="' + gameweekId + '"]';
        await wait(() => [...document.querySelectorAll(selector)].filter(visible).length, 'No cargó la alineación de ' + manager.name + '.');
        const firstCard = [...document.querySelectorAll(selector)].find(visible);
        const starting = firstCard.closest('.lineup-starting');
        const lines = [...starting.children].filter(e => e.classList.contains('line') && visible(e));
        if (lines.length !== 4) throw new Error('Formación ilegible de ' + manager.name + '.');
        const lineup = [];
        for (let i = 0; i < lines.length; i++) {
          const position = ['DL', 'MC', 'DF', 'PT'][i];
          const slots = [...lines[i].querySelectorAll('.lineup-player')];
          for (const card of slots) {
            assertContext(job);
            const rawPoints = text(card.querySelector('.info .points, .points'));
            const id = String(card.dataset.id_player || '');
            // Only accept an explicit empty-position marker, never infer one from missing markup.
            const isEmpty = !id && /posici[oó]n vac[ií]a|sin jugador|hueco vac[ií]o/i.test(text(card));
            if (isEmpty) {
              if (core.number(rawPoints) !== -4) throw new Error('No se pudo confirmar la penalización de una posición vacía.');
              lineup.push({slotNumber:lineup.length+1, isEmpty:true, playerName:'Posición vacía', position,
                displayedPoints:-4,isCaptain:false,captainMultiplier:1,didPlay:null,status:'empty',goals:0,cleanSheet:0,redCard:0});
              continue;
            }
            if (!/^\d+$/.test(id) || String(card.dataset.id_manager) !== manager.id || Number(card.dataset.id_gameweek) !== gameweekId) throw new Error('Un puesto de ' + manager.name + ' no se pudo identificar.');
            const pointNode = card.querySelector('.info .points, .points');
            const parsed = core.points(rawPoints, pointNode?.classList.contains('pending') === true);
            const captainNode = card.querySelector('.captain-badge__multiplier');
            const multiplier = captainNode ? core.number(text(captainNode).replace(/^x/i, '')) : 1;
            let stats = {goals:0,cleanSheet:0,redCard:0,fullName:''};
            if (parsed.status === 'scored') {
              const cacheKey = id + ':' + gameweekId + ':' + position;
              if (cache.has(cacheKey)) stats = cache.get(cacheKey);
              else {
                if (!card.classList.contains('btn-player-gw')) throw new Error('No hay ficha estadística de ' + text(card.querySelector('.name')) + '.');
                stats = await statistics(card, position, gameweekId);
                cache.set(cacheKey, stats);
              }
            }
            lineup.push({slotNumber:lineup.length+1,misterPlayerId:id,playerName:text(card.querySelector('.name')),
              fullName:stats.fullName,misterClubId:String(card.querySelector('img.team-logo')?.src||'').match(/teams\/(\d+)/)?.[1]||'',
              position,displayedPoints:parsed.value,isCaptain:Boolean(captainNode),captainMultiplier:multiplier,
              didPlay:parsed.didPlay,status:parsed.status,goals:stats.goals,cleanSheet:stats.cleanSheet,redCard:stats.redCard});
          }
        }
        const result = core.summarize(lineup, officialPoints);
        result.warnings.forEach(warning => warnings.push(manager.name + ': ' + warning));
        output.push({name:manager.name,misterManagerId:manager.id,...result});
      }
      assertContext(job);
      const payload = {schemaVersion:3,source:'mister.mundodeportivo.com',season:job.season,matchday:job.matchday,
        gameweekId,league:job.discovery.league,capturedStartedAt,capturedAt:new Date().toISOString(),
        provisional:output.some(m=>m.lineup.some(p=>p.status==='pending')),warnings,managers:output};
      await send('RESULT',{id:job.id,payload});
      show('Lectura terminada. Vuelve a administración y espera “Borrador guardado”.');
    } catch (error) {
      show(error.message, true);
      await send('FAIL',{id:job.id,error:error.message}).catch(()=>{});
    } finally { running = false; }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === 'STOP' && message.id === activeId) { stopped = true; show('Lectura finalizada o cancelada desde el panel.'); respond({ok:true}); }
    if (message.type === 'RUN' && message.job?.id === activeId && !running) {
      stopped = false;
      collect(message.job);
      respond({ok:true});
    }
  });
  send('MISTER_READY',{}).then(async answer => {
    if (!answer.job) return;
    try { await discover(answer.job); }
    catch (error) { show(error.message, true); await send('FAIL',{id:answer.job.id,error:error.message}).catch(()=>{}); }
  }).catch(()=>{});
})();
