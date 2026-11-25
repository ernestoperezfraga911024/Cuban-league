'use strict';
// Bundle the exact desktop readers, without dependencies or remote script loading.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function build() {
  let source = read('scripts/mobile-mister-template.js');
  for (const [marker, file] of Object.entries({CORE:'mister-import-core.js',SECOND_CORE:'second-division-core.js',FIRST:'mister-extension/collector.js',SECOND:'mister-extension/second-division-collector.js'}))
    source = source.replace('/* BUNDLE_' + marker + ' */', () => read(file));
  return 'javascript:' + encodeURIComponent(source);
}
if (require.main === module) fs.writeFileSync(path.join(root, 'mister-mobile-bookmarklet.txt'), build());
module.exports = {build};
