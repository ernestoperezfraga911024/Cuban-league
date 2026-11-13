'use strict';

// Transport only. A retrieved page is NOT a verified fixture, lineup or prediction.
const { performance } = require('node:perf_hooks');
const HOSTS = new Set(['www.futbolfantasy.com', 'www.jornadaperfecta.com',
  'www.comuniate.com', 'www.predicted11.com']);
const TWO_HOURS = 2 * 60 * 60 * 1000;

function publicUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || url.port ||
      url.username || url.password) throw Error('Only public HTTPS source URLs are allowed');
  // P11 API ballots remain separate requests per author/team/fixture; never deduplicate
  // them under the author's profile URL or accept embedded anonymous API credentials here.
  if (url.hostname === 'www.predicted11.com' && !url.pathname.startsWith('/es/')) {
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
      download_ms: 0, by_host: {}};
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

  async read(value, {refresh = false} = {}) {
    this.assertOpen();
    const url = publicUrl(value);
    this.metrics.requests++;
    // Concurrent callers share the SAME request even during an explicit second reading.
    if (this.inflight.has(url)) {
      const page = await this.inflight.get(url);
      this.assertOpen();
      this.metrics.reused++;
      return Object.freeze({...page, reused: true});
    }
    if (!refresh && this.cache.has(url)) {
      this.metrics.reused++;
      return Object.freeze({...this.cache.get(url), reused: true});
    }
    this.cache.delete(url); // A failed refresh must not resurrect the previous reading.
    const work = this.download(url);
    this.inflight.set(url, work);
    try {
      const page = await work;
      this.assertOpen();
      this.cache.set(url, page);
      return Object.freeze({...page, reused: false});
    } finally { this.inflight.delete(url); }
  }

  async download(url) {
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
      this.metrics.by_host[host].downloads++;
      const response = await this.fetchImpl(url, {method: 'GET', redirect: 'manual',
        credentials: 'omit', signal: controller.signal,
        headers: {Accept: 'text/html,application/xhtml+xml'}});
      // Return errors to the collector. Do not follow sign-in redirects or retry a block.
      if (!response.ok) {
        await response.body?.cancel();
        throw Error(`Public read failed: HTTP ${response.status}`);
      }
      const contentType = response.headers.get('content-type') || '';
      if (!/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(contentType)) {
        await response.body?.cancel();
        throw Error('Expected a public HTML page');
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
