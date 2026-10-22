/* Read-only Second Division. Fetch tables on entry and XIs only on demand. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const core = window.CubanSecondDivisionCore;
  const section = $('second-division');
  if (!section) return;
  const rows = $('secondDivisionRows'), status = $('secondDivisionStatus'), retry = $('secondDivisionRetry');
  const general = $('secondGeneral'), byDay = $('secondByDay'), picker = $('secondMatchday');
  const dialog = $('secondLineupDialog'), lineupBody = $('secondLineupBody'), lineupStatus = $('secondLineupStatus');
  const cache = new Map(), requests = new Map(), lineupCache = new Map();
  let mode = 'general', active = 0, token = 0, snapshot = null, shownDay = null, catalog = null, modalToken = 0, selectedManager = null;
  const number = new Intl.NumberFormat('es-ES', {maximumFractionDigits:1});
  async function query(table, params) {
    const config = window.CUBAN_LEAGUE_SUPABASE;
    if (!config?.url || !config.publishableKey || !config.season) throw new Error('Sin conexión.');
    const url = new URL(config.url + '/rest/v1/' + table);
    url.search = new URLSearchParams({season:'eq.' + config.season, ...params});
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {headers:{apikey:config.publishableKey}, cache:'no-store', signal:controller.signal});
      if (!response.ok) throw new Error('Sin conexión.');
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error('Respuesta incompleta.');
      return data;
    } finally { clearTimeout(timer); }
  }
  function participant(row) {
    const wrap = document.createElement('span'); wrap.className = 'second-participant';
    const fallback = document.createElement('span'); fallback.className = 'second-avatar second-avatar-fallback';
    fallback.setAttribute('aria-hidden', 'true');
    fallback.textContent = row.name.trim().split(/\s+/).slice(0,2).map(word => [...word][0]).join('').toUpperCase();
    const url = core.avatarUrl(row.avatarUrl);
    if (url) {
      const img = document.createElement('img'); img.className = 'second-avatar'; img.src = url; img.alt = '';
      img.width = 40; img.height = 40; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => img.replaceWith(fallback), {once:true}); wrap.append(img);
    } else wrap.append(fallback);
    const name = document.createElement('span'); name.className = 'second-participant-name'; name.textContent = row.name;
    wrap.append(name); return wrap;
  }
  function table(data, day) {
    const list = data?.standings;
    if (data && (!Array.isArray(list) || !list.length || list.length > 99 || data.matchday !== day
      || !Number.isSafeInteger(data.revision) || list.some((row, i) => !row || row.rank !== i + 1
        || !/^\d{1,20}$/.test(row.id) || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 120
        || !Number.isSafeInteger(row.points)))) throw new Error('Respuesta incompleta.');
    const fragment = document.createDocumentFragment();
    for (const row of list || []) {
      const tr = document.createElement('tr'), rank = document.createElement('td'), name = document.createElement('td'), points = document.createElement('td');
      rank.textContent = row.rank; points.textContent = number.format(row.points);
      if (day) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'second-manager';
        button.append(participant(row)); button.setAttribute('aria-label', 'Ver alineación de ' + row.name + ', jornada ' + day);
        button.addEventListener('click', () => openLineup(row)); name.append(button);
      } else name.append(participant(row));
      tr.append(rank, name, points); fragment.append(tr);
    }
    rows.replaceChildren(fragment); snapshot = data; shownDay = day;
    $('secondTableCaption').textContent = day ? 'Segunda División · Jornada ' + day : 'Segunda División · Clasificación general';
    $('secondDayHint').hidden = !day || !data;
    status.textContent = data ? 'Actualizado ' + new Date(data.updated_at).toLocaleString('es', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'})
      : day ? 'Esta jornada todavía no se ha publicado.' : 'La clasificación general de Segunda todavía no se ha publicado.';
  }
  async function fetchTable(day, force) {
    const hit = cache.get(day);
    if (!force && hit && Date.now() - hit.at < 60000) return hit.data;
    if (requests.has(day)) return requests.get(day);
    const request = query('second_division_standings', {matchday:'eq.' + day, league_id:'eq.978196',
      select:'matchday,standings,revision,updated_at,captured_at', limit:'1'}).then(result => {
      if (result.length > 1) throw new Error('Respuesta incompleta.');
      return result[0] || null;
    }).finally(() => requests.delete(day));
    requests.set(day, request);
    return request;
  }
  async function load(force = false) {
    const requestToken = ++token;
    section.setAttribute('aria-busy', 'true'); retry.hidden = true;
    if (shownDay !== active) { rows.replaceChildren(); snapshot = null; status.textContent = 'Cargando clasificación…'; }
    try {
      if (mode === 'matchday' && (!catalog || force || Date.now() - catalog.at >= 60000)) {
        const list = await query('second_division_standings', {matchday:'gt.0', select:'matchday', order:'matchday.desc', limit:'38'});
        if (requestToken !== token) return;
        if (list.some(row => !Number.isInteger(row.matchday) || row.matchday < 1 || row.matchday > 38)) throw new Error('Calendario ilegible.');
        catalog = {at:Date.now(), days:[...new Set(list.map(row => row.matchday))]};
        picker.replaceChildren();
        for (const day of catalog.days) picker.add(new Option('Jornada ' + day, String(day)));
        if (!catalog.days.length) picker.add(new Option('Sin jornadas publicadas', ''));
        if (!catalog.days.includes(active)) active = catalog.days[0] || null;
        picker.value = active ? String(active) : ''; picker.disabled = !catalog.days.length;
      }
      if (mode === 'matchday' && !active) {
        rows.replaceChildren(); snapshot = null; shownDay = null;
        status.textContent = 'Todavía no hay jornadas de Segunda publicadas.'; $('secondDayHint').hidden = true; return;
      }
      const day = active;
      const data = await fetchTable(day, force);
      if (requestToken !== token) return;
      table(data, day); cache.set(day, {data, at:Date.now()});
    } catch {
      if (requestToken !== token) return;
      status.textContent = snapshot && shownDay === active ? 'No se pudo actualizar. Se conserva la última tabla cargada.' : 'No se pudo cargar la clasificación de Segunda.';
      retry.hidden = false;
    } finally { if (requestToken === token) section.setAttribute('aria-busy', 'false'); }
  }
  function changeMode(next) {
    if (mode === next) return;
    mode = next; active = next === 'general' ? 0 : Number(picker.value) || null;
    general.setAttribute('aria-pressed', String(next === 'general')); byDay.setAttribute('aria-pressed', String(next === 'matchday'));
    $('secondDayControl').hidden = next !== 'matchday'; $('secondDayHint').hidden = true;
    load();
  }
  function drawLineup(data) {
    if (!data || typeof data.negative_balance !== 'boolean' || !Array.isArray(data.lineup)) throw new Error('Alineación no disponible.');
    lineupBody.replaceChildren();
    if (data.negative_balance) {
      if (data.lineup.length) throw new Error('Alineación no válida.');
      lineupStatus.textContent = 'Saldo negativo: no puntuó. Mister no facilitó un once válido para esta jornada.'; return;
    }
    const players = window.CubanSecondDivisionCore.lineup(data.lineup);
    const pitch = document.createElement('div'); pitch.className = 'second-pitch'; pitch.setAttribute('aria-label', 'Once titular');
    for (const position of ['DL','MC','DF','PT']) {
      const line = document.createElement('div'); line.className = 'second-pitch-line';
      for (const player of players.filter(p => p.position === position)) {
        const card = document.createElement('div'); card.className = 'second-player';
        const name = document.createElement('strong'), points = document.createElement('span');
        name.textContent = player.status === 'empty' ? 'Posición vacía' : player.name;
        if (player.status === 'empty') { card.classList.add('second-player-empty'); card.setAttribute('aria-label', 'Posición vacía, menos 4 puntos'); }
        points.textContent = player.status === 'pending' ? 'Pendiente' : player.status === 'did-not-play' ? 'No jugó · 0' : number.format(player.points) + ' pts';
        card.append(name, points);
        if (player.captain) { const badge = document.createElement('small'); badge.textContent = 'Capitán ×' + number.format(player.multiplier); card.append(badge); }
        line.append(card);
      }
      pitch.append(line);
    }
    lineupBody.append(pitch);
    const formation = ['DF','MC','DL'].map(pos => players.filter(p => p.position === pos).length).join('–');
    const total = players.reduce((sum, p) => sum + p.points, 0);
    lineupStatus.textContent = 'Formación ' + formation + ' · ' + number.format(data.points) + ' puntos oficiales.'
      + (players.some(p => p.status === 'pending') ? ' Jornada en curso: hay puntos pendientes.' : '')
      + (Math.abs(total - data.points) > 0.01 ? ' Las tarjetas suman ' + number.format(total) + '; se conserva el total oficial de Mister.' : '');
  }
  async function openLineup(manager) {
    if (!snapshot || !active) return;
    selectedManager = manager;
    const day = active, revision = snapshot.revision, key = day + ':' + revision + ':' + manager.id, requestToken = ++modalToken;
    $('secondLineupTitle').textContent = manager.name;
    $('secondLineupSubtitle').textContent = 'Segunda División · Jornada ' + day;
    lineupBody.replaceChildren(); lineupStatus.textContent = 'Cargando alineación…'; $('secondLineupRetry').hidden = true;
    if (!dialog.open) dialog.showModal();
    try {
      let data = lineupCache.get(key);
      if (!data) {
        const result = await query('second_division_lineups', {matchday:'eq.' + day, manager_id:'eq.' + manager.id, revision:'eq.' + revision,
          select:'lineup,negative_balance,points', limit:'1'});
        if (result.length !== 1) throw new Error('La jornada se actualizó o el once no está disponible. Cierra esta ventana y actualiza la tabla.');
        data = result[0];
      }
      if (requestToken !== modalToken || !dialog.open) return;
      drawLineup(data); lineupCache.set(key, data);
    } catch (error) {
      if (requestToken !== modalToken || !dialog.open) return;
      lineupStatus.textContent = error.message || 'No se pudo cargar la alineación.'; $('secondLineupRetry').hidden = false;
    }
  }
  general.addEventListener('click', () => changeMode('general'));
  byDay.addEventListener('click', () => changeMode('matchday'));
  picker.addEventListener('change', () => { active = Number(picker.value); load(); });
  $('secondLineupClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
  dialog.addEventListener('close', () => { modalToken++; });
  $('secondLineupRetry').addEventListener('click', async () => {
    const manager = selectedManager; dialog.close(); await load(true);
    const updated = snapshot?.standings.find(row => row.id === manager?.id);
    if (updated) openLineup(updated);
  });
  retry.addEventListener('click', () => load(true));
  const ifVisible = () => { if (document.body.dataset.section === 'second-division') load(); else if (dialog.open) dialog.close(); };
  new MutationObserver(ifVisible).observe(document.body, {attributes:true, attributeFilter:['data-section']});
  window.addEventListener('online', ifVisible);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') ifVisible(); });
  ifVisible();
})();
