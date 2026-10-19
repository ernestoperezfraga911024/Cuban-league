const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function freeze(value){Object.freeze(value);Object.values(value).forEach(v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v))freeze(v);});return value;}
function row(name,day,id,points,{captain=true,multiplier=3,time='2026-10-01',pending=false}={}){
  return {participant_name:name,matchday:day,points:points+20,updated_at:time,has_postponed_matches:pending,
    lineup:Array.from({length:11},(_,i)=>({slot_number:i+1,player_id:i===10?id:`filler${i}`,
      player_name:i===10?(id==='mbappe'?'Mbappé':`Jugador ${id}`):`Relleno ${i}`,
      position:i===0?'PT':i<5?'DF':i<9?'MC':'DL',displayed_points:i===10?points:2,
      is_captain:i===10&&captain,captain_multiplier:i===10&&captain?multiplier:1}))};
}
async function setup(){
  const dom=new JSDOM(read('index.html'),{url:'https://example.test/Cuban-league/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,doc=w.document;
  w.scrollTo=()=>{};w.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
  w.HTMLCanvasElement.prototype.getContext=()=>null;
  let requests=0;
  w.fetch=async(url,options={})=>{assert.match(String(url),/^data\.json\?/);assert.equal(options.method||'GET','GET');requests++;return {ok:true,json:async()=>JSON.parse(read('data.json'))};};
  w.eval(read('app.js').replace(/init\(\);\s*$/,`window.detailTest={
    build(rows){const data=buildLeagueStats(rows);LEAGUE_CAPTAIN_DETAILS.set(data,{rows,index:null});return data;},
    render(data){LEAGUE_STATS_STATE.data=data;LEAGUE_STATS_STATE.status='ready';setLeagueStatsSection('captains');},
    details:leagueStatsCaptainDetails,cache(data){return LEAGUE_CAPTAIN_DETAILS.get(data);},
    async load(rows){fetchPublishedLeagueStatsRows=async()=>rows;await ensureLeagueStatsData({force:true});return LEAGUE_STATS_STATE.data;},
    failLoad(){fetchPublishedLeagueStatsRows=async()=>{throw Error('offline');};return ensureLeagueStatsData({force:true});},
    stubLineup(fn){fetchPublishedMatchdayLineup=fn;},closeMatchdayLineup,
    setLeagueCaptainMode,setLeagueCaptainView
  };`));
  await w.init();
  return {dom,w,doc,api:w.detailTest,requests:()=>requests};
}
const cards=doc=>[...doc.querySelectorAll('.league-stats-global-card')];
function search(w,value){const input=w.document.getElementById('leagueCaptainSearch');input.focus();input.value=value;input.dispatchEvent(new w.Event('input',{bubbles:true}));return input;}

test('search covers the full ranking, ignores accents/case, preserves global ranks, focus and exact data',async()=>{
  const {dom,w,doc,api,requests}=await setup();
  try{
    const rows=freeze([...Array.from({length:23},(_,i)=>row('Ernesto',i+1,`c${i}`,100-i*3)),row('Ernesto',24,'mbappe',-6),row('Brian',1,'mbappe',90)]);
    const data=freeze(api.build(rows)),before=JSON.stringify(data),rawBefore=JSON.stringify(rows);
    api.render(data);api.setLeagueCaptainView('general');
    const requestCount=requests();
    const input=search(w,'  MBAPPE  ');
    assert.equal(doc.activeElement,input);assert.equal(doc.getElementById('leagueCaptainSearch'),input);
    assert.equal(cards(doc).length,2);
    assert.deepEqual(cards(doc).map(c=>c.querySelector('.league-stats-rank').textContent),['5','25']);
    assert.equal(doc.querySelector('[data-league-captain-expand]'),null);
    search(w,'mbappe ernesto');assert.equal(cards(doc).length,1);
    assert.equal(cards(doc)[0].querySelector('.league-stats-rank').textContent,'25');
    api.setLeagueCaptainMode('worst');assert.equal(cards(doc).length,1);
    assert.equal(doc.getElementById('leagueCaptainSearch').value,'mbappe ernesto');
    assert.equal(cards(doc)[0].querySelector('.league-stats-rank').textContent,'1');
    search(w,'Ernesto');assert.equal(cards(doc).length,24);
    search(w,'<img src=x onerror=alert(1)>');assert.equal(cards(doc).length,0);
    assert.match(doc.getElementById('leagueGlobalCaptainResults').textContent,/No hay coincidencias/);
    doc.querySelector('[data-league-captain-clear]').click();
    assert.equal(doc.activeElement.id,'leagueCaptainSearch');assert.equal(cards(doc).length,20);
    assert.equal(requests(),requestCount);assert.equal(JSON.stringify(data),before);assert.equal(JSON.stringify(rows),rawBefore);
  }finally{dom.window.close();}
});

test('details count only captain appearances for that owner and select latest complete published rows',async()=>{
  const {dom,api}=await setup();
  try{
    const incomplete=row('Ernesto',5,'mbappe',999);incomplete.lineup.pop();
    const rows=freeze([row('Ernesto',1,'mbappe',90),row('Ernesto',1,'mbappe',7.5,{time:'2026-10-02',multiplier:1.5}),
      row('Ernesto',2,'mbappe',7.5,{multiplier:1.5,pending:true}),row('Ernesto',3,'mbappe',80,{captain:false}),
      row('Ernesto',4,'b',-6),incomplete,row('Brian',1,'mbappe',60),row('Unknown',1,'mbappe',999)]);
    const before=JSON.stringify(rows),data=freeze(api.build(rows));
    const team=data.teams.find(t=>t.name==='Ernesto'),player=team.captains.find(p=>p.playerId==='mbappe');
    assert.equal(api.cache(data).index,null,'no detail work before the first request');
    const details=api.details(data,team,player);
    assert.deepEqual(plain(details),[
      {matchday:1,finalPoints:7.5,multiplier:1.5,basePoints:5,postponed:false},
      {matchday:2,finalPoints:7.5,multiplier:1.5,basePoints:5,postponed:true}
    ]);
    assert.equal(player.captainPoints,15);assert.equal(player.captainBonus,5);
    assert.equal(api.details(data,team,player),details,'reuse the derived index');
    assert.equal(api.cache(data).rows,null,'release the raw snapshot after indexing');
    const other=data.teams.find(t=>t.name==='Brian');assert.equal(api.details(data,other,other.captains[0])[0].finalPoints,60);
    assert.equal(api.details(data,team,{...player,captainPoints:999}),null,'never show a mismatching total');
    assert.equal(JSON.stringify(rows),before);
  }finally{dom.window.close();}
});

test('points disclose compact accessible details, sum before rounding and open the existing XI with focus return',async()=>{
  const {dom,w,doc,api,requests}=await setup();
  try{
    const rows=freeze([row('Ernesto',1,'mbappe',7.5,{multiplier:1.5}),row('Ernesto',2,'mbappe',7.5,{multiplier:1.5,pending:true})]);
    api.render(freeze(api.build(rows)));api.setLeagueCaptainView('general');search(w,'mbappe');
    const before=requests(),button=doc.querySelector('[data-league-captain-detail]');
    assert.equal(doc.querySelector('.league-captain-detail'),null);
    button.focus();button.click();const panel=doc.getElementById(button.getAttribute('aria-controls'));
    assert.equal(panel.hidden,false);assert.equal(button.getAttribute('aria-expanded'),'true');assert.equal(doc.activeElement,button);
    assert.deepEqual([...panel.querySelectorAll('tbody td:last-child')].map(n=>n.textContent),['8','8']);
    assert.equal(panel.querySelector('tfoot td').textContent,'15','raw 7.5 + 7.5, not rounded 8 + 8');
    assert.match(panel.textContent,/antes de redondear/);assert.match(panel.textContent,/Base estimada/);assert.match(panel.textContent,/Provisional/);
    assert.equal(requests(),before,'opening and searching reuse the existing snapshot');
    let opened=[];api.stubLineup(async(name,day)=>{opened.push([name,day]);return {lineup:rows[day-1].lineup};});
    const link=panel.querySelector('[data-matchday="2"]');link.focus();link.click();
    await new Promise(resolve=>w.requestAnimationFrame(resolve));
    assert.deepEqual(opened,[['Ernesto',2]]);assert.equal(doc.getElementById('lineupModal').hidden,false);
    assert.match(doc.getElementById('lineupModal').textContent,/Mbappé/);
    api.closeMatchdayLineup();assert.equal(doc.activeElement,link);assert.equal(panel.hidden,false);
    assert.equal(doc.getElementById('leagueCaptainSearch').value,'mbappe');
    button.click();assert.equal(panel.hidden,true);button.click();assert.equal(doc.querySelector('.league-captain-detail'),panel);
  }finally{dom.window.close();}
});

test('both participant views resolve the displayed captain, including negative and zero scores',async()=>{
  const {dom,doc,api}=await setup();
  try{
    api.render(api.build([row('Ernesto',1,'best',30),row('Ernesto',2,'worst',-6),row('Brian',1,'zero',0)]));
    for(const [mode,id,value] of [['points','best','30'],['average','best','30'],['worst','worst','−6']]){
      api.setLeagueCaptainMode(mode);
      const button=doc.querySelector('[data-league-captain-detail][data-captain-team="Ernesto"]');
      button.click();const panel=doc.getElementById(button.getAttribute('aria-controls'));
      assert.match(panel.querySelector('h4').textContent,new RegExp(id));assert.equal(panel.querySelector('tfoot td').textContent,value);
    }
    const zero=doc.querySelector('[data-league-captain-detail][data-captain-team="Brian"]');zero.click();
    assert.equal(doc.getElementById(zero.getAttribute('aria-controls')).querySelector('tfoot td').textContent,'0');
    api.setLeagueCaptainMode('bonus');assert.equal(doc.querySelector('[data-league-captain-detail]'),null);
  }finally{dom.window.close();}
});

test('real stats loading attaches matching snapshots, refresh replaces details and failed refresh retains verified data',async()=>{
  const {dom,api,doc}=await setup();
  try{
    const first=await api.load(freeze([row('Ernesto',1,'mbappe',30)]));
    api.setLeagueCaptainView('general');
    doc.querySelector('[data-league-captain-detail]').click();assert.equal(doc.querySelector('.league-captain-detail tfoot td').textContent,'30');
    const second=await api.load(freeze([row('Ernesto',1,'mbappe',-12,{time:'2026-10-03'})]));
    assert.notEqual(first,second);assert.equal(doc.querySelector('.league-captain-detail'),null);
    doc.querySelector('[data-league-captain-detail]').click();assert.equal(doc.querySelector('.league-captain-detail tfoot td').textContent,'−12');
    await api.failLoad();doc.querySelector('[data-league-captain-detail]').click();
    assert.equal(doc.querySelector('.league-captain-detail tfoot td').textContent,'−12');
    assert.match(doc.getElementById('leagueStatsContent').textContent,/Mostrando datos anteriores/);
  }finally{dom.window.close();}
});
