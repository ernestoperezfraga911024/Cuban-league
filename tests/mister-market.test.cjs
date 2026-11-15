'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const core = require('../scripts/mister-market/core.cjs');
const dom = require('../scripts/mister-market/dom.cjs');
const { collect, waitStable, paginate, verifyFilters, assertLeague } = require('../scripts/mister-market/collector.cjs');
const { saveCapture, withLock, atomicJson, readJson } = require('../scripts/mister-market/storage.cjs');
const config = { leagueId: '649733', season: '2026-27', expectedManagers: 2, expectedClubs: 1 };
const { waitForManualLogin } = require('../scripts/mister-market/mobile-login.cjs');
const meta = { leagueId: config.leagueId, managers: [{ id: '10', name: 'Equipo A' }, { id: '20', name: 'Equipo B' }],
  clubs: [{ id: '15', name: 'Club de prueba' }] };
function row(id = '100', header = '') {
  return { id, href: `players/${id}/jugador-prueba`, name: 'Jugador de prueba', position: '4', clubId: '15',
    value: '€ 1.250.000', header, photoUrl: `https://cdn-mister.mundodeportivo.com/file/cdn-common/players/${id}.png` };
}
const part = (partition, rows) => ({ partition, rows, leagueId: config.leagueId, exhausted: true, filtersVerified: true });
function capture(overrides = {}, time = '2026-11-15T09:00:00Z') {
  return core.snapshot({ meta, free: part('free', [row()]), owned: part('owned', [row('200', 'Equipo A · 4.000.000 cláusula')]),
    feedBefore: [], feedAfter: [], startedAt: time, completedAt: time, minPlayers: 2, ...overrides }, config);
}
function event(overrides = {}) {
  return { feedId: 'feed-300', playerId: '200', name: 'Jugador de prueba',
    title: 'Jugador de prueba cambia de Equipo A a Equipo B por pago de cláusula',
    from: { id: '10', name: 'Equipo A' }, to: { id: '20', name: 'Equipo B' }, amount: '4.000.000', ...overrides };
}
function code(name) { return error => error.code === name; }
function evaluate(fn, body, url = `${core.ORIGIN}/search`) {
  const instance = new JSDOM(body, { url, runScripts: 'outside-only' });
  Object.defineProperty(instance.window.HTMLElement.prototype, 'offsetWidth', { get() { return this.hidden ? 0 : 10; } });
  try { return JSON.parse(JSON.stringify(instance.window.eval(`(${fn.toString()})()`))); }
  finally { instance.window.close(); }
}
const league = '<a class="active" href="action/change?id_community=649733">Liga de prueba</a>';

