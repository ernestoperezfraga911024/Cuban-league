'use strict';
const { compare, MarketError } = require('./core.cjs');

// Read-only recovery: a retry is a fresh full capture, never a union with old rows.
async function collectComplete(page, previous, { read, progress = () => {} } = {}) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const current = await read(page), delta = compare(previous, current);
    if (!delta.missingPlayerIds.length) return { current, delta, catalogReads: attempt };
    const missing = new Set(delta.missingPlayerIds);
    const details = { phase: 'market', attempt, previousPlayers: previous.players.length,
      currentPlayers: current.players.length,
      freePlayers: current.players.filter(p => p.ownerId === null).length,
      ownedPlayers: current.players.filter(p => p.ownerId !== null).length,
      missingCount: missing.size,
      missing: previous.players.filter(p => missing.has(p.playerId)).slice(0, 100)
        .map(p => ({ playerId: p.playerId, name: p.name, previousOwnerId: p.ownerId,
          previousValue: p.marketValue, previousClause: p.clauseValue })) };
    progress({ ...details, action: attempt === 1 ? 'reread_catalog' : 'blocked_incomplete_catalog' });
    if (attempt === 2) throw new MarketError('missing_catalog_players');
  }
}
module.exports = { collectComplete };
