const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const core=require('../forecast-round-core.js'),{publication}=require('./fixtures/forecast-round.cjs'),root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8'),tick=()=>new Promise(r=>setTimeout(r,0));
const next=(team='real-madrid')=>({...publication(team),schema_version:3,season:'2026-27',matchday:14,fixture_key:'laliga-2026-27-j14-'+team+'-fixture',kickoff_at:'2026-11-28T20:00:00Z'});
const rows=()=>core.config.teams.map(t=>({team:t.id,payload:next(t.id),published_at:'2026-11-12T14:30:00Z',checked_at:'2026-11-12T14:20:00Z',status:'published',attempted_fixture_key:next(t.id).fixture_key}));
const runtime=['forecast-publish-core.js','forecast-round-config.js','forecast-round-core.js','forecast-pitch.js'];
test('manual health-only update uses the existing one-click publication and reports its result',async()=>{
 const dom=new JSDOM(read('admin.html'),{url:'https://preview.test/admin.html',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,calls=[];
 let current=adminState();current.teams=current.teams.map(t=>({...t,ready:false,outcome:'blocked'}));current.health_ready=['real-madrid'];
 try{
  for(const f of [...runtime,'forecast-season-admin.js'])w.eval(read(f));
  const client={rpc:async(name,args)=>{calls.push({name,args});if(name==='get_forecast_season')return{data:current};current={...current,version:9,health_ready:[]};return{data:{outcome:'processed',teams:[],health:{players:2,outcome:'published'}}};}};
  w.CubanForecastSeason.init({client});w.CubanForecastSeason.authorize();w.document.getElementById('forecastTool').open=true;await tick();await tick();
  const publish=w.document.getElementById('forecastSeasonPublish');assert.equal(publish.disabled,false);publish.click();await tick();await tick();
  assert.equal(calls.filter(c=>c.name==='command_forecast_season').length,1);assert.match(w.document.getElementById('forecastSeasonStatus').textContent,/2 estados físicos publicados/);assert.equal(publish.disabled,true);
 }finally{dom.window.close();}
});
test('season accepts verified-shape later matchdays without the fixed J13 identity',()=>{
 for(const t of core.config.teams)assert.equal(core.validate(next(t.id)).matchday,14);
 for(const mutate of [p=>p.season='2027-28',p=>p.matchday=39,p=>p.matchday=14.1,p=>p.fixture_key='laliga-2026-27-j13-x',p=>p.home='foreign',p=>p.away=p.home,p=>p.team='other',p=>p.players[0].id=p.players[1].id,p=>p.players[2].alternative=null,p=>p.kickoff_at='2028-11-21T20:00:00Z']){const p=next();mutate(p);assert.throws(()=>core.validate(p));}
});
test('public season uses one lazy read for 20 teams, shows the actual round and never resurrects a withdrawal',async()=>{
 const dom=new JSDOM(read('index.html'),{url:'https://preview.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;let data=rows(),fail=false;const calls=[];
 try{
  w.CUBAN_LEAGUE_SUPABASE={url:'https://example.supabase.co',publishableKey:'test'};w.CubanLeaguePlayerCatalog={load:async()=>({playersById:new Map()})};w.fetch=async(u,o)=>{calls.push({url:String(u),options:o});return{ok:!fail,json:async()=>data};};
  for(const f of [...runtime,'forecast-season-public.js'])w.eval(read(f));assert.equal(calls.length,0);
  w.document.body.dataset.section='forecasts';await tick();await tick();assert.equal(calls.length,1);assert.ok(calls[0].url.includes('/forecast_season_public?'));assert.equal(calls[0].options.cache,'no-store');
  for(const b of w.document.querySelectorAll('[data-forecast-team]')){b.click();assert.equal(w.document.querySelectorAll('#forecasts .fp-player').length,11);assert.match(w.document.getElementById('forecastPublicBody').textContent,/Jornada 14/);}
  assert.equal(calls.length,1);
  const madrid=data.find(x=>x.team==='real-madrid');madrid.status='blocked';w.document.getElementById('forecastTeamMadrid').click();assert.match(w.document.getElementById('forecastPublicStatus').textContent,/bloqueada/);assert.equal(w.document.querySelectorAll('.fp-player').length,11);
  madrid.status='withdrawn';madrid.payload=null;w.document.getElementById('forecastPublicReload').click();await tick();await tick();assert.equal(w.document.querySelectorAll('.fp-player').length,0);
  fail=true;w.document.getElementById('forecastPublicReload').click();await tick();await tick();assert.equal(w.document.querySelectorAll('.fp-player').length,0);assert.match(w.document.getElementById('forecastPublicStatus').textContent,/No se pudo verificar/);
 }finally{dom.window.close();}
});
function adminState(){return{version:8,mode:'manual',last_run:{slot_at:'2026-11-12T14:00:00Z',expected:core.config.teams.map(t=>t.id),finished_at:'2026-11-12T14:30:00Z',results:core.config.teams.map(t=>({team:t.id,outcome:'ready'}))},teams:core.config.teams.map(t=>({team:t.id,paused:false,outcome:'ready',reason:null,checked_at:'2026-11-12T14:20:00Z',preview:next(t.id),published_at:null,ready:true}))};}
test('manual publishes in one click; uncertain responses retry exactly the same command; logout clears private state',async()=>{
 const dom=new JSDOM(read('admin.html'),{url:'https://preview.test/admin.html',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;const calls=[];let fail=true,current=adminState();
 try{
  w.CubanLeaguePlayerCatalog={load:async()=>({playersById:new Map()})};for(const f of [...runtime,'forecast-season-admin.js'])w.eval(read(f));
  const client={rpc:async(name,args)=>{calls.push({name,args});if(name==='get_forecast_season')return{data:current};if(fail){fail=false;throw Error('response lost');}current={...current,version:9};return{data:{outcome:'processed',teams:[{team:'real-madrid',outcome:'published'}]}};}};
  w.CubanForecastSeason.init({client});w.CubanForecastSeason.authorize();assert.equal(calls.length,0);w.document.getElementById('forecastTool').open=true;await tick();await tick();assert.equal(w.document.querySelectorAll('.fs-team').length,20);assert.match(w.document.getElementById('forecastSeasonSummary').textContent,/20\/20/);
  w.document.getElementById('forecastSeasonPublish').click();await tick();assert.equal(w.document.getElementById('forecastSeasonRetry').hidden,false);const first=calls.find(c=>c.name==='command_forecast_season').args;assert.equal(first.p_action,'publish');assert.equal(first.p_team,null);assert.equal(first.p_expected_version,8);
  w.document.getElementById('forecastSeasonRetry').click();await tick();await tick();const writes=calls.filter(c=>c.name==='command_forecast_season');assert.equal(writes.length,2);assert.deepEqual(writes[1].args,first);assert.equal(w.document.getElementById('forecastSeasonRetry').hidden,true);
  w.CubanForecastSeason.reset();assert.equal(w.document.querySelectorAll('.fs-team').length,0);assert.equal(w.document.getElementById('forecastSeasonPublish').disabled,true);
 }finally{dom.window.close();}
});
test('season wiring keeps the old pilot read-only and precaches the new forecast assets',()=>{
 const index=read('index.html'),admin=read('admin.html'),sw=read('sw.js');assert.match(index,/forecast-season-public\.js\?v=215/);assert.doesNotMatch(index,/src="forecast-public\.js/);assert.match(admin,/forecast-season-admin\.js\?v=212/);assert.match(admin,/id="forecastManage"[^>]*hidden/);assert.match(admin,/Historial del piloto anterior/);assert.match(sw,/cuban-league-v217-mobile-home-shortcuts/);assert.match(sw,/forecast-season-public\.js\?v=215/);
});