test('importes exactos: null, abreviaturas y formatos ambiguos nunca se convierten en cero', () => {
  assert.equal(core.money('€ 25.136.000 ↑'), 25136000);
  assert.equal(core.money('0'), 0);
  for (const value of [null, '', '25,5M', '25.13', '-1', '1,000', '01', '9007199254740992']) {
    assert.throws(() => core.money(value), code('invalid_money'));
  }
});
test('propiedad y cláusula provienen de partición explícita e identidad exacta', () => {
  const ctx = core.context(meta, config);
  assert.equal(core.player(row(), 'free', ctx).ownerId, null);
  assert.throws(() => core.player(row(), 'owned', ctx), code('missing_owner_or_clause'));
  assert.throws(() => core.player(row('100', 'Desconocido · 2.000 cláusula'), 'owned', ctx), code('unknown_owner'));
  assert.throws(() => core.player(row('100', 'Equipo A · 2.000 cláusula'), 'free', ctx), code('partition_conflict'));
  assert.throws(() => core.player({ ...row(), href: 'https://example.org/players/100/x' }, 'free', ctx), code('invalid_player_link'));
});
test('bloquea liga, contexto y nombres de propietarios ambiguos', () => {
  assert.throws(() => core.context({ ...meta, leagueId: '978196' }, config), code('wrong_league'));
  assert.throws(() => core.context({ ...meta, managers: [meta.managers[0]] }, config), code('incomplete_context'));
  assert.throws(() => core.context({ ...meta, managers: meta.managers.map(m => ({ ...m, name: 'Igual' })) }, config), code('ambiguous_manager_name'));
  assert.throws(() => assertLeague({ leagueId: null }, config), code('session_or_page_unavailable'));
});
test('rechaza paginación incompleta, duplicados entre particiones y lectura con cambios concurrentes', () => {
  assert.throws(() => capture({ free: { ...part('free', [row()]), exhausted: false } }), code('incomplete_catalog'));
  assert.throws(() => capture({ owned: part('owned', [row('100', 'Equipo A · 2.000 cláusula')]) }), code('player_in_multiple_partitions'));
  assert.throws(() => capture({ feedAfter: [event()] }), code('feed_changed_during_capture'));
  assert.throws(() => capture({ completedAt: '2026-11-15T10:00:00Z' }), code('invalid_capture_interval'));
});
test('solo el texto explícito identifica un clausulazo; no inventa su fecha', () => {
  const ctx = core.context(meta, config);
  assert.equal(core.transfer(event(), ctx).type, 'clause');
  assert.equal(core.transfer(event(), ctx).occurredAt, null);
  assert.equal(core.transfer(event({ title: 'Traspaso' }), ctx).type, 'transfer');
  assert.equal(core.transfer(event({ title: 'Compra', from: { id: null, name: 'Mister' } }), ctx).type, 'purchase');
  assert.equal(core.transfer(event({ title: 'Venta', to: { id: null, name: 'Mister' } }), ctx).type, 'sale');
  assert.throws(() => core.transfer(event({ from: undefined }), ctx), code('unknown_event_party'));
});
test('diferencias y equipos derivan de la misma lectura; primera lectura no inventa altas', () => {
  const previous = capture();
  assert.deepEqual(core.compare(null, previous).changes, []);
  const current = capture({ owned: part('owned', [{ ...row('200', 'Equipo B · 5.000.000 cláusula'), value: '1.500.000' }]) }, '2026-11-15T22:00:00Z');
  assert.deepEqual(core.compare(previous, current).changes.map(c => c.type), ['owner_changed', 'value_changed', 'clause_changed']);
  const teams = core.teams(current);
  assert.equal(teams[0].players.length, 0);
  assert.equal(teams[1].players[0].playerId, '200');
  assert.equal(current.publicationReady, false);
  assert.equal(current.movementsCoverage, 'visible_window');
  assert.throws(() => core.validateSnapshot({ ...current, leagueId: '978196' }), code('snapshot_hash_mismatch'));
  assert.throws(() => core.compare(current, previous), code('stale_capture'));
});
test('registra movimientos visibles de ida y vuelta aunque el propietario final sea igual', () => {
  const events = [event(), event({ feedId: 'feed-301', from: { id: '20', name: 'Equipo B' }, to: { id: '10', name: 'Equipo A' } })];
  const current = capture({ feedBefore: events, feedAfter: events }, '2026-11-15T22:00:00Z');
  const diff = core.compare(capture(), current);
  assert.equal(diff.changes.length, 0);
  assert.equal(diff.newEvents.length, 2);
  assert.equal(core.compare(current, current).newEvents.length, 0);
});
test('espera una lista distinta y estable después de cerrar el filtro, descartando la anterior', async () => {
  let clock = 0;
  const result = await waitStable(async () => clock < 3 ? { id: 'old' } : { id: 'new' }, s => s.id !== 'old',
    { timeout: 10, stableFor: 2, interval: 1, now: () => clock, sleep: async () => { clock++; } });
  assert.equal(result.id, 'new');
  assert.equal(clock, 5);
  await assert.rejects(waitStable(async () => ({ id: 'old' }), () => false,
    { timeout: 3, interval: 1, now: () => clock, sleep: async () => { clock++; } }), code('page_not_settled'));
});
test('paginación espera crecimiento, detecta reordenamiento y tiene límite', async () => {
  const a = { ready: true, rows: [{ id: '1' }], hasMore: true };
  const b = { ready: true, rows: [{ id: '1' }, { id: '2' }], hasMore: false };
  let clicked = 0;
  const result = await paginate(a, { read: async () => b, next: async () => { clicked++; }, wait: async (read, accept) => {
    assert.equal(accept(a), false); const next = await read(); assert.equal(accept(next), true); return next;
  } });
  assert.equal(result.rows.length, 2); assert.equal(clicked, 1);
  await assert.rejects(paginate(a, { maxPages: 1, next: async () => {}, read: async () => a }), code('pagination_limit'));
  await assert.rejects(paginate(a, { next: async () => {}, read: async () => ({ ...b, rows: [{ id: '2' }, { id: '1' }] }),
    wait: async (read, accept) => accept(await read()) }), code('pagination_changed'));
});
test('los filtros de precio, posición o favoritos no se confunden con catálogo completo', () => {
  const f = { owner: '-1', team: '0', position: '0', injured: false, stealable: false, ranges: [] };
  verifyFilters(f, '-1', []);
  assert.throws(() => verifyFilters({ ...f, position: '4' }, '-1', []), code('unexpected_filters'));
  assert.throws(() => verifyFilters({ ...f, ranges: [{ value: 1 }] }, '-1', []), code('unexpected_price_filter'));
});
test('lector DOM captura valor, identidad y propietario sin confundir el escudo del rival', () => {
  const html = `${league}<input class="search-players-input" value=""><button class="search-players-filter-favs"></button>
    <ul class="search-players-list"><li><div class="header">Equipo A · 4.000.000 cláusula</div><div class="player-row">
    <a class="player" href="players/200/jugador"><div class="icons"><img class="team-logo" src="https://cdn-mister.mundodeportivo.com/file/cdn-common/teams/15.png"><div data-position="4"></div></div>
    <div class="player-avatar"><img src="https://cdn-mister.mundodeportivo.com/file/cdn-common/players/200.png"></div>
    <div class="info"><div class="name">Jugador de prueba</div><div class="underName"><span>€</span>1.250.000</div></div>
    <div class="rival"><img class="team-logo" src="/teams/9.png"></div></a></div></li></ul><button class="search-players-more">Ver más</button>`;
  const state = evaluate(dom.readMarketDocument, html);
  assert.equal(state.leagueId, config.leagueId); assert.equal(state.rows[0].clubId, '15');
  assert.equal(state.rows[0].header, 'Equipo A · 4.000.000 cláusula');
  assert.equal(state.hasMore, true); assert.equal(state.rows[0].value, '€1.250.000');
});
test('lector de feed omite otras pujas, comentarios y fechas relativas', () => {
  const html = `${league}<div class="feed-cards"><div class="card-wrapper"><div class="head">comentó hace 4h</div>
    <div id="feed-300" class="card-transfer"><ul class="player-list"><li><div class="item">
    <div class="title"><strong>Jugador de prueba</strong> cambia de <em>Mister</em> a <em>Equipo A</em></div>
    <a class="player" href="players/200/jugador"></a><div class="flow"><div class="avatar"></div>
    <a class="avatar user" href="users/10/equipo-a"></a><div class="price">1.000.000</div></div></div>
    <ul class="other-bids"><li>Dato privado no requerido</li></ul></li></ul></div><div class="comments">Comentario no requerido</div></div></div>`;
  const result = evaluate(dom.readFeedDocument, html);
  assert.equal(result.events.length, 1); assert.equal(result.events[0].from.id, null);
  assert.equal(core.transfer(result.events[0], core.context(meta, config)).type, 'purchase');
  assert.doesNotMatch(JSON.stringify(result), /privado|Comentario|4h/);
});
test('un jugador faltante conserva la última lectura y nunca se interpreta como venta', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mister-market-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const first = capture();
  await saveCapture(dir, first);
  const current = capture({ free: part('free', []), minPlayers: 1 }, '2026-11-15T22:00:00Z');
  await assert.rejects(saveCapture(dir, current), code('missing_players_review_required'));
  assert.equal((await readJson(path.join(dir, 'latest.json'))).snapshotHash, first.snapshotHash);
  const report = await readJson(path.join(dir, 'report.json'));
  assert.deepEqual(report.missingPlayerIds, ['100']); assert.deepEqual(report.changes, []);
});
test('bloqueo evita dos capturas concurrentes y se libera al fallar', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mister-market-lock-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await withLock(dir, async () => {
    await assert.rejects(withLock(dir, async () => {}), code('already_running_or_stale_lock'));
  });
  await assert.rejects(withLock(dir, async () => { throw new Error('prueba'); }), /prueba/);
  await withLock(dir, async () => atomicJson(path.join(dir, 'test.json'), { ok: true }));
  assert.deepEqual(await readJson(path.join(dir, 'test.json')), { ok: true });
});

