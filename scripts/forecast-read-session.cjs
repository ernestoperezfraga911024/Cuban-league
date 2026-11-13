#!/usr/bin/env node
'use strict';
// One long-lived process for one run. NDJSON in/out; only compact metadata on stdout.
const {createInterface} = require('node:readline');
const {mkdtemp, writeFile} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {createHash} = require('node:crypto');
const {ReadSession} = require('./forecast/read-session.cjs');

async function main() {
  const [runKey, notBefore, expiresAt, ...extra] = process.argv.slice(2);
  if (!runKey || !notBefore || !expiresAt || extra.length) {
    throw Error('Usage: node scripts/forecast-read-session.cjs RUN_KEY NOT_BEFORE_ISO EXPIRES_AT_ISO');
  }
  const session = new ReadSession({runKey, notBefore, expiresAt});
  const directory = await mkdtemp(join(tmpdir(), 'forecast-read-'));
  const files = new Map();
  const output = value => process.stdout.write(JSON.stringify(value) + '\n');
  output({event: 'started', run_key: runKey, directory});
  const input = createInterface({input: process.stdin, crlfDelay: Infinity});
  try {
    for await (const line of input) {
      if (!line.trim()) continue;
      let id = null;
      try {
        if (Buffer.byteLength(line) > 8192) throw Error('Command exceeds 8 KiB');
        const command = JSON.parse(line);
        id = command.id ?? null;
        if (command.op === 'close') break;
        if (command.op === 'stats') { output({id, metrics: session.stats()}); continue; }
        if (command.op !== 'read' || typeof command.url !== 'string') throw Error('Expected read, stats or close');
        const page = await session.read(command.url, {refresh: command.refresh === true});
        const digest = createHash('sha256').update(page.body).digest('hex');
        const key = page.url + '\n' + page.fetched_at + '\n' + digest;
        let path = files.get(key);
        if (!path) {
          path = join(directory, `${files.size + 1}.html`);
          await writeFile(path, page.body, {flag: 'wx', mode: 0o600});
          files.set(key, path);
        }
        output({id, run_key: page.run_key, url: page.url, fetched_at: page.fetched_at,
          http_status: page.http_status, reused: page.reused, path, sha256: digest});
      } catch (error) { output({id, error: error.message}); }
    }
  } finally {
    session.close();
    input.close();
    output({event: 'closed', metrics: session.stats()});
  }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
