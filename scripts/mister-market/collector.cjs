'use strict';

const { ORIGIN, DEFAULTS, fail, hash, context, snapshot } = require('./core.cjs');
const { readMarketDocument, readFilterDocument, readFeedDocument } = require('./dom.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const fingerprint = state => hash({ rows: state.rows, hasMore: state.hasMore });

async function waitStable(read, accept, { timeout = 20000, stableFor = 1500, interval = 200,
  now = Date.now, sleep = pause } = {}) {
  const end = now() + timeout;
  let signature, since;
  while (now() < end) {
    const state = await read();
    const next = hash(state);
    if (!accept(state)) { signature = undefined; since = undefined; }
    else if (next !== signature) { signature = next; since = now(); }
    else if (now() - since >= stableFor) return state;
    await sleep(interval);
  }
  fail('page_not_settled');
}
function assertLeague(state, config) {
  if (state.leagueId !== config.leagueId) fail(state.leagueId ? 'wrong_league' : 'session_or_page_unavailable');
  return state;
}
function verifyFilters(filters, owner, resetRanges) {
  if (filters.owner !== owner || filters.team !== '0' || filters.position !== '0'
    || filters.injured !== false || filters.stealable === true) fail('unexpected_filters');
  if (hash(filters.ranges) !== hash(resetRanges)) fail('unexpected_price_filter');
}
function pageExtended(before, after) {
  if (after.rows.length <= before.rows.length) return false;
  if (before.rows.some((p, i) => p.id !== after.rows[i]?.id)) fail('pagination_changed');
  const ids = after.rows.map(p => p.id);
  if (new Set(ids).size !== ids.length) fail('duplicate_page_row');
  return true;
}
async function paginate(initial, { read, next, maxPages = 40, wait = waitStable }) {
  let state = initial;
  for (let page = 1; state.hasMore; page++) {
    if (page >= maxPages) fail('pagination_limit');
    const before = state;
    await next();
    state = await wait(read, s => s.ready && !s.popupOpen && pageExtended(before, s), { stableFor: 2000 });
  }
  return state;
}

async function collect(page, config = DEFAULTS, { wait = waitStable } = {}) {
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + 12 * 60 * 1000;
  page.setDefaultTimeout(20000);
  async function checked(fn) {
    if (Date.now() > deadline) fail('capture_timeout');
    const url = new URL(page.url());
    if (url.origin !== ORIGIN) fail('session_or_page_unavailable');
    return assertLeague(await page.evaluate(fn), config);
  }
  async function go(path) {
    await page.goto(`${ORIGIN}${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator(`a.active[href*="id_community=${config.leagueId}"]`).waitFor({ state: 'attached' });
  }
  async function feed() {
    await go('/feed');
    const state = await wait(() => checked(readFeedDocument), s => s.ready && s.cards > 0,
      { stableFor: 2500 });
    return state.events;
  }
  const feedBefore = await feed();
  await go('/search');
  await page.locator('.search-players-list').waitFor({ state: 'visible' });
  await page.locator('input.search-players-input').fill('');
  const readMarket = async () => {
    const state = await checked(readMarketDocument);
    if (state.search !== '' || state.favorites !== false) fail('unexpected_search_filter');
    return state;
  };
  const initial = await checked(readMarketDocument);
  if (initial.favorites) await page.locator('.search-players-filter-favs').click();
  async function openFilters() {
    await page.locator('.search-players-filter-btn').click();
    await page.locator('#popup-content select[name="owner"]').waitFor({ state: 'visible' });
  }
  await openFilters();
  await page.locator('#popup-content .search-players-filter-reset').click();
  // Mister closes the popup on reset. Re-open it before selecting a partition.
  await page.locator('#popup-content select[name="owner"]').waitFor({ state: 'hidden' });
  await wait(readMarket, s => s.ready && !s.popupOpen && s.rows.length > 0);
  await openFilters();
  const meta = await checked(readFilterDocument);
  context(meta, config);
  const resetRanges = meta.ranges;
  if (resetRanges.length !== 4 || resetRanges.some(r => !/^\d+$/.test(r.value || ''))
    || resetRanges.filter(r => r.name.endsWith('_from')).some(r => Number(r.value) !== 0)
    || resetRanges.filter(r => r.name.endsWith('_to')).some(r => Number(r.value) <= 0)) fail('unknown_price_filter');
  verifyFilters(meta, '0', resetRanges);

  async function partition(kind, owner, alreadyOpen) {
    if (!alreadyOpen) await openFilters();
    const old = await readMarket();
    await page.locator('#popup-content select[name="owner"]').selectOption(owner);
    verifyFilters(await checked(readFilterDocument), owner, resetRanges);
    await page.locator('#popup-content .search-players-filter-apply').click();
    await page.locator('#popup-content select[name="owner"]').waitFor({ state: 'hidden' });
    // Closing the modal is not evidence of new data: wait for a different, stable list.
    const first = await wait(readMarket, s => s.ready && !s.popupOpen && s.rows.length > 0
      && fingerprint(s) !== fingerprint(old), { stableFor: 2000 });
    const full = await paginate(first, { read: readMarket, wait,
      next: () => page.locator('.search-players-more').click() });
    await openFilters();
    verifyFilters(await checked(readFilterDocument), owner, resetRanges);
    // Re-applying the same filter only closes this read-only search dialog.
    await page.locator('#popup-content .search-players-filter-apply').click();
    await page.locator('#popup-content select[name="owner"]').waitFor({ state: 'hidden' });
    await wait(readMarket, s => s.ready && !s.popupOpen && s.rows.length > 0);
    return { leagueId: full.leagueId, partition: kind, exhausted: true, filtersVerified: true, rows: full.rows };
  }
  const free = await partition('free', '-1', true);
  const owned = await partition('owned', '-2', false);
  const feedAfter = await feed();
  return snapshot({ meta, free, owned, feedBefore, feedAfter, startedAt, completedAt: new Date().toISOString() }, config);
}
module.exports = { collect, waitStable, paginate, pageExtended, verifyFilters, assertLeague };
