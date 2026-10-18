const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const roster=[{id:1,name:'Uno'},{id:2,name:'Dos'},{id:3,name:'Tres'}];
function setup(participants=roster){
  const dom=new JSDOM(read('index.html'),{url:'https://example.test',runScripts:'outside-only'});
  dom.window.eval(read('app.js').replace('init();',`window.testNoBonus={
    set(data){DATA=data;},buildLeagueStats,leagueNoBonusCaptainAdjustment,
    fetchPublishedLeagueStatsRows,setLeagueStatsSection,setLeagueCaptainMode,
    render(data){LEAGUE_STATS_STATE.data=data;LEAGUE_STATS_STATE.status='ready';setLeagueStatsSection('noBonus');}
  };`));
  const api=dom.window.testNoBonus;
  api.set({currentSeason:'2026/27',participants});
  return {dom,api};
}
function row(name,{day=1,points=50,captain=24,multiplier=3,negative=false,pending=false}={}){
  return {participant_name:name,matchday:day,points,goals:0,clean_sheets:0,
    negative_balance_no_score:negative,has_postponed_matches:pending,
    lineup:Array.from({length:11},(_,i)=>({slot_number:i+1,player_id:`p${i}`,player_name:`Jugador ${i}`,
      position:i===0?'PT':i<5?'DF':i<9?'MC':'DL',displayed_points:i===10&&captain!==null?captain:2,
      is_captain:i===10&&captain!==null,captain_multiplier:i===10&&captain!==null?multiplier:1}))};
}
function freeze(value){Object.freeze(value);Object.values(value).forEach(item=>{if(item&&typeof item==='object'&&!Object.isFrozen(item))freeze(item);});return value;}
const plain=value=>JSON.parse(JSON.stringify(value));

