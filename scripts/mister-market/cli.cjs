#!/usr/bin/env node
'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const readline = require('node:readline/promises');
const { ORIGIN, DEFAULTS, MarketError, fail } = require('./core.cjs');
const { readMarketDocument } = require('./dom.cjs');
const { collect } = require('./collector.cjs');
const { waitForManualLogin } = require('./mobile-login.cjs');
const { atomicJson, readJson, withLock, saveCapture } = require('./storage.cjs');
const stateDir = path.resolve(__dirname, '../../.mister-market');
const authFile = path.join(stateDir, 'auth.json');

async function main() {
  const command = process.argv[2];
  if (!['login', 'login-mobile', 'collect'].includes(command)) {
    console.log('Uso: node scripts/mister-market/cli.cjs login|login-mobile|collect');
    process.exitCode = 1; return;
  }
  const { chromium } = require('playwright');
  await withLock(stateDir, async () => {
    const auth = command === 'collect' ? await readJson(authFile) : null;
    if (command === 'collect' && !auth) fail('login_required');
    const browser = await chromium.launch({ headless: command === 'collect' });
    try {
      const context = await browser.newContext({ ...(auth ? { storageState: auth } : {}),
        locale: 'es-ES', timezoneId: 'America/New_York', viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      if (command !== 'collect') {
        if (command === 'login' && !process.stdin.isTTY) fail('interactive_login_required');
        await page.goto(`${ORIGIN}/feed`, { waitUntil: 'domcontentloaded' });
        if (command === 'login-mobile') {
          console.log('Esperando el inicio de sesión manual en Mister y la selección de primera división (máximo 15 minutos).');
          await waitForManualLogin(page);
        } else {
          const input = readline.createInterface({ input: process.stdin, output: process.stdout });
          try { await input.question('Inicia sesión en el navegador y selecciona la 1ra división Cuban League. Luego pulsa Enter aquí. '); }
          finally { input.close(); }
        }
        if (new URL(page.url()).origin !== ORIGIN) fail('login_required');
        const state = await page.evaluate(readMarketDocument);
        if (state.leagueId !== DEFAULTS.leagueId) fail('wrong_league');
        await atomicJson(authFile, await context.storageState());
        await fs.chmod(authFile, 0o600);
        console.log('Sesión guardada en este equipo. Siguiente paso: npm run collect');
      } else {
        const start = Date.now();
        const report = await saveCapture(stateDir, await collect(page));
        console.log(JSON.stringify({ status: 'read_only_complete', players: report.playerCount,
          managers: report.managerCount, changes: report.changes.length, visibleEvents: report.visibleEventCount,
          movementsCoverage: report.movementsCoverage, baseline: report.baseline,
          elapsedMs: Date.now() - start, publicationReady: false, aiCalls: 0 }));
      }
    } finally { await browser.close(); }
  });
}
main().catch(error => {
  // Browser errors may contain URLs or account data. Keep stdout/stderr to controlled codes.
  console.error(JSON.stringify({ status: 'failed', code: error instanceof MarketError ? error.code : 'browser_or_filesystem_error',
    publicSiteChanged: false }));
  process.exitCode = 1;
});
