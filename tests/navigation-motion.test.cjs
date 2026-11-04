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
  w.eval(read('app.js').replace(/init\(\);\s*$/,`DATA=${JSON.stringify(JSON.parse(read('data.json')))};window.motionTest={go,snapshot:()=>JSON.stringify(DATA),duration:SECTION_ENTER_DURATION,leagueDuration:LEAGUE_ENTER_DURATION};`));
  const assertRoute=route=>{
    assert.equal(doc.body.dataset.section,route);
    assert.equal(doc.querySelectorAll('.page.active').length,1);
    assert.equal(doc.querySelector('.page.active').id,route);
    assert.equal(doc.querySelector('.hero-photo').getAttribute('aria-hidden')==='true',route!=='home');
  };
  const finishTimers=()=>{for(const [id,timer] of [...timers]){timers.delete(id);timer.callback();}};
  return {dom,w,doc,timers,transitions,api:w.motionTest,assertRoute,finishTimers,requests:()=>requests,scrolls:()=>scrolls};
}

test('fallback routes immediately, with only an animation-cleanup timer and no data/network changes',()=>{
  const t=setup();try{
    const before=t.api.snapshot();
    for(const route of ['current','matchdays','players','history','cup','champions','rules','cards','second-division','home']){
      t.api.go(route);t.assertRoute(route); // No timers or frames need to run first.
      assert.equal(t.timers.size,1);
      assert.equal([...t.timers.values()][0].delay,240);
      assert.ok(t.doc.getElementById(route).classList.contains('page-entering'));
      assert.equal(t.doc.querySelectorAll('.page-leaving').length,0);
      assert.equal(t.doc.documentElement.classList.contains('section-transition-active'),false);
      t.finishTimers();assert.equal(t.doc.querySelectorAll('.page-entering').length,0);
    }
    assert.equal(t.api.duration,220);assert.equal(t.requests(),0);assert.equal(t.api.snapshot(),before);
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

test('all routes use the approved live entrance even with the native API available',()=>{
  const t=setup({native:true});try{
    const before=t.api.snapshot();
    for(const route of ['current','matchdays','players','history','cup','champions','rules','cards','second-division','home']){
      t.api.go(route);t.assertRoute(route);
      const stale=[...t.timers.values()][0].callback;
      t.api.go('current');t.api.go(route);stale();t.assertRoute(route);
      assert.equal(t.transitions.length,0);t.finishTimers();
      assert.equal(t.doc.querySelectorAll('.page-entering,.page-leaving').length,0);
    }
    assert.equal(t.api.snapshot(),before);assert.equal(t.requests(),0);
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
  for(const asset of ['app.js?v=200-20261104-club-contributions','styles.css?v=195-20261102-fast-navigation','league-motion.css?v=197-20261102-smooth-tabs']){
    assert.ok(html.includes(asset));
    assert.ok(sw.includes(asset));
  }
});

test('Liga has one immediate live-content entrance even when native transitions are available',()=>{
  for(const native of [false,true]){
    const t=setup({native});try{
      const before=t.api.snapshot();t.api.go('current');t.assertRoute('current');
      assert.equal(t.transitions.length,0);assert.equal(t.api.leagueDuration,220);
      assert.equal([...t.timers.values()][0].delay,240);
      assert.ok(t.doc.getElementById('current').classList.contains('page-entering'));
      t.finishTimers();t.assertRoute('current');
      assert.equal(t.doc.querySelectorAll('.page-entering,.page-leaving').length,0);
      assert.equal(t.api.snapshot(),before);assert.equal(t.requests(),0);
    }finally{t.dom.window.close();}
  }
});

test('Liga stylesheet is scoped, uses only opacity/transform, and permanently suppresses the duplicate table reveal',()=>{
  const css=read('league-motion.css'),rules=CSSOM.parse(css).cssRules;
  assert.ok(Buffer.byteLength(css)<1000);
  const keyframes=rules.find(rule=>rule.name==='leaguePageEnter');
  assert.equal(keyframes.cssRules.length,2);
  for(const frame of keyframes.cssRules){
    for(let i=0;i<frame.style.length;i++)assert.ok(['opacity','transform'].includes(frame.style[i]));
  }
  assert.equal(keyframes.cssRules[0].style.opacity,'.72');
  assert.equal(keyframes.cssRules[0].style.transform,'translateY(6px)');
  assert.equal(keyframes.cssRules[1].style.opacity,'1');
  assert.equal(keyframes.cssRules[1].style.transform,'none');
  const normal=rules.filter(rule=>rule.selectorText);
  assert.deepEqual(normal.map(rule=>rule.selectorText),['.page.page','.page.page.page-entering','.standings-panel:not([hidden]),\n.history-hub-panel:not([hidden]),\n.regulation-panel:not([hidden]),\n.history-panel.active']);
  assert.equal(normal[0].style.animation,'none');
  assert.match(normal[1].style.animation,/^leaguePageEnter \.22s cubic-bezier/);
  assert.equal(normal[2].style.animation,'none');
  for(const rule of normal)assert.deepEqual(Array.from({length:rule.style.length},(_,i)=>rule.style[i]),['animation']);
  const reduced=rules.find(rule=>rule.media?.mediaText==='(prefers-reduced-motion:reduce)');
  assert.equal(reduced.cssRules[0].selectorText,'.page.page.page-entering');
  assert.equal(reduced.cssRules[0].style.animation,'none');
});

test('actual CSS cascade cannot restart old page/table animations after Liga cleanup or tab changes',()=>{
  const dom=new JSDOM(`<style>${read('styles.css')}\n${read('league-motion.css')}</style><section id="current" class="page active page-entering"><div class="standings-panel"></div></section><section id="matchdays" class="page active"></section>`);
  try{
    const w=dom.window,page=w.document.getElementById('current'),panel=page.firstElementChild;
    assert.match(w.getComputedStyle(page).animation,/^leaguePageEnter \.22s /);
    assert.equal(w.getComputedStyle(panel).animation,'none');
    page.classList.remove('page-entering');
    assert.equal(w.getComputedStyle(page).animation,'none');
    assert.equal(w.getComputedStyle(panel).animation,'none');
    panel.hidden=true;panel.hidden=false;
    assert.equal(w.getComputedStyle(panel).animation,'none');
    assert.equal(w.getComputedStyle(w.document.getElementById('matchdays')).animation,'none');
  }finally{dom.window.close();}
});
