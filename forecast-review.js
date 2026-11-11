(function() {
  'use strict';
  const $ = id => document.getElementById(id);
  let client, authorized = false, initialized = false, generation = 0, selection = 0, rows = [], loaded = false;
  const cache = new Map();
  let currentRow = null;
  function lockEditorEntry(locked) { if ($('forecastManage')) $('forecastManage').disabled = locked; }
  const core = () => window.CubanForecastCore;
  function el(tag, text, cls) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }
  function date(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return 'No consta';
    return new Intl.DateTimeFormat('es', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Madrid'}).format(new Date(value)) + ' (Madrid)';
  }
  function link(url, label) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') throw Error();
      const node = el('a', label); node.href = parsed.href; node.target = '_blank'; node.rel = 'noopener noreferrer'; return node;
    } catch { return el('span', label + ' · enlace no válido'); }
  }
  function reset() {
    window.CubanForecastEditor?.reset();
    (window.CubanForecastSeason||window.CubanForecastDelivery)?.reset();
    currentRow = null; lockEditorEntry(true);
    generation++; selection++; authorized = false; loaded = false; rows = []; cache.clear();
    if (!$('forecastTool')) return;
    $('forecastTool').open = false;
    $('forecastContent').replaceChildren(); $('forecastVersions').replaceChildren(); $('forecastCompare').replaceChildren();
    $('forecastControls').hidden = true; $('forecastReload').disabled = false;
    $('forecastStatus').textContent = 'Abre este apartado para consultar los borradores privados.';
  }
  async function rpc(key = null) {
    const result = await client.rpc('get_forecast_pilot_drafts', {p_run_key: key});
    if (result.error) throw result.error;
    return result.data;
  }
  function errorMessage(error) {
    if (error?.code === '42501' || error?.status === 401 || error?.status === 403) {
      reset(); return 'Acceso denegado o sesión vencida. Vuelve a iniciar sesión.';
    }
    if (error?.code === 'PGRST202' || error?.code === '42883') return 'La consulta privada aún no está habilitada. El resto del panel sigue disponible.';
    return 'No se pudo completar la consulta. Puedes reintentar; cualquier versión visible conserva su fecha original.';
  }
  async function get(key) {
    if (cache.has(key)) return cache.get(key);
    const g = generation, row = await rpc(key);
    if (g !== generation || !authorized) return null;
    if (!row || row.run_key !== key || !row.payload) throw Error('Versión no disponible');
    cache.set(key, row); return row;
  }
  function fillComparisons() {
    const current = rows.find(r => r.run_key === $('forecastVersions').value);
    const select = $('forecastCompare'); select.replaceChildren(new Option('Sin comparación', ''));
    if (!current) return;
    for (const r of rows) if (r.run_key !== current.run_key && r.fixture_key === current.fixture_key && r.team === current.team && Date.parse(r.created_at) < Date.parse(current.created_at))
      select.add(new Option(date(r.created_at) + ' · ' + r.status, r.run_key));
    if (select.options.length > 1) select.selectedIndex = 1;
  }
  async function selectVersion() {
    if (!authorized) return;
    currentRow = null; lockEditorEntry(true);
    const g = generation, request = ++selection;
    $('forecastStatus').textContent = 'Cargando versión…';
    try {
      const key = $('forecastVersions').value, previousKey = $('forecastCompare').value;
      const [row, previous] = await Promise.all([get(key), previousKey ? get(previousKey) : null]);
      if (g !== generation || request !== selection || !row || !authorized) return;
      render(row, previous);
      $('forecastStatus').textContent = 'Consulta completada. Los datos corresponden a las fechas indicadas; no se ha ejecutado un análisis nuevo.';
    } catch (error) { if (g === generation && request === selection) $('forecastStatus').textContent = errorMessage(error); }
    finally { if (g === generation && request === selection) lockEditorEntry(!authorized); }
  }
  async function reload() {
    if (!authorized || !client || $('forecastReload').disabled) return;
    const g = generation; selection++;
    currentRow = null; lockEditorEntry(true);
    $('forecastReload').disabled = true; $('forecastStatus').textContent = 'Consultando borradores…';
    try {
      const result = await rpc();
      if (g !== generation || !authorized) return;
      if (!Array.isArray(result)) throw Error('Respuesta inválida');
      rows = result; cache.clear(); loaded = true;
      const select = $('forecastVersions'); select.replaceChildren();
      for (const row of rows) select.add(new Option(date(row.created_at) + ' · ' + (row.status === 'draft' ? 'Borrador' : 'Bloqueado'), row.run_key));
      $('forecastControls').hidden = !rows.length;
      if (!rows.length) { $('forecastContent').replaceChildren(); $('forecastStatus').textContent = 'Todavía no hay borradores privados.'; return; }
      fillComparisons(); await selectVersion();
    } catch (error) { if (g === generation) $('forecastStatus').textContent = errorMessage(error); }
    finally { if (g === generation) { $('forecastReload').disabled = false; lockEditorEntry(!authorized); } }
  }
  function render(row, previous) {
    const p = row.payload, fragment = document.createDocumentFragment();
    fragment.append(el('h3', 'Real Madrid · Celta · Jornada ' + p.matchday));
    fragment.append(el('p', 'Partido: ' + date(p.kickoff_at) + ' · Guardado: ' + date(row.created_at)));
    fragment.append(el('p', 'Solo lectura · Privado · ' + (p.status === 'draft' ? 'Borrador' : 'Bloqueado') + ' · Estimaciones provisionales sin precisión demostrada', 'forecast-notice'));
    const limits = el('ul'); for (const note of p.limitations || []) limits.append(el('li', note));
    const details = el('details'); details.append(el('summary', 'Limitaciones de esta lectura'), limits); fragment.append(details);
    if (p.status === 'draft' && Array.isArray(p.proposal?.players)) {
      const pitch = el('div', null, 'forecast-pitch'); pitch.setAttribute('aria-label', 'Once propuesto 4-2-3-1');
      const players = p.proposal.players;
      // Pilot rows did not store slots. Recognize its double pivot independently
      // of JSON order; the remaining layout is schematic, not tracking data.
      const midfield = players.filter(x => x.position === 'MF').sort((a,b) => {
        const pivot = p => /camavinga|tchouameni|bernardo/.test(p.id) ? 0 : 1;
        return pivot(a) - pivot(b);
      });
      const groups = [players.filter(x => x.position === 'FW'), midfield.slice(2), midfield.slice(0, 2), players.filter(x => x.position === 'DF'), players.filter(x => x.position === 'GK')];
      for (const group of groups) {
        const line = el('div', null, 'forecast-line');
        for (const player of group) {
          const button = el('button', null, 'forecast-player' + (player.probability < 70 ? ' uncertain' : ''));
          button.type = 'button'; button.append(el('span', player.name), el('b', player.probability + '%'));
          if (player.probability < 70) button.append(el('small', 'Alternativa: ' + (player.alternative?.name || 'Pendiente')));
          button.addEventListener('click', () => {
            const box = $('forecastPlayerDetail'); box.replaceChildren(el('h4', player.name), el('p', player.reason));
            const assessment = core().assessment(player); box.append(el('p', assessment.label));
            for (const factor of assessment.trace) {
              box.append(el('p', factor.factor + ': ' + factor.reason + ' (' + Number(factor.points.toFixed(1)) + ')'));
              for (const ref of factor.refs) box.append(link(ref, 'Evidencia del criterio'));
            }
            box.append(el('p', 'Consulta los onces y las noticias utilizados en las fuentes de esta versión.'));
            box.focus();
          });
          line.append(button);
        }
        pitch.append(line);
      }
      fragment.append(pitch, el('p', '4-2-3-1 · Los roles son los de esta propuesta, no categorías de Mister.'));
      const detail = el('section', 'Toca un jugador para consultar su explicación.', 'forecast-player-detail'); detail.id = 'forecastPlayerDetail'; detail.tabIndex = -1; detail.setAttribute('aria-live', 'polite'); fragment.append(detail);
    } else fragment.append(el('p', 'Este intento no contiene un once válido. Selecciona una versión anterior para consultarla con su fecha original.'));
    fragment.append(el('h4', 'Fuentes consultadas'));
    for (const s of p.sources || []) {
      const source = el('details'); source.append(el('summary', s.id + ' · ' + s.status));
      source.append(link(s.url, 'Abrir fuente'), el('p', 'Consultada: ' + date(s.fetched_at)), el('p', 'Actualización de la fuente: ' + date(s.source_updated_at)), el('p', 'Once observado: ' + (s.starters || []).join(', ')));
      fragment.append(source);
    }
    for (const n of p.news || []) fragment.append(link(n.url, n.fact || 'Noticia consultada'));
    fragment.append(el('h4', 'Comparación de versiones'));
    const diff = core().comparison(p, previous?.payload);
    fragment.append(el('p', !previous && $('forecastCompare').options.length > 1 ? 'Selecciona una versión anterior para comparar.' : diff.message));
    for (const change of diff.changes) fragment.append(el('p', change.name + ': ' + change.change + '. Motivo registrado: ' + change.reason));
    fragment.append(el('p', 'Los borradores antiguos conservan sus porcentajes originales. Una diferencia sin evidencia nueva no demuestra un cambio deportivo.', 'forecast-notice'));
    $('forecastContent').replaceChildren(fragment);
    currentRow = row;
  }
  function init(options) {
    client = options.client;
    if(!window.CubanForecastSeason)window.CubanForecastEditor?.init({...options, getSelectedDraft: () => currentRow});
    (window.CubanForecastSeason||window.CubanForecastDelivery)?.init(options);
    if (initialized || !$('forecastTool')) return;
    initialized = true;
    $(window.CubanForecastSeason?'forecastAdvanced':'forecastTool').addEventListener('toggle', event => { if (authorized && event.currentTarget.open && !loaded) reload(); });
    $('forecastReload').addEventListener('click', reload);
    $('forecastVersions').addEventListener('change', () => { fillComparisons(); selectVersion(); });
    $('forecastCompare').addEventListener('change', selectVersion);
  }
  window.CubanForecastReview = { init, reset, authorize() { authorized = true; if(!window.CubanForecastSeason)window.CubanForecastEditor?.authorize(); (window.CubanForecastSeason||window.CubanForecastDelivery)?.authorize(); } };
})();
