/* Read standings and historical starting XIs; never edit Mister. */
(() => {
  'use strict';
  const core = globalThis.CubanSecondDivisionCore;
  const original = globalThis.CubanMisterImportCore;
  const visible = node => Boolean(node && (node.offsetWidth || node.offsetHeight || node.getClientRects().length));
  const text = node => String(node?.textContent || '').trim();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let job, gameweekId = null;
  async function send(type, input) {
    const response = await chrome.runtime.sendMessage({type, input});
    if (!response?.ok) throw new Error(response?.error || 'La extensión dejó de responder.');
    return response;
  }
  const dayLinks = () => [...document.querySelectorAll('a[data-partial][href*="/standings?gw="]')].filter(visible);
  const managerLinks = () => [...document.querySelectorAll('a.btn.btn-sw-link.user[href^="users/"]')].filter(visible);
  const managerId = link => link.getAttribute('href').match(/^users\/(\d+)(?:\/|$)/)?.[1] || '';
  function context(checkDay = true) {
    const selected = document.querySelector('a.active[href*="action/change?id_community="]');
    if (!selected || new URL(selected.href).searchParams.get('id_community') !== core.LEAGUE_ID)
      throw new Error('Selecciona «2da Cubanleague» en Mister y vuelve a importar Segunda desde el panel.');
    if (checkDay && job.matchday) {
      const day = dayLinks().find(link => link.classList.contains('selected'));
      if (!document.querySelector('button[data-tab="gameweek"].active') || !day
        || Number(new URL(day.href).searchParams.get('gw')) !== gameweekId)
        throw new Error('La jornada activa cambió. Vuelve a importar.');
    } else if (checkDay && (new URL(location.href).searchParams.has('gw') || document.querySelector('button[data-tab="gameweek"].active')))
      throw new Error('Abre la clasificación General de Segunda y vuelve a importar.');
  }
  async function wait(check, message, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const result = check();
      if (result) return result;
      await sleep(150);
    }
    throw new Error(message + ' Cierra los anuncios y vuelve a importar.');
  }
  async function selectScope() {
    await wait(() => document.querySelector('a.active[href*="action/change?id_community="]'), 'Inicia sesión en Mister.', 20000);
    context(false);
    if (!job.matchday) {
      const general = [...document.querySelectorAll('button[data-tab]')].find(node => /^general$/i.test(text(node)));
      if (general && !general.classList.contains('active')) general.click();
      await wait(() => !document.querySelector('button[data-tab="gameweek"].active')
        && !new URL(location.href).searchParams.has('gw'), 'No se seleccionó General.');
      return;
    }
    const tab = await wait(() => document.querySelector('button[data-tab="gameweek"]'), 'No cargó el calendario.');
    if (!tab.classList.contains('active')) tab.click();
    await wait(() => tab.classList.contains('active') && dayLinks().length, 'No cargó el calendario.');
    const day = dayLinks().find(link => text(link).replace(/\s/g, '') === 'J' + job.matchday);
    if (!day) throw new Error('Mister todavía no muestra la Jornada ' + job.matchday + ' en esta liga.');
    gameweekId = Number(new URL(day.href).searchParams.get('gw'));
    if (!Number.isSafeInteger(gameweekId) || gameweekId < 1) throw new Error('No se pudo identificar la jornada de Mister.');
    if (!day.classList.contains('selected')) day.click();
    await wait(() => dayLinks().some(link => link.classList.contains('selected')
      && Number(new URL(link.href).searchParams.get('gw')) === gameweekId), 'No se seleccionó la jornada.');
  }
  function photo(link) {
    const image = [...link.querySelectorAll('img')].find(node => !node.closest('.points') && !node.matches('.team-logo'));
    const sources = image ? [image.getAttribute('data-src'), image.currentSrc, image.getAttribute('src')] : [];
    for (const node of [link, ...link.querySelectorAll('[style]')]) {
      const background = node.style.backgroundImage;
      const match = background.match(/^url\(["']?(.*?)["']?\)$/);
      if (match) sources.push(match[1]);
    }
    for (const source of sources) {
      if (!source) continue;
      try { const url = core.avatarUrl(new URL(source, location.href).href); if (url) return url; } catch {}
    }
    return null;
  }
  function emptySlot(card, manager) {
    const id = String(card.dataset.id_player || '').trim();
    const name = text(card.querySelector('.name'));
    const emptyLabel = /posici[oó]n vac[ií]a|sin jugador|hueco vac[ií]o/i;
    // Mister also renders an unnamed, unassigned tile with an explicit −4.
    // A missing card or an ordinary player's negative score is not an empty slot.
    if (id && id !== '0') return false;
    if (name && !emptyLabel.test(name)) return false;
    if (!emptyLabel.test(text(card)) && text(card).replace(/\s/g,'') !== '-4'
      && text(card).replace(/\s/g,'') !== '−4') return false;
    if (original.number(text(card.querySelector('.info .points, .points'))) !== -4) return false;
    return (!card.dataset.id_manager || card.dataset.id_manager === '0' || String(card.dataset.id_manager) === manager.id)
      && (!card.dataset.id_gameweek || card.dataset.id_gameweek === '0' || Number(card.dataset.id_gameweek) === gameweekId);
  }
  function visibleSlots(starting, manager) {
    const lines = [...starting.children].filter(node => node.classList.contains('line') && visible(node));
    return lines.map((line, i) => {
      const cards = [...line.querySelectorAll('.lineup-player')]
        .filter(card => visible(card) && !card.parentElement.closest('.lineup-player'));
      // Empty tiles can be plain elements rather than links to a footballer.
      for (const child of line.children) {
        if (visible(child) && !child.matches('.lineup-player') && !child.querySelector('.lineup-player')
          && emptySlot(child, manager)) cards.push(child);
      }
      cards.sort((a,b) => a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
      return cards.map(card => ({card, position:['DL','MC','DF','PT'][i]}));
    });
  }
  async function historicalSlots(manager) {
    let last = '', stable = 0, confirmed = 0, triedDay = false;
    const deadline = Date.now() + 18000;
    while (Date.now() < deadline) {
      context();
      const candidates = [...document.querySelectorAll('.team-lineup .lineup-starting')].filter(visible);
      let complete = false;
      for (const starting of candidates) {
        const groups = visibleSlots(starting, manager), slots = groups.flat();
        const matches = slots.filter(({card}) => /^[1-9]\d*$/.test(card.dataset.id_player || '')
          && String(card.dataset.id_manager) === manager.id && Number(card.dataset.id_gameweek) === gameweekId);
        const empty = ({card}) => emptySlot(card, manager);
        confirmed = Math.max(confirmed, slots.filter(slot => matches.includes(slot) || empty(slot)).length);
        if (groups.length !== 4 || slots.length !== 11 || !matches.length
          || !slots.every(slot => matches.includes(slot) || empty(slot))) continue;
        complete = true;
        const fingerprint = JSON.stringify(slots.map(({card,position}) => [position,card.dataset.id_player,card.outerHTML]));
        stable = fingerprint === last ? stable + 1 : 0; last = fingerprint;
        if (stable >= 2) return slots;
      }
      if (!complete) { last = ''; stable = 0; }
      // Some historical participant views initially show their current XI.
      // Use only a real same-origin link already rendered by Mister for this manager/day.
      if (!triedDay) {
        const target = [...document.querySelectorAll('a[href]')].filter(visible).find(link => {
          try {
            const url = new URL(link.href);
            return url.origin === location.origin && url.pathname.split('/').includes(manager.id)
              && Number(url.searchParams.get('gw')) === gameweekId
              && /^J\s*\d+$/i.test(text(link)) && Number(text(link).replace(/\D/g,'')) === job.matchday;
          } catch { return false; }
        });
        if (target && !target.classList.contains('selected')) { target.click(); triedDay = true; last = ''; stable = 0; }
      }
      if ((await send('SECOND_READY', {})).job?.id !== job.id) throw new Error('Lectura cancelada.');
      await sleep(250);
    }
    throw new Error('No se pudo confirmar el once completo de ' + manager.name + ' en la Jornada ' + job.matchday
      + ' (' + confirmed + '/11 puestos identificados). Abre esa jornada y su alineación en Mister y vuelve a importar. No se guardó ningún dato.');
  }
  function readRows() {
    const links = managerLinks();
    if (links.length < 2) return null;
    if ([...document.querySelectorAll('button, a')].some(node => visible(node)
      && /^(cargar más|mostrar más|ver más participantes|siguiente)$/i.test(text(node))))
      throw new Error('Carga la clasificación completa de Mister antes de importar.');
    return links.map((link, i) => {
      const pointNode = [...link.children].find(node => node.classList.contains('points'));
      const displayedRank = text(link.querySelector('.position, .rank')).replace(/[.ºª]/g, '').trim();
      if (displayedRank && /^\d+$/.test(displayedRank) && Number(displayedRank) !== i + 1)
        throw new Error('La clasificación está incompleta o no empieza en el primer puesto.');
      return { id:managerId(link), name:text(link.querySelector('.info .name')), avatarUrl:photo(link),
        points:core.points(pointNode?.childNodes[0]?.textContent), rank:i + 1,
        ...(job.matchday ? {negativeBalance:/saldo negativo,\s*no punt[uú]a/i.test(text(link.querySelector('.info .played')))} : {}) };
    });
  }
  // Lazy photo loading must not be mistaken for a change in sporting results.
  const standingsSignature = managers => JSON.stringify(managers?.map(({avatarUrl, ...row}) => row));
  function show(message, error = false) {
    let panel = document.getElementById('cuban-second-progress');
    if (!panel) {
      panel = document.createElement('aside'); panel.id = 'cuban-second-progress'; panel.setAttribute('role','status');
      Object.assign(panel.style, {position:'fixed', bottom:'18px', right:'18px', zIndex:'2147483646',
        maxWidth:'340px', padding:'18px', borderRadius:'12px', color:'#f1f4e8', font:'600 14px/1.5 system-ui'});
      document.documentElement.append(panel);
    }
    panel.style.background = error ? '#541a27' : '#153b27'; panel.textContent = message;
  }
  async function readLineup(manager) {
    context();
    // Detect cancellation before opening each participant.
    if ((await send('SECOND_READY', {})).job?.id !== job.id) throw new Error('Lectura cancelada.');
    if (manager.id === job.excludedManagerId) return manager;
    if (manager.negativeBalance) return {...manager, lineup:[]};
    const link = managerLinks().find(node => managerId(node) === manager.id);
    if (!link) throw new Error('Falta ' + manager.name + ' en la tabla.');
    link.click();
    const slots = await historicalSlots(manager);
    const lineup = [];
    for (const {card,position} of slots) {
        context();
        const id = String(card.dataset.id_player || '');
        const node = card.querySelector('.info .points, .points');
        const raw = text(node);
        const empty = emptySlot(card, manager);
        if (empty) {
          if (original.number(raw) !== -4) throw new Error('Penalización de posición vacía ilegible.');
          lineup.push({slot:lineup.length + 1, id:'', name:'Posición vacía', position,
            points:-4, status:'empty', captain:false, multiplier:1});
          continue;
        }
        if (String(card.dataset.id_manager) !== manager.id || Number(card.dataset.id_gameweek) !== gameweekId)
          throw new Error('La alineación no corresponde a la jornada solicitada.');
        const parsed = original.points(raw, node?.classList.contains('pending') === true, node?.classList.contains('not-played') === true);
        const captain = card.querySelector('.captain-badge__multiplier');
        lineup.push({slot:lineup.length + 1, id, name:text(card.querySelector('.name')), position,
          points:parsed.value, status:parsed.status, captain:Boolean(captain),
          multiplier:captain ? original.number(text(captain).replace(/^x/i, '')) : 1});
    }
    return {...manager, lineup:core.lineup(lineup)};
  }
  async function run() {
    try {
      job = (await send('SECOND_READY', {})).job;
      if (!job) return;
      show('Segunda División · Leyendo ' + (job.matchday ? 'Jornada ' + job.matchday : 'General') + '…');
      await selectScope();
      let previous = '', stable = 0, managers;
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        context(); managers = readRows();
        const fingerprint = managers ? standingsSignature(managers) : '';
        stable = fingerprint && fingerprint === previous ? stable + 1 : 0; previous = fingerprint;
        if (stable >= 2) break;
        await sleep(400);
      }
      if (!managers || stable < 2) throw new Error('Mister no terminó de mostrar la clasificación.');
      const initial = standingsSignature(managers);
      if (job.matchday) {
        const output = [];
        for (let i = 0; i < managers.length; i++) {
          show('Segunda · J' + job.matchday + ' · Leyendo ' + managers[i].name + ' (' + (i + 1) + '/' + managers.length + ')');
          output.push(await readLineup(managers[i]));
        }
        // Do not mix points from different updates of a live matchday.
        if (standingsSignature(readRows()) !== initial) throw new Error('Los puntos cambiaron durante la lectura. Vuelve a importar para guardar una captura coherente.');
        managers = output;
      }
      context();
      const payload = core.validate({version:1, kind:job.matchday ? 'matchday' : 'general', matchday:job.matchday,
        season:job.season, league:{id:core.LEAGUE_ID}, capturedAt:new Date().toISOString(), managers,
        ...(job.matchday ? {gameweekId, excludedManagerId:job.excludedManagerId} : {})}, job.season);
      await send('SECOND_RESULT', {id:job.id, payload});
      show('Segunda División · Lectura terminada. Vuelve al panel para revisar y publicar.');
    } catch (error) {
      if (!job) return;
      show('Segunda División · ' + error.message, true);
      await send('SECOND_FAIL', {id:job.id, error:error.message}).catch(() => {});
    }
  }
  run();
})();
