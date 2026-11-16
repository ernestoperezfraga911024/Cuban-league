'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), { createRequire } = require('node:module');
const { generateKeyPairSync } = require('node:crypto');
const { hash, ORIGIN, MarketError } = require('../scripts/mister-market/core.cjs');
const { readFeedDocument, readPlayerMovementsDocument } = require('../scripts/mister-market/dom.cjs');
const { mergeLedger } = require('../scripts/mister-market/history.cjs');
const { clauseReport } = require('../scripts/mister-market/clause-stats.cjs');
const { reconcile } = require('../scripts/mister-market/reconciliation.cjs');
const { prepare } = require('../scripts/mister-market/publication.cjs');
const { restoreArchive } = require('../scripts/mister-market/restore-archive.cjs');
const { refreshPendingDates, assertDateOnlyRefresh } = require('../scripts/mister-market/profile-refresh.cjs');
const fixture = require('./helpers/market-fixture.cjs');
const at = '2026-11-16T15:30:00.000Z';
const now = () => Date.parse(at);
function movement(date = '2026-09-01', amount = 1000) {
  return { type: 'clause', sourceType: 'Cláusula', occurredOn: date, datePrecision: 'day', occurredAt: null,
    from: { managerId: '1', name: 'Participante 1', resolution: 'exact_name' },
    to: { managerId: '2', name: 'Participante 2', resolution: 'exact_name' }, amount };
}
function setup() {
  const publicData = fixture();
  const s = { schemaVersion: 1, leagueId: '649733', season: '2026-27', catalogComplete: true, publicationReady: false,
    startedAt: at, completedAt: at, managers: publicData.managers.map(({ id, name }) => ({ id, name })),
    clubs: [{ id: '1', name: 'Club Ázul' }, { id: '2', name: 'Club Verde' }], movements: [],
    players: publicData.players.map(p => ({ playerId: p.id, name: p.name, position: p.position,
      clubId: Number(p.id) % 2 ? '1' : '2', photoUrl: null, sourceUrl: `${ORIGIN}/players/${p.id}/test`,
      marketValue: p.value, clauseValue: p.clause, ownerId: p.ownerId })) };
  s.snapshotHash = hash(s);
  const v = { schemaVersion: 1, leagueId: s.leagueId, snapshotHash: s.snapshotHash,
    completedAt: '2026-11-15T20:00:00Z', teams: s.managers.map(m => ({ managerId: m.id,
      playerCount: s.players.filter(p => p.ownerId === m.id).length, verified: true })),
    histories: s.players.map(p => ({ playerId: p.playerId, sourceUrl: p.sourceUrl, sectionPresent: true,
      coverage: 'latest_visible_per_player', stableEventIds: false, movements: p.playerId === '3' ? [movement()] : [] })) };
  const incoming = { leagueId: s.leagueId, season: s.season, startedAt: at, completedAt: at,
    endObserved: true, sourceCoverage: 'retained_feed_exhausted', pages: 1, headEventIds: ['a'],
    events: ['1', '2'].map((id, i) => ({ eventId: i ? 'b' : 'a', playerId: id, fromOwnerId: '1',
      toOwnerId: '2', amount: 1000, type: 'clause', sourceFeedId: 'feed-' + (i + 1) })) };
  const ledger = mergeLedger(null, incoming);
  return { snapshot: s, verification: v, ledger, incoming, participants: publicData.managers.map(m => ({ id: m.participantId, name: m.name })) };
}
function raw(label = '16 nov 2026 · Cláusula', amount = '1.000', parties = ['Participante 1', 'Participante 2']) {
  return { label, amount, parties };
}
function browser(rows = {}, options = {}) {
  let url = ORIGIN + '/feed', guards = 0;
  const visits = [];
  const page = { url: () => url, visits,
    async goto(next) { url = next; visits.push(next); },
    async evaluate(fn) {
      const id = url.match(/\/players\/(\d+)/)?.[1];
      if (fn === readFeedDocument) {
        if (!id) guards++;
        return { leagueId: options.wrongLeague && id ? '978196' : '649733', ready: true, cards: 1,
          events: options.changeFeed && guards > 1 ? [{ feedId: 'feed-99', playerId: '1', name: 'Futbolista 1',
            title: 'por pago de cláusula', from: { id: '1', name: 'Participante 1' },
            to: { id: '2', name: 'Participante 2' }, amount: '1.000' }] : options.feedEvents || [] };
      }
      assert.equal(fn, readPlayerMovementsDocument);
      if (rows[id] instanceof Error) throw rows[id];
      return { ready: true, playerId: id, sectionPresent: true, recordsPresent: true, rows: rows[id] || [] };
    } };
  return page;
}
const wait = async (read, accept) => { const s = await read(); if (!accept(s)) throw new MarketError('page_not_settled'); return s; };
const run = (f, page, opts = {}) => refreshPendingDates(page, f.snapshot, f.ledger, f.verification, { wait, now, ...opts });

