const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function freeze(value){Object.freeze(value);Object.values(value).forEach(v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v))freeze(v);});return value;}
function setup(){
  const dom=new JSDOM(read('index.html'),{url:'https://example.test',runScripts:'outside-only'});
  dom.window.fetch=()=>{throw Error('Formatting must not request or write data');};
  dom.window.eval(read('app.js').replace(/init\(\);\s*$/,`window.roundingTest={
    set(data){DATA=data;},buildLeagueStats,leagueStatsFormat,profileSeasonFormat,
    leagueStatsGlobalCaptainRanking,setLeagueCaptainView,setLeagueCaptainMode,setLeagueStatsSection,
    render(data){LEAGUE_STATS_STATE.data=data;LEAGUE_STATS_STATE.status='ready';setLeagueStatsSection('captains');}
  };`));
  const api=dom.window.roundingTest;
  api.set({currentSeason:'2026/27',participants:['Uno','Dos'].map((name,i)=>({id:i+1,name}))});
  return {dom,doc:dom.window.document,api};
}
function row(name,day,points,multiplier=1.5){
  return {participant_name:name,matchday:day,points:20+points,goals:0,clean_sheets:0,
    lineup:Array.from({length:11},(_,i)=>({slot_number:i+1,player_id:`p${i}`,player_name:`Jugador ${i}`,
      position:i===0?'PT':i<5?'DF':i<9?'MC':'DL',displayed_points:i===10?points:2,
      is_captain:i===10,captain_multiplier:i===10?multiplier:1}))};
}

test('statistics round once to nearest integer, retain negative signs, and distinguish missing values from zero',()=>{
  const {dom,api}=setup();
  try{
    for(const [value,expected] of [[12.499,'12'],[12.5,'13'],[12.67,'13'],[-12.5,'−13'],[-12.499,'−12'],[31.995,'32'],[0,'0'],[-0,'0'],[-.49,'0'],['12,5','13'],[12345.6,'12.346']]){
      assert.equal(api.leagueStatsFormat(value),expected,String(value));
    }
    assert.equal(api.leagueStatsFormat(.49,{signed:true}),'0');
    assert.equal(api.leagueStatsFormat(12.5,{signed:true}),'+13');
    for(const value of [null,undefined,'',true,NaN,Infinity,'bad'])assert.equal(api.leagueStatsFormat(value),'—');
    assert.equal(api.profileSeasonFormat(12.5),'12,5','profile precision stays unchanged');
  }finally{dom.window.close();}
});

test('all statistics views and comparator round only after summing published matchday values',()=>{
  const {dom,doc,api}=setup();
  try{
    const rows=freeze([row('Uno',1,7.5),row('Uno',2,7.5),row('Dos',1,-7.5),row('Dos',2,-7.5)]);
    const rawBefore=JSON.stringify(rows),data=freeze(api.buildLeagueStats(rows)),before=JSON.stringify(data);
    const captain=data.teams[0].captains[0];
    assert.equal(captain.captainPoints,15);
    assert.equal(captain.captainAverage,7.5);
    assert.equal(captain.captainBonus,5); // 2.5 + 2.5; never 3 + 3.
    api.render(data);
    for(const view of ['team','general']){
      api.setLeagueCaptainView(view);
      for(const mode of ['points','average','worst']){
        api.setLeagueCaptainMode(mode);
        const cards=[...doc.querySelectorAll('.league-stats-compact-card')];
        const one=cards.find(c=>c.querySelector('[data-profile-player="Uno"]'));
        assert.deepEqual([...one.querySelectorAll('.league-stats-metrics b')].map(n=>n.textContent),['15','2','8','+5']);
      }
    }
    api.setLeagueCaptainView('team');api.setLeagueCaptainMode('bonus');
    const bonusRows=[...doc.querySelectorAll('.league-captain-bonus-table tbody tr')];
    assert.deepEqual(bonusRows.map(r=>r.querySelector('.league-no-bonus-points').textContent),['+5','−5']);
    for(const section of ['lines','mvp','noBonus']){
      api.setLeagueStatsSection(section);
      assert.doesNotMatch(doc.getElementById('leagueStatsSectionPanel').textContent,/\d,\d/);
    }
    assert.doesNotMatch(doc.getElementById('leagueComparatorContent').textContent,/\d,\d/);
    assert.equal(JSON.stringify(rows),rawBefore);
    assert.equal(JSON.stringify(data),before);
  }finally{dom.window.close();}
});

test('equal displayed averages never create false ties or reorder the exact ranking',()=>{
  const {dom,doc,api}=setup();
  try{
    const data=freeze(api.buildLeagueStats([row('Uno',1,12),row('Uno',2,13),row('Dos',1,13),row('Dos',2,13)]));
    api.render(data);api.setLeagueCaptainView('general');api.setLeagueCaptainMode('average');
    const ranking=api.leagueStatsGlobalCaptainRanking(data,'average');
    assert.deepEqual(plain(ranking.map(({row:{team,player},rank})=>[team.name,player.captainAverage,rank])),[['Dos',13,1],['Uno',12.5,2]]);
    const cards=[...doc.querySelectorAll('.league-stats-global-card')];
    assert.deepEqual(cards.map(c=>c.querySelectorAll('.league-stats-metrics b')[2].textContent),['13','13']);
    assert.deepEqual(cards.map(c=>c.querySelector('.league-stats-rank').textContent),['1','2']);
    api.setLeagueCaptainMode('worst');
    assert.equal(doc.querySelector('.league-stats-global-card [data-profile-player]').dataset.profilePlayer,'Uno');
    assert.match(doc.getElementById('leagueStatsContent').textContent,/orden y los empates usan los valores exactos/);
  }finally{dom.window.close();}
});
