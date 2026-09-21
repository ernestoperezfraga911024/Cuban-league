const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const data=JSON.parse(read('data.json'));
const roster=data.participants.filter(p=>p.active!==false);
const j5=data.misterStandings.find(s=>s.matchday===5);
function setup({ranks=true,snapshot=true,pending=false}={}){
  const dom=new JSDOM(read('index.html'),{url:'https://example.test',runScripts:'outside-only'});
  dom.window.eval(read('app.js').replace('init();',`window.testCup={
    set(data,rows){DATA=data;LIVE_MATCHDAY_ROWS=normalizeMatchdayRows(rows);},
    buildCupTournament,renderCup,weeklyStandings,deriveChampionsStatsFromLeague,fetchPublishedStatsRows,
    select(day){SELECTED_CUP_MATCHDAY=day;CUP_SELECTION_MANUAL=true;}
  };`));
  const rows=[
    ...roster.map(p=>({participant_name:p.name,matchday:4,points:p.name==='Arian Mirandez Li'?18:100,goals:0,clean_sheets:0})),
    ...j5.rows.map((p,i)=>({participant_name:p.name,matchday:5,points:p.points,
      goals:p.name==='Victor Manuel'?99:0,clean_sheets:p.name==='Victor Manuel'?99:0,
      mister_rank:ranks?i+1:null,has_postponed_matches:pending}))
  ];
  const league=JSON.parse(JSON.stringify(data));if(!snapshot)delete league.misterStandings;
  const api=dom.window.testCup;
  api.set(league,rows);
  return{dom,api,rows,league};
}
test('J5: Victor (20.º) sale frente a Rivaldo (19.º), ambos 31; goles y CS no desempatan',()=>{
  const {dom,api}=setup();
  try{
    const result=api.buildCupTournament();
    assert.equal(result.rounds[0].eliminated.name,'Arian Mirandez Li');
    assert.equal(result.rounds[1].eliminated.name,'Victor Manuel');
    assert.equal(result.rounds[1].eliminated.misterRank,20);
    assert.ok(result.survivors.includes('Rivaldo'));
    assert.equal(result.rounds[1].rows.length,19);
    api.select(5);api.renderCup();
    assert.match(dom.window.document.getElementById('cupDanger').textContent,/Victor Manuel.*31 PTS.*20º en Mister/s);
    assert.doesNotMatch(dom.window.document.getElementById('cupRows').textContent,/Liga \d/);
  }finally{dom.window.close();}
});
test('a new imported order, not a hardcoded name or snapshot, decides the next tie',()=>{
  const {dom,api,rows,league}=setup();
  try{
    rows.find(r=>r.matchday===5&&r.participant_name==='Victor Manuel').mister_rank=19;
    rows.find(r=>r.matchday===5&&r.participant_name==='Rivaldo').mister_rank=20;
    api.set(league,rows);
    assert.equal(api.buildCupTournament().rounds[1].eliminated.name,'Rivaldo');
  }finally{dom.window.close();}
});
test('verified legacy J5 order works only for the complete matching scores',()=>{
  const {dom,api,rows,league}=setup({ranks:false});
  try{
    assert.equal(api.buildCupTournament().rounds[1].eliminated.name,'Victor Manuel');
    rows.find(r=>r.matchday===5&&r.participant_name==='Ernesto').points++;
    api.set(league,rows);
    assert.equal(api.buildCupTournament().rounds[1].eliminated,null);
  }finally{dom.window.close();}
});
for(const invalid of ['missing','duplicate','out-of-range'])test(invalid+' Mister order leaves the tie and later rounds pending',()=>{
  const {dom,api,rows,league}=setup({snapshot:false});
  try{
    rows.find(r=>r.matchday===5&&r.participant_name==='Victor Manuel').mister_rank=
      invalid==='missing'?null:invalid==='duplicate'?19:21;
    rows.push(...roster.map(p=>({participant_name:p.name,matchday:6,points:p.id,mister_rank:p.id})));
    api.set(league,rows);
    const result=api.buildCupTournament();
    assert.equal(result.rounds[1].eliminated,null);
    assert.equal(result.rounds[1].provisionalEliminated,null);
    assert.equal(result.rounds[1].missingMisterOrder,true);
    assert.equal(result.rounds[2].status,'blocked');
    api.select(5);api.renderCup();
    assert.match(dom.window.document.getElementById('cupDanger').textContent,/Falta el puesto de Mister/);
  }finally{dom.window.close();}
});
test('postponed games keep the correctly ordered loser provisional',()=>{
  const {dom,api}=setup({pending:true});
  try{
    const result=api.buildCupTournament().rounds[1];
    assert.equal(result.eliminated,null);
    assert.equal(result.provisionalEliminated.name,'Victor Manuel');
  }finally{dom.window.close();}
});
test('a unique lowest score needs no tiebreak; eliminated teams never re-enter',()=>{
  const {dom,api,rows,league}=setup({ranks:false,snapshot:false});
  try{
    rows.find(r=>r.matchday===5&&r.participant_name==='Rivaldo').points=30;
    rows.find(r=>r.matchday===5&&r.participant_name==='Arian Mirandez Li').points=-10;
    api.set(league,rows);
    assert.equal(api.buildCupTournament().rounds[1].eliminated.name,'Rivaldo');
  }finally{dom.window.close();}
});

