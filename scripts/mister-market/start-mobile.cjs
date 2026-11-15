'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const dir = path.resolve(__dirname, '../../.mister-market');

if (process.env.CODESPACES !== 'true' || !process.env.DISPLAY) {
  console.error('mobile_desktop_unavailable'); process.exitCode = 1;
} else {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (fs.existsSync(path.join(dir, 'auth.json'))) {
    console.log('La sesión local ya existe. La lectura se inicia manualmente con npm run collect.');
  } else if (fs.existsSync(path.join(dir, 'run.lock'))) {
    console.log('Hay una sesión en curso o un bloqueo pendiente de revisar. No se inicia otra.');
  } else {
    const log = fs.openSync(path.join(dir, 'mobile-login.log'), 'a', 0o600);
    const child = spawn(process.execPath, [path.join(__dirname, 'cli.cjs'), 'login-mobile'],
      { detached: true, stdio: ['ignore', log, log] });
    child.on('error', () => { console.error('mobile_login_start_failed'); process.exitCode = 1; });
    child.unref(); fs.closeSync(log);
    console.log('Abre el puerto 6080 con visibilidad Private. Inicia sesión en Mister en el escritorio.');
  }
}
