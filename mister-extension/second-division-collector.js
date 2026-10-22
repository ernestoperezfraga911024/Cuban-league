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
      return { id:managerId(link), name:text(link.querySelector('.info .name')),
        points:core.points(pointNode?.childNodes[0]?.textContent), rank:i + 1,
        ...(job.matchday ? {negativeBalance:/saldo negativo,\s*no punt[uú]a/i.test(text(link.querySelector('.info .played')))} : {}) };
    });
  }
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
    const selector = '.team-lineup .lineup-starting a.lineup-player[data-id_manager="' + manager.id + '"][data-id_gameweek="' + gameweekId + '"]';
    const first = await wait(() => [...document.querySelectorAll(selector)].find(visible), 'No cargó el once de ' + manager.name + '.');
    const lines = [...first.closest('.lineup-starting').children].filter(node => node.classList.contains('line') && visible(node));
    if (lines.length !== 4) throw new Error('Formación ilegible de ' + manager.name + '.');
    const lineup = [];
    for (let i = 0; i < lines.length; i++) {
      for (const card of lines[i].querySelectorAll('.lineup-player')) {
        context();
        const id = String(card.dataset.id_player || '');
        const node = card.querySelector('.info .points, .points');
        const raw = text(node);
        const empty = !id && /posici[oó]n vac[ií]a|sin jugador|hueco vac[ií]o/i.test(text(card));
        if (empty) {
          if (original.number(raw) !== -4) throw new Error('Penalización de posición vacía ilegible.');
          lineup.push({slot:lineup.length + 1, id:'', name:'Posición vacía', position:['DL','MC','DF','PT'][i],
            points:-4, status:'empty', captain:false, multiplier:1});
          continue;
        }
        if (String(card.dataset.id_manager) !== manager.id || Number(card.dataset.id_gameweek) !== gameweekId)
          throw new Error('La alineación no corresponde a la jornada solicitada.');
        const parsed = original.points(raw, node?.classList.contains('pending') === true, node?.classList.contains('not-played') === true);
        const captain = card.querySelector('.captain-badge__multiplier');
        lineup.push({slot:lineup.length + 1, id, name:text(card.querySelector('.name')), position:['DL','MC','DF','PT'][i],
          points:parsed.value, status:parsed.status, captain:Boolean(captain),
          multiplier:captain ? original.number(text(captain).replace(/^x/i, '')) : 1});
      }
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
        const fingerprint = managers ? JSON.stringify(managers) : '';
        stable = fingerprint && fingerprint === previous ? stable + 1 : 0; previous = fingerprint;
        if (stable >= 2) break;
        await sleep(400);
      }
      if (!managers || stable < 2) throw new Error('Mister no terminó de mostrar la clasificación.');
      const initial = JSON.stringify(managers);
      if (job.matchday) {
        const output = [];
        for (let i = 0; i < managers.length; i++) {
          show('Segunda · J' + job.matchday + ' · Leyendo ' + managers[i].name + ' (' + (i + 1) + '/' + managers.length + ')');
          output.push(await readLineup(managers[i]));
        }
        // Do not mix points from different updates of a live matchday.
        if (JSON.stringify(readRows()) !== initial) throw new Error('Los puntos cambiaron durante la lectura. Vuelve a importar para guardar una captura coherente.');
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