function addNegativeRound(rows){
  rows.push(...roster.map(p=>({participant_name:p.name,matchday:6,
    points:p.name==='Maykel Zuaznabar'?0:50,goals:0,clean_sheets:0,
    negative_balance_no_score:p.name==='Maykel Zuaznabar',has_postponed_matches:true})));
  rows.push(...roster.map(p=>({participant_name:p.name,matchday:7,
    points:p.name==='ANDOBA THE BEST'?22:50,has_postponed_matches:false})));
}
test('J6 negative balance confirms Maykel despite postponement and unlocks J7 ANDOBA',()=>{
  const {dom,api,rows,league}=setup();
  try{
    addNegativeRound(rows);api.set(league,rows);
    const result=api.buildCupTournament();
    assert.equal(result.rounds[2].status,'confirmed');
    assert.equal(result.rounds[2].incomplete,true);
    assert.equal(result.rounds[2].eliminated.name,'Maykel Zuaznabar');
    assert.equal(result.rounds[3].status,'confirmed');
    assert.equal(result.rounds[3].eliminated.name,'ANDOBA THE BEST');
    assert.equal(result.survivors.length,16);
    assert.ok(!result.rounds[3].entrants.includes('Maykel Zuaznabar'));
    assert.equal(api.weeklyStandings(7).find(p=>p.name==='Maykel Zuaznabar').points,50);
    assert.ok(api.deriveChampionsStatsFromLeague().rows.filter(r=>r.leagueMatchday===6).every(r=>r.hasPostponedMatches));
    assert.ok(rows.filter(r=>r.matchday===6).every(r=>r.has_postponed_matches));
    api.select(6);api.renderCup();
    const doc=dom.window.document;
    assert.match(doc.getElementById('cupDanger').textContent,/Maykel Zuaznabar.*0 PTS.*Saldo negativo/s);
    assert.match(doc.getElementById('cupRoundState').textContent,/Eliminación confirmada.*aplazados/);
    assert.equal(doc.getElementById('cupEliminatedCount').textContent,'4');
    assert.match(doc.getElementById('cupHistory').textContent,/ANDOBA THE BEST.*22 PTS.*Maykel Zuaznabar.*Saldo negativo/s);
    api.select(7);api.renderCup();
    assert.match(doc.getElementById('cupDanger').textContent,/ELIMINADO EN J7.*ANDOBA THE BEST/s);
  }finally{dom.window.close();}
});
test('zero alone is not negative balance; corrections recalculate downstream eliminations',()=>{
  const {dom,api,rows,league}=setup();
  try{
    addNegativeRound(rows);api.set(league,rows);
    assert.equal(api.buildCupTournament().rounds[2].status,'confirmed');
    rows.find(r=>r.matchday===6&&r.participant_name==='Maykel Zuaznabar').negative_balance_no_score=false;
    api.set(league,rows);
    let result=api.buildCupTournament();
    assert.equal(result.rounds[2].status,'provisional');
    assert.equal(result.rounds[3].status,'provisional');
    assert.ok(result.survivors.includes('Maykel Zuaznabar'));
    assert.ok(result.survivors.includes('ANDOBA THE BEST'));
    rows.filter(r=>r.matchday===6).forEach(r=>r.has_postponed_matches=false);
    api.set(league,rows);
    result=api.buildCupTournament();
    assert.equal(result.rounds[2].eliminated.name,'Maykel Zuaznabar');
    assert.equal(result.rounds[3].eliminated.name,'ANDOBA THE BEST');
    api.set(league,rows.filter(r=>r.matchday!==6));
    assert.equal(api.buildCupTournament().rounds[3].status,'blocked');
  }finally{dom.window.close();}
});
test('disqualification takes priority over a lower points score and needs no Mister order',()=>{
  const {dom,api,rows,league}=setup();
  try{
    addNegativeRound(rows);
    rows.find(r=>r.matchday===6&&r.participant_name==='Ernesto').points=-4;
    rows.find(r=>r.matchday===6&&r.participant_name==='Brian').points=0;
    api.set(league,rows);
    const result=api.buildCupTournament();
    assert.equal(result.rounds[2].eliminated.name,'Maykel Zuaznabar');
    assert.equal(result.rounds[2].status,'confirmed');
    assert.ok(result.survivors.includes('Ernesto'));
    assert.ok(result.survivors.includes('Brian'));
  }finally{dom.window.close();}
});
test('all negative survivors leave together without eliminating another team by points',()=>{
  const {dom,api,rows,league}=setup();
  try{
    addNegativeRound(rows);
    Object.assign(rows.find(r=>r.matchday===6&&r.participant_name==='Brian'),{points:0,negative_balance_no_score:true});
    api.set(league,rows);
    const result=api.buildCupTournament();
    assert.deepEqual(Array.from(result.rounds[2].eliminatedTeams,t=>t.name).sort(),['Brian','Maykel Zuaznabar']);
    assert.equal(result.rounds[3].rows.length,16);
    assert.equal(result.survivors.length,15);
    api.select(6);api.renderCup();
    assert.equal(dom.window.document.querySelectorAll('#cupDanger .is-eliminated').length,2);
    assert.equal(dom.window.document.querySelectorAll('#cupRows .is-eliminated').length,2);
    assert.equal(dom.window.document.getElementById('cupEliminatedCount').textContent,'5');
  }finally{dom.window.close();}
});
test('negative flags on teams already eliminated do not resolve an unfinished round',()=>{
  const {dom,api,rows,league}=setup();
  try{
    addNegativeRound(rows);
    rows.find(r=>r.matchday===6&&r.participant_name==='Maykel Zuaznabar').negative_balance_no_score=false;
    Object.assign(rows.find(r=>r.matchday===6&&r.participant_name==='Victor Manuel'),{points:0,negative_balance_no_score:true});
    api.set(league,rows);
    assert.equal(api.buildCupTournament().rounds[2].status,'provisional');
  }finally{dom.window.close();}
});
for(const blocker of ['earlier-postponed','missing-participant'])test('negative balance does not bypass '+blocker,()=>{
  const {dom,api,rows,league}=setup({pending:blocker==='earlier-postponed'});
  try{
    addNegativeRound(rows);
    api.set(league,blocker==='missing-participant'?rows.filter(r=>!(r.matchday===6&&r.participant_name==='Ernesto')):rows);
    const result=api.buildCupTournament();
    assert.equal(result.rounds[2].eliminated,null);
    assert.equal(result.rounds[2].status,blocker==='missing-participant'?'invalid':'provisional');
    assert.ok(result.survivors.includes('Maykel Zuaznabar'));
  }finally{dom.window.close();}
});
for(const surviving of [0,1])test('multiple disqualifications finish safely with '+surviving+' survivors',()=>{
  const {dom,api,rows,league}=setup();
  try{
    addNegativeRound(rows);
    rows.filter(r=>r.matchday===6).forEach(r=>{
      r.negative_balance_no_score=!(surviving&&r.participant_name==='Ernesto');
      r.points=r.negative_balance_no_score?0:50;
    });
    api.set(league,rows);
    const result=api.buildCupTournament();
    assert.equal(result.survivors.length,surviving);
    assert.equal(result.finished,true);
    assert.equal(result.champion?.name||null,surviving?'Ernesto':null);
    assert.equal(result.finalMatchday,6);
    api.select(6);api.renderCup();
    assert.equal(dom.window.document.getElementById('cupEliminatedCount').textContent,String(20-surviving));
  }finally{dom.window.close();}
});
test('published stats request includes the explicit negative-balance flag',async()=>{
  const {dom,api}=setup();
  try{
    dom.window.CUBAN_LEAGUE_SUPABASE={url:'https://example.test',publishableKey:'public-test-key'};
    dom.window.fetch=async url=>{
      assert.ok(new URL(url).searchParams.get('select').split(',').includes('negative_balance_no_score'));
      return {ok:true,json:async()=>[]};
    };
    await api.fetchPublishedStatsRows('2026/27');
  }finally{dom.window.close();}
});