test('lector de filtros conserva IDs y extremos sin capturar otras opciones', () => {
  const html = `${league}<div id="popup-content"><select name="owner"><option value="0">Todos</option>
    <option value="-1" selected>Libres</option><option value="10">Equipo A</option><option value="20">Equipo B</option></select>
    <select name="team"><option value="0" selected>Todos</option><option value="15">Club de prueba</option></select>
    <input type="radio" name="position" value="0" checked><input type="checkbox" name="injured">
    <input type="checkbox" name="stealable"><input name="value_from" value="0"><input name="value_to" value="1000000">
    <input name="clause_from" value="0"><input name="clause_to" value="4000000"></div>`;
  const state = evaluate(dom.readFilterDocument, html);
  assert.deepEqual(state.managers, meta.managers);
  assert.equal(state.owner, '-1'); assert.equal(state.injured, false);
  assert.equal(state.ranges[3].value, '4000000');
});
test('recorrido simulado completo reabre Limpiar y espera la sustitución y ampliación de listas', async () => {
  const free = Array.from({ length: 60 }, (_, i) => row(String(i + 1)));
  const owned = Array.from({ length: 40 }, (_, i) => row(String(i + 61), 'Equipo A · 4.000.000 cláusula'));
  let url, popup = false, selected = '0', active = '0', limit = 50, pending = null, ticks = 0, clock = 0;
  const actions = [];
  const ranges = ['value_from', 'value_to', 'clause_from', 'clause_to'].map(name => ({ name, value: name.endsWith('_from') ? '0' : '4000000' }));
  const page = {
    setDefaultTimeout() {}, url: () => url,
    async goto(next) { url = next; },
    async evaluate(fn) {
      if (fn.name === 'readFeedDocument') return { leagueId: config.leagueId, ready: true, cards: 1, events: [] };
      if (fn.name === 'readFilterDocument') {
        assert.equal(popup, true);
        return { ...meta, owner: selected, team: '0', position: '0', injured: false, stealable: false, ranges };
      }
      assert.equal(fn.name, 'readMarketDocument');
      if (pending && ++ticks >= 3) { active = pending.owner; limit = pending.limit; pending = null; }
      const rows = active === '-1' ? free : active === '-2' ? owned : [...owned, ...free];
      return { leagueId: config.leagueId, ready: true, search: '', favorites: false,
        popupOpen: popup, hasMore: rows.length > limit, rows: rows.slice(0, limit) };
    },
    locator(selector) { return {
      async waitFor(options) {
        if (selector.includes('select[name="owner"]')) assert.equal(popup, options.state === 'visible');
      },
      async fill(value) { assert.equal(selector, 'input.search-players-input'); assert.equal(value, ''); },
      async selectOption(value) { assert.equal(popup, true); selected = value; },
      async click() {
        actions.push(selector);
        if (selector === '.search-players-filter-btn') { assert.equal(popup, false); popup = true; }
        else if (selector.includes('filter-reset')) { assert.equal(popup, true); popup = false; selected = '0'; pending = { owner: '0', limit: 50 }; ticks = 0; }
        else if (selector.includes('filter-apply')) { assert.equal(popup, true); popup = false; pending = { owner: selected, limit: 50 }; ticks = 0; }
        else if (selector === '.search-players-more') { assert.equal(popup, false); pending = { owner: active, limit: limit + 50 }; ticks = 0; }
        else assert.fail(`Acción inesperada: ${selector}`);
      }
    }; }
  };
  const result = await collect(page, config, { wait: (read, accept) => waitStable(read, accept,
    { timeout: 100, stableFor: 3, interval: 1, now: () => clock, sleep: async () => { clock++; } }) });
  assert.equal(result.players.length, 100);
  assert.equal(result.players.filter(p => p.ownerId).length, 40);
  assert.equal(actions.filter(a => a === '.search-players-more').length, 1);
  assert.equal(result.publicationReady, false);
});

