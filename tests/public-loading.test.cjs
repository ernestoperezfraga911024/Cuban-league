const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const data=()=>JSON.parse(read('data.json'));
const response=rows=>({ok:true,json:async()=>rows});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function publishedRows(){
  return data().participants.filter(p=>p.active!==false).map((p,index)=>({
    participant_name:p.name,matchday:1,points:100-index,goals:1,clean_sheets:0,
    red_cards:0,mister_rank:index+1,negative_balance_no_score:false,
    has_postponed_matches:false,updated_at:'2026-10-16T12:00:00Z'
  }));
}
function setup(){
  const dom=new JSDOM(read('index.html'),{url:'https://example.test/Cuban-league/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;
  w.scrollTo=()=>{};
  w.matchMedia=()=>({matches:true});
  w.HTMLCanvasElement.prototype.getContext=()=>null;
  w.CUBAN_LEAGUE_SUPABASE={url:'https://league.test',publishableKey:'test-public',season:'2026/27'};
  w.fetch=async()=>{throw new Error('Unexpected network request');};
  w.eval(read('app.js').replace(/init\(\);\s*$/,`window.loadingTest={
    init,syncPublishedData,syncAchievementMilestones,renderHomeLive,
    fetchPublishedMatchdayLineup,fetchPublishedProfileSeasonRows,fetchPublishedLeagueStatsRows,
    signature:profileSeasonPublishedRowsSignature,
    setData(data){DATA=data;},
    snapshot(){return JSON.stringify({data:DATA,rows:LIVE_MATCHDAY_ROWS,milestones:MATCHDAY_MILESTONES});},
    milestones(){return JSON.stringify(MATCHDAY_MILESTONES);},
    status(){return LIVE_STATS_STATUS;}
  };`));
  w.loadingTest.setData(data());
  return {dom,w,doc:w.document,api:w.loadingTest};
}

test('initial HTML and first render show loading, never the previous-season podium',()=>{
  const {dom,doc,api}=setup();
  try{
    for(const render of [()=>{},()=>api.renderHomeLive()]){
      render();
      const hero=doc.getElementById('heroKpis');
      assert.match(hero.textContent,/Cargando clasificación/);
      assert.equal(hero.getAttribute('aria-busy'),'true');
      assert.doesNotMatch(hero.textContent,/2025\/26|Juventus|ANDOBA|Clasificación final/);
      assert.equal(hero.querySelectorAll('[data-profile-player],img').length,0);
      assert.doesNotMatch(doc.getElementById('homeLiveTitle').textContent,/comienzo/);
    }
  }finally{dom.window.close();}
});

test('concurrent refreshes share one request and current podium does not wait for milestones',async()=>{
  const {dom,w,doc,api}=setup();
  const stats=deferred(),milestones=deferred(),requests=[];
  try{
    w.fetch=(url,options)=>{
      const u=new URL(url);requests.push(u);
      assert.equal(options.method||'GET','GET');
      assert.equal(u.searchParams.get('season'),'eq.2026/27');
      if(u.pathname.endsWith('/matchday_stats')){
        assert.equal(u.searchParams.get('published'),'eq.true');
        assert.ok(options.signal);
        return stats.promise;
      }
      return milestones.promise;
    };
    const first=api.syncPublishedData();
    assert.equal(api.syncPublishedData(),first);
    assert.equal(api.syncPublishedData(),first);
    assert.equal(requests.length,1);
    assert.match(doc.getElementById('heroKpis').textContent,/Cargando/);
    stats.resolve(response(publishedRows()));
    await turn();
    assert.match(doc.getElementById('heroKpis').textContent,/Podio actual/);
    assert.equal(doc.querySelector('.hero-kpi-first b').textContent,publishedRows()[0].participant_name);
    assert.equal(doc.getElementById('heroKpis').getAttribute('aria-busy'),'false');
    assert.equal(requests.length,2);
    milestones.resolve(response([]));
    await first;
  }finally{dom.window.close();}
});

test('failure is not preseason; successful empty publication alone may show the archived podium',async()=>{
  const {dom,w,doc,api}=setup();
  try{
    w.fetch=async()=>{throw new Error('Offline');};
    await api.syncPublishedData();
    assert.equal(api.status(),'error');
    assert.match(doc.getElementById('heroKpis').textContent,/Clasificación no disponible/);
    assert.doesNotMatch(doc.getElementById('heroKpis').textContent,/2025\/26/);
    assert.equal(doc.getElementById('liveDataNotice').hidden,false);
    w.fetch=async()=>response([]);
    await api.syncPublishedData();
    assert.equal(api.status(),'ready');
    assert.match(doc.getElementById('heroKpis').textContent,/Podio 2025\/26/);
    assert.equal(doc.getElementById('liveDataNotice').hidden,true);
  }finally{dom.window.close();}
});

test('unchanged polling preserves DOM; a network failure preserves standings and recovery applies corrections',async()=>{
  const {dom,w,doc,api}=setup();
  let rows=publishedRows();
  try{
    w.fetch=async url=>response(String(url).includes('matchday_stats')?rows:[]);
    await api.syncPublishedData();
    const row=doc.getElementById('currentRows').firstElementChild;
    const podium=doc.getElementById('heroKpis').firstElementChild;
    const before=api.snapshot();
    await api.syncPublishedData();
    assert.equal(doc.getElementById('currentRows').firstElementChild,row);
    assert.equal(doc.getElementById('heroKpis').firstElementChild,podium);
    w.fetch=async()=>{throw new Error('Offline');};
    await api.syncPublishedData();
    assert.equal(api.status(),'stale');
    assert.equal(api.snapshot(),before);
    assert.match(doc.getElementById('heroKpis').textContent,/Podio actual/);
    rows=rows.map((r,i)=>i===5?{...r,points:500}:r);
    w.fetch=async url=>response(String(url).includes('matchday_stats')?rows:[]);
    await api.syncPublishedData();
    assert.equal(doc.querySelector('.hero-kpi-first b').textContent,rows[5].participant_name);
    assert.equal(doc.getElementById('liveDataNotice').hidden,true);
    const after=JSON.parse(api.snapshot()).data;
    assert.deepEqual(after.historicalTables,data().historicalTables);
    assert.deepEqual(after.champions,data().champions);
  }finally{dom.window.close();}
});

test('failed milestones retain confirmed awards; a successful empty response clears them',async()=>{
  const {dom,w,api}=setup();
  const milestones=[{matchday:1,matchday_date:'2026-09-30',is_month_end:true,is_year_end:false}];
  try{
    w.fetch=async url=>response(String(url).includes('matchday_stats')?publishedRows():milestones);
    await api.syncPublishedData();
    const before=api.milestones();
    assert.equal(JSON.parse(before).length,1);
    for(const result of [()=>{throw new Error('Offline');},()=>({ok:false}),()=>response({error:'invalid'})]){
      w.fetch=async()=>result();
      assert.equal(await api.syncAchievementMilestones({render:false}),false);
      assert.equal(api.milestones(),before);
    }
    w.fetch=async()=>response([]);
    assert.equal(await api.syncAchievementMilestones({render:false}),true);
    assert.equal(api.milestones(),'[]');
  }finally{dom.window.close();}
});

test('a hung stats request times out, releases the refresh lock and allows recovery',async()=>{
  const {dom,w,api}=setup();
  const timers=[];
  try{
    w.setTimeout=(callback,delay)=>{timers.push({callback,delay});return timers.length;};
    w.clearTimeout=()=>{};
    w.fetch=(_url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new w.DOMException('Aborted','AbortError'))));
    const refresh=api.syncPublishedData();
    assert.equal(timers[0].delay,15000);
    timers[0].callback();
    await refresh;
    assert.equal(api.status(),'error');
    w.fetch=async url=>response(String(url).includes('matchday_stats')?publishedRows():[]);
    await api.syncPublishedData();
    assert.equal(api.status(),'ready');
  }finally{dom.window.close();}
});

