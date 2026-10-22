const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
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
  dom.window.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
  dom.window.fetch=async()=>{throw new Error('Live network forbidden in design tests');};
  dom.window.eval(read('app.js').replace(/init\(\);\s*$/,`window.designTest={
    set(data){DATA=data;},data(){return JSON.stringify(DATA);},go,openPlayer,closePlayer,setProfileView,
    render(){renderCurrent();renderMatchdayCenter();renderHomeLive();renderGeneral();renderPoints();renderPalmares();renderSeasons();renderSeasonChampions();renderPlayers();renderRecords();renderChampions();renderCup();},
    business(name){return window[name].toString();}
  };`));
  dom.window.designTest.set(JSON.parse(read('data.json')));
  return dom;
}

test('V174 protected files remain unchanged; manifests only replace approved F05 image URLs and theme colors',()=>{
  for(const [p,expected] of Object.entries(baseline.files)){
    if(p==='manifest.json'||p==='admin-manifest.json'){
      // Preserve the original hash contract after undoing only the approved branding fields.
      const originalColors=p==='manifest.json'?['#030914','#030914']:['#030a0c','#06130f'];
      const normalized=read(p)
        .replaceAll('icon-f05-192.png','icon-green-192.png')
        .replaceAll('icon-f05-maskable-512.png','icon-green-512.png')
        .replaceAll('icon-f05-512.png','icon-green-512.png')
        .replace('"background_color": "#071910"',`"background_color": "${originalColors[0]}"`)
        .replace('"theme_color": "#071910"',`"theme_color": "${originalColors[1]}"`);
      assert.equal(hash(normalized),expected,p+' non-brand fields');
    }else if(p==='admin.js'){
      // V188 adds only an authenticated-client handoff and teardown for Segunda.
      // Removing those exact integration lines must restore the full original file.
      const normalized=read(p)
        .replace("      window.CubanSecondAdmin?.init({ client: state.client, season: currentSeasonKey(), extensionCall,\n        isBlocked: () => state.misterImportBusy || state.saving || state.backupRestoring });\n",'')
        .replace("  function showOnly(viewId) {\n    if (viewId !== 'panelView') window.CubanSecondAdmin?.reset();\n",'  function showOnly(viewId) {');
      assert.equal(hash(normalized),expected,p+' original admin preserved');
    }else assert.equal(hash(bytes(p)),expected,p);
  }
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
test('original league calculations and normalization functions remain unchanged',()=>{
  const dom=setup();
  // V179 intentionally fixes loading/sync and defers catalog dependencies.
  // These six I/O functions now have behavioral coverage in public-loading.test.cjs.
  const loadingFixes=new Set(['fetchPublishedStatsRows','syncLiveCurrentStats','syncAchievementMilestones','fetchPublishedMatchdayLineup','fetchPublishedProfileSeasonRows','fetchPublishedLeagueStatsRows']);
  try {for(const [name,digest] of Object.entries(baseline.protectedFunctions)){
    if(!loadingFixes.has(name))assert.equal(hash(dom.window.designTest.business(name)),digest,name);
  }}
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
      if(route!=='home')assert.equal(doc.querySelector('.navtab[aria-current=page]').dataset.section,route);
      assert.equal(Boolean(doc.querySelector('.hero-photo').inert),route!=='home');
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
test('real app click handlers route every retained shortcut and keep league data intact',async()=>{
  const dom=setup();
  try{
    const w=dom.window,doc=w.document,menu=doc.getElementById('editorialMenu');
    w.HTMLCanvasElement.prototype.getContext=()=>null;
    w.fetch=async(url,options={})=>{
      assert.match(String(url),/^data\.json\?/);
      assert.equal(options.method||'GET','GET');
      return {ok:true,json:async()=>JSON.parse(read('data.json'))};
    };
    menu.showModal=()=>menu.setAttribute('open','');
    menu.close=()=>{menu.removeAttribute('open');menu.dispatchEvent(new w.Event('close'));};
    await w.init();
    w.eval(read('editorial-ui.js'));
    const before=w.designTest.data();
    const more=doc.querySelector('.editorial-mobile-nav [data-editorial-menu]');
    for(const route of ['current','matchdays','history','home','players','champions','cup','rules','cards']){
      const direct=['home','current','matchdays','history'].includes(route);
      if(!direct){more.focus();more.querySelector('svg').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));assert.equal(menu.open,true);}
      const button=doc.querySelector(`${direct?'.editorial-mobile-nav':'#editorialMenu'} [data-go=${route}]`);
      button.querySelector('svg').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
      await Promise.resolve();
      assert.equal(doc.body.dataset.section,route);
      assert.equal(doc.querySelector('.page.active').id,route);
      assert.equal(menu.open,false);
      if(!direct)assert.equal(doc.activeElement,more);
      const active=doc.querySelector('.editorial-mobile-nav [aria-current=page]');
      assert.equal(active.dataset.go||'more',direct?route:'more');
    }
    more.click();menu.querySelector('[data-editorial-close]').click();
    assert.equal(menu.open,false);
    assert.equal(menu.querySelector('a').getAttribute('href'),'admin.html');
    assert.equal(w.designTest.data(),before);
  }finally{dom.window.close();}
});
test('navigation stays read-only and the new cache restores the classic resources',()=>{
  assert.doesNotMatch(read('editorial-ui.js'),/\b(fetch|localStorage|sessionStorage|indexedDB|supabase)\s*[.(]/);
  const sw=read('sw.js');
  for(const asset of ['styles.css?v=176-20261015-classic-navigation','admin.css?v=176-20261015-classic-navigation','mobile-navigation.css?v=178-20261015','editorial-ui.js?v=176-20261015','home-stadium-night.jpg'])assert.ok(sw.includes(asset));
  assert.match(sw,/cuban-league-v190-empty-slots/);
  assert.doesNotMatch(sw,/editorial(?:-admin)?\.css/);
});
test('classic styles are active; the lightweight add-on is scoped to navigation',()=>{
  const css=read('mobile-navigation.css');
  const parsed=CSSOM.parse(css);
  assert.ok(parsed.cssRules.length>0);
  assert.ok(bytes('mobile-navigation.css').length<6000);
  assert.doesNotMatch(css,/url\(/);
  assert.match(css,/safe-area-inset-bottom/);
  assert.match(css,/prefers-reduced-motion/);
  function checkRules(rules){for(const rule of rules){
    if(rule.cssRules){checkRules(rule.cssRules);continue;}
    assert.ok(rule.selectorText.startsWith('.classic-mobile-nav')||rule.selectorText.startsWith('#editorialMenu'),rule.selectorText);
  }}
  checkRules(parsed.cssRules);
  for(const [file,legacy] of [['index.html','styles.css'],['admin.html','admin.css']]){
    const dom=new JSDOM(read(file));
    const sheets=[...dom.window.document.querySelectorAll('link[rel=stylesheet]')].map(n=>n.getAttribute('href'));
    assert.ok(sheets.some(s=>s.startsWith(legacy+'?')));
    assert.ok(sheets.every(s=>!s.includes('editorial.css')&&!s.includes('editorial-admin.css')));
    assert.equal(dom.window.document.body.classList.contains('editorial'),false);
    dom.window.close();
  }
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
  for(const [fg,bg] of [['#172b25','#f7f8f3'],['#596b62','#ffffff'],['#145c46','#ffffff'],['#ffffff','#145c46'],['#85602c','#f7f1e5'],['#ac3541','#fbefef'],['#91a4b5','#06151b'],['#6cff73','#12382b'],['#f5f8f6','#06151b'],['#f5f8f6','#0a2028'],['#f5f8f6','#12382b'],['#6cff73','#0a2028']]){
    const a=lum(fg),b=lum(bg);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,`${fg} / ${bg}`);
  }
});
