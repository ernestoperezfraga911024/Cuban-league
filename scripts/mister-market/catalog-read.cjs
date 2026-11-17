'use strict';
const { compare, hash, MarketError } = require('./core.cjs');

// Read-only recovery: a retry is a fresh full capture, never a union with old rows.
async function collectComplete(page, previous, { read, progress = () => {}, protectedPlayerIds = null } = {}) {
  let first;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const current = await read(page), delta = compare(previous, current);
    if (!delta.missingPlayerIds.length) return { current, delta, catalogReads: attempt, absentFreePlayers: [] };
    const missing = new Set(delta.missingPlayerIds);
    const details = { phase: 'market', attempt, previousPlayers: previous.players.length,
      currentPlayers: current.players.length,
      freePlayers: current.players.filter(p => p.ownerId === null).length,
      ownedPlayers: current.players.filter(p => p.ownerId !== null).length,
      missingCount: missing.size,
      missing: previous.players.filter(p => missing.has(p.playerId)).slice(0, 100)
        .map(p => ({ playerId: p.playerId, name: p.name, previousOwnerId: p.ownerId,
          previousValue: p.marketValue, previousClause: p.clauseValue })) };
    progress({ ...details, action: attempt === 1 ? 'reread_catalog' : 'review_catalog_absences' });
    if (attempt === 1) { first = current; continue; }
    const absentFreePlayers = previous.players.filter(p => missing.has(p.playerId));
    // A free player's search absence is not a sale or a deletion of history.
    // Require independent club searches before these candidates can be accepted.
    if (!Array.isArray(protectedPlayerIds) || missing.size > 20 || missing.size > previous.players.length * 0.05
      || absentFreePlayers.some(p => p.ownerId !== null || p.ownershipStatus !== 'free'
        || protectedPlayerIds.includes(p.playerId))
      || hash(first.players) !== hash(current.players)
      || hash(first.movements) !== hash(current.movements)
      || hash(first.managers) !== hash(current.managers) || hash(first.clubs) !== hash(current.clubs)
      || Date.parse(current.startedAt) < Date.parse(first.completedAt)) throw new MarketError('missing_catalog_players');
    return { current, delta, catalogReads: attempt, absentFreePlayers,
      readings: [first, current].map(s => ({ snapshotHash: s.snapshotHash, completedAt: s.completedAt,
        playersHash: hash(s.players), playerIds: s.players.map(p => p.playerId) })) };
  }
}
module.exports = { collectComplete };
