const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const core = require('../second-division-core.js');
const root = path.join(__dirname,'..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve,15));
const season = '2026/27';
const xi = () => Array.from({length:11},(_,i) => ({slot:i+1,id:String(1000+i),name:'Player '+i,
  position:i===10?'PT':i<3?'DL':i<7?'MC':'DF',points:i===0?3:1,status:'scored',captain:i===0,multiplier:i===0?3:1}));
const payload = (day=0) => ({version:1,league:{id:'978196'},kind:day?'matchday':'general',matchday:day,season,
  capturedAt:new Date().toISOString(),...(day?{gameweekId:4046,excludedManagerId:'999'}:{}),
  managers:[{id:'101',name:'Participant',points:day?13:100,rank:1,...(day?{negativeBalance:false,lineup:xi()}:{})},
    {id:'999',name:'Ernesto',points:0,rank:2}]});

test('General and matchday contracts preserve official points and exclude only the configured Second Division ID',()=>{
  for(const day of [0,5]) {
    const p=core.validate(payload(day),season);
    assert.equal(core.standings(p,'999').length,1);
    assert.equal(p.managers.length,2);
    assert.equal(p.managers[0].points,day?13:100);
    assert.equal(core.suggestedExclusion(p),'999');
  }
  const p=payload(5);p.managers[1].name='Admin renamed';
  assert.equal(core.suggestedExclusion(p),'');
  assert.equal(core.standings(core.validate(p,season),'999')[0].id,'101');
  assert.throws(()=>core.validate({...p,league:{id:'649733'}},season));
  assert.throws(()=>core.validate({...p,matchday:39},season));
  assert.throws(()=>core.validate({...p,season:'2025/26'},season));
  assert.throws(()=>core.validate({...p,excludedManagerId:'404'},season));
  p.managers[1].id='101';assert.throws(()=>core.validate(p,season));
});
test('XI validation handles captain fractions, pending, no-play and empty slots without inventing missing data',()=>{
  const p=payload(5);
  Object.assign(p.managers[0].lineup[0],{points:1.5,multiplier:1.5});
  Object.assign(p.managers[0].lineup[1],{points:0,status:'pending'});
  Object.assign(p.managers[0].lineup[2],{points:0,status:'did-not-play'});
  Object.assign(p.managers[0].lineup[3],{id:'',name:'Posición vacía',points:-4,status:'empty'});
  assert.equal(core.validate(p,season).managers[0].lineup[0].points,1.5);
  const broken=structuredClone(p);broken.managers[0].lineup.pop();assert.throws(()=>core.validate(broken,season));
  const duplicate=structuredClone(p);duplicate.managers[0].lineup[4].id=duplicate.managers[0].lineup[0].id;assert.throws(()=>core.validate(duplicate,season));
  const twice=structuredClone(p);Object.assign(twice.managers[0].lineup[4],{captain:true,multiplier:2});assert.throws(()=>core.validate(twice,season));
  const negative=payload(5);Object.assign(negative.managers[0],{points:0,negativeBalance:true,lineup:[]});
  assert.equal(core.validate(negative,season).managers[0].lineup.length,0);
  negative.managers[0].points=1;assert.throws(()=>core.validate(negative,season));
  assert.throws(()=>core.points(''));assert.equal(core.points('1.234'),1234);
});

function publicPage(fetcher) {
  const dom=new JSDOM(read('index.html'),{url:'https://example.test/',runScripts:'outside-only'});
  const w=dom.window;const calls=[];
  w.CUBAN_LEAGUE_SUPABASE={url:'https://project.supabase.co',publishableKey:'public',season};
  w.fetch=async url=>{const u=new URL(url);calls.push(u);return {ok:true,json:async()=>fetcher(u)};};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
  w.eval(read('second-division-core.js'));w.eval(read('second-division.js'));
  return {dom,w,calls,$:id=>w.document.getElementById(id)};
}
const snapshot=(day,revision=1,name='Participant')=>({matchday:day,revision,updated_at:new Date().toISOString(),
  standings:[{id:'101',name,rank:1,points:day?13:100}]});

test('public section is lazy, switches General/Jornada and downloads an XI only when its participant is opened',async()=>{
  const page=publicPage(u=>{
    if(u.pathname.endsWith('lineups')) return [{lineup:xi(),negative_balance:false,points:13}];
    if(u.searchParams.get('matchday')==='gt.0')return [{matchday:5},{matchday:3}];
    return [snapshot(Number(u.searchParams.get('matchday').slice(3)),1,'<img src=x onerror=alert(1)>')];
  });
  const {w,$,calls,dom}=page;
  try {
    assert.equal(calls.length,0);
    w.document.body.dataset.section='second-division';await tick();
    assert.equal(calls.length,1);assert.equal($('secondDivisionRows').querySelectorAll('img').length,0);
    assert.equal($('secondDivisionRows').querySelector('button'),null);
    $('secondByDay').click();await tick();
    assert.equal($('secondMatchday').value,'5');
    assert.equal(calls.some(u=>u.pathname.endsWith('lineups')),false);
    $('secondDivisionRows').querySelector('button').click();await tick();
    assert.equal($('secondLineupDialog').open,true);
    assert.equal($('secondLineupBody').querySelectorAll('.second-player').length,11);
    assert.match($('secondLineupBody').textContent,/Capitán ×3/);
    assert.equal(calls.at(-1).searchParams.get('revision'),'eq.1');
    const count=calls.length;$('secondLineupClose').click();$('secondDivisionRows').querySelector('button').click();await tick();
    assert.equal(calls.length,count);
    $('secondLineupClose').click();$('secondGeneral').click();await tick();
    assert.equal($('secondDivisionRows').querySelector('button'),null);assert.equal(calls.length,count);
    assert.ok(calls.every(u=>u.pathname.includes('/second_division_')));
  }finally{dom.window.close();}
});
test('late matchday replies cannot overwrite a newer selection; failed refresh retains verified points',async()=>{
  let finishSlow, fail=false;
  const page=publicPage(u=>{
    const day=u.searchParams.get('matchday');
    if(day==='gt.0')return [{matchday:5},{matchday:3}];
    if(fail)throw new Error('Offline');
    if(day==='eq.3')return new Promise(resolve=>finishSlow=resolve);
    return [snapshot(Number(day.slice(3)))];
  });
  const {w,$,dom}=page;
  try {
    w.document.body.dataset.section='second-division';await tick();$('secondByDay').click();await tick();
    $('secondMatchday').value='3';$('secondMatchday').dispatchEvent(new w.Event('change'));await tick();
    $('secondMatchday').value='5';$('secondMatchday').dispatchEvent(new w.Event('change'));await tick();
    finishSlow([snapshot(3,1,'Wrong old day')]);await tick();
    assert.doesNotMatch($('secondDivisionRows').textContent,/Wrong old day/);
    assert.match($('secondTableCaption').textContent,/5/);
    fail=true;$('secondDivisionRetry').click();await tick();
    assert.match($('secondDivisionRows').textContent,/13/);
    assert.match($('secondDivisionStatus').textContent,/conserva/);
  }finally{dom.window.close();}
});
test('empty calendar and unavailable XI show honest states; refreshing a changed revision replaces the cached XI',async()=>{
  let revision=1, empty=true;
  const page=publicPage(u=>{
    if(u.pathname.endsWith('lineups'))return revision===1?[]:[{lineup:xi(),negative_balance:false,points:13}];
    if(u.searchParams.get('matchday')==='gt.0')return empty?[]:[{matchday:5}];
    return [snapshot(Number(u.searchParams.get('matchday').slice(3)),revision)];
  });
  const {w,$,dom}=page;
  try {
    w.document.body.dataset.section='second-division';await tick();$('secondByDay').click();await tick();
    assert.match($('secondDivisionStatus').textContent,/no hay jornadas/);
    empty=false;$('secondDivisionRetry').click();await tick();
    $('secondDivisionRows').querySelector('button').click();await tick();
    assert.equal($('secondLineupRetry').hidden,false);assert.equal($('secondLineupBody').children.length,0);
    revision=2;$('secondLineupRetry').click();await tick();await tick();
    assert.equal($('secondLineupBody').querySelectorAll('.second-player').length,11);
  }finally{dom.window.close();}
});

test('Mister DOM to historical XI reads the chosen day, keeps no-play/captain and never opens statistics',async()=>{
  const source=read('tests/fixtures/mister-j5-yovany-lineup-20260917.html');
  const html='<a class="active" href="/action/change?id_community=978196">2da Cubanleague</a><button data-tab="gameweek" class="active">Jornada</button>'
    +'<a data-partial class="selected" href="/standings?gw=4046">J5</a>'
    +[{id:'101',name:'Fixture',points:74},{id:'999',name:'Ernesto',points:0}].map(m=>'<a class="btn btn-sw-link user" href="users/'+m.id+'/manager"><div class="info"><div class="name">'+m.name+'</div></div><div class="points">'+m.points+'<span> Pts</span></div></a>').join('');
  const dom=new JSDOM(html,{url:'https://mister.mundodeportivo.com/standings',runScripts:'outside-only'});
  const w=dom.window;Object.defineProperty(w.HTMLElement.prototype,'offsetWidth',{get(){return 10;}});
  let resolve, stats=0;const finished=new Promise(r=>resolve=r);
  w.chrome={runtime:{sendMessage:async ({type,input})=>{
    if(type==='SECOND_READY')return {ok:true,job:{id:'job',season,matchday:5,excludedManagerId:'999'}};
    if(type==='SECOND_RESULT')resolve({payload:input.payload});
    if(type==='SECOND_FAIL')resolve({error:input.error});
    return {ok:true};
  }}};
  w.document.addEventListener('click',event=>{
    if(event.target.closest('.lineup-player'))stats++;
    const link=event.target.closest('a.user');
    if(link){
      assert.match(link.getAttribute('href'),/101/);
      w.document.querySelector('.team-lineup')?.remove();
      const container=w.document.createElement('div');container.className='team-lineup';
      container.innerHTML=source.replaceAll('data-id_manager="7070670"','data-id_manager="101"');
      w.document.body.append(container);
    }
  });
  try {
    w.eval(read('mister-import-core.js'));w.eval(read('second-division-core.js'));w.eval(read('mister-extension/second-division-collector.js'));
    const timer=setTimeout(()=>resolve({error:'Fixture timeout'}),5000);
    const result=await finished;clearTimeout(timer);await tick();
    assert.equal(result.error,undefined);assert.equal(stats,0);
    const p=core.validate(JSON.parse(JSON.stringify(result.payload)),season);
    assert.equal(p.matchday,5);assert.equal(p.managers[0].lineup.length,11);
    assert.equal(p.managers[0].lineup.find(p=>p.id==='4764213').status,'did-not-play');
    assert.equal(p.managers[0].lineup.find(p=>p.captain).multiplier,3);
    assert.equal(p.managers[1].lineup,undefined);
  }finally{dom.window.close();}
});

test('admin publishes only reviewed Second Division data and passes the exact day, revision and stable exclusion',async()=>{
  const dom=new JSDOM(read('admin.html'),{url:'https://example.test/admin.html',runScripts:'outside-only'});
  const w=dom.window, calls=[], jobs=[];const $=id=>w.document.getElementById(id);
  const id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const client={rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='get_second_division_admin_state')return {data:{revision:2,excludedId:'999',snapshot:{standings:[{id:'101'}]},baselineStandings:[{id:'101'}]}};
    return {data:{},error:null};
  }};
  const extensionCall=async(type,input)=>{
    jobs.push({type,input});
    if(type==='HELLO')return {secondDivision:true};
    if(type==='SECOND_START')return {id};
    if(type==='SECOND_STATUS')return {job:{status:'ready',payload:payload(5)}};
    return {};
  };
  try {
    w.eval(read('second-division-core.js'));w.eval(read('second-division-admin.js'));
    w.CubanSecondAdmin.init({client,season,extensionCall,isBlocked:()=>false});
    $('secondImportScope').value='5';$('secondImportScope').dispatchEvent(new w.Event('change'));
    $('secondImport').click();await tick();await tick();
    assert.equal($('secondReview').hidden,false);assert.equal($('secondExcluded').value,'999');assert.equal($('secondExcluded').disabled,true);
    assert.equal(calls.some(c=>c.name==='publish_second_division'),false);
    assert.equal(jobs.find(c=>c.type==='SECOND_START').input.matchday,5);
    assert.doesNotMatch($('secondPreviewRows').textContent,/Ernesto/);
    $('secondPublish').click();await tick();
    const publish=calls.find(c=>c.name==='publish_second_division');
    assert.equal(publish.args.p_expected_revision,2);assert.equal(publish.args.p_payload.matchday,5);
    assert.equal(publish.args.p_excluded_manager_id,'999');assert.equal(publish.args.p_import_id,id);
    assert.ok(calls.every(c=>c.name.includes('second_division')));
    assert.ok(jobs.some(c=>c.type==='SECOND_CONSUME'));
  }finally{dom.window.close();}
});
