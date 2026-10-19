const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const source=JSON.parse(read('data.json'));
const roster=source.participants.filter(p=>p.active!==false);
const plain=value=>JSON.parse(JSON.stringify(value));
function freeze(value){Object.freeze(value);Object.values(value).forEach(v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v))freeze(v);});return value;}
function rowsFor(day,{pending=false,negative=null}={}){
  return roster.map((p,index)=>({participant_name:p.name,matchday:day,points:100-index-day,
    goals:0,clean_sheets:0,red_cards:0,mister_rank:index+1,has_postponed_matches:pending,
    negative_balance_no_score:p.name===negative,updated_at:'2026-10-19T00:00:00Z'}));
}
async function setup({init=false}={}){
  const dom=new JSDOM(read('index.html'),{url:'https://example.test/Cuban-league/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,doc=w.document;
  w.scrollTo=()=>{};w.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
  w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLCanvasElement.prototype.getContext=()=>null;
  let requests=0;
  w.fetch=async(url,options={})=>{assert.match(String(url),/^data\.json\?/);assert.equal(options.method||'GET','GET');requests++;return {ok:true,json:async()=>JSON.parse(read('data.json'))};};
  w.eval(read('app.js').replace(/init\(\);\s*$/,`window.calendarTest={
    set(rows,{known=true,status='ready',data}={}){if(data)DATA=data;LIVE_MATCHDAY_ROWS=normalizeMatchdayRows(rows);LIVE_STATS_HAS_SYNCED=known;LIVE_STATS_STATUS=status;PUBLISHED_MATCHDAYS=[...new Set(LIVE_MATCHDAY_ROWS.map(r=>r.matchday))].sort((a,b)=>a-b);SELECTED_MATCHDAY=PUBLISHED_MATCHDAYS.at(-1)||null;syncChampionsStats({render:false});},
    data(){return DATA;},rows(){return LIVE_MATCHDAY_ROWS;},build:buildCompetitionCalendar,
    setMatchdayView,setCompetitionCalendarPage,renderCompetitionCalendar,renderMatchdayCenter,
    openCompetitionCalendarEntry,returnToCompetitionCalendar,buildCupTournament,go,
    state(){return {view:COMPETITION_CALENDAR_STATE.view,start:COMPETITION_CALENDAR_STATE.start,selected:SELECTED_MATCHDAY,cup:SELECTED_CUP_MATCHDAY};}
  };`));
  if(init)await w.init();
  else w.calendarTest.set([],{data:JSON.parse(read('data.json'))});
  return {dom,w,doc,api:w.calendarTest,requests:()=>requests};
}
const event=(model,day,kind)=>model.days[day-1].events.find(e=>e.kind===kind);

test('calendar follows the actual J7 mapping, Copa bounds and all five knockout dates without changing source data',async()=>{
  const {dom,api}=await setup();
  try{
    const data=freeze(JSON.parse(read('data.json'))),rows=freeze([...rowsFor(3),...rowsFor(4),...rowsFor(7),...rowsFor(8,{pending:true})]);
    api.set(rows,{data});freeze(api.rows());const before=JSON.stringify(data),rowsBefore=JSON.stringify(rows);
    const model=api.build();assert.equal(model.days.length,38);assert.equal(model.latest,8);
    assert.equal(event(model,6,'champions').enabled,false);
    assert.equal(event(model,7,'champions').title,'Grupos · Champions J2');
    assert.equal(event(model,9,'champions').title,'Grupos · Champions J3');
    assert.deepEqual([27,28,32,33,37].map(day=>event(model,day,'champions').title),['Cuartos · Ida','Cuartos · Vuelta','Semifinales · Ida','Semifinales · Vuelta','La final · Todo o nada']);
    assert.equal(event(model,3,'cup').enabled,false);assert.equal(event(model,4,'cup').enabled,true);
    assert.equal(event(model,22,'cup').title,'Final prevista');assert.equal(event(model,23,'cup').enabled,false);
    assert.equal(event(model,8,'league').detail,'Provisional · Aplazados');assert.equal(event(model,9,'league').enabled,false);
    assert.equal(api.build(),model,'reuse the current snapshot when paging');
    assert.equal(JSON.stringify(data),before);assert.equal(JSON.stringify(rows),rowsBefore);
  }finally{dom.window.close();}
});

test('publication, partial data, postponed matches and Copa disqualification keep independent truthful states',async()=>{
  const {dom,api}=await setup();
  try{
    const rows=[...rowsFor(4),...rowsFor(5),...rowsFor(6,{pending:true,negative:'Maykel Zuaznabar'}),...rowsFor(7),...rowsFor(8).slice(0,3)];
    api.set(rows);const model=api.build();
    assert.equal(event(model,6,'league').detail,'Provisional · Aplazados');
    assert.equal(event(model,6,'cup').detail,'Eliminación confirmada');
    assert.equal(event(model,7,'champions').detail,'Resultados publicados');
    assert.match(event(model,8,'league').detail,/Datos parciales · 3\/20/);
    assert.equal(event(model,8,'cup').detail,'Datos incompletos');
    api.set(rows.filter(r=>r.matchday!==5));
    assert.equal(event(api.build(),6,'cup').detail,'En espera de J5');
    api.set(rows.map(r=>r.matchday===6?{...r,negative_balance_no_score:false}:r));
    assert.equal(event(api.build(),6,'cup').detail,'Provisional · Aplazados');
    assert.notEqual(api.build(),model);
  }finally{dom.window.close();}
});

test('an early official Copa finish removes future round links instead of navigating to a different round',async()=>{
  const {dom,api}=await setup();
  try{
    const rows=rowsFor(4).map((row,index)=>({...row,negative_balance_no_score:index!==0,points:index===0?100:0}));
    api.set(rows);assert.equal(api.buildCupTournament().finished,true);
    const model=api.build();assert.equal(event(model,4,'cup').title,'Ronda final');
    assert.equal(event(model,5,'cup').title,'Copa finalizada');assert.equal(event(model,5,'cup').enabled,false);
    api.openCompetitionCalendarEntry('cup',5);assert.equal(api.state().cup,null);
  }finally{dom.window.close();}
});

test('loading/errors do not imply future or completed rounds; corrected schedules replace cached mappings',async()=>{
  const {dom,api,doc}=await setup();
  try{
    api.set([],{known:false,status:'loading'});api.setMatchdayView('calendar');
    assert.match(doc.getElementById('competitionCalendarContent').textContent,/Consultando resultados publicados/);
    assert.doesNotMatch(doc.getElementById('competitionCalendarContent').textContent,/Próxima por publicar|Resultados publicados/);
    api.set([],{known:false,status:'error'});api.renderCompetitionCalendar();
    assert.match(doc.getElementById('competitionCalendarContent').textContent,/Resultados no disponibles/);
    api.set(rowsFor(7),{status:'stale'});api.renderCompetitionCalendar();
    assert.match(doc.getElementById('competitionCalendarContent').textContent,/se conservan los últimos resultados/);
    const next=JSON.parse(read('data.json'));next.champions.format.leagueMatchdays[1]=6;
    api.set(rowsFor(7),{data:next});assert.equal(event(api.build(),6,'champions').title,'Grupos · Champions J2');
    assert.equal(event(api.build(),7,'champions').enabled,false);
    doc.querySelector('.champions-calendar-phase.is-quarter strong').textContent='Liga J26';
    assert.equal(event(api.build(),26,'champions').title,'Cuartos · Ida');assert.equal(event(api.build(),27,'champions').enabled,false);
    next.champions.format.leagueMatchdays=[3,3];
    assert.equal(event(api.build(),9,'champions').title,'Calendario por confirmar');
  }finally{dom.window.close();}
});

test('real tabs, six-day paging and links open the exact competition and return to the chosen day without requests',async()=>{
  const {dom,w,doc,api,requests}=await setup({init:true});
  const frame=()=>new Promise(resolve=>w.requestAnimationFrame(resolve));
  try{
    api.set([...rowsFor(4),...rowsFor(5),...rowsFor(6,{pending:true,negative:'Maykel Zuaznabar'}),...rowsFor(7),...rowsFor(8,{pending:true})]);
    api.renderMatchdayCenter();api.go('matchdays');const count=requests(),before=JSON.stringify(api.data());
    const summary=doc.getElementById('matchdaySummaryTab');summary.focus();summary.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    assert.equal(doc.activeElement.id,'matchdayCalendarTab');assert.equal(doc.getElementById('matchdaySummaryPanel').hidden,true);
    assert.equal(doc.querySelectorAll('.competition-calendar-day').length,6);assert.equal(doc.querySelector('.competition-calendar-day').id,'competitionCalendarDay7');
    const first=doc.querySelector('.competition-calendar-day');api.renderCompetitionCalendar();assert.equal(doc.querySelector('.competition-calendar-day'),first,'unchanged render keeps DOM');
    doc.querySelector('[data-calendar-day="8"][data-calendar-competition="league"]').click();await frame();
    assert.equal(doc.getElementById('matchdayTitle').textContent,'Jornada 8');assert.equal(doc.getElementById('publicMatchdaySelect').value,'8');
    assert.equal(doc.activeElement.id,'matchdayCalendarReturn');
    doc.querySelector('#matchdayCalendarReturn button').click();await frame();assert.equal(doc.activeElement.id,'competitionCalendarDay8');
    doc.querySelector('[data-calendar-day="7"][data-calendar-competition="cup"]').click();await frame();
    assert.equal(doc.body.dataset.section,'cup');assert.equal(doc.getElementById('cupRoundTitle').textContent,'Jornada 7');assert.equal(api.state().cup,7);
    doc.querySelector('#cupCalendarReturn button').click();await frame();assert.equal(doc.activeElement.id,'competitionCalendarDay7');
    doc.querySelector('[data-calendar-day="9"][data-calendar-competition="champions"]').click();await frame();
    assert.equal(doc.body.dataset.section,'champions');assert.equal(doc.getElementById('championsCalendarToggle').getAttribute('aria-expanded'),'true');
    assert.equal(doc.querySelector('.champions-calendar-dates li.is-calendar-day strong').textContent,'Liga J9');
    assert.equal(doc.querySelectorAll('.champions-day-head.is-calendar-day').length,4);
    assert.equal(doc.querySelectorAll('.champions-points-cell.is-calendar-day').length,20);
    doc.querySelector('#championsCalendarReturn button').click();await frame();assert.equal(doc.activeElement.id,'competitionCalendarDay9');
    doc.querySelector('[data-calendar-page="13"]').click();assert.equal(doc.querySelector('.competition-calendar-day').id,'competitionCalendarDay13');
    const select=doc.getElementById('competitionCalendarRange');select.value='37';select.dispatchEvent(new w.Event('change',{bubbles:true}));
    assert.equal(doc.querySelectorAll('.competition-calendar-day').length,2);assert.equal(doc.querySelector('[data-calendar-page="43"]').disabled,true);
    doc.querySelector('[data-calendar-current]').click();assert.equal(doc.querySelector('.competition-calendar-day').id,'competitionCalendarDay7');
    assert.equal(requests(),count);assert.equal(JSON.stringify(api.data()),before);
  }finally{dom.window.close();}
});