test('inicio móvil espera una sesión estable en la liga exacta y tolera navegación manual', async () => {
  let clock = 0, calls = 0;
  const page = { isClosed: () => false,
    url: () => clock === 0 ? 'https://accounts.example.org/login' : `${core.ORIGIN}/feed`,
    evaluate: async () => { calls++; if (clock === 1) throw new Error('navigation');
      return { leagueId: clock < 3 ? '978196' : core.DEFAULTS.leagueId }; } };
  await waitForManualLogin(page, { timeout: 10, interval: 1, now: () => clock, sleep: async () => { clock++; } });
  assert.equal(clock, 4); assert.equal(calls, 4);
});
test('inicio móvil no acepta un dominio externo, una liga ajena ni una ventana cerrada', async () => {
  for (const url of ['https://example.org/feed', `${core.ORIGIN}/feed`]) {
    let clock = 0;
    await assert.rejects(waitForManualLogin({ isClosed: () => false, url: () => url,
      evaluate: async () => ({ leagueId: '978196' }) }, { timeout: 3, interval: 1,
      now: () => clock, sleep: async () => { clock++; } }), code('manual_login_timeout'));
  }
  await assert.rejects(waitForManualLogin({ isClosed: () => true }), code('login_window_closed'));
});
test('configuración móvil no activa publicación, cron ni puertos adicionales', async () => {
  const configFile = JSON.parse(await fs.readFile(path.join(__dirname, '../.devcontainer/mister-market/devcontainer.json'), 'utf8'));
  assert.deepEqual(configFile.forwardPorts, [6080]);
  assert.equal(configFile.otherPortsAttributes.onAutoForward, 'ignore');
  assert.equal(configFile.postAttachCommand, 'node scripts/mister-market/start-mobile.cjs');
  assert.doesNotMatch(JSON.stringify(configFile), /public|cron|collect|publish/);
  // La imagen universal agotó el disco de Codespaces al extraer PyTorch.
  // Este lector solo necesita Node y el escritorio; no volver a esa imagen.
  assert.match(configFile.image, /^mcr\.microsoft\.com\/devcontainers\/javascript-node:/);
  assert.deepEqual(Object.keys(configFile.features), ['ghcr.io/devcontainers/features/desktop-lite:1.2.10']);
});