test('Recovers only exact pending tuples and preserves every old date, count and amount', async () => {
  const f = setup(), original = structuredClone(f.verification), page = browser({ '1': [raw()], '2': [raw('15 nov 2026 · Cláusula')] });
  const result = await run(f, page), before = reconcile(f.verification, f.ledger), after = reconcile(result.verification, f.ledger);
  assert.equal(result.metrics.profileReads, 2); assert.equal(result.metrics.profileDatesRecovered, 2);
  assert.equal(result.metrics.profileDatesPending, 0); assert.equal(after.events.length, before.events.length);
  assert.deepEqual(f.verification, original); assertDateOnlyRefresh(before, after);
  assert.deepEqual(after.events.filter(e => e.playerId === '3'), before.events.filter(e => e.playerId === '3'));
  assert.deepEqual(page.visits.filter(u => u.includes('/players/')).map(u => u.match(/players\/(\d+)/)[1]), ['1', '2']);
  const added = result.verification.histories[0].movements[0];
  assert.equal(added.occurredOn, '2026-11-16'); assert.equal(added.rereadEvidence.observedAt, at);
  assert.equal(added.rereadEvidence.sourceUrl, f.snapshot.players[0].sourceUrl);
  assert.equal(result.verification.completedAt, original.completedAt);
});
test('A completed reread survives compressed archival and repeated runs perform zero profile requests', async () => {
  const f = setup(), r = await run(f, browser({ '1': [raw()], '2': [raw()] }));
  const backup = { schemaVersion: 1, leagueId: f.snapshot.leagueId, season: f.snapshot.season, completeSeason: false,
    captures: [f.snapshot], verification: r.verification, feedLedger: f.ledger,
    clauseStatistics: clauseReport(f.snapshot, f.ledger, r.verification) };
  const prepared = prepare(backup, f.participants, { reconciled: true }), restored = restoreArchive(prepared.archive);
  const page = browser(), second = await run({ ...f, verification: restored.verification }, page);
  assert.equal(second.metrics.profileReads, 0); assert.deepEqual(page.visits, []);
  assert.deepEqual(prepared.payload.history.events, reconcile(second.verification, f.ledger).events);
});
test('Future clauses trigger only their pending player and keep recovered dates', async () => {
  const f = setup(), first = await run(f, browser({ '1': [raw()], '2': [raw()] }));
  const incoming = { ...f.incoming, startedAt: '2026-11-16T16:00:00Z', completedAt: '2026-11-16T16:00:00Z',
    events: [...f.incoming.events, { ...f.incoming.events[0], eventId: 'c', playerId: '4' }] };
  const page = browser({ '4': [raw()] });
  const result = await run({ ...f, verification: first.verification, ledger: mergeLedger(f.ledger, incoming) }, page);
  assert.equal(result.metrics.profileReads, 1); assert.equal(result.metrics.profileDatesRecovered, 1);
  assert.ok(page.visits.some(u => u.includes('/players/4/')));
  assert.deepEqual(result.verification.histories.slice(0, 3), first.verification.histories.slice(0, 3));
});
test('Identical rows retain multiplicity; a repeated observation cannot create another clause', async () => {
  const f = setup(); f.verification.histories[0].movements = [movement('2026-11-16')];
  const incoming = { ...f.incoming, events: [...f.incoming.events, { ...f.incoming.events[0], eventId: 'c' }] };
  f.ledger = mergeLedger(null, incoming);
  const result = await run(f, browser({ '1': [raw(), raw()], '2': [raw()] }));
  assert.equal(result.verification.histories[0].movements.length, 2);
  assert.equal(reconcile(result.verification, f.ledger).events.length, 4);
  const second = await run({ ...f, verification: result.verification }, browser({ '1': [raw(), raw()] }));
  assert.equal(second.metrics.profileReads, 0); assert.equal(second.verification.histories[0].movements.length, 2);
});
test('Does not choose an arbitrary date when several new dated rows exceed the pending count', async () => {
  const f = setup(), r = await run(f, browser({ '1': [raw(), raw('15 nov 2026 · Cláusula')] }));
  assert.equal(r.metrics.profileDatesRecovered, 0); assert.equal(r.metrics.profileDatesPending, 2);
  assert.equal(r.verification.profileRefresh.attempts.find(a => a.playerId === '1').status, 'ambiguous');
});
test('Different prices, reversed parties and ordinary transfers cannot supply a clause date', async () => {
  const f = setup(), r = await run(f, browser({ '1': [raw('16 nov 2026 · Cláusula', '2.000'),
    raw('16 nov 2026 · Cláusula', '1.000', ['Participante 2', 'Participante 1']), raw('16 nov 2026 · Traspaso')] }));
  assert.equal(r.metrics.profileDatesRecovered, 0); assert.equal(r.metrics.profileDatesPending, 2);
});
test('Missing rows and a failed profile keep the market usable and retryable without erasing history', async () => {
  const f = setup(), r = await run(f, browser({ '1': new MarketError('page_not_settled'), '2': [raw()] }));
  assert.equal(r.metrics.profileReadFailures, 1); assert.equal(r.metrics.profileDatesRecovered, 1);
  assert.equal(r.metrics.profileDatesPending, 1);
  assert.deepEqual(r.verification.histories[2], f.verification.histories[2]);
  const page = browser({ '1': [raw()] });
  const next = await run({ ...f, verification: r.verification }, page);
  assert.equal(next.metrics.profileDatesRecovered, 1); assert.equal(next.metrics.profileReads, 1);
});
test('Malformed or future dates remain pending and never become a capture date', async () => {
  const f = setup(), r = await run(f, browser({ '1': [raw('31 nov 2026 · Cláusula')], '2': [raw('17 nov 2026 · Cláusula')] }));
  assert.equal(r.metrics.profileReadFailures, 2); assert.equal(r.metrics.profileDatesRecovered, 0);
  assert.equal(r.metrics.profileDatesPending, 2);
});
test('A newly added catalogue player stays pending without expanding the baseline or blocking other dates', async () => {
  const f = setup();
  f.snapshot.players.push({ ...f.snapshot.players[0], playerId: '999', sourceUrl: ORIGIN + '/players/999/new' });
  delete f.snapshot.snapshotHash; f.snapshot.snapshotHash = hash(f.snapshot);
  f.ledger = mergeLedger(null, { ...f.incoming, events: [...f.incoming.events, { ...f.incoming.events[0], eventId: 'new', playerId: '999' }] });
  const r = await run(f, browser({ '1': [raw()], '2': [raw()] }));
  assert.equal(r.metrics.profileDatesRecovered, 2); assert.equal(r.metrics.profileDatesPending, 1);
  assert.equal(r.verification.histories.length, f.verification.histories.length);
  assert.equal(r.verification.profileRefresh.attempts.find(a => a.playerId === '999').reason, 'profile_not_in_verified_catalog');
});
test('A change of league or concurrent transfer prevents publication of the reread', async () => {
  for (const option of [{ wrongLeague: true }, { changeFeed: true }]) {
    const f = setup(), before = structuredClone(f.verification);
    await assert.rejects(run(f, browser({ '1': [raw()], '2': [raw()] }, option)), /wrong_league|feed_changed_during_verification/);
    assert.deepEqual(f.verification, before);
  }
});
test('Bounds requests and rotates unresolved players fairly across runs', async () => {
  const f = setup(), first = await run(f, browser(), { maxPlayers: 1 });
  assert.equal(first.metrics.profileReads, 1);
  const page = browser(), second = await run({ ...f, verification: first.verification }, page, { maxPlayers: 1 });
  assert.equal(second.metrics.profileReads, 1); assert.ok(page.visits.some(u => u.includes('/players/2/')));
  const timed = browser(); let clock = now();
  await run(f, timed, { now: () => { clock += 10; return clock; }, maxDuration: 1 });
  assert.equal(timed.visits.filter(u => u.includes('/players/')).length, 0);
});
test('Invariant guard rejects changed money, participant, count or a historical date', () => {
  const f = setup(), before = reconcile(f.verification, f.ledger);
  for (const change of [e => e.amount++, e => e.from = '4', e => e.date = '2026-11-16']) {
    const after = structuredClone(before); change(after.events.find(e => e.date));
    assert.throws(() => assertDateOnlyRefresh(before, after), /profile_refresh_changed/);
  }
  const fewer = structuredClone(before); fewer.events.pop();
  assert.throws(() => assertDateOnlyRefresh(before, fewer), /profile_refresh_changed_totals/);
});
test('Worker passes reread evidence through its real preparation/archive path and preserves test mode', async () => {
  const f = setup();
  const feedRows = ['1', '2'].map(id => ({ feedId: 'feed-' + id, playerId: id, name: 'Futbolista ' + id,
    title: 'por pago de cláusula', from: { id: '1', name: 'Participante 1' },
    to: { id: '2', name: 'Participante 2' }, amount: '1.000' }));
  f.snapshot.movements = feedRows.map(e => require('../scripts/mister-market/core.cjs').transfer(e, f.snapshot));
  delete f.snapshot.snapshotHash; f.snapshot.snapshotHash = hash(f.snapshot);
  f.incoming.events = f.snapshot.movements;
  f.incoming.headEventIds = f.snapshot.movements.map(e => e.eventId);
  const baseline = structuredClone(f.snapshot); baseline.startedAt = baseline.completedAt = '2026-11-15T19:00:00Z';
  delete baseline.snapshotHash; baseline.snapshotHash = hash(baseline); f.verification.snapshotHash = baseline.snapshotHash;
  const oldIncoming = { ...f.incoming, startedAt: '2026-11-15T20:00:00Z', completedAt: '2026-11-15T20:00:00Z' };
  const oldLedger = mergeLedger(null, oldIncoming);
  const backup = { schemaVersion: 1, leagueId: baseline.leagueId, season: baseline.season, completeSeason: false,
    captures: [baseline], verification: f.verification, feedLedger: oldLedger,
    clauseStatistics: clauseReport(baseline, oldLedger, f.verification) };
  const archive = prepare(backup, f.participants, { reconciled: true }).archive;
  const liveBefore = reconcile(f.verification, oldLedger), page = browser({ '1': [raw()], '2': [raw()] }, { feedEvents: feedRows });
  const publicKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const moduleFile = require.resolve('../scripts/mister-market/worker.cjs'), realRequire = createRequire(moduleFile);
  let closed = false, mode, finished;
  const replacements = {
    './collector.cjs': { collect: async () => f.snapshot },
    './verification.cjs': { verifySnapshot: async () => ({ ...f.verification, snapshotHash: f.snapshot.snapshotHash, feedStable: true }) },
    './history.cjs': { ...realRequire('./history.cjs'), collectHistory: async () => f.incoming },
    './profile-refresh.cjs': { refreshPendingDates: (p, s, l, v, options) => refreshPendingDates(p, s, l, v, { ...options, wait, now }) },
    '../../data.json': { participants: f.participants },
    playwright: { chromium: { launch: async () => ({ close: async () => { closed = true; }, newContext: async () => ({
      newPage: async () => page, storageState: async () => ({ cookies: [], origins: [] }) }) }) } }
  };
  const sandbox = { module: { exports: {} }, require: name => replacements[name] || realRequire(name),
    process: { env: {} }, console: { log() {}, error() {} }, Date, URL, fetch, AbortSignal };
  vm.runInNewContext(fs.readFileSync(moduleFile, 'utf8'), sandbox, { filename: moduleFile });
  const result = await sandbox.module.exports.run({ mode: 'test', request: async (action, data) => {
    if (action === 'begin') { mode = data.mode; return { archive, publicKey, storageState: { cookies: [], origins: [] }, expectedRevision: 'old' }; }
    assert.equal(action, 'finish'); finished = data; return { outcome: 'tested' };
  } });
  assert.equal(result.outcome, 'tested'); assert.equal(mode, 'test'); assert.equal(closed, true);
  assert.equal(finished.metrics.profileDatesRecovered, 2); assert.equal(finished.metrics.aiCalls, 0);
  assert.equal(finished.payload.history.events.filter(e => e.date === null).length, 0);
  assertDateOnlyRefresh(liveBefore, finished.payload.history);
  assert.equal(restoreArchive(finished.archive).verification.profileRefresh.metrics.profileDatesRecovered, 2);
});
