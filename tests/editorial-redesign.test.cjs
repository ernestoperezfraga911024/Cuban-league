const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const {JSDOM}=require('jsdom');
const CSSOM=require('rrweb-cssom');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const bytes=p=>fs.readFileSync(path.join(root,p));
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const baseline=JSON.parse(read('tests/fixtures/pre-editorial-contract.json'));

function setup() {
  const dom=new JSDOM(read('index.html'),{url:'https://example.test/Cuban-league/',runScripts:'outside-only',pretendToBeVisual:true});
  dom.window.scrollTo=()=>{};
  dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  dom.window.fetch=async()=>{throw new Error('Live network forbidden in design tests');};
  dom.window.eval(read('app.js').replace(/init\(\);\s*$/,`window.designTest={
    set(data){DATA=data;},data(){return JSON.stringify(DATA);},go,openPlayer,closePlayer,setProfileView,
    render(){renderCurrent();renderMatchdayCenter();renderHomeLive();renderGeneral();renderPoints();renderPalmares();renderSeasons();renderSeasonChampions();renderPlayers();renderRecords();renderChampions();renderCup();},
    business(name){return window[name].toString();}
  };`));
  dom.window.designTest.set(JSON.parse(read('data.json')));
  return dom;
}

test('V174 data, catalog, admin logic, import, credentials config and legacy CSS remain byte-for-byte unchanged',()=>{
  for(const [p,expected] of Object.entries(baseline.files))assert.equal(hash(bytes(p)),expected,p);
});
test('all 627 original photo, crest and icon assets are byte-for-byte preserved',()=>{
  assert.equal(hash(baseline.assets.map(p=>p+'\0'+hash(bytes(p))).join('\n')),baseline.assetDigest);
});
test('all existing element IDs remain available and new markup has no duplicate IDs',()=>{
  for(const p of ['index.html','admin.html']) {
    const dom=new JSDOM(read(p)),doc=dom.window.document;
    const ids=[...doc.querySelectorAll('[id]')].map(x=>x.id);
    assert.equal(ids.length,new Set(ids).size,p+' duplicate IDs');
    for(const id of baseline.ids[p])assert.ok(doc.getElementById(id),`${p}: missing ${id}`);
    dom.window.close();
  }
});
test('all 28 calculation, normalization, fetch and synchronization functions are unchanged',()=>{
  const dom=setup();
  try {for(const [name,digest] of Object.entries(baseline.protectedFunctions))assert.equal(hash(dom.window.designTest.business(name)),digest,name);}
  finally{dom.window.close();}
});
test('all public sections render without changing static league data or photo mappings',()=>{
  const dom=setup();
  try {
    const before=dom.window.designTest.data();
    dom.window.designTest.render();
    const doc=dom.window.document;
    for(const route of ['home','current','matchdays','players','history','cup','champions','rules','cards']) {
      dom.window.designTest.go(route);
      assert.equal(doc.body.dataset.section,route);
      assert.equal(doc.querySelectorAll('.page.active').length,1);
      assert.equal(doc.querySelector('.page.active').id,route);
      assert.equal(doc.querySelector('.navtab[aria-current=page]').dataset.section,route);
      assert.equal(doc.querySelector('.hero-photo').inert,route!=='home');
      assert.equal(doc.querySelectorAll('.page-entering,.page-leaving').length,0);
    }
    const data=JSON.parse(read('data.json'));
    assert.ok(doc.querySelectorAll('#playerGrid .player-card').length>=20);
    for(const p of data.participants){
      const card=[...doc.querySelectorAll('#playerGrid .player-card')].find(x=>x.dataset.profilePlayer===p.name);
      assert.ok(card,p.name);
      assert.equal(card.querySelector('img').getAttribute('src'),p.shield,p.name+' photo');
    }
    assert.doesNotMatch(doc.getElementById('achievementHub').textContent,/El Muro/);
    assert.equal(dom.window.designTest.data(),before);
  }finally{dom.window.close();}
});
test('profile tabs and closing retain their existing behavior',()=>{
  const dom=setup();
  try{
    dom.window.designTest.render();
    dom.window.designTest.openPlayer('Ernesto');
    const doc=dom.window.document;
    assert.equal(doc.getElementById('playerModal').hidden,false);
    assert.match(doc.getElementById('profileTitle').textContent,/Ernesto/);
    for(const tab of [...doc.querySelectorAll('[data-profile-view]')]){
      dom.window.designTest.setProfileView(tab.dataset.profileView);
      assert.equal(tab.getAttribute('aria-selected'),'true');
    }
    dom.window.designTest.closePlayer();
    assert.equal(doc.getElementById('playerModal').hidden,true);
  }finally{dom.window.close();}
});
test('mobile menu is progressive, closes on route selection, and reflects every section',async()=>{
  const dom=setup();
  try {
    const w=dom.window,doc=w.document,menu=doc.getElementById('editorialMenu');
    menu.showModal=()=>menu.setAttribute('open','');
    menu.close=()=>{menu.removeAttribute('open');menu.dispatchEvent(new w.Event('close'));};
    w.eval(read('editorial-ui.js'));
    assert.ok(doc.body.classList.contains('editorial-ui-ready'));
    assert.equal(doc.querySelectorAll('.editorial-mobile-nav button').length,5);
    doc.querySelector('[data-editorial-menu]').click();
    assert.equal(menu.open,true);
    menu.querySelector('[data-go=champions]').click();
    assert.equal(menu.open,false);
    for(const route of ['home','current','matchdays','history','players','champions','cup','rules','cards']){
      w.designTest.go(route);
      await Promise.resolve();
      const active=doc.querySelectorAll('.editorial-mobile-nav [aria-current=page]');
      assert.equal(active.length,1);
      assert.equal(active[0].dataset.go||'more',['home','current','matchdays','history'].includes(route)?route:'more');
    }
  }finally{dom.window.close();}
});
test('without dialog support the existing full navigation remains available',()=>{
  const dom=setup();
  try{dom.window.eval(read('editorial-ui.js'));assert.equal(dom.window.document.body.classList.contains('editorial-ui-ready'),false);}
  finally{dom.window.close();}
});
test('theme and enhanced navigation do not create data or auth persistence paths',()=>{
  assert.doesNotMatch(read('editorial-ui.js'),/\b(fetch|localStorage|sessionStorage|indexedDB|supabase)\s*[.(]/);
  const sw=read('sw.js');
  for(const asset of ['editorial.css?v=175-20261015','editorial-admin.css?v=175-20261015','editorial-ui.js?v=175-20261015'])assert.ok(sw.includes(asset));
  assert.doesNotMatch(sw,/\.\/(bernabeu-bg|stadium-bg|home-stadium-night|mbappe-card|yamal-card)\./);
});
test('generated CSS parses, has light surfaces, and removes external font/decorative image requests',()=>{
  for(const p of ['editorial.css','editorial-admin.css']){
    const css=read(p);
    assert.ok(CSSOM.parse(css).cssRules.length>0);
    assert.doesNotMatch(css,/[\t ]+$/m);
    assert.doesNotMatch(css,/url\(['"]?(?:https?:|bernabeu|stadium|home-stadium|mbappe|yamal)/);
    assert.match(css,/color-scheme:\s*light/);
    assert.match(css,/font-size:\s*16px\s*!important/);
    assert.match(css,/safe-area-inset-bottom/);
    assert.match(css,/prefers-reduced-motion/);
  }
  assert.doesNotMatch(read('index.html'),/fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.ok(zlib.gzipSync(bytes('editorial.css')).length<zlib.gzipSync(bytes('styles.css')).length*.8);
  assert.ok(zlib.gzipSync(bytes('editorial-admin.css')).length<zlib.gzipSync(bytes('admin.css')).length*.85);
});
test('every referenced local HTML/script/stylesheet/image asset exists',()=>{
  for(const file of ['index.html','admin.html']) {
    const dom=new JSDOM(read(file));
    for(const node of dom.window.document.querySelectorAll('script[src],link[href],img[src]')) {
      const value=node.getAttribute('src')||node.getAttribute('href');
      if(/^(https?:|data:|#)/.test(value))continue;
      const local=value.split('?')[0];
      assert.ok(fs.existsSync(path.join(root,local)),`${file}: ${local}`);
    }
    dom.window.close();
  }
});
test('primary and secondary palette combinations meet 4.5:1 contrast',()=>{
  function lum(h){const rgb=h.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
  for(const [fg,bg] of [['#172b25','#f7f8f3'],['#596b62','#ffffff'],['#145c46','#ffffff'],['#ffffff','#145c46'],['#85602c','#f7f1e5'],['#ac3541','#fbefef']]){
    const a=lum(fg),b=lum(bg);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,`${fg} / ${bg}`);
  }
});
