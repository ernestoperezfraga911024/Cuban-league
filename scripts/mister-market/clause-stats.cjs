'use strict';
const { fail, hash, validateSnapshot } = require('./core.cjs');
const { validateLedger } = require('./history.cjs');

// Counts refer to explicit Cláusula operations. The amount is the historical
// transaction price, never the player's current market value or clause.
function summarizeClauses(events, managers) {
  const totals = { clauseCount: 0, amount: 0 };
  const rows = new Map(managers.map(m => [m.id, { managerId: m.id, name: m.name,
    made: 0, received: 0, spent: 0, collected: 0, net: 0 }]));
  const unresolved = [], mostExpensive = [];
  for (const event of events) {
    if (event.type !== 'clause') continue;
    if (!Number.isSafeInteger(event.amount) || event.amount < 0) fail('invalid_clause_amount');
    totals.clauseCount++; totals.amount += event.amount;
    if (!Number.isSafeInteger(totals.amount)) fail('clause_total_overflow');
    const from = rows.get(event.fromOwnerId), to = rows.get(event.toOwnerId);
    if (from && to && from === to) fail('invalid_clause_transfer');
    if (from) { from.received++; from.collected += event.amount; }
    if (to) { to.made++; to.spent += event.amount; }
    if (!from || !to) unresolved.push({ reference: event.reference,
      from: event.fromName || null, to: event.toName || null, amount: event.amount });
    mostExpensive.push({ ...event });
  }
  const participants = [...rows.values()].map(row => ({ ...row, net: row.collected - row.spent }));
  // Ties remain ties; names/IDs only make their display ordering deterministic.
  const ranking = key => {
    const ordered = [...participants].sort((a, b) => b[key] - a[key] || a.managerId.localeCompare(b.managerId));
    let rank = 0;
    return ordered.map((row, i) => {
      if (i === 0 || row[key] !== ordered[i - 1][key]) rank = i + 1;
      return { rank, managerId: row.managerId, value: row[key] };
    });
  };
  return { totals, participants, unresolved, identityComplete: unresolved.length === 0,
    rankings: Object.fromEntries(['made', 'received', 'spent', 'collected'].map(key => [key, ranking(key)])),
    mostExpensive: mostExpensive.sort((a, b) => b.amount - a.amount || a.reference.localeCompare(b.reference)).slice(0, 10) };
}
function clauseReport(snapshot, ledger, verification = null) {
  validateSnapshot(snapshot); validateLedger(ledger);
  if (ledger.leagueId !== snapshot.leagueId || ledger.season !== snapshot.season) fail('snapshot_context_mismatch');
  const feed = { coverage: 'retained_feed_accumulated', completeSeason: false,
    coverageGaps: ledger.coverageGaps || [], reviewRequired: ledger.reviewRequired || false,
    ledgerHash: ledger.ledgerHash, observedThrough: ledger.completedAt,
    ...summarizeClauses(ledger.events.map(e => ({ ...e, reference: e.eventId })), snapshot.managers) };
  let profiles = null;
  if (verification) {
    if (verification.snapshotHash !== snapshot.snapshotHash || verification.leagueId !== snapshot.leagueId
      || verification.histories?.length !== snapshot.players.length
      || verification.histories.some((h, i) => h.playerId !== snapshot.players[i].playerId)) fail('verification_snapshot_mismatch');
    profiles = { coverage: 'latest_visible_per_player', completeSeason: false,
      observedThrough: verification.completedAt, playersChecked: verification.histories.length,
      ...summarizeClauses(verification.histories.flatMap(h => h.movements.map((m, index) => ({
        reference: `${h.playerId}:row:${index}`, playerId: h.playerId, type: m.type, amount: m.amount,
        occurredOn: m.occurredOn, fromOwnerId: m.from.managerId, toOwnerId: m.to.managerId,
        fromName: m.from.name, toName: m.to.name
      }))), snapshot.managers) };
  }
  // The profile rows have dates but no event IDs. Adding these two totals would
  // count the same operation twice; reconciliation is deliberately still pending.
  const result = { schemaVersion: 1, leagueId: snapshot.leagueId, season: snapshot.season, snapshotHash: snapshot.snapshotHash,
    generatedAt: new Date().toISOString(), feed, profiles,
    combined: null, reconciliation: 'pending', publicationReady: false, aiCalls: 0 };
  return { ...result, reportHash: hash(result) };
}
module.exports = { summarizeClauses, clauseReport };
