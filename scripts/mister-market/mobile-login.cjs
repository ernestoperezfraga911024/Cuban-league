'use strict';
const { ORIGIN, DEFAULTS, fail } = require('./core.cjs');
const { readMarketDocument } = require('./dom.cjs');
const LOGIN_TIMEOUT_MS = 60 * 60 * 1000;

// The user signs in directly inside the remote desktop. Do not inspect inputs,
// passwords, OTPs, network requests or another browser's authentication state.
async function waitForManualLogin(page, { timeout = LOGIN_TIMEOUT_MS, interval = 1000,
  now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const end = now() + timeout;
  let confirmed = 0;
  while (now() < end) {
    if (page.isClosed()) fail('login_window_closed');
    let valid = false;
    try {
      if (new URL(page.url()).origin === ORIGIN) {
        const state = await page.evaluate(readMarketDocument);
        valid = state.leagueId === DEFAULTS.leagueId;
      }
    } catch { /* A navigation during manual sign-in is not success. */ }
    confirmed = valid ? confirmed + 1 : 0;
    if (confirmed >= 2) return;
    await sleep(interval);
  }
  fail('manual_login_timeout');
}
module.exports = { waitForManualLogin, LOGIN_TIMEOUT_MS };
