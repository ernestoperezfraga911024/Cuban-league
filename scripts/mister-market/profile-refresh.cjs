'use strict';
const { ORIGIN, DEFAULTS, MarketError, fail, hash, transfer, validateSnapshot } = require('./core.cjs');
const { waitStable, assertLeague } = require('./collector.cjs');
const { readFeedDocument, readPlayerMovementsDocument } = require('./dom.cjs');
const { playerMovements } = require('./verification.cjs');
const { reconcile } = require('./reconciliation.cjs');

const tuple = e => hash([e.playerId, e.from, e.to, e.amount]);
const fact = (playerId, m) => ({ playerId, from: m.from.managerId, to: m.to.managerId, amount: m.amount });
function pendingGroups(verification, ledger) {
  const groups = new Map();
  for (const e of reconcile(verification, ledger).events.filter(e => e.date === null)) {
    const key = tuple(e);
    if (!groups.has(key)) groups.set(key, { ...e, key, missing: 0 });
    groups.get(key).missing++;
  }
  return groups;
}
function counts(events) {
  const map = new Map();
  for (const e of events) map.set(tuple(e), (map.get(tuple(e)) || 0) + 1);
  return [...map].sort(([a], [b]) => a.localeCompare(b));
}
function assertDateOnlyRefresh(before, after) {
  if (hash(counts(before.events)) !== hash(counts(after.events))) fail('profile_refresh_changed_totals');
  const indexed = new Map(after.events.map(e => [e.reference, e]));
  for (const e of before.events.filter(e => e.date !== null)) {
    if (hash(e) !== hash(indexed.get(e.reference))) fail('profile_refresh_changed_known_date');
  }
  if (after.events.filter(e => e.date === null).length > before.events.filter(e => e.date === null).length) {
    fail('profile_refresh_lost_dates');
  }
}

// Rows have no event IDs. Extend the dated multiset, never assert a match to a
// particular feed ID, replace a previous row or choose among excess candidates.
function mergeProfile(previous, observed, groups, evidence) {
  if (previous.playerId !== observed.playerId) fail('player_history_context_mismatch');
  const known = new Map(), seen = new Map(), candidates = new Map(), ambiguous = [];
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(evidence.observedAt));
  const datedKey = m => hash([tuple(fact(observed.playerId, m)), m.occurredOn]);
  for (const m of previous.movements.filter(m => m.type === 'clause')) {
    known.set(datedKey(m), (known.get(datedKey(m)) || 0) + 1);
  }
  observed.movements.forEach((m, sourceRow) => {
    if (m.type !== 'clause') return;
    const key = tuple(fact(observed.playerId, m));
    if (!groups.has(key)) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.occurredOn) || m.occurredOn > day) fail('invalid_profile_refresh_date');
    const dated = datedKey(m), occurrence = (seen.get(dated) || 0) + 1;
    seen.set(dated, occurrence);
    if (occurrence <= (known.get(dated) || 0)) return;
    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key).push({ ...m, rereadEvidence: { ...evidence, sourceRow } });
  });
  const additions = [];
  for (const [key, rows] of candidates) {
    if (rows.length > groups.get(key).missing) ambiguous.push(key);
    else additions.push(...rows);
  }
  return { history: { ...previous, movements: [...previous.movements, ...additions] },
    added: additions.length, ambiguousGroups: ambiguous.length };
}

