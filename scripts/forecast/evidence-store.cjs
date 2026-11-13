'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');

function evidenceStore(directory) {
  const saved = new Map();
  let sequence = 0;
  return async page => {
    const digest = createHash('sha256').update(page.body).digest('hex');
    const key = page.url + '\n' + page.fetched_at + '\n' + digest;
    let pending = saved.get(key);
    if (!pending) {
      // Allocate before the asynchronous write; concurrent sources cannot claim
      // the same filename and duplicate captures share the same pending promise.
      const file = path.join(directory, `page-${++sequence}.html`);
      pending = fs.writeFile(file, page.body, {flag: 'wx', mode: 0o600}).then(() => ({
        url: page.url, fetched_at: page.fetched_at, path: file, sha256: digest,
      }));
      saved.set(key, pending);
    }
    return {...await pending, reused: page.reused};
  };
}
module.exports = {evidenceStore};
