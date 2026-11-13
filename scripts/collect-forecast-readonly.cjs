#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {tmpdir} = require('node:os');
const {ReadSession} = require('./forecast/read-session.cjs');
const {TeamCollector} = require('./forecast/collect-team.cjs');
const {evidenceStore} = require('./forecast/evidence-store.cjs');

async function main() {
  const [flag, manifestPath, ...extra] = process.argv.slice(2);
  if (flag !== '--read-only' || !manifestPath || extra.length) throw Error('Usage: node scripts/collect-forecast-readonly.cjs --read-only manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.teams) || !manifest.teams.length || manifest.teams.length > 20 ||
      new Set(manifest.teams.map(t => t.team)).size !== manifest.teams.length ||
      manifest.teams.some(t => !/^[a-z0-9-]+$/.test(t.team) || !Number.isInteger(t.fixture?.matchday) ||
        ![t.fixture.home, t.fixture.away].includes(t.team) || !Number.isFinite(Date.parse(t.fixture.kickoff_at)) || Date.parse(t.fixture.kickoff_at) <= Date.now() ||
        !['futbolfantasy','jornadaperfecta','comuniate'].every(id => typeof t.fixture.source_urls?.[id] === 'string') ||
        typeof t.comuniate_team_url !== 'string')) throw Error('Invalid future-fixture manifest');
  const started = Date.now();
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'forecast-readonly-'));
  const reader = new ReadSession({runKey: 'READ_ONLY_DIAGNOSTIC:' + path.basename(directory),
    notBefore: new Date(started).toISOString(), expiresAt: new Date(started + 7200000).toISOString()});
  const collector = new TeamCollector(reader, evidenceStore(directory));
  const teams = [];
  console.log(JSON.stringify({event: 'started', directory, started_at: new Date(started).toISOString(), read_only: true}));
  try {
    for (const team of manifest.teams) {
      const result = await collector.collect(team);
      await fs.writeFile(path.join(directory, team.team + '.json'), JSON.stringify(result), {flag: 'wx', mode: 0o600});
      const summary = {team: team.team, elapsed_ms: result.elapsed_ms,
        base_elevens: Object.values(result.observations).filter(x => x.length === 11 && new Set(x.map(p => p.name)).size === 11).length,
        authors: result.predictions.length, complete_unvalidated: result.predictions.filter(p => p.status === 'complete_unvalidated').length,
        unavailable: result.predictions.filter(p => p.status === 'unavailable').length, errors: result.errors};
      teams.push(summary);
      console.log(JSON.stringify({event: 'team_collected', ...summary}));
    }
  } finally { reader.close(); }
  const finished = Date.now();
  const report = {read_only: true, publication_ready: false, database_writes: 0,
    started_at: new Date(started).toISOString(), finished_at: new Date(finished).toISOString(),
    elapsed_ms: finished - started, metrics: reader.stats(), teams};
  const file = path.join(directory, 'report.json');
  await fs.writeFile(file, JSON.stringify(report, null, 2), {flag: 'wx', mode: 0o600});
  console.log(JSON.stringify({event: 'finished', report: file, ...report}));
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