test('entrada manual permite superar quince minutos, pero conserva un límite de espera', async () => {
  let clock = 0;
  const page = { isClosed: () => false, url: () => `${core.ORIGIN}/feed`,
    evaluate: async () => ({ leagueId: clock >= 20 * 60000 ? core.DEFAULTS.leagueId : null }) };
  await waitForManualLogin(page, { now: () => clock, sleep: async () => { clock += 10 * 60000; } });
  assert.equal(clock, 30 * 60000);
  clock = 0;
  await assert.rejects(waitForManualLogin({ ...page, evaluate: async () => ({ leagueId: null }) },
    { now: () => clock, sleep: async () => { clock += 10 * 60000; } }), code('manual_login_timeout'));
  assert.equal(clock, 60 * 60000);
});

test('la entrada se adapta al escritorio y la lectura conserva su tamaño estable', () => {
  const { browserOptions } = require('../scripts/mister-market/browser-options.cjs');
  for (const command of ['login', 'login-mobile']) {
    const options = browserOptions(command);
    assert.equal(options.context.viewport, null);
    assert.equal(options.launch.headless, false);
    assert.ok(options.launch.args.includes('--start-maximized'));
  }
  const reading = browserOptions('collect');
  assert.equal(reading.launch.headless, true);
  assert.deepEqual(reading.context.viewport, { width: 1280, height: 900 });
  assert.deepEqual(browserOptions('verify'), reading);
  assert.deepEqual(browserOptions('history'), reading);
});

