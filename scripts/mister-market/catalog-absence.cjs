'use strict';
const { ORIGIN, fail, hash, player, transfer, context } = require('./core.cjs');
const { readMarketDocument, readFilterDocument, readFeedDocument } = require('./dom.cjs');
const { waitStable, paginate, verifyFilters, assertLeague } = require('./collector.cjs');

// Independent club-filtered searches verify that global pagination did not drop rows.
async function confirmFreeAbsences(page, current, candidates, { wait = waitStable, progress = () => {} } = {}) {
  if (!candidates.length) return [];
  const deadline = Date.now() + 3 * 60000, observations = [];
  const checked = async fn => {
    if (Date.now() > deadline) fail('catalog_confirmation_timeout');
    if (new URL(page.url()).origin !== ORIGIN) fail('session_or_page_unavailable');
    return assertLeague(await page.evaluate(fn), current);
  };
  await page.goto(ORIGIN + '/search', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.search-players-list').waitFor({ state: 'visible' });
  await page.locator('input.search-players-input').fill('');
  if ((await checked(readMarketDocument)).favorites) await page.locator('.search-players-filter-favs').click();
  const read = async () => {
    const s = await checked(readMarketDocument);
    if (s.search !== '' || s.favorites !== false) fail('unexpected_search_filter');
    return s;
  };
  const open = async () => {
    await page.locator('.search-players-filter-btn').click();
    await page.locator('#popup-content select[name="owner"]').waitFor({ state: 'visible' });
  };
  await open();
  await page.locator('#popup-content .search-players-filter-reset').click();
  await page.locator('#popup-content select[name="owner"]').waitFor({ state: 'hidden' });
  await wait(read, s => s.ready && !s.popupOpen && s.rows.length > 0, { label: 'absence_filter_reset' });
  await open();
  const meta = await checked(readFilterDocument); context(meta);
  if (hash(meta.managers) !== hash(current.managers) || hash(meta.clubs) !== hash(current.clubs)) fail('catalog_context_changed');
  const ranges = meta.ranges;
  if (ranges.length !== 4 || ranges.some(r => !/^\d+$/.test(r.value || ''))
    || ranges.filter(r => r.name.endsWith('_from')).some(r => Number(r.value) !== 0)
    || ranges.filter(r => r.name.endsWith('_to')).some(r => Number(r.value) <= 0)) fail('unknown_price_filter');
  verifyFilters(meta, '0', ranges);
  let first = true;
  for (const clubId of [...new Set(candidates.map(p => p.clubId))]) {
    if (!first) await open(); first = false;
    const old = await read();
    await page.locator('#popup-content select[name="owner"]').selectOption('-1');
    await page.locator('#popup-content select[name="team"]').selectOption(clubId);
    verifyFilters(await checked(readFilterDocument), '-1', ranges, clubId);
    await page.locator('#popup-content .search-players-filter-apply').click();
    await page.locator('#popup-content select[name="owner"]').waitFor({ state: 'hidden' });
    const initial = await wait(read, s => s.ready && !s.popupOpen && s.rows.length > 0
      && hash(s.rows) !== hash(old.rows), { stableFor: 2000, label: 'absence_club_search' });
    const full = await paginate(initial, { read, wait, next: () => page.locator('.search-players-more').click() });
    await open(); verifyFilters(await checked(readFilterDocument), '-1', ranges, clubId);
    await page.locator('#popup-content .search-players-filter-apply').click();
    await page.locator('#popup-content select[name="owner"]').waitFor({ state: 'hidden' });
    await wait(read, s => s.ready && !s.popupOpen && hash(s.rows) === hash(full.rows), { label: 'absence_filter_recheck' });
    const observed = full.rows.map(r => player(r, 'free', current)).sort((a,b)=>Number(a.playerId)-Number(b.playerId));
    if (observed.some(p => candidates.some(c => c.playerId === p.playerId))) fail('catalog_absence_not_confirmed');
    const expected = current.players.filter(p => p.clubId === clubId && p.ownerId === null);
    if (hash(observed) !== hash(expected)) fail('catalog_club_mismatch');
    observations.push({ clubId, observedAt: new Date().toISOString(), playerIds: observed.map(p=>p.playerId),
      playersHash: hash(observed), absentPlayerIds: candidates.filter(p=>p.clubId===clubId).map(p=>p.playerId) });
    progress({ phase: 'catalog_confirmation', completed: observations.length, players: observed.length, clubId });
  }
  await page.goto(ORIGIN + '/feed', { waitUntil: 'domcontentloaded', timeout: 30000 });
  const feed = await wait(() => checked(readFeedDocument), s=>s.ready && s.cards > 0,
    { stableFor: 1500, label: 'absence_feed' });
  const events = feed.events.map(e=>transfer(e,current)).sort((a,b)=>a.eventId.localeCompare(b.eventId));
  if (hash(events) !== hash(current.movements)) fail('feed_changed_during_verification');
  return observations;
}
module.exports = { confirmFreeAbsences };
