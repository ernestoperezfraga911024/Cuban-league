'use strict';

// Transport only. A retrieved page is NOT a verified fixture, lineup or prediction.
const { performance } = require('node:perf_hooks');
const HOSTS = new Set(['www.futbolfantasy.com', 'www.jornadaperfecta.com',
  'www.comuniate.com', 'www.predicted11.com']);
const TWO_HOURS = 2 * 60 * 60 * 1000;

function publicUrl(value, kind = 'page') {
  const url = new URL(value);
  const script = kind === 'script' && url.hostname === 'www.predicted11.com' && url.pathname === '/js/profile-show.js';
  const ballot = kind === 'ballot' && url.hostname === 'frpg.predicted11.com' &&
    /^\/api\/juegos\/participacion-criterios\/\d+\/\d+\/\d+\/\d+\/get\/\d+-[A-Za-z0-9]+$/.test(url.pathname);
  if (url.protocol !== 'https:' || !(kind === 'page' ? HOSTS.has(url.hostname) : script || ballot) || url.port ||
      url.username || url.password) throw Error('Only public HTTPS source URLs are allowed');
  // P11 API ballots remain separate requests per author/team/fixture; never deduplicate
  // them under the author's profile URL or accept embedded anonymous API credentials here.
  if (kind === 'page' && url.hostname === 'www.predicted11.com' && !url.pathname.startsWith('/es/')) {
    throw Error('Only public Predicted11 pages are allowed');
  }
  url.hash = '';
  return url.href; // Preserve query parameters and their order.
}

