// Local preparation only: no network, database write or publication.
const fs = require('node:fs');
const {applyMethod} = require('../forecast-review-core.js');
try {
  if (process.argv.length !== 3) throw Error('Uso: node scripts/prepare-forecast.cjs borrador-con-evidencia.json');
  const text = fs.readFileSync(process.argv[2], 'utf8');
  if (Buffer.byteLength(text) > 65536) throw Error('Borrador superior a 64 KiB');
  const result = JSON.stringify(applyMethod(JSON.parse(text)), null, 2);
  if (Buffer.byteLength(result) > 65536) throw Error('Resultado superior a 64 KiB');
  process.stdout.write(result + '\n');
} catch (error) { console.error(error.message); process.exitCode = 1; }
