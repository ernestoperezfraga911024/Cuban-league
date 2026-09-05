'use strict';
const ADMIN = 'https://ernestoperezfraga911024.github.io/Cuban-league/admin.html';
const MISTER = 'https://mister.mundodeportivo.com';
const TTL = 60 * 60 * 1000;
const isAdmin = url => { try { const u = new URL(url); return u.origin + u.pathname === ADMIN; } catch { return false; } };
const isMister = url => { try { return new URL(url).origin === MISTER; } catch { return false; } };
const jobKey = id => 'job:' + id;
async function jobFor(id) {
  if (!/^[\da-f-]{36}$/i.test(String(id || ''))) throw new Error('Solicitud no válida.');
  const job = (await chrome.storage.session.get(jobKey(id)))[jobKey(id)];
  if (!job || Date.now() - job.createdAt > TTL) throw new Error('La captura caducó. Inicia una nueva importación.');
  return job;
}
async function save(job) { await chrome.storage.session.set({ [jobKey(job.id)]: job }); }
async function handle(message, sender) {
  if (sender.frameId !== 0 || !sender.tab) throw new Error('Origen no autorizado.');
  const input = message.input || {};
  if (isAdmin(sender.url)) {
    if (message.type === 'HELLO') return { version: '1.0.0' };
    if (message.type === 'START') {
      if (!Number.isInteger(input.matchday) || input.matchday < 1 || input.matchday > 38
        || typeof input.season !== 'string' || input.season.length > 30) throw new Error('Jornada no válida.');
      const stored = await chrome.storage.session.get(null);
      for (const [key, old] of Object.entries(stored)) {
        if (!key.startsWith('job:')) continue;
        if (Date.now() - old.createdAt > TTL || ['cancelled', 'consumed'].includes(old.status)) await chrome.storage.session.remove(key);
        else if (['discovering', 'discovered', 'capturing'].includes(old.status)) throw new Error('Ya hay una lectura de Mister activa. Cancélala en su panel antes de empezar otra.');
      }
      const job = { id: crypto.randomUUID(), adminTabId: sender.tab.id, createdAt: Date.now(),
        matchday: input.matchday, season: input.season, status: 'discovering', progress: 'Abriendo Mister…' };
      // Create blank first so the content script cannot race the tab-to-job binding.
      const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
      job.misterTabId = tab.id;
      await save(job);
      await chrome.tabs.update(tab.id, { url: MISTER + '/standings' });
      return { id: job.id };
    }
    const job = await jobFor(input.id);
    if (job.adminTabId !== sender.tab.id) throw new Error('La captura pertenece a otra pestaña del panel.');
    if (message.type === 'STATUS') return { job };
    if (message.type === 'CANCEL' || message.type === 'CONSUME') {
      job.status = message.type === 'CANCEL' ? 'cancelled' : 'consumed';
      delete job.payload;
      await save(job);
      await chrome.tabs.sendMessage(job.misterTabId, { type: 'STOP', id: job.id }).catch(() => {});
      return {};
    }
    if (message.type === 'CAPTURE') {
      if (job.status !== 'discovered') throw new Error('La lectura no está preparada.');
      job.status = 'capturing';
      job.progress = 'Leyendo alineaciones…';
      await save(job);
      const reply = await chrome.tabs.sendMessage(job.misterTabId, { type: 'RUN', job });
      if (!reply?.ok) throw new Error('Mister no pudo iniciar la lectura. Recarga e inténtalo otra vez.');
      return {};
    }
  } else if (isMister(sender.url)) {
    if (message.type === 'MISTER_READY') {
      const entries = await chrome.storage.session.get(null);
      const interrupted = Object.values(entries).find(j => j.misterTabId === sender.tab.id && j.status === 'capturing');
      if (interrupted) {
        interrupted.status = 'failed';
        interrupted.error = 'La pestaña de Mister se recargó durante la captura. Cancela e inicia una nueva lectura.';
        await save(interrupted);
      }
      const job = Object.values(entries).find(j => j.misterTabId === sender.tab.id && j.status === 'discovering' && Date.now() - j.createdAt < TTL);
      return { job: job || null };
    }
    const job = await jobFor(input.id);
    if (job.misterTabId !== sender.tab.id || ['cancelled', 'consumed', 'ready', 'failed'].includes(job.status)) throw new Error('Lectura cancelada o finalizada.');
    if (message.type === 'DISCOVERED' && job.status === 'discovering') {
      job.discovery = input.discovery;
      job.status = 'discovered';
    } else if (message.type === 'PROGRESS') {
      job.progress = String(input.progress || '').slice(0,300);
    } else if (message.type === 'RESULT' && job.status === 'capturing') {
      if (JSON.stringify(input.payload).length > 1000000) throw new Error('Captura demasiado grande.');
      job.payload = input.payload;
      job.status = 'ready';
      job.progress = 'Captura terminada. Vuelve al panel para ver el borrador.';
    } else if (message.type === 'FAIL') {
      job.status = 'failed';
      job.error = String(input.error || 'No se pudo completar la captura.').slice(0,500);
    } else throw new Error('Mensaje no válido para este estado.');
    await save(job);
    return {};
  }
  throw new Error('Acción no autorizada.');
}
// Serialize state writes. No long capture runs inside the service worker.
let queue = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  queue = queue.then(() => handle(message, sender)).then(result => respond({ ok: true, ...result }),
    error => respond({ ok: false, error: String(error.message || error) }));
  return true;
});
