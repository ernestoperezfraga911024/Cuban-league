'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {ReadSession} = require('../scripts/forecast/read-session.cjs');

const START = Date.parse('2026-11-13T20:30:00Z');
const URL = 'https://www.futbolfantasy.com/partidos/test-fixture';
const html = text => new Response(text, {headers: {'content-type': 'text/html; charset=utf-8'}});
function setup(overrides = {}) {
  let now = START, calls = 0;
  const reader = new ReadSession({runKey: 'offline-test-only',
    notBefore: new Date(START).toISOString(), expiresAt: new Date(START + 7200000).toISOString(),
    clock: () => now, fetchImpl: async () => { calls++; return html('<p>fixture</p>'); }, ...overrides});
  return {reader, calls: () => calls, advance: ms => { now += ms; }};
}

test('two rivals reuse the same fresh body and original timestamp', async () => {
  const {reader, calls, advance} = setup();
  const first = await reader.read(URL);
  advance(60000);
  const second = await reader.read(URL + '#away');
  assert.equal(calls(), 1);
  assert.equal(second.body, first.body);
  assert.equal(second.fetched_at, first.fetched_at);
  assert.equal(second.reused, true);
  assert.throws(() => { second.body = 'tampered'; }, TypeError);
  assert.equal((await reader.read(URL)).body, first.body);
});

test('new sessions never import prior evidence, even for the same run key', async () => {
  const a = setup(), b = setup();
  await a.reader.read(URL);
  await b.reader.read(URL);
  assert.equal(a.calls(), 1);
  assert.equal(b.calls(), 1);
  assert.equal(b.reader.stats().reused, 0);
});

test('simultaneous duplicate requests share one download', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const {reader} = setup({fetchImpl: async () => { calls++; await gate; return html('same'); }});
  const pending = [reader.read(URL), reader.read(URL), reader.read(URL)];
  release();
  const pages = await Promise.all(pending);
  assert.equal(calls, 1);
  assert.equal(new Set(pages.map(p => p.fetched_at)).size, 1);
  assert.equal(reader.stats().reused, 2);
});

test('query differences are distinct resources, never merged as one profile', async () => {
  const {reader, calls} = setup();
  const profile = 'https://www.predicted11.com/es/usuario/example';
  await reader.read(profile);
  await reader.read(profile + '?campeonato=laliga');
  assert.equal(calls(), 2);
  await assert.rejects(reader.read('https://www.predicted11.com/api/ballots'), /public Predicted11/);
});

test('public scripts share a reading while author/team ballot responses are always fresh', async () => {
  let calls = 0;
  const {reader} = setup({fetchImpl: async url => {
    calls++;
    return new Response(url.includes('/js/') ? 'public script' : '[]', {headers: {
      'content-type': url.includes('/js/') ? 'application/javascript' : 'application/json',
    }});
  }});
  const script = 'https://www.predicted11.com/js/profile-show.js?id=test';
  await reader.readScript(script); await reader.readScript(script);
  const ballot = 'https://frpg.predicted11.com/api/juegos/participacion-criterios/11/28/16/13/get/999-TESTONLY';
  await reader.readBallot(ballot); await reader.readBallot(ballot);
  assert.equal(calls, 3);
  assert.deepEqual(reader.stats().by_kind.script, {requests: 2, downloads: 1, reused: 1});
  assert.deepEqual(reader.stats().by_kind.ballot, {requests: 2, downloads: 2, reused: 0});
  await assert.rejects(reader.readBallot('https://www.predicted11.com/es/usuario/test'));
});

test('failed reads are not cached or retried automatically', async () => {
  let calls = 0;
  const {reader} = setup({fetchImpl: async () => {
    calls++; return calls === 1 ? new Response('blocked', {status: 403}) : html('ok');
  }});
  await assert.rejects(reader.read(URL), /403/);
  assert.equal(calls, 1);
  assert.equal((await reader.read(URL)).reused, false);
  assert.equal(calls, 2);
});

test('refresh performs a real second read and preserves earlier immutable evidence', async () => {
  const {reader, advance, calls} = setup();
  const first = await reader.read(URL);
  advance(10000);
  const second = await reader.read(URL, {refresh: true});
  assert.equal(calls(), 2);
  assert.notEqual(first.fetched_at, second.fetched_at);
  assert.equal(first.fetched_at, new Date(START).toISOString());
});

test('failed refresh cannot fall back to a formerly successful cached page', async () => {
  let calls = 0;
  const {reader} = setup({fetchImpl: async () => {
    if (++calls > 1) throw Error('network unavailable');
    return html('old');
  }});
  await reader.read(URL);
  await assert.rejects(reader.read(URL, {refresh: true}));
  await assert.rejects(reader.read(URL));
  assert.equal(calls, 3);
});

test('clock, expiry and explicit close protect cached readings too', async () => {
  assert.throws(() => setup({clock: () => START - 1}), /real start/);
  const {reader, advance, calls} = setup();
  await reader.read(URL);
  advance(7200000);
  await assert.rejects(reader.read(URL), /expired/);
  assert.equal(calls(), 1);
  const other = setup();
  other.reader.close();
  await assert.rejects(other.reader.read(URL), /closed/);
  assert.equal(other.calls(), 0);
});