test('only the extra is removed; x3 retains base points and official data is immutable',()=>{
  const {dom,api}=setup();
  try{
    const rows=freeze([row('Uno'),row('Dos',{captain:16,multiplier:2}),row('Tres',{captain:null})]);
    const before=JSON.stringify(rows);
    const data=api.buildLeagueStats(rows);
    const lookup=new Map(data.noBonus.teams.map(t=>[t.name,t]));
    assert.equal(lookup.get('Uno').points,34); // 50 - (24 - 8), not 50 - 24.
    assert.equal(lookup.get('Dos').points,42);
    assert.equal(lookup.get('Tres').points,50);
    assert.equal(lookup.get('Tres').movement,2);
    assert.equal(lookup.get('Uno').movement,-2);
    assert.ok(data.teams.every(t=>t.officialPoints===50));
    assert.equal(data.teams[0].players.find(p=>p.captainUses).captainPoints,24);
    assert.equal(JSON.stringify(rows),before);
  }finally{dom.window.close();}
});
test('x1.5 reverses Mister rounding and old precision residues without losing the base',()=>{
  const {dom,api}=setup();
  try{
    for(const [final,base] of [[8,5],[5,3],[14,9],[32,21],[31.995,21],[7.995,5],[4.995,3],[10.995,7],[2,1],[0,0]]){
      assert.equal(api.leagueNoBonusCaptainAdjustment({displayed_points:final,captain_multiplier:1.5}),Math.round(final)-base);
    }
    assert.equal(api.leagueNoBonusCaptainAdjustment({displayed_points:7.5,captain_multiplier:1.5}),2.5);
    assert.equal(api.leagueNoBonusCaptainAdjustment({displayed_points:7,captain_multiplier:1.5}),null);
  }finally{dom.window.close();}
});
test('negative captain points recover only the extra penalty; no captain and zero keep totals',()=>{
  const {dom,api}=setup();
  try{
    const rows=[row('Uno',{points:18,captain:-6}),row('Dos',{captain:null}),row('Tres',{captain:0})];
    const table=api.buildLeagueStats(rows).noBonus;
    assert.equal(table.teams.find(t=>t.name==='Uno').points,22);
    assert.equal(table.teams.find(t=>t.name==='Uno').bonus,-4);
    assert.ok(table.teams.filter(t=>t.name!=='Uno').every(t=>t.points===50));
  }finally{dom.window.close();}
});
test('negative balance always contributes zero, even with a stale XI or no XI and postponements',()=>{
  const {dom,api}=setup();
  try{
    const rows=[row('Uno',{negative:true,pending:true}),row('Dos',{negative:true,pending:true}),row('Tres',{negative:true,pending:true})];
    rows[0].lineup=[];
    rows[1].goals=9;
    const data=api.buildLeagueStats(rows);
    assert.ok(data.noBonus.complete);
    assert.ok(data.noBonus.teams.every(t=>t.points===0&&t.goals===0&&t.bonus===0));
    assert.deepEqual(plain(data.noBonus.postponedMatchdays),[1]);
    api.render(data);
    assert.match(dom.window.document.getElementById('leagueStatsContent').textContent,/Provisional.*J1 con aplazados/);
    rows.forEach(r=>r.lineup=[]);
    api.render(api.buildLeagueStats(rows));
    assert.equal(dom.window.document.querySelectorAll('.league-no-bonus-table tbody tr').length,3);
  }finally{dom.window.close();}
});
test('equal adjusted totals use league goals, clean sheets and stable participant order',()=>{
  const {dom,api}=setup();
  try{
    const rows=roster.map(p=>row(p.name,{captain:null}));
    rows[1].goals=1;rows[2].goals=1;rows[2].clean_sheets=1;
    let teams=api.buildLeagueStats(rows).noBonus.teams;
    assert.deepEqual(plain(teams.map(t=>t.name)),['Tres','Dos','Uno']);
    assert.ok(teams.every(t=>t.movement===0));
    rows[1].clean_sheets=1;
    assert.equal(api.buildLeagueStats(rows).noBonus.teams[0].name,'Dos');
  }finally{dom.window.close();}
});
test('latest published correction replaces a round instead of adding it; postponed status refreshes',()=>{
  const {dom,api}=setup();
  try{
    const rows=roster.map(p=>({...row(p.name,{pending:true}),updated_at:'2026-09-01T00:00:00Z'}));
    rows.push(...roster.map(p=>({...row(p.name,{points:60,captain:30}),updated_at:'2026-09-02T00:00:00Z'})));
    const data=api.buildLeagueStats(rows);
    assert.equal(data.publishedRows,3);
    assert.ok(data.noBonus.teams.every(t=>t.points===40));
    assert.deepEqual(plain(data.noBonus.postponedMatchdays),[]);
    assert.equal(data.noBonus.matchdays.length,1);
  }finally{dom.window.close();}
});
for(const invalid of ['missing-row','missing-lineup','duplicate-slot','two-captains','missing-multiplier','missing-captain-points','invalid-points'])test(invalid+' withholds invented totals and ranks',()=>{
  const {dom,api}=setup();
  try{
    const rows=roster.map(p=>row(p.name));
    if(invalid==='missing-row')rows.pop();
    if(invalid==='missing-lineup')rows[2].lineup=[];
    if(invalid==='duplicate-slot')rows[2].lineup[10].slot_number=1;
    if(invalid==='two-captains')rows[2].lineup[0].is_captain=true;
    if(invalid==='missing-multiplier')delete rows[2].lineup[10].captain_multiplier;
    if(invalid==='missing-captain-points')rows[2].lineup[10].displayed_points=null;
    if(invalid==='invalid-points')rows[2].points=null;
    const data=api.buildLeagueStats(rows);
    assert.equal(data.noBonus.complete,false);
    assert.equal(data.noBonus.teams.find(t=>t.name==='Tres').points,null);
    assert.ok(data.noBonus.teams.every(t=>t.rank===null&&t.movement===null));
    api.render(data);
    assert.match(dom.window.document.getElementById('leagueStatsContent').textContent,/Faltan datos.*Revisar J1/s);
  }finally{dom.window.close();}
});
test('new tab renders four columns, keeps captain points and supports returning to existing tabs',()=>{
  const {dom,api}=setup();
  try{
    const data=api.buildLeagueStats(roster.map(p=>row(p.name)));
    api.render(data);
    const doc=dom.window.document;
    assert.equal(doc.querySelectorAll('.league-stats-subtabs [role="tab"]').length,4);
    assert.equal(doc.getElementById('leagueStatsNoBonusTab').getAttribute('aria-selected'),'true');
    assert.equal(doc.querySelectorAll('.league-no-bonus-table thead th').length,4);
    assert.equal(doc.querySelectorAll('.league-no-bonus-table tbody tr').length,3);
    assert.match(doc.getElementById('leagueStatsContent').textContent,/conserva sus 8 puntos.*solo los 16/);
    api.setLeagueStatsSection('captains');
    assert.equal(doc.querySelectorAll('.league-stats-captain-card').length,3);
    assert.match(doc.querySelector('.league-stats-captain-card').textContent,/24/);
  }finally{dom.window.close();}
});
test('statistics fetch reads only published rows for this season, including negative and postponed flags',async()=>{
  const {dom,api}=setup();
  try{
    dom.window.CUBAN_LEAGUE_SUPABASE={url:'https://example.test',publishableKey:'public-test-key',season:'2026/27'};
    dom.window.fetch=async (url,options)=>{
      const query=new URL(url).searchParams;
      assert.equal(query.get('published'),'eq.true');
      assert.equal(query.get('season'),'eq.2026/27');
      assert.ok(query.get('select').includes('negative_balance_no_score'));
      assert.ok(query.get('select').includes('has_postponed_matches'));
      assert.ok(!options.method||options.method==='GET');
      return {ok:true,json:async()=>[]};
    };
    await api.fetchPublishedLeagueStatsRows();
  }finally{dom.window.close();}
});

