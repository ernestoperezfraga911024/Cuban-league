'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const readerRequire = require('node:module').createRequire(require('node:path').resolve(__dirname, '../scripts/mister-market/package.json'));
const { chromium } = readerRequire('playwright');
const { advanceFeed, paginateHistory } = require('../scripts/mister-market/history.cjs');
const { waitStable } = require('../scripts/mister-market/collector.cjs');
const { readFeedDocument } = require('../scripts/mister-market/dom.cjs');

test('historial avanza hasta el final aunque la última tarjeta exceda la pantalla', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    // Local fixture only: no sign-in, network requests or production data.
    await page.setContent(`<style>body{margin:0}.card{height:40px}.card:last-child{height:6000px}.loading-more{height:50px}</style>
      <div class="feed-cards">${Array.from({ length: 15 }, (_, i) => `<div class="card card-transfer" id="feed-${i}"></div>`).join('')}</div>
      <div class="loading-more">Cargando</div>
      <script>addEventListener('scroll', () => {
        const marker = document.querySelector('.loading-more');
        if (marker && scrollY + innerHeight >= document.documentElement.scrollHeight - 20) {
          const card = document.createElement('div'); card.id = 'feed-15'; card.className = 'card card-transfer';
          document.querySelector('.feed-cards').append(card); marker.remove();
        }
      });</script>`);
    const read = () => page.evaluate(readFeedDocument), initial = await read();
    // Reproduce the previous trigger: it exposes the middle of the tall card,
    // but does not reach the bottom and therefore cannot load the next page.
    await page.locator('.feed-cards .card[id]').last().scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal((await read()).cardIds.length, 15);
    assert.equal(await page.evaluate(() => scrollY + innerHeight < document.documentElement.scrollHeight - 20), true);
    const full = await paginateHistory(initial, { read, next: () => advanceFeed(page),
      wait: (read, accept) => waitStable(read, accept, { timeout: 3000, stableFor: 100, interval: 20 }) });
    assert.equal(full.cardIds.length, 16);
    assert.deepEqual(full.cardIds.slice(0, 15), initial.cardIds);
    assert.equal(full.hasMore, false); assert.equal(full.endObserved, true);
    assert.equal(full.pages, 2);
  } finally { await browser.close(); }
});