test('Mister order alone invalidates the published signature for Copa updates',()=>{
  const {dom,api}=setup();
  try{
    const row={participantName:'Ernesto',matchday:5,points:31,misterRank:19};
    assert.notEqual(api.signature([row]),api.signature([{...row,misterRank:20}]));
  }finally{dom.window.close();}
});

test('a slow open lineup cannot hold the shared standings refresh lock',async()=>{
  const {dom,w,api}=setup();
  let requests=0;
  try{
    w.refreshOpenMatchdayLineup=()=>new Promise(()=>{});
    w.fetch=async url=>{requests++;return response(String(url).includes('matchday_stats')?publishedRows():[]);};
    await api.syncPublishedData();
    await api.syncPublishedData();
    assert.equal(requests,4);
  }finally{dom.window.close();}
});

test('slow catalog does not block boot or navigation; lineup queries await catalog and stay read-only',async()=>{
  const {dom,w,doc,api}=setup();
  const catalog=deferred();
  const requests=[];
  try{
    w.localStorage.setItem('cuban-league-owner-browser','1');
    w.CubanLeaguePlayerCatalog={load:()=>catalog.promise};
    w.fetch=async(url,options={})=>{
      requests.push({url:String(url),options});
      if(String(url).startsWith('data.json'))return response(data());
      return response(String(url).includes('matchday_milestones')?[]:publishedRows());
    };
    await api.init();
    await api.syncPublishedData();
    assert.match(doc.getElementById('heroKpis').textContent,/Podio actual/);
    doc.querySelector('[data-go="history"]').click();
    assert.equal(doc.body.dataset.section,'history');
    const initialCount=requests.length;
    const lineup=api.fetchPublishedMatchdayLineup('Ernesto',1);
    const profile=api.fetchPublishedProfileSeasonRows('Ernesto');
    const league=api.fetchPublishedLeagueStatsRows();
    await turn();
    assert.equal(requests.length,initialCount);
    catalog.resolve(null);
    await Promise.all([lineup,profile,league]);
    assert.equal(requests.length,initialCount+3);
    for(const {url,options} of requests.slice(initialCount)){
      const u=new URL(url);
      assert.equal(options.method||'GET','GET');
      assert.equal(u.searchParams.get('published'),'eq.true');
      assert.equal(u.searchParams.get('season'),'eq.2026/27');
    }
  }finally{dom.window.close();}
});

test('failed initial data load offers retry instead of rejecting init',async()=>{
  const {dom,w,doc,api}=setup();
  try{
    w.localStorage.setItem('cuban-league-owner-browser','1');
    w.fetch=async()=>({ok:false,status:503});
    await api.init();
    assert.match(doc.getElementById('heroKpis').textContent,/No se pudo cargar la página/);
    assert.equal(doc.querySelector('#heroKpis button').textContent,'Volver a intentar');
    assert.equal(doc.getElementById('heroKpis').getAttribute('aria-busy'),'false');
  }finally{dom.window.close();}
});