test('captain bonus table sums every captain, uses verified rounding, and leaves statistics immutable',()=>{
  const {dom,api}=setup();
  try{
    const rows=[row('Uno',{captain:8,multiplier:1.5}),row('Uno',{day:2}),row('Uno',{day:3,captain:-6}),
      row('Dos',{captain:30}),row('Dos',{day:2,captain:null}),row('Dos',{day:3,negative:true}),
      ...[1,2,3].map(day=>row('Tres',{day,captain:null}))];
    rows[1].lineup[10].player_id='another-captain';
    rows[1].lineup[10].player_name='Otro capitán';
    const before=JSON.stringify(rows);
    const data=freeze(api.buildLeagueStats(freeze(rows)));
    const statsBefore=JSON.stringify(data);
    api.render(data);api.setLeagueStatsSection('captains');api.setLeagueCaptainMode('bonus',{focus:true});
    const doc=dom.window.document;
    const table=[...doc.querySelectorAll('.league-captain-bonus-table tbody tr')];
    assert.deepEqual(table.map(tr=>tr.querySelector('[data-profile-player]').dataset.profilePlayer),['Dos','Uno','Tres']);
    assert.deepEqual(table.map(tr=>tr.cells[2].textContent),['+20','+15','0']);
    assert.equal(table.length,3);
    assert.equal(doc.querySelectorAll('.league-captain-bonus-table thead th').length,3);
    assert.equal(doc.activeElement.dataset.leagueCaptainMode,'bonus');
    assert.equal(doc.activeElement.getAttribute('aria-pressed'),'true');
    assert.equal(JSON.stringify(rows),before);
    assert.equal(JSON.stringify(data),statsBefore);
  }finally{dom.window.close();}
});

test('bonus ranking shares tied positions and displays negative extras below zero',()=>{
  const {dom,api}=setup();
  try{
    api.render(api.buildLeagueStats([row('Uno'),row('Dos'),row('Tres',{captain:-6})]));
    api.setLeagueStatsSection('captains');api.setLeagueCaptainMode('bonus');
    const table=[...dom.window.document.querySelectorAll('.league-captain-bonus-table tbody tr')];
    assert.deepEqual(table.map(tr=>tr.cells[0].textContent),['1','1','3']);
    assert.deepEqual(table.map(tr=>tr.cells[2].textContent),['+16','+16','−4']);
    assert.ok(table[2].querySelector('.is-down'));
  }finally{dom.window.close();}
});

test('bonus table includes all 20 participants before any XI and does not invent zero totals',()=>{
  const participants=JSON.parse(read('data.json')).participants.filter(p=>p.active!==false);
  const {dom,api}=setup(participants);
  try{
    assert.equal(participants.length,20);
    api.render(api.buildLeagueStats([]));api.setLeagueStatsSection('captains');
    assert.ok(dom.window.document.querySelector('[data-league-captain-mode="bonus"]'));
    api.setLeagueCaptainMode('bonus');
    const table=[...dom.window.document.querySelectorAll('.league-captain-bonus-table tbody tr')];
    assert.equal(table.length,20);
    assert.ok(table.every(tr=>tr.cells[0].textContent==='—'&&tr.cells[2].textContent==='—'));
    assert.match(dom.window.document.getElementById('leagueStatsContent').textContent,/Sin jornadas publicadas/);
  }finally{dom.window.close();}
});

test('bonus table distinguishes missing XI from zero and refreshes corrected postponed rounds',()=>{
  const {dom,api}=setup();
  try{
    const rows=roster.map(p=>({...row(p.name,{pending:true}),updated_at:'2026-09-01T00:00:00Z'}));
    rows[2].lineup=[];
    api.render(api.buildLeagueStats(rows));api.setLeagueStatsSection('captains');api.setLeagueCaptainMode('bonus');
    const doc=dom.window.document;
    let table=[...doc.querySelectorAll('.league-captain-bonus-table tbody tr')];
    assert.ok(table.every(tr=>tr.cells[0].textContent==='—'));
    assert.equal(table[2].cells[2].textContent,'—');
    assert.match(table[2].textContent,/Revisar J1/);
    assert.match(doc.getElementById('leagueStatsContent').textContent,/Provisional.*J1 con aplazados/);
    const corrected=roster.map(p=>({...row(p.name,{captain:30}),updated_at:'2026-09-02T00:00:00Z'}));
    api.render(api.buildLeagueStats([...rows,...corrected]));api.setLeagueStatsSection('captains');
    table=[...doc.querySelectorAll('.league-captain-bonus-table tbody tr')];
    assert.ok(table.every(tr=>tr.cells[0].textContent==='1'&&tr.cells[2].textContent==='+20'));
    assert.doesNotMatch(doc.getElementById('leagueStatsContent').textContent,/Provisional|Revisar J1/);
  }finally{dom.window.close();}
});

