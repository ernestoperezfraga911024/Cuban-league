const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {JSDOM}=require('jsdom');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const data=JSON.parse(read('data.json'));
const roster=data.participants.filter(p=>p.active!==false);
const changed=new Set(['matchday_king','on_fire']);
function freeze(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    Object.values(value).forEach(freeze);Object.freeze(value);
  }
  return value;
}
function day(matchday,points=[100,90,80,70]){
  return roster.map((p,i)=>({participant_name:p.name,matchday,points:points[i]??30-i,
    goals:i===0?1:0,clean_sheets:i===1?1:0,red_cards:0}));
}
const days=(count,start=1)=>Array.from({length:count},(_,i)=>day(start+i)).flat();
function setup(rows=[]){
  const dom=new JSDOM(read('index.html'),{url:'https://example.test/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;w.scrollTo=()=>{};w.matchMedia=()=>({matches:true});
  w.fetch=()=>{throw new Error('No network permitted for achievement rules');};
  w.eval(read('app.js').replace(/init\(\);\s*$/,`window.achievementTest={
    set(data,rows){DATA=data;LIVE_MATCHDAY_ROWS=normalizeMatchdayRows(rows);PUBLISHED_MATCHDAYS=[...new Set(LIVE_MATCHDAY_ROWS.map(r=>r.matchday))].sort((a,b)=>a-b);},
    inputs(){return JSON.stringify({data:DATA,rows:LIVE_MATCHDAY_ROWS,days:PUBLISHED_MATCHDAYS});},
    frozen(){LIVE_MATCHDAY_ROWS.forEach(Object.freeze);Object.freeze(LIVE_MATCHDAY_ROWS);Object.freeze(PUBLISHED_MATCHDAYS);},
    buildAchievementSnapshot,weeklyStandings,cumulativeStandings,renderCurrent,renderAchievementHub,
    compactAchievementBadges,playerAchievementState,profileAchievementsPanelMarkup,achievementDetailMarkup,
    currentAchievementKeys
  };`));
  const api=w.achievementTest;
  const set=(rows,league=data)=>{api.set(freeze(JSON.parse(JSON.stringify(league))),freeze(rows));api.frozen();};
  set(rows);
  const badge=(index,id)=>api.buildAchievementSnapshot().players.get(roster[index].name).get(id);
  const owners=id=>Array.from(api.buildAchievementSnapshot().catalog.find(b=>b.id===id).achievers,p=>p.name);
  return {dom,w,api,set,badge,owners};
}

test('Rey: nobody with zero wins; first winner qualifies without waiting for three wins',()=>{
  const t=setup();try{
    assert.deepEqual(t.owners('matchday_king'),[]);
    assert.match(t.badge(0,'matchday_king').progress,/Todavía no hay jornadas ganadas/);
    t.set(day(1));assert.deepEqual(t.owners('matchday_king'),[roster[0].name]);
    assert.equal(t.badge(0,'matchday_king').meta,'1 jornada ganada');
    assert.equal(t.badge(0,'matchday_king').type,'Dinámica');
  }finally{t.dom.window.close();}
});

test('Rey: only the most wins, shared ties and ownership changes after corrections/undo',()=>{
  const t=setup();try{
    const rows=[...day(1,[100,100,80,70]),...day(2)];
    t.set(rows);assert.deepEqual(t.owners('matchday_king'),[roster[0].name]);
    const tied=[...rows,...day(3,[90,100,80,70])];
    t.set(tied);assert.deepEqual(t.owners('matchday_king'),[roster[0].name,roster[1].name]);
    t.set([...tied,...day(4,[90,100,80,70])]);
    assert.deepEqual(t.owners('matchday_king'),[roster[1].name]);
    assert.match(t.badge(0,'matchday_king').progress,/2 victorias · Máximo actual: 3/);
    t.set([...tied,...day(4)]); // Correction, not an additional win appended to old state.
    assert.deepEqual(t.owners('matchday_king'),[roster[0].name]);
    t.set(tied);assert.deepEqual(t.owners('matchday_king'),[roster[0].name,roster[1].name]);
    t.set(tied);assert.equal(t.badge(0,'matchday_king').meta,'2 jornadas ganadas');
    const seven=[0,0,0,1,1,1,1].flatMap((winner,i)=>day(i+1,winner===0?[100,90,80,70]:[90,100,80,70]));
    t.set(seven);assert.deepEqual(t.owners('matchday_king'),[roster[1].name]);
    assert.equal(t.badge(0,'matchday_king').earned,false); // Three wins no longer unlock it.
  }finally{t.dom.window.close();}
});

test('En llamas: three and nine are insufficient; ten qualify; longest run remains earned',()=>{
  const t=setup();try{
    for(const n of [3,9,10,11]){
      t.set(days(n));const b=t.badge(0,'on_fire');
      assert.equal(b.earned,n>=10);
      assert.equal(b.progress,`${Math.min(n,10)}/10 en el Top 3`);
      assert.match(b.requirement,/Top 3 de cada jornada durante 10 jornadas seguidas/);
    }
    t.set([...days(10),...day(11,[10,100,90,80])]);
    assert.equal(t.badge(0,'on_fire').earned,true);
    assert.equal(t.badge(0,'on_fire').meta,'Racha de 10 jornadas en el Top 3');
    t.set(days(10,5));assert.equal(t.badge(0,'on_fire').earned,true);
  }finally{t.dom.window.close();}
});

test('En llamas: missing dates, missing participant rows and fourth place interrupt a run',()=>{
  const t=setup();try{
    t.set([...days(5),...days(5,7)]);assert.equal(t.badge(0,'on_fire').earned,false);
    assert.equal(t.badge(0,'on_fire').progress,'5/10 en el Top 3');
    t.set(days(11).filter(r=>!(r.matchday===6&&r.participant_name===roster[0].name)));
    assert.equal(t.badge(0,'on_fire').earned,false);
    t.set([...days(5),...day(6,[65,100,90,80]),...days(5,7)]);
    assert.equal(t.badge(0,'on_fire').earned,false);
    t.set(days(11));assert.equal(t.badge(0,'on_fire').earned,true); // Filling/correcting the gap restores the run.
  }finally{t.dom.window.close();}
});

test('En llamas uses weekly Top 3, not cumulative standing; season reset clears both rules',()=>{
  const rows=[...day(1,[2000,100,90,80]),...Array.from({length:9},(_,i)=>day(i+2,[40,100,90,80])).flat()];
  const t=setup(rows);try{
    assert.equal(t.api.cumulativeStandings(10)[0].name,roster[0].name);
    assert.equal(t.badge(0,'on_fire').earned,false);
    assert.equal(t.badge(1,'on_fire').earned,true);
    t.set([],{...data,currentSeason:'2027/28'});
    assert.deepEqual(t.owners('on_fire'),[]);assert.deepEqual(t.owners('matchday_king'),[]);
  }finally{t.dom.window.close();}
});

test('other twelve badges match V193 exactly; snapshots do not mutate inputs or standings',()=>{
  const t=setup(days(11));try{
    const before=t.api.inputs(),weekly=JSON.stringify(t.api.weeklyStandings(11)),general=JSON.stringify(t.api.cumulativeStandings(11));
    const snap=t.api.buildAchievementSnapshot();
    const untouched={catalog:snap.catalog.filter(a=>!changed.has(a.id)),players:[...snap.players].map(([name,badges])=>[name,[...badges.values()].filter(a=>!changed.has(a.id))])};
    // Captured from main V193 before changing the two requested rules, with this same fixture.
    assert.equal(createHash('sha256').update(JSON.stringify(untouched)).digest('hex'),'514e347dbd5224e1ee64878daae3415c6d5e58167dee9d93b732d98c8120484f');
    assert.equal(snap.catalog.length,14);
    assert.equal(t.api.inputs(),before);
    assert.equal(JSON.stringify(t.api.weeklyStandings(11)),weekly);
    assert.equal(JSON.stringify(t.api.cumulativeStandings(11)),general);
  }finally{t.dom.window.close();}
});

test('catalog, table badges, profiles and detail agree; stored notifications do not confer awards',()=>{
  const t=setup(days(10));try{
    const d=t.w.document,snap=t.api.buildAchievementSnapshot();
    t.api.renderCurrent();t.api.renderAchievementHub(snap);
    assert.equal(d.querySelectorAll('#currentRows .current-row').length,roster.length);
    for(const row of d.querySelectorAll('#currentRows .current-row'))assert.equal(row.children.length,9);
    assert.match(d.getElementById('achievementHub').textContent,/10 jornadas seguidas/);
    assert.doesNotMatch(d.getElementById('achievementHub').textContent,/Ganar 3 jornadas|durante 3 jornadas seguidas/);
    assert.match(t.api.compactAchievementBadges(roster[0].name,snap,{limit:99}),/Rey de la jornada/);
    const all=t.api.playerAchievementState(roster[0].name,snap),earned=all.filter(a=>a.earned);
    const markup=t.api.profileAchievementsPanelMarkup(all,earned,50);
    assert.match(markup,/10 jornadas seguidas/);assert.match(markup,/10\/10 en el Top 3|Racha de 10 jornadas en el Top 3/);
    assert.match(t.api.achievementDetailMarkup(roster[0].name,all.find(a=>a.id==='matchday_king')),/más jornadas ha ganado/);
    t.w.localStorage.setItem('cuban-league-seen-achievements-v1',JSON.stringify([`${encodeURIComponent(roster[1].name)}::matchday_king`]));
    assert.equal(t.badge(1,'matchday_king').earned,false);
    t.set(day(1,[90,100,80,70]));t.api.renderCurrent();
    const updated=t.api.buildAchievementSnapshot();
    assert.doesNotMatch(t.api.compactAchievementBadges(roster[0].name,updated,{limit:99}),/Rey de la jornada/);
    assert.match(t.api.compactAchievementBadges(roster[1].name,updated,{limit:99}),/Rey de la jornada/);
    assert.ok(!t.api.currentAchievementKeys(updated).some(x=>x.playerName===roster[0].name&&x.item.id==='matchday_king'));
  }finally{t.dom.window.close();}
});
