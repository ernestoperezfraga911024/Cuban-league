const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');
const {build} = require('../scripts/build-mobile-mister.cjs');
const read = p => fs.readFileSync(require.resolve('../'+p),'utf8');
test('mobile bookmark is reproducible from the current desktop readers and compiles',()=>{
  assert.equal(read('mister-mobile-bookmarklet.txt'),build(),'Regenerate with node scripts/build-mobile-mister.cjs after collector changes');
  const source=decodeURIComponent(build().slice('javascript:'.length));
  new vm.Script(source);
  assert.doesNotMatch(source,/BUNDLE_|document\.cookie|localStorage|fetch\(|XMLHttpRequest/);
});
test('bookmark refuses other sites and unrelated leagues before starting any reader',()=>{
  for(const [url,html] of [['https://example.test',''],['https://mister.mundodeportivo.com/standings','<a class="active" href="/action/change?id_community=123">Other</a>']]) {
    const dom=new JSDOM(html,{url,runScripts:'outside-only'}); const alerts=[];
    try {
      dom.window.alert=message=>alerts.push(message);
      dom.window.eval(decodeURIComponent(build().slice('javascript:'.length)));
      assert.equal(alerts.length,1);assert.equal(dom.window.__cubanMobileReading,undefined);
      assert.equal(dom.window.chrome,undefined);
    } finally {dom.window.close();}
  }
});
test('file transport rejects oversized, empty or malformed captures without interpreting code',async()=>{
  const dom=new JSDOM('',{runScripts:'outside-only'});
  try {
    dom.window.eval(read('mister-mobile.js'));const api=dom.window.CubanMobileImport;
    for(const file of [null,{size:0},{size:2097153},{size:2,text:async()=>'{bad'},{size:2,text:async()=>'[]'}])
      await assert.rejects(api.readFile(file));
    const payload=await api.readFile({size:10,text:async()=>' {"hello":"<script>"}'});
    assert.equal(payload.hello,'<script>');
  } finally {dom.window.close();}
});