test('completion after expiry is rejected, never cached as fresh evidence', async () => {
  let now = START;
  const {reader} = setup({clock: () => now, fetchImpl: async () => {
    now += 7200000; return html('late');
  }});
  await assert.rejects(reader.read(URL), /expired/);
  assert.equal(reader.stats().failures, 1);
});

test('bounded concurrency does not serialize independent source pages', async () => {
  let active = 0, peak = 0;
  const {reader} = setup({concurrency: 2, fetchImpl: async () => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--; return html('ok');
  }});
  await Promise.all(Array.from({length: 6}, (_, i) => reader.read(URL + '/' + i)));
  assert.equal(peak, 2);
});

test('refuses credentials, other hosts, non-HTML and redirects without following them', async () => {
  const {reader, calls} = setup();
  for (const url of ['http://www.comuniate.com/', 'https://example.com/',
    'https://user:password@www.comuniate.com/', 'https://www.comuniate.com:8443/']) {
    await assert.rejects(reader.read(url));
  }
  assert.equal(calls(), 0);
  const redirect = setup({fetchImpl: async (url, options) => {
    assert.equal(options.redirect, 'manual');
    assert.equal(options.credentials, 'omit');
    return new Response(null, {status: 302, headers: {location: 'https://example.com/login'}});
  }});
  await assert.rejects(redirect.reader.read(URL), /302/);
  const json = setup({fetchImpl: async () => new Response('{}', {headers: {'content-type': 'application/json'}})});
  await assert.rejects(json.reader.read(URL), /HTML/);
});

test('limits page sizes and cancels timed-out requests', async () => {
  const large = setup({maxBytes: 4, fetchImpl: async () => html('12345')});
  await assert.rejects(large.reader.read(URL), /size limit/);
  const slow = setup({timeoutMs: 5, fetchImpl: async (url, {signal}) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(Error('timed out')), {once: true});
  })});
  await assert.rejects(slow.reader.read(URL), /timed out/);
});

test('follows one observed same-origin trailing-slash canonical redirect and preserves the first timestamp', async () => {
  const urls = [], {reader} = setup({fetchImpl: async url => {
    urls.push(url);
    return urls.length === 1 ? new Response(null, {status: 301, headers: {location: 'https://www.predicted11.com/es/laliga'}}) : html('public');
  }});
  const page = await reader.read('https://www.predicted11.com/es/laliga/');
  assert.equal(page.url, 'https://www.predicted11.com/es/laliga');
  assert.equal(page.fetched_at, new Date(START).toISOString());
  assert.equal(reader.stats().downloads, 2);
  assert.equal((await reader.read('https://www.predicted11.com/es/laliga/')).reused, true);
  assert.equal(urls.length, 2);
});

test('two-club producer can finish one club before starting its rival without changing extracted data', async () => {
  const payload = '<main data-fixture="test-only">' +
    JSON.stringify({home: Array.from({length: 11}, (_, i) => 'home-' + i),
      away: Array.from({length: 11}, (_, i) => 'away-' + i)}) + '</main>';
  let calls = 0;
  const {reader} = setup({fetchImpl: async () => { calls++; return html(payload); }});
  const done = [];
  for (const side of ['home', 'away']) {
    if (side === 'away') assert.deepEqual(done, ['home']);
    const page = await reader.read(URL);
    const observed = JSON.parse(page.body.replace(/^<main[^>]*>|<\/main>$/g, ''))[side];
    assert.deepEqual(observed, Array.from({length: 11}, (_, i) => side + '-' + i));
    done.push(side); // Stand-in for the unchanged validate/save/deliver/verify boundary.
  }
  assert.equal(calls, 1);
  assert.deepEqual(done, ['home', 'away']);
});

test('agent bridge writes one body and emits compact metadata for repeated reads', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const {tmpdir} = require('node:os');
  const {execFileSync} = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'forecast-bridge-test-'));
  let bodyDirectory;
  try {
    const preload = path.join(dir, 'fetch.cjs');
    fs.writeFileSync(preload, "globalThis.fetch=async()=>new Response('<p>offline fixture</p>',{headers:{'content-type':'text/html'}});\n");
    const now = Date.now();
    const input = [{id: 1, op: 'read', url: URL}, {id: 2, op: 'read', url: URL},
      {id: 3, op: 'stats'}, {op: 'close'}].map(x => JSON.stringify(x)).join('\n') + '\n';
    const lines = execFileSync(process.execPath, ['--require', preload,
      path.resolve(__dirname, '../scripts/forecast-read-session.cjs'), 'offline-test-only',
      new Date(now).toISOString(), new Date(now + 60000).toISOString()],
    {input, encoding: 'utf8'}).trim().split('\n').map(line => JSON.parse(line));
    bodyDirectory = lines[0].directory;
    assert.equal(lines[1].path, lines[2].path);
    assert.equal(lines[1].fetched_at, lines[2].fetched_at);
    assert.equal(lines[2].reused, true);
    assert.equal(lines[3].metrics.downloads, 1);
    assert.equal(lines[1].body, undefined);
    assert.equal(fs.readFileSync(lines[1].path, 'utf8'), '<p>offline fixture</p>');
    assert.equal(lines.at(-1).event, 'closed');
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
    if (bodyDirectory) fs.rmSync(bodyDirectory, {recursive: true, force: true});
  }
});
