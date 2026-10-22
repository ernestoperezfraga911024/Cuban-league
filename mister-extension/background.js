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

  // Separate namespace and messages: Second Division never enters the matchday pipeline.
  async function secondDivisionMessage(type, input, sender) {
    const secondKey = id => 'second-job:' + id;
    const entries = await chrome.storage.session.get(null);
    if (type === 'SECOND_START' && isAdmin(sender.url)) {
      if (!/^\d{4}\/\d{2}$/.test(input.season || '')) throw new Error('Temporada no válida.');
      if (!Number.isInteger(input.matchday) || input.matchday < 0 || input.matchday > 38
        || (input.matchday > 0 && !/^\d{1,20}$/.test(input.excludedManagerId || ''))) throw new Error('Jornada o cuenta excluida no válida.');
      for (const [key, old] of Object.entries(entries)) {
        if (Date.now() - old.createdAt >= TTL) {
          if (key.startsWith('second-job:')) await chrome.storage.session.remove(key);
          continue;
        }
        if (key.startsWith('job:') && ['discovering','discovered','capturing'].includes(old.status))
          throw new Error('Termina o cancela la importación de Primera antes de leer Segunda.');
        if (key.startsWith('second-job:') && old.status === 'reading') {
          if (old.adminTabId === sender.tab.id && old.season === input.season && old.matchday === input.matchday && old.excludedManagerId === input.excludedManagerId) return { id: old.id };
          throw new Error('Ya hay una lectura de Segunda activa.');
        }
      }
      const job = { id: crypto.randomUUID(), season: input.season, matchday: input.matchday, excludedManagerId: input.excludedManagerId || '', adminTabId: sender.tab.id, createdAt: Date.now(), status: 'reading' };
      const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
      job.tabId = tab.id;
      await chrome.storage.session.set({ [secondKey(job.id)]: job });
      await chrome.tabs.update(tab.id, { url: MISTER + '/standings' });
      return { id: job.id };
    }
    if (type === 'SECOND_READY' && isMister(sender.url)) {
      const job = Object.entries(entries).find(([key, j]) => key.startsWith('second-job:') && j.tabId === sender.tab.id
        && j.status === 'reading' && Date.now() - j.createdAt < TTL)?.[1];
      return { job: job || null };
    }
    if (!/^[\da-f-]{36}$/i.test(String(input.id || ''))) throw new Error('Solicitud de Segunda no válida.');
    const job = entries[secondKey(input.id)];
    if (!job || Date.now() - job.createdAt >= TTL) throw new Error('La captura de Segunda caducó.');
    if (isAdmin(sender.url)) {
      if (job.adminTabId !== sender.tab.id) throw new Error('La captura pertenece a otra pestaña.');
      if (type === 'SECOND_STATUS') return { job };
      if (type !== 'SECOND_CANCEL' && type !== 'SECOND_CONSUME') throw new Error('Acción no autorizada.');
      job.status = type === 'SECOND_CANCEL' ? 'cancelled' : 'consumed';
      delete job.payload;
    } else if (isMister(sender.url)) {
      if (job.tabId !== sender.tab.id || job.status !== 'reading') throw new Error('Lectura cancelada o finalizada.');
      if (type === 'SECOND_RESULT') {
        if (input.payload?.league?.id !== '978196' || input.payload?.kind !== (job.matchday ? 'matchday' : 'general')
          || input.payload.matchday !== job.matchday || (job.matchday && input.payload.excludedManagerId !== job.excludedManagerId)
          || input.payload.season !== job.season || JSON.stringify(input.payload).length > 500000)
          throw new Error('La captura no corresponde a Segunda División.');
        job.payload = input.payload;
        job.status = 'ready';
      } else if (type === 'SECOND_FAIL') {
        job.error = String(input.error || 'No se pudo leer Segunda.').slice(0, 500);
        job.status = 'failed';
      } else throw new Error('Acción no autorizada.');
    } else throw new Error('Origen no autorizado.');
    await chrome.storage.session.set({ [secondKey(job.id)]: job });
    return {};
  }

async function handle(message, sender) {
  if (sender.frameId !== 0 || !sender.tab) throw new Error('Origen no autorizado.');
  const input = message.input || {};
  if (String(message.type).startsWith('SECOND_')) return secondDivisionMessage(message.type, input, sender);
  if (isAdmin(sender.url)) {
    if (message.type === 'HELLO') return { version: '1.1.0', bridgeProtocol: 2, notPlayedIcon: true, secondDivision: true };
    if (message.type === 'START') {
      const secondEntries = await chrome.storage.session.get(null);
      if (Object.entries(secondEntries).some(([key, job]) => key.startsWith('second-job:') && job.status === 'reading' && Date.now() - job.createdAt < TTL))
        throw new Error('Termina o cancela la lectura de Segunda antes de importar Primera.');
      if (!Number.isInteger(input.matchday) || input.matchday < 1 || input.matchday > 38
        || typeof input.season !== 'string' || input.season.length > 30) throw new Error('Jornada no válida.');
      const stored = await chrome.storage.session.get(null);
      for (const [key, old] of Object.entries(stored)) {
        if (!key.startsWith('job:')) continue;
        if (Date.now() - old.createdAt > TTL || ['cancelled', 'consumed'].includes(old.status)) await chrome.storage.session.remove(key);
        else if (['discovering', 'discovered', 'capturing'].includes(old.status)) {
          // Recover a START response lost by the same panel without opening another tab.
          if (old.adminTabId === sender.tab.id && old.matchday === input.matchday && old.season === input.season) return { id: old.id };
          throw new Error('Ya hay una lectura de Mister activa. Cancélala en su panel antes de empezar otra.');
        }
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
