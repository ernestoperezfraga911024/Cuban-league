'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { compare, fail, teams } = require('./core.cjs');

async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }); }
}
async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; fail('unreadable_local_state'); }
}
async function withLock(dir, run) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const lock = path.join(dir, 'run.lock');
  let handle;
  try { handle = await fs.open(lock, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') fail('already_running_or_stale_lock'); throw error; }
  try { return await run(); }
  finally { await handle.close(); await fs.rm(lock, { force: true }); }
}
async function saveCapture(dir, current) {
  const previous = await readJson(path.join(dir, 'latest.json'));
  const diff = compare(previous, current);
  // Keep the catalog behind each evidence hash when the comparison baseline advances.
  // Also archive an existing baseline created before this archive was introduced.
  for (const capture of [previous, current].filter(Boolean)) {
    await atomicJson(path.join(dir, 'captures', `${capture.snapshotHash}.json`), capture);
  }
  const report = { schemaVersion: 1, capturedAt: current.completedAt, snapshotHash: current.snapshotHash,
    mode: 'read_only', publicationReady: false, aiCalls: 0, playerCount: current.players.length,
    ownedCount: current.players.filter(p => p.ownerId !== null).length,
    managerCount: current.managers.length, visibleEventCount: current.movements.length,
    movementsCoverage: current.movementsCoverage, ...diff };
  await atomicJson(path.join(dir, 'candidate.json'), current);
  await atomicJson(path.join(dir, 'report.json'), report);
  if (diff.missingPlayerIds.length) fail('missing_players_review_required');
  await atomicJson(path.join(dir, 'teams.json'), { snapshotHash: current.snapshotHash,
    capturedAt: current.completedAt, teams: teams(current) });
  // This is only the local comparison baseline. It is never a public-site write.
  await atomicJson(path.join(dir, 'latest.json'), current);
  return report;
}
module.exports = { atomicJson, readJson, withLock, saveCapture };
