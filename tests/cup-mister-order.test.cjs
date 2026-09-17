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
    buildCupTournament,renderCup,select(day){SELECTED_CUP_MATCHDAY=day;CUP_SELECTION_MANUAL=true;}
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