test('negative balance with no XI still allows a verified zero in the bonus table',()=>{
  const {dom,api}=setup();
  try{
    const rows=roster.map(p=>({...row(p.name,{negative:true}),lineup:[]}));
    api.render(api.buildLeagueStats(rows));api.setLeagueStatsSection('captains');api.setLeagueCaptainMode('bonus');
    const table=[...dom.window.document.querySelectorAll('.league-captain-bonus-table tbody tr')];
    assert.equal(table.length,3);
    assert.ok(table.every(tr=>tr.cells[0].textContent==='1'&&tr.cells[2].textContent==='0'));
  }finally{dom.window.close();}
});

test('worst captains uses lowest average per participant, keeps ties and puts absent captains last',()=>{
  const {dom,api}=setup();
  try{
    const rows=[row('Uno',{captain:0}),row('Uno',{day:2,captain:24}),row('Uno',{day:3,captain:6}),
      row('Dos',{captain:-6}),row('Dos',{day:2,captain:-6}),row('Tres',{captain:null})];
    rows[2].lineup[10].player_id='worst-captain';rows[2].lineup[10].player_name='Peor de Uno';
    rows[4].lineup[10].player_id='tied-captain';rows[4].lineup[10].player_name='Empatado de Dos';
    const data=freeze(api.buildLeagueStats(freeze(rows)));
    const before=JSON.stringify(data);
    api.render(data);api.setLeagueStatsSection('captains');api.setLeagueCaptainMode('worst');
    const doc=dom.window.document;
    const cards=[...doc.querySelectorAll('.league-stats-captain-card')];
    assert.deepEqual(cards.map(card=>card.querySelector('[data-profile-player]').dataset.profilePlayer),['Dos','Uno','Tres']);
    assert.match(cards[0].textContent,/Empatado de Dos/);
    assert.match(cards[0].textContent,/Jugador 10/);
    assert.match(cards[1].textContent,/Peor de Uno/); // 6 average, versus the other's (0 + 24) / 2 = 12.
    assert.doesNotMatch(cards[1].textContent,/Jugador 10/);
    assert.equal(cards[2].querySelector('.league-stats-rank').textContent,'—');
    assert.equal(cards[0].querySelector('.league-stats-metrics div:nth-child(3) b').textContent,'−6');
    assert.doesNotMatch(doc.getElementById('leagueStatsContent').textContent,/Líder en ambos/);
    assert.equal(JSON.stringify(data),before);
    api.setLeagueCaptainMode('average');
    assert.equal(doc.querySelector('.league-stats-captain-card [data-profile-player]').dataset.profilePlayer,'Uno');
    assert.match(doc.querySelector('.league-stats-captain-card').textContent,/Jugador 10/);
  }finally{dom.window.close();}
});

test('real captain buttons switch between both new views and retained views without extra requests',async()=>{
  const {dom,api}=setup();
  try{
    const w=dom.window,doc=w.document;
    w.scrollTo=()=>{};w.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
    w.HTMLCanvasElement.prototype.getContext=()=>null;
    let requests=0;
    w.fetch=async(url,options={})=>{
      assert.match(String(url),/^data\.json\?/);assert.equal(options.method||'GET','GET');requests++;
      return {ok:true,json:async()=>JSON.parse(read('data.json'))};
    };
    await w.init();
    api.set({currentSeason:'2026/27',participants:roster});
    api.render(api.buildLeagueStats(roster.map(p=>row(p.name))));api.setLeagueStatsSection('captains');
    const initialRequests=requests;
    assert.deepEqual([...doc.querySelectorAll('[data-league-captain-mode]')].map(b=>b.dataset.leagueCaptainMode),['points','average','bonus','worst']);
    for(const mode of ['bonus','worst','average','points']){
      doc.querySelector(`[data-league-captain-mode="${mode}"]`).click();
      assert.equal(doc.querySelector('[data-league-captain-mode][aria-pressed="true"]').dataset.leagueCaptainMode,mode);
      assert.equal(doc.activeElement.dataset.leagueCaptainMode,mode);
      assert.equal(doc.querySelectorAll(mode==='bonus'?'.league-captain-bonus-table tbody tr':'.league-stats-captain-card').length,3);
    }
    assert.equal(requests,initialRequests);
  }finally{dom.window.close();}
});
