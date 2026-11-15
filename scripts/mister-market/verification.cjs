'use strict';
const { ORIGIN, DEFAULTS, fail, clean, money, hash, validateSnapshot } = require('./core.cjs');
const { readFeedDocument, readManagerDocument, readTeamDocument, readPlayerMovementsDocument } = require('./dom.cjs');
const { waitStable, assertLeague } = require('./collector.cjs');

function managerLinks(state, snapshot) {
  assertLeague(state, snapshot);
  const ids = new Set();
  const links = state.managers.map(row => {
    const manager = snapshot.managers.find(m => m.id === row.id && m.name === clean(row.name));
    const url = new URL(row.href, ORIGIN);
    if (!manager || ids.has(row.id) || url.origin !== ORIGIN || url.search
      || url.pathname.split('/')[1] !== 'users' || url.pathname.split('/')[2] !== row.id) fail('roster_manager_mismatch');
    ids.add(row.id);
    return { ...manager, url: url.href };
  });
  if (ids.size !== snapshot.managers.length) fail('roster_manager_mismatch');
  return links;
}
function verifyTeam(state, manager, snapshot) {
  if (!state.ready || state.managerId !== manager.id) fail('roster_context_mismatch');
  const expected = snapshot.players.filter(p => p.ownerId === manager.id);
  const seen = new Set();
  if (state.rows.length !== expected.length) fail('roster_player_mismatch');
  for (const row of state.rows) {
    const p = expected.find(p => p.playerId === row.id);
    if (!p || seen.has(row.id) || p.name !== clean(row.name) || p.clubId !== row.clubId
      || p.position !== { 1: 'PT', 2: 'DF', 3: 'MC', 4: 'DL' }[row.position]
      || p.marketValue !== money(row.value)) fail('roster_player_mismatch');
    seen.add(row.id);
  }
  return { managerId: manager.id, playerCount: seen.size, verified: true };
}
function movementDate(value) {
  const months = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
    jul: 7, ago: 8, sept: 9, oct: 10, nov: 11, dic: 12 };
  const m = clean(value).match(/^(\d{1,2}) ([a-z]+) (\d{4})$/);
  const month = m && months[m[2]], day = m && Number(m[1]), year = m && Number(m[3]);
  if (!month || year < 2000 || year > 2100 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) {
    fail('invalid_movement_date');
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function playerMovements(state, player, snapshot) {
  if (!state.ready || state.playerId !== player.playerId || (state.sectionPresent && !state.recordsPresent)
    || (!state.sectionPresent && state.rows.length)) fail('player_history_context_mismatch');
  const rows = state.rows.map(raw => {
    const split = clean(raw.label).split(' · ');
    if (split.length !== 2 || raw.parties.length !== 2) fail('unknown_player_movement');
    if (!['Cláusula', 'Fichaje', 'Venta', 'Traspaso'].includes(split[1])) fail('unknown_player_movement');
    const parties = raw.parties.map(name => {
      const normalized = clean(name);
      if (normalized === 'Mister') return { name: normalized, managerId: null, resolution: 'mister' };
      const matches = snapshot.managers.filter(m => m.name === normalized);
      // Historical names may belong to former managers. Preserve the evidence without guessing an ID.
      return { name: normalized, managerId: matches.length === 1 ? matches[0].id : null,
        resolution: matches.length === 1 ? 'exact_name' : 'unresolved' };
    });
    const type = split[1] === 'Cláusula' ? 'clause' : parties[0].resolution === 'mister' ? 'purchase'
      : parties[1].resolution === 'mister' ? 'sale' : 'transfer';
    if (parties[0].name === parties[1].name || (type === 'clause' && parties.some(p => p.resolution === 'mister'))) {
      fail('invalid_player_movement');
    }
    return { occurredOn: movementDate(split[0]), datePrecision: 'day', occurredAt: null,
      sourceType: split[1], type, from: parties[0], to: parties[1], amount: money(raw.amount) };
  });
  // These rows have no stable event ID and Mister labels them "Últimos", not a complete ledger.
  // Keep duplicates and the displayed order. Do not merge them into feed events or invent coverage.
  return { playerId: player.playerId, sourceUrl: player.sourceUrl, sectionPresent: state.sectionPresent,
    coverage: 'latest_visible_per_player', stableEventIds: false, movements: rows };
}

async function verifySnapshot(page, snapshot, { wait = waitStable, progress = () => {},
  maxDuration = 12 * 60 * 1000 } = {}) {
  validateSnapshot(snapshot);
  if (snapshot.leagueId !== DEFAULTS.leagueId) fail('wrong_league');
  const startedAt = new Date().toISOString(), deadline = Date.now() + maxDuration;
  page.setDefaultTimeout(20000);
  const checkTime = () => { if (Date.now() > deadline) fail('verification_timeout'); };
  async function go(url) {
    checkTime();
    if (new URL(url, ORIGIN).origin !== ORIGIN) fail('verification_wrong_origin');
    await page.goto(new URL(url, ORIGIN).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (new URL(page.url()).origin !== ORIGIN) fail('login_required');
  }
  async function feed() {
    await go('/feed');
    return wait(async () => assertLeague(await page.evaluate(readFeedDocument), snapshot),
      s => s.ready && s.cards > 0, { stableFor: 1500 });
  }
  const before = await feed();
  await go('/standings');
  const standings = await wait(() => page.evaluate(readManagerDocument),
    s => s.leagueId === snapshot.leagueId && s.managers.length === snapshot.managers.length);
  const managers = managerLinks(standings, snapshot), teams = [];
  for (const manager of managers) {
    await go(manager.url);
    await page.getByRole('button', { name: 'Equipo', exact: true }).click();
    const state = await wait(() => page.evaluate(readTeamDocument), s => s.ready && s.managerId === manager.id,
      { stableFor: 500 });
    teams.push(verifyTeam(state, manager, snapshot));
    progress({ phase: 'teams', completed: teams.length, expected: managers.length });
  }
  const histories = [];
  for (const player of snapshot.players) {
    await go(player.sourceUrl);
    const state = await wait(() => page.evaluate(readPlayerMovementsDocument),
      s => s.ready && s.playerId === player.playerId, { stableFor: 300 });
    histories.push(playerMovements(state, player, snapshot));
    if (histories.length % 50 === 0 || histories.length === snapshot.players.length) {
      progress({ phase: 'player_histories', completed: histories.length, expected: snapshot.players.length });
    }
  }
  const after = await feed();
  if (hash(before.events) !== hash(after.events)) fail('feed_changed_during_verification');
  return { schemaVersion: 1, leagueId: snapshot.leagueId, snapshotHash: snapshot.snapshotHash,
    startedAt, completedAt: new Date().toISOString(), publicationReady: false, aiCalls: 0,
    teams, histories, movementsCoverage: 'latest_visible_per_player',
    movementCount: histories.reduce((n, h) => n + h.movements.length, 0) };
}
module.exports = { managerLinks, verifyTeam, movementDate, playerMovements, verifySnapshot };
