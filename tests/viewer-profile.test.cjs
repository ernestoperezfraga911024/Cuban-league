const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const CSSOM=require('rrweb-cssom');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const KEY='cuban-league-viewer-v1';
const data=JSON.parse(read('data.json'));

function setup({saved=null,blocked=false,reduced=true}={}){
  const dom=new JSDOM(read('index.html'),{url:'https://example.test/Cuban-league/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,doc=w.document,frames=[],timers=new Map();let timer=0;
  w.scrollTo=()=>{};w.matchMedia=()=>({matches:reduced});
  w.requestAnimationFrame=fn=>frames.push(fn);
  w.setTimeout=(fn,delay)=>{timers.set(++timer,{fn,delay});return timer;};
  w.clearTimeout=id=>timers.delete(id);
  w.fetch=()=>assert.fail('Profile personalization must not make a network request');
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
  if(saved!==null)w.localStorage.setItem(KEY,saved);
  if(blocked){for(const method of ['getItem','setItem','removeItem'])w.Storage.prototype[method]=()=>{throw new Error('Storage disabled');};}
  w.eval(read('viewer-profile.js'));
  w.eval(read('app.js').replace(/init\(\);\s*$/,`DATA=${JSON.stringify(data)};window.viewerTest={
    renderCurrent,go,
    start(){window.CubanLeagueViewer.init(activeParticipants());},
    snapshot(){return JSON.stringify(DATA);},
    update(scores){
      LIVE_MATCHDAY_ROWS=Object.entries(scores).map(([participantName,points])=>({participantName,points,matchday:1,goals:0,cleanSheets:0,redCards:0}));
      PUBLISHED_MATCHDAYS=Object.keys(scores).length?[1]:[];renderCurrent();
    }
  };`));
  const api=w.viewerTest;
  api.renderCurrent();api.start();
  const flushFrames=()=>{while(frames.length)frames.shift()();};
  const flushTimers=()=>{for(const [id,t] of [...timers]){timers.delete(id);t.fn();}};
  const choose=id=>{
    const input=doc.querySelector(`#viewerList input[value="${id}"]`);
    assert.ok(input,'participant must exist');input.checked=true;input.dispatchEvent(new w.Event('change',{bubbles:true}));
    doc.getElementById('viewerContinue').click();
  };
  const delta=id=>doc.querySelector(`#currentRows [data-participant-id="${id}"] .viewer-difference`)?.textContent;
  return {dom,w,doc,api,flushFrames,flushTimers,choose,delta,timers};
}

test('first visit opens once, lists active participants, and remembers a stable participant ID',()=>{
  const t=setup();try{
    t.flushFrames();assert.ok(t.doc.getElementById('viewerDialog').open);
    assert.equal(t.doc.activeElement.id,'viewerTitle');
    assert.equal(t.doc.querySelectorAll('#viewerList input').length,20);
    assert.ok(t.doc.getElementById('viewerContinue').disabled);
    t.choose(1);assert.equal(t.doc.getElementById('viewerDialog').open,false);
    const saved=t.w.localStorage.getItem(KEY);
    assert.deepEqual(JSON.parse(saved),{version:1,kind:'participant',participantId:1});
    const returning=setup({saved});try{returning.flushFrames();assert.equal(returning.doc.getElementById('viewerDialog').open,false);assert.match(returning.doc.getElementById('viewerMenuLabel').textContent,/Ernesto/);}finally{returning.dom.window.close();}
  }finally{t.dom.window.close();}
});

test('guest is remembered, produces no personal differences, and can later select a participant',()=>{
  const t=setup();try{
    t.flushFrames();t.doc.getElementById('viewerGuest').click();
    t.api.update({Ernesto:100,'Yovany R9':120});
    assert.equal(t.doc.querySelectorAll('.viewer-difference,.viewer-you').length,0);
    const returning=setup({saved:t.w.localStorage.getItem(KEY)});try{returning.flushFrames();assert.equal(returning.doc.getElementById('viewerDialog').open,false);}finally{returning.dom.window.close();}
    t.doc.getElementById('viewerChoose').click();t.choose(1);
    assert.equal(t.delta(8),'+20');
  }finally{t.dom.window.close();}
});

test('signed gaps use the official cumulative points including ties, negatives and fresh corrections',()=>{
  const t=setup({saved:JSON.stringify({version:1,kind:'participant',participantId:1})});try{
    const before=t.api.snapshot();
    assert.equal(t.doc.querySelectorAll('.viewer-difference').length,0,'no invented zeros before published data');
    t.api.update({Ernesto:100,'Yovany R9':120,Rivaldo:85,'Victor Manuel':100});
    assert.equal(t.delta(1),'0');assert.equal(t.delta(8),'+20');assert.equal(t.delta(9),'-15');assert.equal(t.delta(2),'0');
    const order=[...t.doc.querySelectorAll('#currentRows .current-row')].map(row=>row.dataset.participantId);
    t.api.renderCurrent();
    assert.equal(t.doc.querySelectorAll('.viewer-difference').length,20);
    assert.equal(t.doc.querySelectorAll('.viewer-you').length,1);
    assert.deepEqual([...t.doc.querySelectorAll('#currentRows .current-row')].map(row=>row.dataset.participantId),order);
    assert.equal(t.api.snapshot(),before,'preference and decoration never modify league data');
    t.api.update({Ernesto:-10,'Yovany R9':20,Rivaldo:-25});
    assert.equal(t.delta(8),'+30');assert.equal(t.delta(9),'-15');
    t.doc.getElementById('viewerChange').click();t.choose(8);
    assert.equal(t.delta(1),'-30');assert.equal(t.delta(8),'0');assert.equal(t.delta(9),'-45');
    t.api.update({});assert.equal(t.doc.querySelectorAll('.viewer-difference').length,0);
  }finally{t.dom.window.close();}
});

test('forget removes only the profile preference, does not immediately re-prompt, and works next visit',()=>{
  const t=setup({saved:JSON.stringify({version:1,kind:'participant',participantId:1})});try{
    t.w.localStorage.setItem('cuban-league-visitor-id','retained');
    t.w.localStorage.setItem('cuban-league-owner-browser','1');
    t.api.update({Ernesto:100,'Yovany R9':120});t.doc.getElementById('viewerForget').click();t.flushFrames();
    assert.equal(t.w.localStorage.getItem(KEY),null);
    assert.equal(t.w.localStorage.getItem('cuban-league-visitor-id'),'retained');
    assert.equal(t.w.localStorage.getItem('cuban-league-owner-browser'),'1');
    assert.equal(t.doc.getElementById('viewerDialog').open,false);
    assert.equal(t.doc.querySelectorAll('.viewer-difference,.viewer-you').length,0);
  }finally{t.dom.window.close();}
});

test('search handles accents, empty results and long or malicious names as text',()=>{
  const t=setup();try{
    t.flushFrames();const search=t.doc.getElementById('viewerSearch');
    search.value='pineiro';search.dispatchEvent(new t.w.Event('input'));
    assert.equal(t.doc.querySelectorAll('#viewerList input').length,1);
    assert.match(t.doc.getElementById('viewerList').textContent,/Roberto Piñeiro/);
    search.value='<script>';search.dispatchEvent(new t.w.Event('input'));
    assert.equal(t.doc.querySelectorAll('#viewerList input').length,0);assert.equal(t.doc.getElementById('viewerEmpty').hidden,false);
    assert.equal(t.doc.getElementById('viewerList').querySelector('script'),null);
  }finally{t.dom.window.close();}
});

test('corrupt, unknown and retired IDs cannot personalize the table or grant privileges',()=>{
  for(const saved of ['{broken}',JSON.stringify({version:1,kind:'participant',participantId:999}),JSON.stringify({version:1,kind:'participant',participantId:21}),JSON.stringify({version:1,kind:'admin',participantId:1})]){
    const t=setup({saved});try{t.flushFrames();assert.ok(t.doc.getElementById('viewerDialog').open);t.api.update({Ernesto:100});assert.equal(t.doc.querySelectorAll('.viewer-difference').length,0);}finally{t.dom.window.close();}
  }
});

test('blocked storage does not break selection, navigation, guest or forgetting',()=>{
  const t=setup({blocked:true});try{
    t.flushFrames();t.choose(1);t.api.update({Ernesto:100,'Yovany R9':120});
    assert.equal(t.delta(8),'+20');assert.match(t.doc.getElementById('viewerStatus').textContent,/durante esta visita/);
    t.api.go('current');assert.equal(t.doc.body.dataset.section,'current');
    t.doc.getElementById('viewerForget').click();assert.equal(t.doc.querySelectorAll('.viewer-difference').length,0);
    t.doc.getElementById('viewerChoose').click();t.doc.getElementById('viewerGuest').click();assert.equal(t.doc.getElementById('viewerDialog').open,false);
  }finally{t.dom.window.close();}
});

test('cross-tab changes and clearing storage immediately refresh relative points without a new request',()=>{
  const t=setup({saved:JSON.stringify({version:1,kind:'guest'})});try{
    t.api.update({Ernesto:100,'Yovany R9':120});
    t.w.localStorage.setItem(KEY,JSON.stringify({version:1,kind:'participant',participantId:1}));
    t.w.dispatchEvent(new t.w.StorageEvent('storage',{key:KEY}));assert.equal(t.delta(8),'+20');
    t.w.localStorage.clear();t.w.dispatchEvent(new t.w.StorageEvent('storage',{key:null}));assert.equal(t.doc.querySelectorAll('.viewer-difference').length,0);
  }finally{t.dom.window.close();}
});

test('close animation has one cleanup; rapid reopen cancels stale close and Escape remains usable',()=>{
  const t=setup({reduced:false});try{
    t.flushFrames();const dialog=t.doc.getElementById('viewerDialog');
    dialog.dispatchEvent(new t.w.Event('cancel',{cancelable:true}));
    assert.ok(dialog.open);assert.ok(dialog.classList.contains('is-closing'));assert.equal(t.timers.size,1);
    t.doc.getElementById('viewerChoose').click();t.flushTimers();assert.ok(dialog.open);assert.equal(dialog.classList.contains('is-closing'),false);
    t.choose(1);t.flushTimers();assert.equal(dialog.open,false);assert.equal(t.doc.body.classList.contains('viewer-dialog-open'),false);
  }finally{t.dom.window.close();}
});

test('animations only use opacity/transform, respect reduced motion, and PWA caches both new assets',()=>{
  const css=read('viewer-profile.css'),rules=CSSOM.parse(css).cssRules;
  for(const animation of rules.filter(rule=>['viewerEnter','viewerExit','viewerBackdrop'].includes(rule.name))){
    for(const frame of animation.cssRules){for(let i=0;i<frame.style.length;i++)assert.ok(['opacity','transform'].includes(frame.style[i]));}
  }
  const reduced=rules.find(rule=>rule.media?.mediaText==='(prefers-reduced-motion:reduce)');assert.ok(reduced);
  assert.equal(reduced.cssRules[0].style.animation,'none');
  for(const asset of ['viewer-profile.js?v=219-20261113','viewer-profile.css?v=219-20261113','app.js?v=219-20261113']){
    assert.ok(read('index.html').includes(asset));assert.ok(read('sw.js').includes(asset));
  }
});
