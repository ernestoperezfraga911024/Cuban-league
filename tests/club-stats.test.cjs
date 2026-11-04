const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const cssom=require('rrweb-cssom');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const roster=[{id:1,name:'Uno'},{id:2,name:'Dos'}];
const catalog=[{id:'a',name:'Club A',crest:'catalog/a.png'},{id:'b',name:'Club B',crest:'catalog/b.png'}];
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze);}return value;};
function row(name='Uno',day=1,{captain=24,multiplier=3}={}){
  return {participant_name:name,matchday:day,points:20+captain,updated_at:'2026-11-01T00:00:00Z',
    lineup:Array.from({length:11},(_,i)=>({slot_number:i+1,player_id:'p'+i,player_name:'Jugador '+i,
      position:i===0?'PT':i<5?'DF':i<9?'MC':'DL',club_id:i===10?'b':'a',club_name:i===10?'Club B':'Club A',
      displayed_points:i===10?captain:2,is_captain:i===10,captain_multiplier:i===10?multiplier:1}))};
}
function setup(){
  const dom=new JSDOM(read('index.html'),{url:'https://example.test/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,doc=w.document;
  w.fetch=()=>{throw Error('Clubes must not request or write data');};
  w.eval(read('club-stats.js'));
  w.eval(read('app.js').replace(/init\(\);\s*$/,`window.clubTest={
    setup(){DATA={currentSeason:'2026/27',participants:${JSON.stringify(roster)}};PLAYER_CATALOG={clubs:${JSON.stringify(catalog)},resolve:()=>null,clubsById:new Map()};},
    buildLeagueStats,leagueNoBonusCaptainAdjustment,isPublishedEmptyLineupPlayer,handleProfileTabsKeydown,
    ensureLeagueStatsData,setLeagueStatsSection,renderLeagueStatsContent,
    register(rows){const data=buildLeagueStats(rows);LEAGUE_CLUB_SOURCES.set(data,{rows,days:[...new Set(rows.map(r=>r.matchday))],model:null});LEAGUE_STATS_STATE.data=data;LEAGUE_STATS_STATE.status='ready';return data;},
    getModel(){return LEAGUE_CLUB_SOURCES.get(LEAGUE_STATS_STATE.data)?.model;},
    state(status,error=''){LEAGUE_STATS_STATE.status=status;LEAGUE_STATS_STATE.error=error;},
    clear(){LEAGUE_STATS_STATE.data=null;},
    configureFetch(rows){window.CUBAN_LEAGUE_SUPABASE={url:'https://db.example.test',publishableKey:'test',season:'2026/27'};PUBLISHED_MATCHDAYS=[...new Set(rows.map(r=>r.matchday))];},
    resetSeason(){LEAGUE_STATS_STATE.data=null;LEAGUE_STATS_STATE.status='idle';DATA.currentSeason='2027/28';}
  };`));
  const api=w.clubTest;api.setup();doc.getElementById('currentStatisticsPanel').hidden=false;
  const build=(rows,extra={})=>w.CubanClubStats.build({rows,season:'2026/27',participants:roster,clubs:catalog,captainAdjustment:api.leagueNoBonusCaptainAdjustment,isEmpty:api.isPublishedEmptyLineupPlayer,...extra});
  const view=(model,extra={})=>w.CubanClubStats.select(model,extra);
  return {dom,w,doc,api,build,view};
}
function close(t,fn){try{return fn();}finally{t.dom.window.close();}}
const club=(v,key)=>v.clubs.find(c=>c.key==='id:'+key);
test('club points retain official captain points and remove only the exact extra, without mutations',()=>{
  const t=setup();close(t,()=>{
    const rows=freeze([row(),row('Dos',1,{captain:16,multiplier:2})]),before=JSON.stringify(rows),m=t.build(rows);
    const all=t.view(m),one=t.view(m,{participant:'Uno'}),base=t.view(m,{participant:'Uno',withoutBonus:true});
    assert.equal(club(all,'a').points,40);assert.equal(club(all,'b').points,40);
    assert.equal(club(one,'b').points,24);assert.equal(club(base,'b').points,8);
    assert.equal(club(one,'b').bonus,16);assert.equal(club(one,'a').appearances,10);
    assert.equal(club(one,'a').average,2);assert.equal(JSON.stringify(rows),before);
    assert.equal(one.scope.officialPoints,44);assert.equal(all.scope.officialPoints,80);
  });
});
test('x1.5, precision residues and negative captains reconcile with the existing no-bonus calculation',()=>{
  const t=setup();close(t,()=>{
    for(const [captain,multiplier] of [[8,1.5],[31.995,1.5],[7.5,1.5],[-6,3],[0,2]]){
      const r=row('Uno',1,{captain,multiplier});r.points=Math.round(r.points);
      const base=t.view(t.build([r]),{participant:'Uno',withoutBonus:true});
      const expected=t.api.buildLeagueStats([r]).noBonus.teams.find(p=>p.name==='Uno').points;
      assert.ok(Math.abs(base.clubs.reduce((n,c)=>n+c.points,0)+base.scope.adjustments-expected)<1e-8);
      assert.equal(club(base,'b').points,captain-t.api.leagueNoBonusCaptainAdjustment(r.lineup[10]));
    }
  });
});
test('average means player appearances, full precision determines shared ranks, minimum sample only gates the highlight',()=>{
  const t=setup();close(t,()=>{
    const rows=[1,2,3].map(d=>row('Uno',d,{captain:2,multiplier:1}));
    const v=t.view(t.build(rows),{participant:'Uno',sort:'average'});
    assert.deepEqual(plain(v.clubs.map(c=>[c.rank,c.average])),[[1,2],[1,2]]);
    assert.equal(v.performance.length,1);assert.equal(v.performance[0].key,'id:a');
    rows[0].lineup[10].displayed_points=2.1;
    const precise=t.view(t.build(rows),{participant:'Uno',sort:'average'});
    assert.equal(precise.clubs[0].key,'id:b');assert.equal(precise.clubs[1].rank,2);
    assert.equal(precise.performance[0].key,'id:a');
  });
});
test('stored club identity survives transfers and catalogue changes; unknown clubs are not inferred from a player',()=>{
  const t=setup();close(t,()=>{
    const a=row(),b=row('Uno',2);b.lineup[10].club_id='a';b.lineup[10].club_name='Club A';
    a.lineup[0].club_id='';a.lineup[0].club_name='';
    a.lineup[1].club_id='';a.lineup[1].club_name='Club A';
    const v=t.view(t.build([a,b]),{participant:'Uno'});
    assert.equal(club(v,'b').players.get('p10').points,24);
    assert.equal(club(v,'a').players.get('p10').points,24);
    assert.equal(v.scope.unknownClub,1);assert.equal(v.scope.unknownPoints,2);assert.equal(v.partial,true);
    assert.equal(club(v,'a').points,62);assert.equal(v.clubs.length,2);
  });
});
test('empty-slot penalties and adjustments are separate; negative-balance lineups do not generate club points or appearances',()=>{
  const t=setup();close(t,()=>{
    const r=row();Object.assign(r.lineup[0],{player_id:'empty-slot-1',player_name:'Posición vacía',displayed_points:-4,club_id:'',club_name:'Penalización automática'});
    r.points=40; // known XI 38, adjustment +2
    const n=row('Uno',2);n.negative_balance_no_score=true;n.points=0;
    const v=t.view(t.build([r,n]),{participant:'Uno'});
    assert.equal(v.scope.emptyPoints,-4);assert.equal(v.scope.adjustments,2);assert.equal(v.scope.negative,1);
    assert.equal(v.scope.analyzed,1);assert.equal(club(v,'a').appearances,9);
    assert.equal(v.clubs.reduce((n,c)=>n+c.points,0)+v.scope.emptyPoints+v.scope.adjustments,40);
    assert.equal(v.scope.unknownClub,0);
  });
});
test('partial lineups, missing numbers, duplicate slots/players and malformed JSON never invent zero scores',()=>{
  const t=setup();close(t,()=>{
    for(const modify of [r=>r.lineup.pop(),r=>r.lineup[0].displayed_points=null,r=>r.lineup[0].displayed_points='',r=>r.lineup[0].slot_number=2,r=>r.lineup[0].player_id='p1',r=>r.lineup='{',r=>r.points=null,r=>r.lineup[0].is_captain=true]){
      const r=row();modify(r);const v=t.view(t.build([r]),{participant:'Uno'});
      assert.equal(v.clubs.length,0);assert.equal(v.scope.invalid,1);assert.equal(v.partial,true);
    }
    const r=row();r.lineup[0].displayed_points=0;const v=t.view(t.build([r]),{participant:'Uno'});
    assert.equal(club(v,'a').points,18);assert.equal(v.scope.invalid,0);
  });
});
test('unknown captain bonus preserves published contribution but withholds that XI only in the no-bonus mode',()=>{
  const t=setup();close(t,()=>{
    const r=row('Uno',1,{captain:7,multiplier:1.5}),m=t.build([r]);
    assert.equal(club(t.view(m),'b').points,7);
    assert.equal(club(t.view(m),'b').bonusUnknown,true);
    const base=t.view(m,{participant:'Uno',withoutBonus:true});
    assert.equal(base.clubs.length,0);assert.equal(base.scope.unknownBonus,1);assert.equal(base.partial,true);
  });
});
test('newest correction wins, ambiguous snapshots are withheld, unpublished/foreign-season rows are ignored and undo clears records',()=>{
  const t=setup();close(t,()=>{
    const r=row(),fixed=row('Uno',1,{captain:30});fixed.updated_at='2026-11-02T00:00:00Z';
    const duplicate=plain(fixed);
    let v=t.view(t.build([r,fixed,duplicate]),{participant:'Uno'});
    assert.equal(club(v,'b').points,30);assert.equal(v.scope.published,1);
    duplicate.lineup[10].displayed_points=33;
    v=t.view(t.build([fixed,duplicate]),{participant:'Uno'});assert.equal(v.clubs.length,0);assert.equal(v.scope.ambiguous,1);
    v=t.view(t.build([{...r,published:false},{...r,season:'2025/26'}]));assert.equal(v.clubs.length,0);
    v=t.view(t.build([]));assert.equal(v.clubs.length,0);assert.equal(v.expected,0);
  });
});
test('coverage and postponed markers are scoped to the participant and no missing participant receives invented points',()=>{
  const t=setup();close(t,()=>{
    const a=row(),b=row('Dos',1);a.has_postponed_matches=true;
    const m=t.build([a,b,row('Uno',2)]);
    assert.equal(t.view(m).partial,true);assert.equal(t.view(m,{participant:'Uno'}).partial,false);
    assert.equal(t.view(m,{participant:'Dos'}).missing,1);
    assert.equal(t.view(m,{participant:'Dos'}).scope.postponed.size,0);
    assert.equal(t.view(m,{participant:'Uno'}).scope.postponed.size,1);
  });
});
test('integration builds once on opening Clubes, caches filters, refreshes corrections and leaves existing aggregates untouched',()=>{
  const t=setup();close(t,()=>{
    let builds=0;const original=t.w.CubanClubStats.build;t.w.CubanClubStats.build=(...args)=>{builds++;return original(...args);};
    const rows=freeze([row(),row('Dos')]),data=t.api.register(rows),before=JSON.stringify(data);
    for(const section of ['captains','lines','mvp','noBonus'])t.api.setLeagueStatsSection(section);
    assert.equal(builds,0);t.doc.getElementById('currentStatisticsPanel').hidden=true;
    t.api.setLeagueStatsSection('clubs');assert.equal(builds,0,'a hidden statistics panel must not build Clubes for the comparator');
    t.doc.getElementById('currentStatisticsPanel').hidden=false;t.api.renderLeagueStatsContent();assert.equal(builds,1);
    assert.equal(t.doc.querySelectorAll('[data-league-stats-section]').length,5);
    const participant=t.doc.getElementById('clubParticipant');participant.value='Uno';participant.dispatchEvent(new t.w.Event('change',{bubbles:true}));
    assert.equal(t.doc.activeElement.id,'clubParticipant');assert.equal(builds,1);
    const toggle=t.doc.getElementById('clubNoBonus');toggle.checked=true;toggle.dispatchEvent(new t.w.Event('change',{bubbles:true}));
    assert.equal(t.doc.activeElement.id,'clubNoBonus');assert.equal(builds,1);
    t.api.setLeagueStatsSection('captains');t.api.setLeagueStatsSection('clubs');assert.equal(builds,1);
    assert.equal(t.doc.getElementById('clubParticipant').value,'Uno');assert.equal(t.doc.getElementById('clubNoBonus').checked,true);
    assert.equal(JSON.stringify(data),before);
    t.api.register([row('Uno',1,{captain:30})]);t.api.renderLeagueStatsContent();assert.equal(builds,2);
    assert.equal(club(t.view(t.api.getModel()),'b').points,30);
    t.api.register([]);t.api.renderLeagueStatsContent();assert.match(t.doc.getElementById('leagueClubsRoot').textContent,/Todavía no hay jornadas/);
  });
});
test('existing fetch is reused with no extra query and its source is available for lazy clubs',async()=>{
  const t=setup();try{
    const rows=[row(),row('Dos')];let requests=0;t.api.configureFetch(rows);
    t.w.fetch=async url=>{assert.match(String(url),/^https:\/\/db.example.test\/rest\/v1\/matchday_stats/);requests++;return {ok:true,json:async()=>rows};};
    await t.api.ensureLeagueStatsData();assert.equal(requests,1);assert.equal(t.api.getModel(),null);
    t.api.setLeagueStatsSection('clubs');assert.equal(requests,1);assert.ok(t.api.getModel());
    await t.api.ensureLeagueStatsData();assert.equal(requests,1);
  }finally{t.dom.window.close();}
});
test('38-round snapshots reconcile every club across 20 participants and filtering never rebuilds the index',()=>{
  const t=setup();close(t,()=>{
    const participants=Array.from({length:20},(_,i)=>({name:'Equipo '+i}));
    const rows=participants.flatMap(p=>Array.from({length:38},(_,i)=>row(p.name,i+1)));
    const model=t.build(rows,{participants});
    for(const withoutBonus of [false,true]){
      const all=t.view(model,{withoutBonus});assert.equal(all.scope.analyzed,760);assert.equal(all.partial,false);
      for(const c of all.clubs){
        const personal=participants.reduce((n,p)=>n+t.view(model,{participant:p.name,withoutBonus}).clubs.find(x=>x.key===c.key).points,0);
        assert.equal(c.points,personal);
      }
    }
    let builds=0;const original=t.w.CubanClubStats.build;t.w.CubanClubStats.build=(...args)=>{builds++;return original(...args);};
    const host=t.doc.createElement('div');host.id='leagueClubsRoot';t.doc.body.append(host);t.w.CubanClubStats.render(host,model);
    for(const participant of participants){const select=host.querySelector('#clubParticipant');select.value=participant.name;select.dispatchEvent(new t.w.Event('change',{bubbles:true}));}
    assert.equal(builds,0);assert.equal(host.querySelectorAll('.cs-detail-list').length,0);
  });
});
test('disclosures render lazily and retain links to the best lineup and participant profiles',()=>{
  const t=setup();close(t,()=>{
    t.api.register([row(),row('Dos')]);t.api.setLeagueStatsSection('clubs');
    const root=t.doc.getElementById('leagueClubsRoot');assert.equal(root.querySelectorAll('[data-matchday-lineup-player]').length,0);
    const details=[...root.querySelectorAll('.cs-club')].find(d=>d.querySelector('summary').textContent.includes('Club A'));details.open=true;details.dispatchEvent(new t.w.Event('toggle'));
    assert.ok(details.querySelector('[data-matchday-lineup-player="Uno"][data-matchday="1"]'));
    assert.ok(details.querySelector('button[data-profile-player="Uno"]'));
    assert.ok(details.querySelector('.cs-more')); // 10 players, 5 visible initially.
    const detail=details.querySelector('.cs-detail').firstChild;details.dispatchEvent(new t.w.Event('toggle'));assert.equal(details.querySelector('.cs-detail').firstChild,detail);
    t.api.state('ready','No se pudo actualizar');t.api.renderLeagueStatsContent();assert.match(t.doc.getElementById('leagueStatsContent').textContent,/Mostrando datos anteriores/);
    t.api.clear();t.api.state('loading');t.api.renderLeagueStatsContent();assert.equal(t.doc.getElementById('leagueClubsRoot'),null);
    t.api.state('error','Sin conexión');t.api.renderLeagueStatsContent();assert.match(t.doc.getElementById('leagueStatsContent').textContent,/Sin conexión/);
  });
});
test('tab keyboard navigation uses the existing generic handler and preserves all five destinations',()=>{
  const t=setup();close(t,()=>{
    t.api.register([row()]);t.api.setLeagueStatsSection('captains');
    t.doc.addEventListener('click',e=>{const tab=e.target.closest('[data-league-stats-section]');if(tab)t.api.setLeagueStatsSection(tab.dataset.leagueStatsSection,{focus:true});});
    const event={target:t.doc.getElementById('leagueStatsCaptainsTab'),key:'End',preventDefault(){}};
    assert.equal(t.api.handleProfileTabsKeydown(event),true);assert.equal(t.doc.activeElement.id,'leagueStatsClubsTab');
    t.api.handleProfileTabsKeydown({...event,target:t.doc.activeElement,key:'ArrowRight'});assert.equal(t.doc.activeElement.id,'leagueStatsCaptainsTab');
  });
});
test('UI escapes names, rejects unsafe images, resets preferences for a new season and parses its scoped responsive CSS',()=>{
  const t=setup();close(t,()=>{
    const r=row();r.lineup[10].club_name='<img src=x onerror=alert(1)>';r.lineup[10].player_name='<script>bad()</script>';
    const m=t.build([r],{clubs:[{id:'b',name:'Other',crest:'javascript:alert(1)'}]});
    const root=t.doc.createElement('div');root.id='leagueClubsRoot';t.doc.body.append(root);t.w.CubanClubStats.render(root,m);
    root.querySelectorAll('.cs-club').forEach(d=>{d.open=true;d.dispatchEvent(new t.w.Event('toggle'));});
    assert.equal(root.querySelector('script,[onerror],img[src^="javascript:"]'),null);assert.match(root.textContent,/<script>bad/);
    root.querySelector('#clubNoBonus').checked=true;root.querySelector('#clubNoBonus').dispatchEvent(new t.w.Event('change',{bubbles:true}));
    t.w.CubanClubStats.render(root,t.build([],{season:'2027/28'}));assert.equal(root.querySelector('#clubNoBonus').checked,false);
    const css=read('club-stats.css');assert.ok(cssom.parse(css).cssRules.length>20);
    const check=rules=>{for(const rule of rules){if(rule.cssRules)check(rule.cssRules);else assert.match(rule.selectorText,/^#league(?:ClubsRoot|StatsContent)/);}};check(cssom.parse(css).cssRules);
    assert.match(css,/min-height:44px/);assert.match(css,/@media\(max-width:380px\)/);assert.doesNotMatch(css,/backdrop-filter|animation:|position:fixed/);
    assert.doesNotMatch(read('club-stats.js'),/\bfetch\(|localStorage|setInterval|requestAnimationFrame/);
    for(const file of ['club-stats.js','club-stats.css']){assert.ok(read('index.html').includes(file+'?v=200-20261104-club-contributions'));assert.ok(read('sw.js').includes(file+'?v=200-20261104-club-contributions'));}
  });
});