const history = require('../scripts/mister-market/history.cjs');
test('historial pagina aunque reaparezca un ID conocido y exige el final observado', async () => {
  const a = { ready: true, cardIds: ['feed-300', 'feed-290'], events: [], hasMore: true };
  const b = { ...a, cardIds: [...a.cardIds, 'feed-295'] };
  const end = { ...b, hasMore: false };
  let reads = 0, clicks = 0;
  const result = await history.paginateHistory(a, { read: async () => [b, end][reads++], next: async () => { clicks++; },
    wait: async (read, accept) => { const state = await read(); assert.equal(accept(state), true); return state; } });
  assert.equal(clicks, 2); assert.equal(result.endObserved, true); assert.equal(result.pages, 3);
  assert.equal(history.feedProgress(a, a), false);
  assert.throws(() => history.feedProgress(a, { ...a, cardIds: [...a.cardIds].reverse() }), code('feed_pagination_changed'));
  assert.throws(() => history.feedProgress(a, { ...a, cardIds: [...a.cardIds, 'feed-300'] }), code('duplicate_feed_card'));
  await assert.rejects(history.paginateHistory(a, { read: async () => a, next: async () => {}, maxPages: 1 }),
    code('feed_pagination_limit'));
  const withEvent = { ...a, events: [event()] };
  assert.throws(() => history.feedProgress(withEvent, { ...b, events: [event({ amount: '1' })] }),
    code('feed_changed_during_capture'));
});
function historyCapture(ids = ['300'], completedAt = '2026-11-15T10:00:00Z') {
  const events = ids.map(id => core.transfer(event({ feedId: `feed-${id}` }), core.context(meta, config)));
  return { leagueId: config.leagueId, season: config.season, startedAt: completedAt, completedAt,
    endObserved: true, sourceCoverage: 'retained_feed_exhausted', pages: 3, events, headEventIds: [events[0].eventId] };
}
test('registro duradero deduplica por ID y conserva eventos que desaparecen del portal', () => {
  const first = history.mergeLedger(null, historyCapture(['300', '290']));
  assert.equal(first.baseline, true); assert.deepEqual(first.newlyObservedIds, []);
  const second = history.mergeLedger(first, historyCapture(['300', '301'], '2026-11-15T22:00:00Z'));
  assert.equal(second.events.length, 3); assert.equal(second.newlyObservedIds.length, 1);
  assert.equal(second.continuity, 'previous_head_retained');
  const again = history.mergeLedger(second, historyCapture(['300', '301'], '2026-11-15T22:01:00Z'));
  assert.equal(again.events.length, 3); assert.deepEqual(again.newlyObservedIds, []);
  assert.equal(again.events.find(e => e.sourceFeedId === 'feed-290').firstSeenAt, first.completedAt);
  assert.equal(again.publicationReady, false); history.validateLedger(again);
  assert.throws(() => history.validateLedger({ ...again, events: [] }), code('feed_ledger_hash_mismatch'));
});
test('registro detecta ventanas sin solapamiento, pausas largas, cambios e historial incompleto', () => {
  const first = history.mergeLedger(null, historyCapture());
  assert.equal(history.mergeLedger(first, historyCapture(['301'], '2026-11-15T22:00:00Z')).continuity, 'review_required');
  assert.equal(history.mergeLedger(first, historyCapture(['300'], '2026-11-17T22:00:00Z')).continuity, 'review_required');
  const changed = historyCapture(['300'], '2026-11-15T22:00:00Z'); changed.events[0].amount++;
  assert.throws(() => history.mergeLedger(first, changed), code('feed_event_changed'));
  assert.throws(() => history.mergeLedger(first, { ...historyCapture(), endObserved: false }), code('incomplete_feed_history'));
  assert.throws(() => history.mergeLedger(first, { ...historyCapture(), leagueId: '978196' }), code('snapshot_context_mismatch'));
  assert.throws(() => history.mergeLedger(first, historyCapture(['300'], '2026-11-14T22:00:00Z')), code('stale_capture'));
});

