const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const {JSDOM} = require('jsdom');
const read = file => fs.readFileSync(require.resolve('../' + file), 'utf8');

function transport() {
  const dom = new JSDOM(read('admin.html'), {
    url: 'https://ernestoperezfraga911024.github.io/Cuban-league/admin.html',
    runScripts: 'outside-only'
  });
  const w = dom.window;
  const storage = {};
  const opened = [];
  const envelopes = [];
  let workerListener;
  const chrome = {
    storage: {session: {
      get: async key => structuredClone(key ? {[key]: storage[key]} : storage),
      set: async values => Object.assign(storage, structuredClone(values)),
      remove: async key => { delete storage[key]; }
    }},
    tabs: {
      create: async options => { opened.push(options.url); return {id: 50}; },
      update: async (_id, options) => opened.push(options.url),
      sendMessage: async () => ({ok: true})
    },
    runtime: {onMessage: {addListener(fn) { workerListener = fn; }}}
  };
  vm.runInNewContext(read('mister-extension/background.js'), {chrome, URL, crypto: webcrypto, Date});
  const sendWorker = (message, tabId = 10, url = w.location.href) => new Promise(resolve =>
    workerListener(message, {url, tab: {id: tabId}, frameId: 0}, resolve));
  w.chrome = {runtime: {sendMessage: message => sendWorker(message)}};
  // Preserve real browser message source/origin, which JSDOM omits by default.
  w.postMessage = (data, origin) => {
    assert.equal(origin, w.location.origin);
    envelopes.push(data);
    queueMicrotask(() => w.dispatchEvent(new w.MessageEvent('message', {data, source: w, origin})));
  };
  const schedule = w.setTimeout.bind(w);
  w.setTimeout = (fn, ms, ...args) => schedule(fn, ms === 8000 ? 100 : ms, ...args);
  w.eval(read('mister-import-core.js'));
  w.eval(read('admin.js').replace('  boot();', '  window.testTransport = {extensionCall, requireMisterExtension, resolveMisterParticipant, state};'));
  w.eval(read('mister-extension/admin-bridge.js'));
  return {dom, api: w.testTransport, sendWorker, storage, opened, envelopes};
}

test('panel → puente → worker: START conserva la correlación y devuelve la captura de J6', async () => {
  const t = transport();
  try {
    await t.api.requireMisterExtension();
    const start = await t.api.extensionCall('START', {matchday: 6, season: '2026/27'});
    const request = t.envelopes.find(e => e.type === 'START');
    const response = t.envelopes.find(e => e.channel === 'cuban-mister-extension-v1' && e.id === request.id);
    assert.ok(response, 'El puente debe contestar al identificador que espera el panel');
    assert.notEqual(start.id, request.id, 'La captura y el mensaje tienen identificadores distintos');
    assert.equal((await t.api.extensionCall('STATUS', {id: start.id})).job.matchday, 6);
    const source = 'https://mister.mundodeportivo.com/standings';
    await t.sendWorker({type: 'DISCOVERED', input: {id: start.id, discovery: {gameweekId: 4047}}}, 50, source);
    await t.api.extensionCall('CAPTURE', {id: start.id});
    await t.sendWorker({type: 'RESULT', input: {id: start.id, payload: {matchday: 6, managers: []}}}, 50, source);
    assert.equal((await t.api.extensionCall('STATUS', {id: start.id})).job.status, 'ready');
    await t.api.extensionCall('CONSUME', {id: start.id});
    assert.equal((await t.api.extensionCall('STATUS', {id: start.id})).job.payload, undefined);
    assert.equal(t.opened.length, 2, 'Una sola pestaña de Mister');
  } finally { t.dom.window.close(); }
});

test('avisa de actualizar 1.0.0 antes de iniciar una captura', async () => {
  const t = transport();
  try {
    t.dom.window.chrome.runtime.sendMessage = async () => ({ok: true, version: '1.0.0'});
    await assert.rejects(t.api.requireMisterExtension(), /actualizarse a 1.0.1/);
    assert.equal(t.opened.length, 0);
  } finally { t.dom.window.close(); }
});

test('una respuesta con identificador ajeno no resuelve una llamada pendiente', async () => {
  const t = transport();
  try {
    let answer;
    t.dom.window.chrome.runtime.sendMessage = () => new Promise(resolve => { answer = resolve; });
    let resolved = false;
    const pending = t.api.extensionCall('HELLO').then(value => { resolved = true; return value; });
    await new Promise(resolve => setImmediate(resolve));
    t.dom.window.postMessage({channel: 'cuban-mister-extension-v1', id: 'unrelated', result: {ok: true}}, t.dom.window.location.origin);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(resolved, false);
    answer({ok: true, version: '1.0.1', bridgeProtocol: 2});
    assert.equal((await pending).version, '1.0.1');
  } finally { t.dom.window.close(); }
});

test('el apodo ampliado de ANDOBA se relaciona por su ID verificado, sin coincidencias aproximadas', () => {
  const t = transport();
  try {
    t.api.state.participants = [{name: 'ANDOBA THE BEST'}, {name: 'Ernesto'}];
    assert.equal(t.api.resolveMisterParticipant({id: '5014980', name: 'ANDOBA THE BEST cuus💪'}).name, 'ANDOBA THE BEST');
    assert.equal(t.api.resolveMisterParticipant({id: 'unknown', name: 'ANDOBA THE BEST cuus💪'}), undefined);
    assert.equal(t.api.resolveMisterParticipant({id: 'other', name: 'Ernesto 🏆'}).name, 'Ernesto');
  } finally { t.dom.window.close(); }
});
