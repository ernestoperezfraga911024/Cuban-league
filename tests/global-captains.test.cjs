const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const roster=['Uno','Dos','Tres'].map((name,i)=>({id:i+1,name}));
const plain=value=>JSON.parse(JSON.stringify(value));
function freeze(value){Object.freeze(value);Object.values(value).forEach(v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v))freeze(v);});return value;}
function setup(){
  const dom=new JSDOM(read('index.html'),{url:'https://example.test/Cuban-league/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;
  w.eval(read('app.js').replace(/init\(\);\s*$/,`window.captainTest={
    set(data){DATA=data;},buildLeagueStats,leagueStatsGlobalCaptainRanking,
    setLeagueCaptainView,setLeagueCaptainMode,toggleLeagueCaptainExpanded,setLeagueStatsSection,
    render(data){LEAGUE_STATS_STATE.data=data;LEAGUE_STATS_STATE.status='ready';setLeagueStatsSection('captains');}
  };`));
  w.captainTest.set({currentSeason:'2026/27',participants:roster});
  return {dom,w,doc:w.document,api:w.captainTest};
}
function row(name,day,id,points,{captain=true,pending=false,time='2026-10-01T00:00:00Z'}={}){
  return {participant_name:name,matchday:day,points:points+20,goals:0,clean_sheets:0,
    has_postponed_matches:pending,updated_at:time,
    lineup:Array.from({length:11},(_,i)=>({slot_number:i+1,player_id:i===10?id:`filler${i}`,
      player_name:i===10?`Jugador ${id}`:`Relleno ${i}`,position:i===0?'PT':i<5?'DF':i<9?'MC':'DL',
      displayed_points:i===10?points:2,is_captain:i===10&&captain,captain_multiplier:i===10&&captain?3:1}))};
}
const cards=doc=>[...doc.querySelectorAll('.league-stats-global-card')];
const metrics=card=>[...card.querySelectorAll('.league-stats-metrics b')].map(n=>n.textContent);

test('global ranking includes multiple captains per participant and separates transfers using captain-only totals',()=>{
  const {dom,api,doc}=setup();
  try{
    const rows=freeze([row('Uno',1,'a',30),row('Uno',2,'a',24),row('Uno',3,'b',45),
      row('Uno',4,'a',80,{captain:false}),row('Uno',5,'c',12),row('Dos',1,'a',90)]);
    const rawBefore=JSON.stringify(rows),data=freeze(api.buildLeagueStats(rows)),before=JSON.stringify(data);
    const ranking=api.leagueStatsGlobalCaptainRanking(data,'points');
    assert.deepEqual(plain(ranking.map(({row:{team,player}})=>[team.name,player.playerId,player.captainPoints,player.captainUses])),
      [['Dos','a',90,1],['Uno','a',54,2],['Uno','b',45,1],['Uno','c',12,1]]);
    api.render(data);api.setLeagueCaptainView('general');
    assert.equal(cards(doc).length,4);
    assert.deepEqual(metrics(cards(doc)[1]),['54','2','27','+36']);
    assert.equal(cards(doc)[1].querySelector('[data-profile-player]').dataset.profilePlayer,'Uno');
    assert.match(doc.getElementById('leagueStatsSectionPanel').textContent,/bono estimado/i);
    assert.equal(api.leagueStatsGlobalCaptainRanking(data,'points'),ranking);
    assert.equal(JSON.stringify(rows),rawBefore);assert.equal(JSON.stringify(data),before);
  }finally{dom.window.close();}
});

test('best/worst averages rank signed values correctly, share ties, and show sample sizes',()=>{
  const {dom,api,doc}=setup();
  try{
    const data=api.buildLeagueStats([row('Uno',1,'a',30),row('Uno',2,'a',0),row('Uno',3,'b',24),
      row('Dos',1,'c',-6),row('Dos',2,'d',-6),row('Tres',1,'e',0)]);
    api.render(data);api.setLeagueCaptainView('general');
    assert.match(cards(doc)[0].textContent,/Jugador a/);
    api.setLeagueCaptainMode('average');assert.match(cards(doc)[0].textContent,/Jugador b/);
    api.setLeagueCaptainMode('worst');
    assert.deepEqual(cards(doc).map(c=>c.querySelector('.league-stats-rank').textContent),['1','1','3','4','5']);
    assert.deepEqual(cards(doc).map(c=>metrics(c)[2]),['−6','−6','0','15','24']);
    assert.deepEqual(metrics(cards(doc)[3]).slice(0,3),['30','2','15']);
    assert.ok(cards(doc)[0].querySelector('.is-negative'));
  }finally{dom.window.close();}
});

test('first 20 positions retain cutoff ties; expanding, collapsing and changing order keep full data',()=>{
  const {dom,api,doc}=setup();
  try{
    const rows=Array.from({length:24},(_,i)=>row('Uno',i+1,`c${i}`,i===20?43:100-i*3));
    // 19 higher scores, then two captains tied at rank 20 (43 points).
    api.render(api.buildLeagueStats(rows));api.setLeagueCaptainView('general');
    assert.equal(cards(doc).length,21);
    assert.equal(cards(doc)[20].querySelector('.league-stats-rank').textContent,'20');
    api.toggleLeagueCaptainExpanded();assert.equal(cards(doc).length,24);
    assert.equal(doc.activeElement.getAttribute('aria-expanded'),'true');
    api.toggleLeagueCaptainExpanded();assert.equal(cards(doc).length,21);
    assert.equal(doc.activeElement.getAttribute('aria-expanded'),'false');
    api.toggleLeagueCaptainExpanded();api.setLeagueCaptainMode('worst');
    assert.equal(cards(doc).length,20);
    assert.equal(doc.querySelector('[data-league-captain-expand]').getAttribute('aria-expanded'),'false');
  }finally{dom.window.close();}
});

test('a corrected published snapshot replaces scores and invalidates only its derived ranking',()=>{
  const {dom,api,doc}=setup();
  try{
    const original=row('Uno',1,'a',30,{pending:true});
    const before=api.buildLeagueStats([original]);
    api.render(before);api.setLeagueCaptainView('general');
    assert.match(doc.getElementById('leagueStatsSectionPanel').textContent,/Provisional.*J1/);
    const corrected=api.buildLeagueStats([original,row('Uno',1,'a',60,{time:'2026-10-02T00:00:00Z'})]);
    api.render(corrected);
    assert.deepEqual(metrics(cards(doc)[0]),['60','1','60','+40']);
    assert.doesNotMatch(doc.getElementById('leagueStatsSectionPanel').textContent,/Provisional/);
    assert.equal(api.leagueStatsGlobalCaptainRanking(before,'points')[0].row.player.captainPoints,30);
  }finally{dom.window.close();}
});

test('empty and incomplete lineups do not invent global captain records',()=>{
  const {dom,api,doc}=setup();
  try{
    const incomplete=row('Uno',1,'a',90);incomplete.lineup.pop();
    for(const rows of [[],[incomplete],[row('Dos',1,'b',0,{captain:false})]]){
      api.render(api.buildLeagueStats(rows));api.setLeagueCaptainView('general');
      assert.equal(cards(doc).length,0);
      assert.match(doc.getElementById('leagueStatsSectionPanel').textContent,/Todavía no hay capitanes registrados/);
      assert.equal(doc.querySelector('[data-league-captain-expand]'),null);
    }
  }finally{dom.window.close();}
});

test('real controls preserve participant bonus view, focus, profile links and data without extra requests',async()=>{
  const {dom,w,api,doc}=setup();
  try{
    w.scrollTo=()=>{};w.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
    w.HTMLCanvasElement.prototype.getContext=()=>null;
    let requests=0;
    w.fetch=async(url,options={})=>{assert.match(String(url),/^data\.json\?/);assert.equal(options.method||'GET','GET');requests++;return {ok:true,json:async()=>JSON.parse(read('data.json'))};};
    await w.init();
    const data=freeze(api.buildLeagueStats(Array.from({length:24},(_,i)=>row('Ernesto',i+1,`c${i}`,100-i*3))));
    const before=JSON.stringify(data);api.render(data);const initialRequests=requests;
    doc.querySelector('[data-league-captain-mode="bonus"]').click();
    const bonusMarkup=doc.querySelector('.league-captain-bonus-table').outerHTML;
    doc.querySelector('[data-league-captain-view="general"]').click();
    assert.equal(doc.activeElement.dataset.leagueCaptainView,'general');
    assert.equal(doc.querySelector('[data-league-captain-mode][aria-pressed="true"]').dataset.leagueCaptainMode,'points');
    assert.equal(cards(doc).length,20);
    doc.querySelector('[data-league-captain-expand]').click();assert.equal(cards(doc).length,24);
    for(const mode of ['average','worst','points']){
      doc.querySelector(`[data-league-captain-mode="${mode}"]`).click();
      assert.equal(doc.activeElement.dataset.leagueCaptainMode,mode);
      assert.equal(cards(doc).length,20);
    }
    doc.querySelector('[data-league-captain-view="team"]').click();
    assert.equal(doc.querySelector('.league-captain-bonus-table').outerHTML,bonusMarkup);
    doc.querySelector('[data-league-captain-view="general"]').click();
    cards(doc)[0].querySelector('[data-profile-player]').click();
    assert.equal(doc.getElementById('playerModal').hidden,false);
    assert.equal(doc.getElementById('profileTitle').textContent,'Ernesto');
    assert.equal(requests,initialRequests);assert.equal(JSON.stringify(data),before);
  }finally{dom.window.close();}
});
