const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
const {JSDOM}=require('jsdom');
const CSSOM=require('rrweb-cssom');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const css=read('glass-standings.css');
function walk(rules,visit){for(const rule of rules){if(rule.cssRules)walk(rule.cssRules,visit);else if(rule.style)visit(rule);}}

test('glass is scoped to Liga, within a 3 KB gzip budget, without new images or scripts',()=>{
  assert.ok(Buffer.byteLength(css)<12000);
  assert.ok(zlib.gzipSync(css).length<3000);
  assert.doesNotMatch(css,/@import|https?:|data:|@keyframes|will-change|filter\s*:\s*url/);
  assert.deepEqual([...css.matchAll(/url\(['"]?([^)'" ]+)/g)].map(m=>m[1]),['bernabeu-bg.jpg']);
  walk(CSSOM.parse(css).cssRules,rule=>{
    // Commas inside :is() are not selector boundaries.
    for(const selector of rule.selectorText.split(/,(?![^()]*\))/)){
      assert.match(selector.trim(),/^(?:#current(?=[\s>.{:]|$)|body\.[^ ]+\[data-section="current"\])/);
    }
    if(rule.style.getPropertyValue('backdrop-filter').includes('blur')){
      assert.match(rule.selectorText,/standings-switcher-primary/);
      assert.match(rule.selectorText,/editorial-mobile-nav/);
      assert.doesNotMatch(rule.selectorText,/current-row|current-table-card/);
      assert.equal(rule.style.getPropertyValue('backdrop-filter'),'blur(8px)');
    }
    if(rule.style.getPropertyValue('animation'))assert.equal(rule.style.getPropertyValue('animation'),'none');
  });
  assert.match(css,/prefers-reduced-transparency:reduce/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(css,/prefers-contrast:more/);
});

test('scroll region retains all nine columns, tab panels and F05; sheet is precached once',()=>{
  const dom=new JSDOM(read('index.html'));
  try{
    const d=dom.window.document,card=d.querySelector('#current .current-table-card');
    assert.equal(card.tabIndex,0);assert.equal(card.getAttribute('role'),'region');
    assert.ok(d.getElementById(card.getAttribute('aria-describedby')));
    assert.equal(card.querySelectorAll('.current-grid>span').length,9);
    assert.equal(d.querySelectorAll('[data-standings-view]').length,8);
    assert.equal(d.querySelectorAll('[data-standings-panel]').length,8);
    assert.equal(d.querySelector('.brand .logo img').getAttribute('src'),'cuban-league-f05-logo.svg');
    const links=[...d.querySelectorAll('link[rel=stylesheet]')].map(x=>x.getAttribute('href'));
    assert.equal(links.at(-1),'glass-standings.css?v=192-20261101');
    assert.equal(read('sw.js').split("'./glass-standings.css?v=192-20261101'").length-1,1);
    assert.doesNotMatch(read('admin.html'),/glass-standings/);
    assert.doesNotMatch(read('app.js'),/glass-standings(?!';)/);
  }finally{dom.window.close();}
});

test('mobile headings and values map to the same columns without hiding metrics',()=>{
  const rules=CSSOM.parse(css).cssRules;
  const mobile=[...rules].find(r=>r.media?.mediaText==='(max-width:700px)');
  assert.ok(mobile);
  for(const [nth,cls,column] of [[5,'current-goals',6],[6,'current-clean-sheets',7],[7,'current-red-cards',8],[8,'current-movement',5],[9,'current-form',9]]){
    const rule=[...mobile.cssRules].find(r=>r.selectorText?.includes(`span:nth-child(${nth})`));
    assert.ok(rule.selectorText.includes(`.${cls}`));
    assert.equal(rule.style.getPropertyValue('grid-column'),String(column));
    assert.equal(rule.style.getPropertyValue('grid-row'),'1');
  }
  walk(rules,rule=>{
    if(rule.style.getPropertyValue('display')==='none')assert.equal(rule.selectorText,'#current .current-table-scroll-hint');
  });
});

test('render and navigation preserve participants, scores, profiles and all nine metrics without network',()=>{
  const dom=new JSDOM(read('index.html'),{url:'https://example.test/',runScripts:'outside-only',pretendToBeVisual:true});
  try{
    const w=dom.window,d=w.document;
    w.scrollTo=()=>{};w.matchMedia=()=>({matches:true});
    w.fetch=()=>{throw new Error('No network allowed for presentation/navigation');};
    w.eval(read('app.js').replace(/init\(\);\s*$/,`window.glassTest={
      load(data){DATA=data;},snapshot(){return JSON.stringify(DATA);},renderCurrent,
      setupStandingsSwitcher,go,openPlayer,closePlayer
    };`));
    const data=JSON.parse(read('data.json'));
    w.glassTest.load(data);const before=w.glassTest.snapshot();
    w.glassTest.renderCurrent();w.glassTest.setupStandingsSwitcher();
    const rows=[...d.querySelectorAll('#currentRows .current-row')];
    assert.equal(rows.length,data.participants.filter(p=>p.active!==false).length);
    for(const row of rows){
      assert.equal(row.children.length,9);
      assert.ok(row.querySelector('[data-profile-player]'));
      for(const selector of ['.num','.current-goals','.current-clean-sheets','.current-red-cards','.current-movement','.current-form'])assert.ok(row.querySelector(selector),selector);
    }
    const rendered=d.getElementById('currentRows').innerHTML;
    for(const view of ['matchday','goals','clean-sheets','red-cards','general']){
      d.querySelector(`[data-standings-view="${view}"]`).click();
      assert.equal(d.querySelectorAll('[data-standings-panel]:not([hidden])').length,1);
      assert.equal(d.querySelector('[data-standings-panel]:not([hidden])').dataset.standingsPanel,view);
    }
    d.getElementById('standingsTabGeneral').dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    assert.equal(d.activeElement.id,'standingsTabMatchday');
    d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Home',bubbles:true}));
    assert.equal(d.activeElement.id,'standingsTabGeneral');
    for(const route of ['current','home','matchdays','history','current']){
      w.glassTest.go(route);assert.equal(d.body.dataset.section,route);
    }
    w.glassTest.openPlayer('Ernesto');assert.equal(d.getElementById('playerModal').hidden,false);
    w.glassTest.closePlayer();assert.equal(d.getElementById('playerModal').hidden,true);
    assert.equal(d.getElementById('currentRows').innerHTML,rendered);
    assert.equal(w.glassTest.snapshot(),before);
  }finally{dom.window.close();}
});

test('glass text and semantic accents retain 4.5:1 contrast on the lightest table surface',()=>{
  const luminance=hex=>hex.match(/\w\w/g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);
  // Conservative composite including white behind the .96 panel and its sheen.
  for(const fg of ['f1f5f2','b0beb7','e0c486','c1d1d6','d5a58b','a8dbb9','f6a6ae']){
    assert.ok((luminance(fg)+.05)/(luminance('26342f')+.05)>=4.5,fg);
  }
});