const verification = require('../scripts/mister-market/verification.cjs');
test('contraste usa la plantilla actual, sin confundirla con el once de una jornada', () => {
  const html = '<div class="team-lineup"><a class="player" href="players/999/antiguo"></a></div>'
    + '<button data-tab="team" class="active">Equipo</button><div class="panels-users"><div class="panel-team">'
    + '<ul class="player-list"><li><a class="player" href="players/200/actual"><div class="icons">'
    + '<img class="team-logo" src="/teams/15.png"><div data-position="4"></div></div><div class="info">'
    + '<div class="name">Jugador de prueba</div><div class="underName">€ 1.250.000 ↑</div></div></a></li></ul></div></div>';
  const state = evaluate(dom.readTeamDocument, html, `${core.ORIGIN}/users/10/equipo-a`);
  assert.equal(state.managerId, '10'); assert.equal(state.rows.length, 1);
  assert.equal(verification.verifyTeam(state, meta.managers[0], capture()).playerCount, 1);
  for (const invalid of [{ ...state, managerId: '20' }, { ...state, ready: false }]) {
    assert.throws(() => verification.verifyTeam(invalid, meta.managers[0], capture()), code('roster_context_mismatch'));
  }
  for (const rows of [[], [...state.rows, ...state.rows], [{ ...state.rows[0], id: '999' }],
    [{ ...state.rows[0], value: '€ 1.250.001' }]]) {
    assert.throws(() => verification.verifyTeam({ ...state, rows }, meta.managers[0], capture()), code('roster_player_mismatch'));
  }
});
test('los enlaces de participantes exigen identidad completa, liga y destino exactos', () => {
  const state = { leagueId: config.leagueId, managers: meta.managers.map(m => ({ ...m, href: `users/${m.id}/equipo` })) };
  assert.equal(verification.managerLinks(state, capture()).length, 2);
  assert.throws(() => verification.managerLinks({ ...state, leagueId: '978196' }, capture()), code('wrong_league'));
  for (const managers of [state.managers.slice(0, 1), [state.managers[0], state.managers[0]],
    state.managers.map(m => ({ ...m, href: `https://example.org/users/${m.id}` }))]) {
    assert.throws(() => verification.managerLinks({ ...state, managers }, capture()), code('roster_manager_mismatch'));
  }
});
test('Últimos movimientos conserva fechas, tipos, importes y duplicados sin inventar cobertura', () => {
  const item = '<li><div class="left"><div class="label">15 sept 2026 · Cláusula</div>'
    + '<div class="value">De <strong>Equipo A</strong> a <strong>Equipo B</strong></div></div><div class="right">22.279.500</div></li>';
  const state = evaluate(dom.readPlayerMovementsDocument, '<div class="section-title"><h4>Detalles</h4></div>'
    + '<div class="section-title"><h4>Últimos movimientos</h4></div><div class="box-records"><ul>' + item + item + '</ul></div>'
    + '<div class="section-title">Historial de puntos</div><div class="box-records">Dato no requerido</div>',
  `${core.ORIGIN}/players/200/jugador-prueba`);
  const history = verification.playerMovements(state, capture().players[1], capture());
  assert.equal(history.movements.length, 2); assert.equal(history.coverage, 'latest_visible_per_player');
  assert.equal(history.stableEventIds, false); assert.equal(history.movements[0].occurredOn, '2026-09-15');
  assert.equal(history.movements[0].occurredAt, null); assert.equal(history.movements[0].type, 'clause');
  assert.equal(history.movements[0].amount, 22279500); assert.equal(history.movements[0].from.managerId, '10');
  assert.doesNotMatch(JSON.stringify(history), /Dato no requerido/);
  const oldName = { ...state, rows: [{ ...state.rows[0], parties: ['Nombre antiguo', 'Equipo B'] }] };
  assert.equal(verification.playerMovements(oldName, capture().players[1], capture()).movements[0].from.resolution, 'unresolved');
  const signed = { ...state, rows: [{ ...state.rows[0], label: '13 jul 2026 · Fichaje', parties: ['Mister', 'Equipo A'] }] };
  assert.equal(verification.playerMovements(signed, capture().players[1], capture()).movements[0].type, 'purchase');
  signed.rows[0].parties = ['Equipo A', 'Equipo B'];
  assert.equal(verification.playerMovements(signed, capture().players[1], capture()).movements[0].type, 'transfer');
  assert.throws(() => verification.playerMovements({ ...state, playerId: '999' }, capture().players[1], capture()),
    code('player_history_context_mismatch'));
  assert.throws(() => verification.playerMovements({ ...state, recordsPresent: false }, capture().players[1], capture()),
    code('player_history_context_mismatch'));
});
test('fecha de movimiento rechaza días imposibles y formatos no observados', () => {
  assert.equal(verification.movementDate('29 feb 2024'), '2024-02-29');
  for (const value of ['29 feb 2026', '31 abr 2026', '0 ene 2026', 'hace 2 horas', '15/09/2026', '15 september 2026']) {
    assert.throws(() => verification.movementDate(value), code('invalid_movement_date'));
  }
});
test('la verificación recorre todos los equipos y perfiles y rechaza cambios durante la lectura', async () => {
  for (const changed of [false, true]) {
    const snapshot = capture(); let url, activeTeam = false, feeds = 0;
    const progress = [], visited = [];
    const page = { setDefaultTimeout() {}, url: () => url,
      async goto(next) { url = next; activeTeam = false; visited.push(next); },
      getByRole(role, options) { assert.equal(role, 'button'); assert.equal(options.name, 'Equipo');
        return { async click() { activeTeam = true; } }; },
      async evaluate(fn) {
        if (fn.name === 'readFeedDocument') return { leagueId: config.leagueId, ready: true, cards: 1,
          events: changed && feeds++ ? [event()] : [] };
        if (fn.name === 'readManagerDocument') return { leagueId: config.leagueId,
          managers: meta.managers.map(m => ({ ...m, href: `users/${m.id}/equipo` })) };
        if (fn.name === 'readTeamDocument') return { ready: activeTeam, managerId: url.split('/')[4],
          rows: url.includes('/users/10/') ? [row('200')] : [] };
        if (fn.name === 'readPlayerMovementsDocument') return { ready: true, playerId: url.split('/')[4],
          sectionPresent: false, recordsPresent: false, rows: [] };
        assert.fail('Unexpected read');
      }
    };
    const run = () => verification.verifySnapshot(page, snapshot, { progress: s => progress.push(s),
      wait: async (read, accept) => { const state = await read(); assert.equal(accept(state), true); return state; } });
    if (changed) await assert.rejects(run(), code('feed_changed_during_verification'));
    else { const result = await run(); assert.equal(result.teams.length, 2); assert.equal(result.histories.length, 2);
      assert.equal(result.snapshotHash, snapshot.snapshotHash); assert.equal(result.publicationReady, false);
      assert.equal(visited.filter(u => u.includes('/players/')).length, 2); assert.equal(progress.at(-1).completed, 2); }
  }
});