class ReadSession {
  constructor({runKey, notBefore, expiresAt, fetchImpl = globalThis.fetch,
    clock = Date.now, concurrency = 4, timeoutMs = 25000, maxBytes = 8 * 1024 * 1024}) {
    this.runKey = runKey;
    this.notBefore = Date.parse(notBefore);
    this.expiresAt = Date.parse(expiresAt);
    this.clock = clock;
    if (typeof runKey !== 'string' || !runKey.trim() ||
        !Number.isFinite(this.notBefore) || !Number.isFinite(this.expiresAt) ||
        this.expiresAt <= this.notBefore || this.expiresAt - this.notBefore > TWO_HOURS) {
      throw Error('Use the actual run key and an execution window of at most two hours');
    }
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4 ||
        !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 25000 ||
        !Number.isInteger(maxBytes) || maxBytes < 1) throw Error('Invalid transport limits');
    this.fetchImpl = fetchImpl;
    this.concurrency = concurrency;
    this.timeoutMs = timeoutMs;
    this.maxBytes = maxBytes;
    this.cache = new Map();
    this.inflight = new Map();
    this.active = 0;
    this.queue = [];
    this.closed = false;
    this.metrics = {requests: 0, downloads: 0, reused: 0, failures: 0, bytes: 0,
      download_ms: 0, by_host: {}, by_kind: {}};
    this.assertOpen();
  }

  assertOpen() {
    const now = this.clock();
    if (this.closed || now < this.notBefore || now >= this.expiresAt) {
      throw Error('Read session is closed, expired or before its real start time');
    }
  }

  async acquire() {
    if (this.active < this.concurrency) { this.active++; return; }
    await new Promise(resolve => this.queue.push(resolve));
  }

  release() {
    const next = this.queue.shift();
    if (next) next();
    else this.active--;
  }

  readScript(value) { return this.read(value, {kind: 'script'}); }
  readBallot(value) { return this.read(value, {kind: 'ballot'}); }

  async read(value, {refresh = false, kind = 'page'} = {}) {
    this.assertOpen();
    const url = publicUrl(value, kind);
    this.metrics.requests++;
    this.metrics.by_kind[kind] ??= {requests: 0, downloads: 0, reused: 0};
    this.metrics.by_kind[kind].requests++;
    // The anonymous endpoint is discovered from the public profile and its script.
    // Keep each author/team/jornada ballot fresh, without caching its response.
    if (kind === 'ballot') return Object.freeze({...await this.download(url, kind), reused: false});
    // Concurrent callers share the SAME request even during an explicit second reading.
    if (this.inflight.has(url)) {
      const page = await this.inflight.get(url);
      this.assertOpen();
      this.metrics.reused++;
      this.metrics.by_kind[kind].reused++;
      return Object.freeze({...page, reused: true});
    }
    if (!refresh && this.cache.has(url)) {
      this.metrics.reused++;
      this.metrics.by_kind[kind].reused++;
      return Object.freeze({...this.cache.get(url), reused: true});
    }
    this.cache.delete(url); // A failed refresh must not resurrect the previous reading.
    const work = this.download(url, kind);
    this.inflight.set(url, work);
    try {
      const page = await work;
      this.assertOpen();
      this.cache.set(url, page);
      return Object.freeze({...page, reused: false});
    } finally { this.inflight.delete(url); }
  }

  async download(url, kind = 'page') {
    await this.acquire();
    const started = performance.now();
    let timer;
    try {
      this.assertOpen();
      const fetchedAt = new Date(this.clock()).toISOString();
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), Math.min(this.timeoutMs, this.expiresAt - this.clock()));
      const host = new URL(url).hostname;
      this.metrics.by_host[host] ??= {downloads: 0, bytes: 0};
      this.metrics.downloads++;
      this.metrics.by_kind[kind].downloads++;
      this.metrics.by_host[host].downloads++;
      const options = {method: 'GET', redirect: 'manual',
        credentials: 'omit', signal: controller.signal,
        headers: {Accept: kind === 'ballot' ? 'application/json' : kind === 'script' ? 'application/javascript,text/javascript' : 'text/html,application/xhtml+xml'}};
      let response = await this.fetchImpl(url, options);
      if (kind === 'page' && [301,308].includes(response.status) && response.headers.get('location')) {
        const from = new URL(url), to = new URL(response.headers.get('location'), url);
        // Only the observed canonical trailing-slash redirect, same origin/query/path.
        // No login redirects, other paths, automatic chains or access-control retries.
        if (to.origin === from.origin && to.search === from.search &&
            to.pathname.replace(/\/$/, '') === from.pathname.replace(/\/$/, '') && to.pathname !== from.pathname) {
          url = publicUrl(to.href);
          await response.body?.cancel();
          this.metrics.downloads++;
          this.metrics.by_kind[kind].downloads++;
          this.metrics.by_host[host].downloads++;
          response = await this.fetchImpl(url, options);
        }
      }
      // Return all other redirects/errors to the collector; never retry a block.
      if (!response.ok) {
        await response.body?.cancel();
        throw Error(`Public read failed: HTTP ${response.status}`);
      }
      const contentType = response.headers.get('content-type') || '';
      const expected = kind === 'ballot' ? /^application\/json(;|$)/i : kind === 'script' ? /^(application|text)\/javascript(;|$)/i : /^(text\/html|application\/xhtml\+xml)(;|$)/i;
      if (!expected.test(contentType)) {
        await response.body?.cancel();
        throw Error(kind === 'page' ? 'Expected a public HTML page' : 'Unexpected public resource content type');
      }
      const chunks = [];
      let bytes = 0;
      const reader = response.body.getReader();
      try {
        for (;;) {
          const {done, value} = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > this.maxBytes) { await reader.cancel(); throw Error('Page exceeds size limit'); }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
      this.assertOpen();
      this.metrics.bytes += bytes;
      this.metrics.by_host[host].bytes += bytes;
      return Object.freeze({run_key: this.runKey, url, fetched_at: fetchedAt,
        http_status: response.status, body: Buffer.concat(chunks).toString('utf8')});
    } catch (error) { this.metrics.failures++; throw error; }
    finally {
      clearTimeout(timer);
      this.metrics.download_ms += performance.now() - started;
      this.release();
    }
  }

  stats() { return structuredClone(this.metrics); }
  close() { this.closed = true; this.cache.clear(); }
}

module.exports = {ReadSession};