async function refreshPendingDates(page, snapshot, ledger, verification, {
  wait = waitStable, progress = () => {}, now = Date.now, maxPlayers = 20, maxDuration = 120000
} = {}) {
  validateSnapshot(snapshot);
  if (snapshot.leagueId !== DEFAULTS.leagueId || ledger.leagueId !== snapshot.leagueId
    || ledger.season !== snapshot.season || verification.leagueId !== snapshot.leagueId) fail('wrong_league');
  if (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 20
    || !Number.isFinite(maxDuration) || maxDuration < 1 || maxDuration > 120000) fail('invalid_profile_refresh_limits');
  const before = reconcile(verification, ledger), groups = pendingGroups(verification, ledger);
  const metrics = { profileReads: 0, profileDatesRecovered: 0,
    profileDatesPending: before.events.filter(e => e.date === null).length, profileReadFailures: 0, profileReadMs: 0 };
  if (!groups.size) return { verification, metrics };
  const started = now(), deadline = started + maxDuration, next = structuredClone(verification);
  const priorAttempts = new Map((next.profileRefresh?.attempts || []).map(a => [a.playerId, a]));
  const attempts = new Map(priorAttempts);
  const targets = [...new Set([...groups.values()].map(g => g.playerId))].sort((a, b) =>
    (priorAttempts.get(a)?.attemptedAt || '').localeCompare(priorAttempts.get(b)?.attemptedAt || '') || a.localeCompare(b));
  const expectedFeed = hash(snapshot.movements);
  async function go(url, timeout = 30000) {
    const parsed = new URL(url, ORIGIN);
    if (parsed.origin !== ORIGIN || parsed.username || parsed.password || parsed.search || parsed.hash) fail('verification_wrong_origin');
    await page.goto(parsed.href, { waitUntil: 'domcontentloaded', timeout });
    if (new URL(page.url()).origin !== ORIGIN) fail('login_required');
  }
  async function checkedFeed() {
    if (new URL(page.url()).origin !== ORIGIN) fail('login_required');
    return assertLeague(await page.evaluate(readFeedDocument), snapshot);
  }
  async function guardFeed() {
    await go('/feed');
    const state = await wait(checkedFeed, s => s.ready && s.cards > 0,
      { stableFor: 500, label: 'profile_dates_feed' });
    const events = state.events.map(e => transfer(e, snapshot)).sort((a, b) => a.eventId.localeCompare(b.eventId));
    if (hash(events) !== expectedFeed) fail('feed_changed_during_verification');
  }
  await guardFeed();
  for (const playerId of targets.slice(0, maxPlayers)) {
    if (now() >= deadline) break;
    const player = snapshot.players.find(p => p.playerId === playerId);
    const index = next.histories.findIndex(h => h.playerId === playerId);
    if (!player) fail('verification_snapshot_mismatch');
    // An added catalogue player needs a separate baseline verification. Do not
    // expand the verified catalogue or block unrelated market updates here.
    if (index < 0) {
      attempts.set(playerId, { playerId, attemptedAt: new Date(now()).toISOString(),
        status: 'unavailable', reason: 'profile_not_in_verified_catalog' });
      metrics.profileReadFailures++;
      continue;
    }
    const url = new URL(player.sourceUrl);
    if (url.pathname.split('/')[1] !== 'players' || url.pathname.split('/')[2] !== playerId) fail('invalid_player_link');
    const attempt = { playerId, attemptedAt: new Date(now()).toISOString() };
    metrics.profileReads++;
    let observed;
    try {
      await go(player.sourceUrl, Math.max(1, Math.min(30000, deadline - now())));
      const state = await wait(async () => {
        await checkedFeed(); // Every profile must still belong to the intended league.
        return page.evaluate(readPlayerMovementsDocument);
      }, s => s.ready && s.playerId === playerId,
      { stableFor: 300, timeout: Math.max(1, Math.min(40000, deadline - now())), label: 'profile_dates_player' });
      observed = playerMovements(state, player, snapshot);
      const evidence = { observedAt: new Date(now()).toISOString(), snapshotHash: snapshot.snapshotHash,
        sourceUrl: player.sourceUrl, rowsHash: hash(observed.movements) };
      const merged = mergeProfile(next.histories[index], observed, groups, evidence);
      next.histories[index] = merged.history;
      attempts.set(playerId, { ...attempt, status: merged.ambiguousGroups ? 'ambiguous' : merged.added ? 'dated' : 'not_found',
        observedAt: evidence.observedAt, rowsHash: evidence.rowsHash, observedHistory: observed, addedDates: merged.added });
      metrics.profileDatesRecovered += merged.added;
    } catch (error) {
      if (error instanceof MarketError && ['wrong_league', 'login_required', 'session_or_page_unavailable',
        'verification_wrong_origin'].includes(error.code)) throw error;
      const reason = error instanceof MarketError ? error.code : 'profile_read_failed';
      attempts.set(playerId, { ...attempt, status: 'unavailable', reason });
      metrics.profileReadFailures++;
    }
    progress({ phase: 'profile_dates', playerId, completed: metrics.profileReads,
      expected: Math.min(targets.length, maxPlayers), status: attempts.get(playerId).status });
  }
  // A concurrent transfer or a context change invalidates the entire read, as before.
  await guardFeed();
  const after = reconcile(next, ledger);
  assertDateOnlyRefresh(before, after);
  metrics.profileDatesPending = after.events.filter(e => e.date === null).length;
  metrics.profileReadMs = now() - started;
  next.profileRefresh = { schemaVersion: 1, completedAt: new Date(now()).toISOString(),
    snapshotHash: snapshot.snapshotHash, feedHash: expectedFeed, attempts: [...attempts.values()], metrics };
  return { verification: next, metrics };
}
module.exports = { pendingGroups, mergeProfile, assertDateOnlyRefresh, refreshPendingDates };
