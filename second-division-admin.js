/* Independent Second Division admin controls. Shares the authenticated client only. */
(() => {
  'use strict';
  const core = window.CubanSecondDivisionCore;
  const $ = id => document.getElementById(id);
  let client, season, call, blocked, initialized = false;
  let current = null, excludedId = '', revision = 0, payload = null, jobId = null;
  let timer, generation = 0, stateRequest = 0, busy = false, saving = false, baseline = [];
  const scope = () => Number($('secondImportScope').value);
  const label = () => scope() ? 'Jornada ' + scope() : 'General';
  function message(value) { $('secondAdminStatus').textContent = value; }
  function buttons() {
    $('secondImport').disabled = busy || saving;
    $('secondImportScope').disabled = busy || saving || Boolean(payload);
    $('secondCancel').hidden = !busy && !payload;
    $('secondCancel').disabled = saving;
    $('secondPublish').disabled = saving || !payload || !$('secondExcluded').value;
    $('secondExcluded').disabled = saving || Boolean(excludedId);
  }
  async function state() {
    const request = ++stateRequest, session = generation, day = scope();
    const { data, error } = await client.rpc('get_second_division_admin_state', { p_season:season, p_matchday:day });
    if (request !== stateRequest || session !== generation || day !== scope()) return null;
    if (error) throw error;
    if (!data || !Number.isSafeInteger(data.revision) || data.revision < 0) throw new Error('No se pudo leer el estado de Segunda.');
    current = data.snapshot; excludedId = data.excludedId || ''; revision = data.revision; baseline = data.baselineStandings || [];
    const days = Array.isArray(data.publishedMatchdays) ? data.publishedMatchdays.filter(day => Number.isInteger(day) && day >= 0 && day <= 38) : [];
    for (const option of $('secondImportScope').options) {
      const day = Number(option.value);
      option.textContent = (day ? 'Jornada ' + day : 'General') + ' · ' + (days.includes(day) ? 'Guardada' : 'Pendiente');
    }
    const saved = days.filter(day => day > 0).sort((a,b) => a-b);
    $('secondSavedDays').textContent = saved.length ? 'Jornadas guardadas: ' + saved.map(day => 'J' + day).join(', ') + '. Cada importación actualiza solo la jornada elegida.'
      : 'Todavía no hay jornadas guardadas. Importa y publica cada jornada para conservar su tabla y sus alineaciones.';
    return data;
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
  function renderReview() {
    const selected = $('secondExcluded').value;
    const rows = selected ? core.standings(payload, selected) : [];
    const fragment = document.createDocumentFragment();
    for (const row of rows) {
      const tr = document.createElement('tr');
      const rank = document.createElement('td'), name = document.createElement('td'), points = document.createElement('td');
      rank.textContent = row.rank; name.append(participant(row)); points.textContent = row.points;
      tr.append(rank, name, points);
      fragment.appendChild(tr);
    }
    $('secondPreviewRows').replaceChildren(fragment);
    $('secondReviewCount').textContent = selected ? rows.length + ' participantes · cuenta de administrador excluida' : 'Selecciona tu cuenta de administrador para excluirla.';
    const before = baseline.map(row => row.id).sort().join(',');
    const after = rows.map(row => row.id).sort().join(',');
    $('secondRosterWarning').hidden = !baseline.length || !selected || before === after;
    $('secondAllowRoster').checked = false;
    buttons();
  }
  function review(capture) {
    payload = core.validate(capture, season);
    if (payload.matchday !== scope()) throw new Error('La captura corresponde a otra jornada.');
    const selected = excludedId || core.suggestedExclusion(payload);
    if (excludedId && !payload.managers.some(row => row.id === excludedId))
      throw new Error('Falta tu cuenta de administrador en la captura. Comprueba que la clasificación esté completa.');
    const select = $('secondExcluded');
    select.replaceChildren(new Option('Seleccionar cuenta de administrador', ''));
    for (const row of payload.managers) select.add(new Option(row.name, row.id));
    select.value = selected;
    $('secondReview').hidden = false;
    renderReview();
    const playing = payload.managers.filter(row => row.id !== selected);
    const mismatches = playing.filter(row => row.lineup?.length && Math.abs(row.lineup.reduce((total,p) => total+p.points,0)-row.points) > 0.01);
    const pending = playing.some(row => row.lineup?.some(p => p.status === 'pending'));
    $('secondReviewWarnings').textContent = (payload.matchday ? 'Se incluyen ' + playing.filter(row => row.lineup?.length).length + ' alineaciones. ' : '')
      + (pending ? 'Hay jugadores pendientes: los puntos son provisionales. ' : '')
      + (mismatches.length ? 'Las tarjetas y el total oficial difieren en: ' + mismatches.map(row => row.name).join(', ') + '. Se publicará el total oficial de Mister.' : '');
    message(label() + ' leída. Revisa los participantes y sus puntos antes de publicar.');
  }
  async function poll(token, id) {
    if (token !== generation) return;
    try {
      const { job } = await call('SECOND_STATUS', { id });
      if (token !== generation) return;
      if (job.status === 'failed') throw new Error(job.error || 'No se pudo completar la lectura.');
      if (job.status === 'ready') {
        busy = false; review(job.payload); buttons(); return;
      }
      if (job.status !== 'reading') throw new Error('La lectura ya no está activa. Vuelve a importar.');
      timer = setTimeout(() => poll(token, id), 1500);
    } catch (error) {
      if (token !== generation) return;
      busy = false; message(error.message || String(error)); buttons();
    }
  }
  async function cancel() {
    if (saving) return;
    generation++; clearTimeout(timer);
    const old = jobId; jobId = null; payload = null; busy = false;
    $('secondReview').hidden = true;
    buttons();
    if (old) await call('SECOND_CANCEL', { id:old }).catch(() => {});
    message('Lectura descartada. La clasificación publicada se conserva.');
  }
  async function start() {
    if (busy || saving) return;
    if (blocked?.()) { message('Termina la operación de Primera antes de importar Segunda.'); return; }
    await cancel();
    const token = ++generation;
    busy = true; buttons(); message('Preparando la lectura de Segunda…');
    try {
      await state();
      if (token !== generation) return;
      if (scope() && !excludedId) throw new Error('Publica primero General e identifica tu cuenta de administrador. Después podrás importar jornadas.');
      const hello = await call('HELLO');
      if (token !== generation) return;
      if (hello.secondDivision !== true || hello.secondHistory !== true || hello.secondEmptySlots !== true) throw new Error('Actualiza la extensión a 1.1.2 y recarga Mister y este panel. Usa «Actualizar extensión».');
      const result = await call('SECOND_START', { season, matchday:scope(), excludedManagerId:excludedId });
      if (token !== generation) { await call('SECOND_CANCEL', { id:result.id }).catch(() => {}); return; }
      jobId = result.id;
      message('Leyendo ' + label() + '. Mantén abierta la pestaña de «2da Cubanleague».');
      poll(token, jobId);
    } catch (error) {
      if (token !== generation) return;
      busy = false; message(error.message || String(error)); buttons();
    }
  }
  async function publish() {
    if (!payload || busy || saving) return;
    const selected = $('secondExcluded').value;
    if (!selected) return;
    if (!$('secondRosterWarning').hidden && !$('secondAllowRoster').checked) {
      message('La lista de participantes cambió. Revisa la tabla y confirma ese cambio.'); return;
    }
    saving = true; buttons(); message('Publicando clasificación de Segunda…');
    try {
      const { error } = await client.rpc('publish_second_division', {
        p_payload: core.validate(payload, season), p_excluded_manager_id:selected,
        p_expected_revision:revision, p_import_id:jobId, p_allow_roster_change:$('secondAllowRoster').checked
      });
      if (error) throw error;
      const savedJob = jobId; payload = null; jobId = null;
      $('secondReview').hidden = true;
      await call('SECOND_CONSUME', { id:savedJob }).catch(() => {});
      message(label() + ' guardada. Ya se puede consultar desde Más. Las otras jornadas se conservan.');
      // A refresh failure must not misreport an already completed publication.
      await state().catch(() => {});
    } catch (error) {
      message(error.message || String(error));
    } finally { saving = false; buttons(); }
  }
  function init(options) {
    if (initialized) return;
    initialized = true;
    ({ client, season, extensionCall:call, isBlocked:blocked } = options);
    for (let day = 1; day <= 38; day++) $('secondImportScope').add(new Option('Jornada ' + day + ' · tabla y alineaciones', String(day)));
    $('secondImportScope').addEventListener('change', () => { generation++; stateRequest++; current = null; baseline = []; revision = 0; message('Seleccionada ' + label() + '. Pulsa importar para leerla desde Mister.'); });
    $('secondImport').addEventListener('click', start);
    $('secondCancel').addEventListener('click', cancel);
    $('secondPublish').addEventListener('click', publish);
    $('secondExcluded').addEventListener('change', renderReview);
    $('secondAdmin').addEventListener('toggle', async () => {
      if (!$('secondAdmin').open || busy || payload || saving) return;
      const token = generation;
      message('Comprobando clasificación de Segunda…');
      try {
        await state();
        if (token !== generation) return;
        message(current ? 'Última publicación: ' + new Date(current.updated_at).toLocaleString('es') : 'Todavía no se ha publicado ' + label() + '.');
      } catch (error) { if (token === generation) message(error.message || String(error)); }
    });
    buttons();
  }
  function reset() {
    generation++; clearTimeout(timer);
    const old = jobId; jobId = null; payload = null; busy = false; current = null; excludedId = ''; revision = 0;
    if (old && call) call('SECOND_CANCEL', { id:old }).catch(() => {});
    if (initialized) { $('secondReview').hidden = true; $('secondAdmin').open = false; buttons(); }
  }
  window.CubanSecondAdmin = { init, reset };
})();
