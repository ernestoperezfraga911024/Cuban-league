'use strict';
const { ORIGIN, DEFAULTS, fail, hash, transfer, validateSnapshot } = require('./core.cjs');
const { readFeedDocument } = require('./dom.cjs');
const { waitStable, assertLeague } = require('./collector.cjs');

async function advanceFeed(page) {
  // A tall final card may be visible while its bottom is still far off screen.
  // The load marker follows the complete card, so scrolling it reaches the end.
  await page.locator('.loading-more').scrollIntoViewIfNeeded();
}
function feedProgress(before, after) {
  if (!Array.isArray(after.cardIds) || typeof after.hasMore !== 'boolean') fail('unknown_feed_pagination');
  if (new Set(after.cardIds).size !== after.cardIds.length) fail('duplicate_feed_card');
  if (after.cardIds.length < before.cardIds.length
    || before.cardIds.some((id, i) => after.cardIds[i] !== id)) fail('feed_pagination_changed');
  const previousCards = new Set(before.cardIds);
  const earlierEvents = after.events.filter(e => previousCards.has(e.feedId));
  if (hash(before.events) !== hash(earlierEvents)) fail('feed_changed_during_capture');
  return after.cardIds.length > before.cardIds.length || !after.hasMore;
}
async function paginateHistory(initial, { read, next, wait = waitStable, maxPages = 100,
  progress = () => {} }) {
  if (!initial.ready || !Array.isArray(initial.cardIds) || !initial.cardIds.length
    || typeof initial.hasMore !== 'boolean') fail('unknown_feed_pagination');
  let state = initial, pages = 1;
  while (state.hasMore) {
    if (pages >= maxPages) fail('feed_pagination_limit');
    const before = state;
    await next();
    state = await wait(read, s => s.ready && feedProgress(before, s), { stableFor: 1500, label: 'history_pagination' });
    pages++;
    if (pages % 5 === 0) progress({ phase: 'feed_history', pages, cards: state.cardIds.length });
  }
  return { ...state, pages, endObserved: true };
}
function normalizedEvents(rows, snapshot) {
  const events = rows.map(e => transfer(e, snapshot)), ids = new Set();
  for (const event of events) {
    if (ids.has(event.eventId)) fail('duplicate_event');
    ids.add(event.eventId);
  }
  return events.sort((a, b) => a.eventId.localeCompare(b.eventId));
}
async function collectHistory(page, snapshot, { wait = waitStable, progress = () => {} } = {}) {
  validateSnapshot(snapshot);
  if (snapshot.leagueId !== DEFAULTS.leagueId) fail('wrong_league');
  const startedAt = new Date().toISOString(), deadline = Date.now() + 6 * 60 * 1000;
  page.setDefaultTimeout(20000);
  async function go() {
    await page.goto(`${ORIGIN}/feed`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator(`a.active[href*="id_community=${snapshot.leagueId}"]`).waitFor({ state: 'attached' });
  }
  async function read() {
    if (Date.now() > deadline) fail('history_timeout');
    if (new URL(page.url()).origin !== ORIGIN) fail('login_required');
    return assertLeague(await page.evaluate(readFeedDocument), snapshot);
  }
  await go();
  const head = await wait(read, s => s.ready && s.cards > 0, { label: 'history_head' });
  const full = await paginateHistory(head, { read, wait, progress,
    next: () => advanceFeed(page) });
  await go();
  const after = await wait(read, s => s.ready && s.cards > 0, { label: 'history_recheck' });
  const headEvents = normalizedEvents(head.events, snapshot);
  if (hash(headEvents) !== hash(normalizedEvents(after.events, snapshot))) fail('feed_changed_during_capture');
  return { leagueId: snapshot.leagueId, season: snapshot.season, startedAt,
    completedAt: new Date().toISOString(), sourceCoverage: 'retained_feed_exhausted',
    endObserved: full.endObserved, pages: full.pages, cards: full.cards,
    headEventIds: headEvents.map(e => e.eventId), events: normalizedEvents(full.events, snapshot) };
}

function validateLedger(ledger) {
  if (!ledger || ledger.schemaVersion !== 1 || !Array.isArray(ledger.events)
    || !Array.isArray(ledger.headEventIds) || ledger.publicationReady !== false) fail('invalid_feed_ledger');
  const { ledgerHash, ...unsigned } = ledger;
  if (hash(unsigned) !== ledgerHash) fail('feed_ledger_hash_mismatch');
  if (new Set(ledger.events.map(e => e.eventId)).size !== ledger.events.length) fail('duplicate_event');
  return ledger;
}
function eventFacts(e) {
  return { eventId: e.eventId, playerId: e.playerId, fromOwnerId: e.fromOwnerId, toOwnerId: e.toOwnerId,
    type: e.type, amount: e.amount, sourceFeedId: e.sourceFeedId };
}
function mergeLedger(previous, current) {
  if (!current.endObserved || current.sourceCoverage !== 'retained_feed_exhausted'
    || !Number.isInteger(current.pages) || current.pages < 1 || current.pages > 100
    || !Array.isArray(current.events) || !Array.isArray(current.headEventIds) || !current.headEventIds.length) {
    fail('incomplete_feed_history');
  }
  const started = Date.parse(current.startedAt), completed = Date.parse(current.completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) fail('invalid_capture_interval');
  const incoming = new Map();
  for (const event of current.events) {
    if (incoming.has(event.eventId)) fail('duplicate_event');
    incoming.set(event.eventId, event);
  }
  if (current.headEventIds.some(id => !incoming.has(id))) fail('incomplete_feed_history');
  if (previous) {
    validateLedger(previous);
    if (previous.leagueId !== current.leagueId || previous.season !== current.season) fail('snapshot_context_mismatch');
    if (started < Date.parse(previous.completedAt)) fail('stale_capture');
  }
  const merged = new Map((previous?.events || []).map(e => [e.eventId, e])), newlyObservedIds = [];
  for (const event of current.events) {
    const old = merged.get(event.eventId);
    if (old && hash(eventFacts(old)) !== hash(eventFacts(event))) fail('feed_event_changed');
    if (!old && previous) newlyObservedIds.push(event.eventId);
    merged.set(event.eventId, { ...event, firstSeenAt: old?.firstSeenAt || current.completedAt,
      lastSeenAt: current.completedAt });
  }
  const overlap = previous && previous.headEventIds.length > 0
    && previous.headEventIds.every(id => incoming.has(id));
  const recent = previous && started - Date.parse(previous.completedAt) <= 24 * 60 * 60 * 1000;
  const coverageGaps = [...(previous?.coverageGaps || [])];
  if (previous && (!overlap || !recent)) coverageGaps.push({
    previousCaptureAt: previous.completedAt, detectedAt: current.completedAt,
    reasons: [!overlap && 'previous_head_missing', !recent && 'interval_over_24h'].filter(Boolean)
  });
  const result = { schemaVersion: 1, leagueId: current.leagueId, season: current.season,
    initializedAt: previous?.initializedAt || current.completedAt, completedAt: current.completedAt,
    sourceCoverage: current.sourceCoverage, sourceWindowEventCount: current.events.length,
    headEventIds: current.headEventIds, pages: current.pages, baseline: !previous,
    continuity: !previous ? 'initial_baseline' : overlap && recent ? 'previous_head_retained' : 'review_required',
    coverageGaps, reviewRequired: coverageGaps.length > 0,
    newlyObservedIds, events: [...merged.values()].sort((a, b) => a.eventId.localeCompare(b.eventId)),
    publicationReady: false, aiCalls: 0 };
  result.ledgerHash = hash(result);
  return result;
}
module.exports = { advanceFeed, feedProgress, paginateHistory, collectHistory, mergeLedger, validateLedger };
