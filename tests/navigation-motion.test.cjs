const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {JSDOM}=require('jsdom');
const CSSOM=require('rrweb-cssom');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup({reduced=false,native=false}={}){
  const dom=new JSDOM(read('index.html'),{url:'https://example.test/Cuban-league/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,doc=w.document,timers=new Map(),transitions=[];
  let timerId=0,requests=0,scrolls=0;
  w.scrollTo=()=>{scrolls++;};
  w.matchMedia=()=>({matches:reduced});
  w.fetch=()=>{requests++;throw new Error('Navigation must not fetch');};
  w.setTimeout=(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;};
  w.clearTimeout=id=>timers.delete(id);
  if(native)doc.startViewTransition=update=>{
    let resolve,reject,readyResolve,readyReject;
    const transition={skipped:false,ready:new Promise((yes,no)=>{readyResolve=yes;readyReject=no;}),
      finished:new Promise((yes,no)=>{resolve=yes;reject=no;}),update(){readyResolve();update();},
      skipTransition(){this.skipped=true;readyReject(new Error('Animation skipped'));},
      resolve(){resolve();},reject(){reject(new Error('Animation skipped'));}};
    transitions.push(transition);return transition;
  };
  w.eval(read('app.js').replace(/init\(\);\s*$/,`DATA=${JSON.stringify(JSON.parse(read('data.json')))};window.motionTest={go,snapshot:()=>JSON.stringify(DATA),duration:SECTION_ENTER_DURATION};`));
  const assertRoute=route=>{
    assert.equal(doc.body.dataset.section,route);
    assert.equal(doc.querySelectorAll('.page.active').length,1);
    assert.equal(doc.querySelector('.page.active').id,route);
    assert.equal(doc.querySelector('.hero-photo').getAttribute('aria-hidden')==='true',route!=='home');
  };
  const finishTimers=()=>{for(const [id,timer] of [...timers]){timers.delete(id);timer.callback();}};
  return {dom,w,doc,timers,transitions,api:w.motionTest,assertRoute,finishTimers,requests:()=>requests,scrolls:()=>scrolls};
}

test('fallback routes immediately, with only a 200ms animation-cleanup timer and no data/network changes',()=>{
  const t=setup();try{
    const before=t.api.snapshot();
    for(const route of ['current','matchdays','players','history','cup','champions','rules','cards','second-division','home']){
      t.api.go(route);t.assertRoute(route); // No timers or frames need to run first.
      assert.equal(t.timers.size,1);
      assert.equal([...t.timers.values()][0].delay,200);
      assert.ok(t.doc.getElementById(route).classList.contains('page-entering'));
      assert.equal(t.doc.querySelectorAll('.page-leaving').length,0);
      assert.equal(t.doc.documentElement.classList.contains('section-transition-active'),false);
      t.finishTimers();assert.equal(t.doc.querySelectorAll('.page-entering').length,0);
    }
    assert.equal(t.api.duration,180);assert.equal(t.requests(),0);assert.equal(t.api.snapshot(),before);
  }finally{t.dom.window.close();}
});

test('fast fallback taps keep only the last section; stale cleanup cannot affect its entrance',()=>{
  const t=setup();try{
    t.api.go('current');const oldFinish=[...t.timers.values()][0].callback;
    t.api.go('matchdays');t.api.go('cup');t.assertRoute('cup');
    assert.equal(t.timers.size,1);assert.equal(t.doc.querySelectorAll('.page-entering').length,1);
    oldFinish();t.assertRoute('cup');assert.ok(t.doc.getElementById('cup').classList.contains('page-entering'));
    t.finishTimers();assert.equal(t.doc.querySelectorAll('.page-entering,.page-leaving').length,0);
  }finally{t.dom.window.close();}
});

test('same-section and historical aliases retain scrolling and selected history view without stale timers',()=>{
  const t=setup();try{
    t.api.go('current');t.api.go('current');t.assertRoute('current');
    assert.equal(t.timers.size,0);assert.equal(t.doc.querySelectorAll('.page-entering').length,0);
    t.api.go('seasons');t.assertRoute('history');
    assert.equal(t.doc.querySelector('[data-history-view="seasons"]').getAttribute('aria-selected'),'true');
    t.api.go('records');t.assertRoute('history');
    assert.equal(t.doc.querySelector('[data-history-view="records"]').getAttribute('aria-selected'),'true');
    assert.equal(t.timers.size,0);assert.equal(t.scrolls(),4);
    t.api.go('not-a-section');t.assertRoute('history');
  }finally{t.dom.window.close();}
});

test('reduced-motion navigates synchronously with no timers or native transitions',()=>{
  const t=setup({reduced:true,native:true});try{
    for(const route of ['current','matchdays','history','home']){t.api.go(route);t.assertRoute(route);}
    assert.equal(t.timers.size,0);assert.equal(t.transitions.length,0);
    assert.equal(t.doc.querySelectorAll('.page-entering,.page-leaving').length,0);
  }finally{t.dom.window.close();}
});

test('native transitions preserve routing and clean up after successful completion',async()=>{
  const t=setup({native:true});try{
    t.api.go('current');assert.equal(t.transitions.length,1);assert.equal(t.timers.size,0);
    t.transitions[0].update();t.assertRoute('current');
    assert.equal(t.doc.documentElement.classList.contains('section-transition-active'),true);
    t.transitions[0].resolve();await flush();
    assert.equal(t.doc.documentElement.classList.contains('section-transition-active'),false);
  }finally{t.dom.window.close();}
});

test('rapid native taps skip the old animation and discard its late route/cleanup callbacks',async()=>{
  const t=setup({native:true});try{
    t.api.go('current');t.api.go('cup');
    const [old,latest]=t.transitions;assert.equal(old.skipped,true);
    latest.update();t.assertRoute('cup');old.update();t.assertRoute('cup');
    old.resolve();await flush();
    assert.equal(t.doc.documentElement.classList.contains('section-transition-active'),true);
    latest.resolve();await flush();
    assert.equal(t.doc.documentElement.classList.contains('section-transition-active'),false);
    assert.equal(t.requests(),0);
  }finally{t.dom.window.close();}
});

test('returning to the visible section cancels a pending native destination',async()=>{
  const t=setup({native:true});try{
    t.api.go('current');const pending=t.transitions[0];t.api.go('home');
    assert.equal(pending.skipped,true);pending.update();t.assertRoute('home');
    pending.resolve();await flush();t.assertRoute('home');
    assert.equal(t.doc.documentElement.classList.contains('section-transition-active'),false);
    assert.equal(t.transitions.length,1);assert.equal(t.timers.size,0);
  }finally{t.dom.window.close();}
});

test('unsupported or rejected native animation cannot leave transition classes stuck',async()=>{
  const t=setup({native:true});try{
    t.api.go('current');t.transitions[0].update();t.transitions[0].reject();await flush();
    t.assertRoute('current');assert.equal(t.doc.documentElement.classList.contains('section-transition-active'),false);
    t.doc.startViewTransition=()=>{throw new Error('Unavailable');};
    t.api.go('cup');t.assertRoute('cup');assert.equal(t.timers.size,1);
    assert.equal(t.doc.documentElement.classList.contains('section-transition-active'),false);
    t.finishTimers();assert.equal(t.doc.querySelectorAll('.page-entering,.page-leaving').length,0);
  }finally{t.dom.window.close();}
});

test('CSS changes only three page-navigation durations, preserving layout, keyframes and reduced-motion rules',()=>{
  const css=read('styles.css'),rules=CSSOM.parse(css).cssRules;
  const animation=selector=>rules.find(rule=>rule.selectorText===selector).style.getPropertyValue('animation');
  assert.match(animation('.page.page-entering'),/^sectionPageEnter \.18s /);
  assert.match(animation('::view-transition-old(league-section)'),/^sectionPageLeave \.09s /);
  assert.match(animation('::view-transition-new(league-section)'),/^sectionPageEnter \.18s /);
  const normalized=css
    .replace('.page.page-entering{\n  display:block;\n  animation:sectionPageEnter .18s','.page.page-entering{\n  display:block;\n  animation:sectionPageEnter .45s')
    .replace('::view-transition-old(league-section){\n  animation:sectionPageLeave .09s','::view-transition-old(league-section){\n  animation:sectionPageLeave .18s')
    .replace('::view-transition-new(league-section){\n  animation:sectionPageEnter .18s','::view-transition-new(league-section){\n  animation:sectionPageEnter .46s');
  const baseline=JSON.parse(read('tests/fixtures/pre-editorial-contract.json'));
  assert.equal(createHash('sha256').update(normalized).digest('hex'),baseline.files['styles.css']);
  const html=read('index.html'),sw=read('sw.js');
  for(const file of ['app.js','styles.css']){
    assert.ok(html.includes(`${file}?v=195-20261102-fast-navigation`));
    assert.ok(sw.includes(`${file}?v=195-20261102-fast-navigation`));
  }
});
