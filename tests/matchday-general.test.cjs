const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const CSSOM=require('rrweb-cssom');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const source=JSON.parse(read('data.json'));
const roster=source.participants.filter(p=>p.active!==false);
const plain=x=>JSON.parse(JSON.stringify(x));
const freeze=x=>{Object.freeze(x);Object.values(x).forEach(v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v))freeze(v);});return x;};
function builder(){const sandbox={Intl};vm.runInNewContext(read('matchday-general.js'),sandbox);return sandbox.CubanMatchdayGeneral.build;}
const people=['A','B','C','D'].map((name,order)=>({name,order}));
function fixture(scores){
  const rows=scores.flatMap((points,i)=>points.map((value,j)=>({participantName:people[j].name,matchday:i+1,points:value,hasPostponedMatches:false})));
  const standings=day=>people.map(p=>({...p,points:rows.filter(r=>r.participantName===p.name&&r.matchday<=day).reduce((n,r)=>n+r.points,0)}))
    .sort((a,b)=>b.points-a.points||a.order-b.order).map((p,i)=>({...p,position:i+1}));
  return {participants:people,rows,standings,season:'2026/27'};
}
test('records use distinct participants, preserve real zeros/negatives, and share ties without dropping cutoff ties',()=>{
  const input=fixture([[80,70,70,-4],[80,90,70,0],[20,10,70,-1]]);freeze(input.rows);freeze(input.participants);
  const before=JSON.stringify(input.rows),m=builder()(input);
  assert.deepEqual(plain(m.best.map(p=>[p.name,p.best.points,p.rank])),[['B',90,1],['A',80,2],['C',70,3],['D',0,4]]);
  assert.deepEqual(plain(m.best[1].best.days),[1,2]);
  assert.deepEqual(plain(m.worst.map(p=>[p.name,p.worst.points])),[['D',-4],['B',10],['A',20],['C',70]]);
  assert.equal(JSON.stringify(input.rows),before);
  const tied=builder()(fixture([[100,90,80,80]]));assert.equal(tied.best.filter(p=>p.rank<=3).length,4);
});
test('weekly co-winners, cumulative leaders, total leadership and longest/active streaks are distinct',()=>{
  const m=builder()(fixture([[10,9,0,0],[10,10,0,0],[0,10,0,0],[20,0,0,0]]));
  assert.deepEqual(plain(m.wins.map(p=>[p.name,p.wins])),[['A',3],['B',2]]);
  assert.deepEqual(plain(m.leads.map(p=>[p.name,p.leads])),[['A',3],['B',1]]);
  assert.equal(m.streaks[0].bestRun,2);assert.equal(m.streaks[0].bestStart,1);assert.equal(m.streaks[0].bestEnd,2);
  assert.equal(m.active.name,'A');assert.equal(m.active.run,1);assert.equal(m.active.runStart,4);
});
test('missing rows, unplayed rounds and ambiguous duplicates never invent zeros or cumulative leaders',()=>{
  const input=fixture([[10,9,8,7],[10,9,8,7],[10,9,8,7]]);
  input.rows=input.rows.filter(r=>!(r.matchday===2&&r.participantName==='D'));
  let m=builder()(input);assert.equal(m.incomplete,true);assert.equal(m.frames[0].complete,true);
  assert.equal(m.frames[1].table.length,0);assert.equal(m.frames[2].table.length,0);assert.equal(m.active,null);
  assert.equal(m.worst.find(p=>p.name==='D').worst.points,7);assert.equal(m.leads[0].leads,1);
  input.rows=input.rows.filter(r=>r.matchday!==2);m=builder()(input);assert.equal(m.frames.length,3);assert.equal(m.frames[1].complete,false);
  const duplicate=fixture([[10,9,8,7]]);duplicate.rows.push({...duplicate.rows[0]});m=builder()(duplicate);
  assert.equal(m.best.some(p=>p.name==='A'),false);assert.equal(m.frames[0].complete,false);
  const missing=fixture([[10,null,8,7]]);m=builder()(missing);assert.equal(m.worst.some(p=>p.name==='B'),false);
});
test('pending results, corrections, undo and a new season recalculate without retaining old awards',()=>{
  const input=fixture([[10,9,8,7],[10,9,8,7]]);input.rows[0].hasPostponedMatches=true;
  let m=builder()(input);assert.equal(m.provisional,true);assert.equal(m.frames[1].provisional,true);
  input.rows[0].hasPostponedMatches=false;input.rows.find(r=>r.matchday===2&&r.participantName==='B').points=100;
  m=builder()(input);assert.equal(m.provisional,false);assert.equal(m.best[0].name,'B');assert.equal(m.active.name,'B');
  input.rows=input.rows.filter(r=>r.matchday===1);m=builder()(input);assert.equal(m.latest,1);assert.equal(m.active.name,'A');
  m=builder()({...input,season:'2027/28',rows:[]});assert.equal(m.best.length,0);assert.equal(m.leads.length,0);assert.equal(m.active,null);
});
function dayRows(day){return roster.map((p,i)=>({participant_name:p.name,matchday:day,points:100-i-day,goals:i===1?2:0,clean_sheets:0,red_cards:0}));}
async function setup({reduced=false,init=false}={}){
  const dom=new JSDOM(read('index.html'),{url:'https://example.test/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,doc=w.document,frames=new Map();let next=0,requests=0;
  w.matchMedia=()=>({matches:reduced,addEventListener(){}});w.scrollTo=()=>{};
  w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLCanvasElement.prototype.getContext=()=>null;
  w.requestAnimationFrame=fn=>{frames.set(++next,fn);return next;};w.cancelAnimationFrame=id=>frames.delete(id);
  w.fetch=async url=>{assert.match(String(url),/^data\.json\?/);requests++;return {ok:true,json:async()=>plain(source)};};
  w.eval(read('matchday-general.js'));
  let builds=0;const build=w.CubanMatchdayGeneral.build;w.CubanMatchdayGeneral.build=(...args)=>{builds++;return build(...args);};
  w.eval(read('app.js').replace(/init\(\);\s*$/,`window.generalTest={
    set(rows,status='ready'){DATA=DATA||${JSON.stringify(source)};LIVE_MATCHDAY_ROWS=normalizeMatchdayRows(rows);PUBLISHED_MATCHDAYS=[...new Set(LIVE_MATCHDAY_ROWS.map(r=>r.matchday))].sort((a,b)=>a-b);LIVE_STATS_STATUS=status;LIVE_STATS_HAS_SYNCED=true;SELECTED_MATCHDAY=PUBLISHED_MATCHDAYS.at(-1)||null;},
    go,setMatchdayView,renderMatchdayGeneral,renderMatchdayCenter,cumulativeStandings,buildAchievementSnapshot,
    snapshot(){return JSON.stringify([DATA,LIVE_MATCHDAY_ROWS]);},model(){return MATCHDAY_GENERAL_CACHE?.model;}
  };`));
  if(init)await w.init();else w.generalTest.set([]);
  const advance=time=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(time));};
  return {dom,w,doc,api:w.generalTest,frames,advance,builds:()=>builds,requests:()=>requests};
}
test('lazy integration preserves official ranks/weekly award rules and caches the 38-round snapshot',async()=>{
  const t=await setup();try{
    const rows=Array.from({length:38},(_,i)=>dayRows(i+1)).flat();
    // A tie on points is resolved by the original goals comparator in cumulative standings.
    rows[1].points=rows[0].points;
    t.api.set(rows);const before=t.api.snapshot();t.api.renderMatchdayCenter();assert.equal(t.builds(),0);
    t.api.go('matchdays');assert.equal(t.builds(),1);const m=t.api.model();
    assert.deepEqual(plain(m.frames[0].table),plain(t.api.cumulativeStandings(1).map(({name,position,points})=>({name,position,points}))));
    const awards=t.api.buildAchievementSnapshot();
    for(const p of m.wins)assert.equal(Number(awards.players.get(p.name).get('matchday_king').progress.split(' ')[0]),p.wins);
    t.api.renderMatchdayGeneral();t.api.setMatchdayView('summary');t.api.setMatchdayView('general');assert.equal(t.builds(),1);
    assert.equal(t.api.snapshot(),before);assert.equal(t.requests(),0);
    assert.equal(t.doc.querySelectorAll('[data-mg-line]').length,20);assert.equal(m.frames.length,38);
  }finally{t.dom.window.close();}
});
test('play/pause, scrub, highlight, expand and leave retain DOM and cancel animation work',async()=>{
  const t=await setup();try{
    t.api.set([1,2,3].flatMap(dayRows));t.api.go('matchdays');const host=t.doc.getElementById('matchdayGeneralPanel');
    const paths=[...host.querySelectorAll('path')],button=host.querySelector('[data-mg-play]');
    button.click();assert.equal(button.textContent,'Ⅱ Pausar');assert.equal(t.frames.size,1);
    t.advance(0);t.advance(100);assert.equal(host.querySelector('[data-mg-day]').textContent,'Jornada 1');
    button.click();assert.equal(t.frames.size,0);
    const slider=host.querySelector('[data-mg-range]');slider.value='1';slider.dispatchEvent(new t.w.Event('input',{bubbles:true}));
    assert.equal(host.querySelector('[data-mg-day]').textContent,'Jornada 2');
    const picker=host.querySelector('[data-mg-person]');picker.value=roster[0].name;picker.dispatchEvent(new t.w.Event('change',{bubbles:true}));
    assert.match(host.querySelector('[data-mg-detail]').textContent,/puntos acumulados/);
    assert.equal(paths[0],host.querySelector('path'),'no path rebuild during playback/filter');
    host.querySelector('[data-mg-expand]').click();assert.equal(host.querySelector('svg').getAttribute('height'),'560');
    button.click();t.api.setMatchdayView('calendar');assert.equal(t.frames.size,0);assert.equal(host.hidden,true);
    t.api.setMatchdayView('general');button.click();t.api.go('home');assert.equal(t.frames.size,0);
  }finally{t.dom.window.close();}
});
test('snapshot refresh updates values even at the same day, handles stale/empty data, and retains user selection',async()=>{
  const t=await setup();try{
    const rows=dayRows(1);t.api.set(rows);t.api.go('matchdays');const host=t.doc.getElementById('matchdayGeneralPanel');
    const picker=host.querySelector('[data-mg-person]');picker.value=roster[0].name;picker.dispatchEvent(new t.w.Event('change',{bubbles:true}));
    rows[0].points=777;t.api.set(rows);t.api.renderMatchdayGeneral();assert.match(host.querySelector('[data-mg-detail]').textContent,/777/);
    assert.equal(host.querySelector('[data-mg-person]').value,roster[0].name);
    t.api.set(rows,'stale');t.api.renderMatchdayGeneral();assert.match(host.querySelector('[data-mg-status]').textContent,/Sin conexión/);
    t.api.set([],'loading');t.api.renderMatchdayGeneral();assert.match(host.textContent,/Consultando/);assert.equal(host.querySelector('svg'),null);
    t.api.set([],'error');t.api.renderMatchdayGeneral();assert.match(host.textContent,/No se pudieron/);
  }finally{t.dom.window.close();}
});
test('reduced motion keeps the static chart and keyboard-accessible three-tab navigation',async()=>{
  const t=await setup({reduced:true,init:true});try{
    t.api.set([1,2].flatMap(dayRows));t.api.go('matchdays');const requests=t.requests();
    assert.equal(t.doc.querySelector('[data-mg-play]').disabled,true);t.doc.querySelector('[data-mg-play]').click();assert.equal(t.frames.size,0);
    const general=t.doc.getElementById('matchdayGeneralTab');general.focus();general.dispatchEvent(new t.w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    assert.equal(t.doc.activeElement.id,'matchdaySummaryTab');assert.equal(t.doc.getElementById('matchdaySummaryPanel').hidden,false);
    t.doc.activeElement.dispatchEvent(new t.w.KeyboardEvent('keydown',{key:'End',bubbles:true}));assert.equal(t.doc.activeElement.id,'matchdayCalendarTab');
    t.doc.activeElement.dispatchEvent(new t.w.KeyboardEvent('keydown',{key:'Home',bubbles:true}));assert.equal(t.doc.activeElement.id,'matchdayGeneralTab');
    assert.equal(t.requests(),requests);
  }finally{t.dom.window.close();}
});
test('new UI escapes names, rejects unsafe photos, scopes styles and versions all offline resources',()=>{
  const dom=new JSDOM('<body data-section="matchdays"><div id="matchdayGeneralPanel"></div>',{runScripts:'outside-only',pretendToBeVisual:true});
  try{
    const w=dom.window;w.matchMedia=()=>({matches:true,addEventListener(){}});w.eval(read('matchday-general.js'));
    const name='<img src=x onerror=alert(1)>';const input={participants:[{name,photo:'javascript:alert(1)'}],rows:[{participantName:name,matchday:1,points:3}],standings:()=>[{name,position:1,points:3}],season:'2026/27'};
    w.CubanMatchdayGeneral.render(w.document.getElementById('matchdayGeneralPanel'),w.CubanMatchdayGeneral.build(input),'ready');
    assert.equal(w.document.querySelector('[onerror]'),null);assert.equal(w.document.querySelector('img'),null);assert.match(w.document.body.textContent,/<img/);
    const walk=rules=>{for(const r of rules){if(r.selectorText)assert.ok(r.selectorText.split(',').every(s=>s.trim().startsWith('#matchdayGeneralPanel')||s.trim().startsWith('#matchdays[data-matchday-mode=')||s.trim()==='#matchdays>.matchday-view-tabs button'),r.selectorText);if(r.cssRules)walk(r.cssRules);}};
    walk(CSSOM.parse(read('matchday-general.css')).cssRules);
    for(const file of ['matchday-general.js','matchday-general.css']){assert.ok(read('index.html').includes(file+'?v=198-20261104-matchday-general'));assert.ok(read('sw.js').includes(file+'?v=198-20261104-matchday-general'));}
  }finally{dom.window.close();}
});
