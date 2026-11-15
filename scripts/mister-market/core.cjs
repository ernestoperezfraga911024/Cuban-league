'use strict';

const { createHash } = require('node:crypto');
const ORIGIN = 'https://mister.mundodeportivo.com';
const DEFAULTS = Object.freeze({ leagueId: '649733', season: '2026-27', expectedManagers: 20, expectedClubs: 20 });
class MarketError extends Error {
  constructor(code) { super(code); this.name = 'MarketError'; this.code = code; }
}
const fail = code => { throw new MarketError(code); };
const clean = value => String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim();
const id = value => /^[1-9]\d*$/.test(String(value)) ? String(value) : fail('invalid_id');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function money(value) {
  const s = clean(value).replace(/^€\s*/, '').replace(/\s*[↑↓]$/, '').trim();
  if (!/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:\.\d{3})+)$/.test(s)) fail('invalid_money');
  const n = Number(s.replace(/\./g, ''));
  if (!Number.isSafeInteger(n) || n < 0) fail('invalid_money');
  return n;
}
function unique(rows, key, code) {
  const seen = new Set();
  for (const row of rows) { const k = key(row); if (seen.has(k)) fail(code); seen.add(k); }
}
function context(meta, config = DEFAULTS) {
  if (meta.leagueId !== config.leagueId) fail('wrong_league');
  const managers = meta.managers.map(m => ({ id: id(m.id), name: clean(m.name) }));
  const clubs = meta.clubs.map(c => ({ id: id(c.id), name: clean(c.name) }));
  if (managers.length !== config.expectedManagers || clubs.length !== config.expectedClubs
    || [...managers, ...clubs].some(x => !x.name)) fail('incomplete_context');
  unique(managers, m => m.id, 'duplicate_manager');
  unique(managers, m => m.name, 'ambiguous_manager_name');
  unique(clubs, c => c.id, 'duplicate_club');
  return { leagueId: config.leagueId, season: config.season, managers, clubs };
}
function player(raw, partition, ctx) {
  const playerId = id(raw.id);
  const url = new URL(raw.href, ORIGIN);
  if (url.origin !== ORIGIN || url.pathname.split('/')[1] !== 'players'
    || url.pathname.split('/')[2] !== playerId || url.search) fail('invalid_player_link');
  const name = clean(raw.name);
  const position = { 1: 'PT', 2: 'DF', 3: 'MC', 4: 'DL' }[raw.position];
  const club = ctx.clubs.find(c => c.id === String(raw.clubId));
  if (!name || !position || !club) fail('invalid_player_identity');
  let ownerId = null, clause = null;
  if (partition === 'owned') {
    const match = clean(raw.header).match(/^(.*) · ([\d.]+) cláusula$/u);
    if (!match) fail('missing_owner_or_clause');
    const owner = ctx.managers.find(m => m.name === match[1]);
    if (!owner) fail('unknown_owner');
    ownerId = owner.id;
    clause = money(match[2]);
  } else if (partition !== 'free' || clean(raw.header)) fail('partition_conflict');
  let photoUrl = null;
  if (raw.photoUrl) {
    const photo = new URL(raw.photoUrl);
    if (photo.protocol === 'https:' && photo.hostname === 'cdn-mister.mundodeportivo.com'
      && photo.pathname === `/file/cdn-common/players/${playerId}.png`) photoUrl = photo.href;
  }
  return { playerId, name, position, clubId: club.id, photoUrl, sourceUrl: url.href,
    marketValue: money(raw.value), clauseValue: clause, clauseStatus: partition === 'free' ? 'not_applicable' : 'observed',
    ownerId, ownershipStatus: partition, salePrice: null, saleStatus: 'not_collected', currency: 'EUR' };
}
function transfer(raw, ctx) {
  const playerId = id(raw.playerId);
  if (!/^feed-[1-9]\d*$/.test(raw.feedId)) fail('invalid_event_id');
  function party(p) {
    if (!p) fail('unknown_event_party');
    if (p.id === null && clean(p.name) === 'Mister') return null;
    const manager = ctx.managers.find(m => m.id === String(p.id));
    if (!manager || manager.name !== clean(p.name)) fail('unknown_event_party');
    return manager.id;
  }
  const fromOwnerId = party(raw.from), toOwnerId = party(raw.to);
  if (fromOwnerId === toOwnerId || !clean(raw.name)) fail('invalid_transfer');
  const isClause = /por pago de cláusula/.test(clean(raw.title));
  if (isClause && (!fromOwnerId || !toOwnerId)) fail('invalid_clause_transfer');
  const type = isClause ? 'clause' : fromOwnerId === null ? 'purchase' : toOwnerId === null ? 'sale' : 'transfer';
  return { eventId: `${ctx.leagueId}:${raw.feedId}:${playerId}:${fromOwnerId || 'mister'}:${toOwnerId || 'mister'}`,
    playerId, name: clean(raw.name), fromOwnerId, toOwnerId, type, amount: money(raw.amount),
    occurredAt: null, sourceFeedId: raw.feedId };
}
function eventSet(rawEvents, ctx) {
  const events = rawEvents.map(e => transfer(e, ctx));
  unique(events, e => e.eventId, 'duplicate_event');
  return events.sort((a, b) => a.eventId.localeCompare(b.eventId));
}
function snapshot({ meta, free, owned, feedBefore, feedAfter, startedAt, completedAt, minPlayers = 100 }, config = DEFAULTS) {
  const ctx = context(meta, config);
  const start = Date.parse(startedAt), end = Date.parse(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 15 * 60 * 1000) fail('invalid_capture_interval');
  for (const [part, kind] of [[free, 'free'], [owned, 'owned']]) {
    if (part.leagueId !== ctx.leagueId || part.partition !== kind || part.exhausted !== true
      || part.filtersVerified !== true || !Array.isArray(part.rows)) fail('incomplete_catalog');
  }
  const players = [...free.rows.map(r => player(r, 'free', ctx)), ...owned.rows.map(r => player(r, 'owned', ctx))];
  if (players.length < minPlayers) fail('catalog_too_small');
  unique(players, p => p.playerId, 'player_in_multiple_partitions');
  const before = eventSet(feedBefore, ctx), after = eventSet(feedAfter, ctx);
  if (hash(before) !== hash(after)) fail('feed_changed_during_capture');
  players.sort((a, b) => Number(a.playerId) - Number(b.playerId));
  const result = { schemaVersion: 1, ...ctx, startedAt, completedAt, catalogComplete: true, players,
    movements: after, movementsCoverage: 'visible_window', publicationReady: false };
  result.snapshotHash = hash(result);
  return result;
}
function validateSnapshot(s) {
  if (!s || s.schemaVersion !== 1 || s.catalogComplete !== true || s.publicationReady !== false
    || !Array.isArray(s.players) || !Array.isArray(s.movements)) fail('invalid_snapshot');
  const { snapshotHash, ...unsigned } = s;
  if (hash(unsigned) !== snapshotHash) fail('snapshot_hash_mismatch');
  return s;
}
function compare(previous, current) {
  validateSnapshot(current);
  if (!previous) return { baseline: true, changes: [], newEvents: [], missingPlayerIds: [] };
  validateSnapshot(previous);
  if (previous.leagueId !== current.leagueId || previous.season !== current.season) fail('snapshot_context_mismatch');
  if (Date.parse(current.startedAt) < Date.parse(previous.completedAt)) fail('stale_capture');
  const old = new Map(previous.players.map(p => [p.playerId, p]));
  const seen = new Set(previous.movements.map(e => e.eventId));
  const newEvents = current.movements.filter(e => !seen.has(e.eventId));
  const changes = [];
  for (const p of current.players) {
    const prior = old.get(p.playerId);
    if (!prior) changes.push({ type: 'catalog_added', playerId: p.playerId });
    else {
      if (p.ownerId !== prior.ownerId) changes.push({ type: 'owner_changed', playerId: p.playerId,
        fromOwnerId: prior.ownerId, toOwnerId: p.ownerId });
      for (const field of ['marketValue', 'clauseValue']) if (p[field] !== prior[field]) {
        changes.push({ type: field === 'marketValue' ? 'value_changed' : 'clause_changed', playerId: p.playerId,
          before: prior[field], after: p[field] });
      }
    }
    old.delete(p.playerId);
  }
  // Missing rows are a review condition, never a sale or a request to remove a player.
  return { baseline: false, changes, newEvents, missingPlayerIds: [...old.keys()] };
}
function teams(s) {
  validateSnapshot(s);
  return s.managers.map(m => ({ managerId: m.id, name: m.name,
    players: s.players.filter(p => p.ownerId === m.id) }));
}
module.exports = { ORIGIN, DEFAULTS, MarketError, fail, clean, money, context, player, transfer, snapshot,
  validateSnapshot, compare, teams, hash };
