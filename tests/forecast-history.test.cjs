const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const history=require('../forecast-history-core.js'),round=require('../forecast-round-core.js'),catalog=require('../catalog/players.json'),{publication}=require('./fixtures/forecast-round.cjs');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8'),tick=()=>new Promise(r=>setTimeout(r,0));
const runtime=['forecast-publish-core.js','forecast-round-config.js','forecast-round-core.js','forecast-pitch.js','forecast-history-core.js'];
function record(team='real-madrid',hits=9,day=13){
 const prediction=publication(team);if(day!==13)Object.assign(prediction,{schema_version:3,season:'2026-27',matchday:day,fixture_key:'laliga-2026-27-j'+day+'-'+prediction.home+'-'+prediction.away,kickoff_at:'2026-11-28T20:00:00Z'});
 const players=catalog.players.filter(p=>p.club_id===team),expected=prediction.players.map(p=>({id:p.id,name:p.name})),extra=players.slice(11,22).map(p=>({id:p.id,name:p.display_name}));
 const official_starters=[...expected.slice(0,hits),...extra.slice(0,11-hits)],correct_ids=expected.slice(0,hits).map(p=>p.id),missed_ids=expected.slice(hits).map(p=>p.id);
 return {team,fixture_key:prediction.fixture_key,season:'2026-27',matchday:day,home:prediction.home,away:prediction.away,kickoff_at:prediction.kickoff_at,prediction,prediction_published_at:'2026-11-11T20:01:00Z',cutoff_at:new Date(Date.parse(prediction.kickoff_at)-7200000).toISOString(),status:'evaluated',official_starters,correct_ids,missed_ids,unexpected_starters:extra.slice(0,11-hits),hits,verification_stage:'final',verified_at:new Date(Date.parse(prediction.kickoff_at)+10800000).toISOString(),source_url:prediction.sources.find(s=>s.id==='futbolfantasy').url,published_at:new Date(Date.parse(prediction.kickoff_at)+10900000).toISOString()};
}
const summary=r=>Object.fromEntries(['team','fixture_key','season','matchday','home','away','kickoff_at','status','hits','verification_stage'].map(k=>[k,r[k]]));
function pending(row){return {...row,status:'pending',hits:null,verification_stage:null,verified_at:null,official_starters:[],correct_ids:[],missed_ids:[],unexpected_starters:[]};}
test('11, 9 and 0 starters score correctly; bench participation and pending matches never add hits',()=>{
 for(const hits of [11,9,0]){const r=record('real-madrid',hits);assert.equal(history.detail(r).hits,hits);assert.equal(history.aggregate([r],r.team).percentage,100*hits/11);}
 const a=record(),b=record('real-madrid',8,14),c=pending(record('real-madrid',0,15));history.rows([a,b,c],true);const total=history.aggregate([a,b,c],'real-madrid');assert.equal(total.hits,17);assert.equal(total.total,22);assert.equal(total.matches,2);assert.equal(total.pending,1);assert.equal(history.percentage(900/11),'81,8%');assert.equal(history.percentage(null),'—');
 const bad=record();bad.correct_ids.push(bad.missed_ids[0]);bad.hits++;assert.throws(()=>history.detail(bad),/inconsistentes/);
});
test('all real J13 fixture keys retain their registered club identity, including legacy slugs',()=>{
 for(const team of round.config.teams){const r=record(team.id);assert.equal(history.detail(r).fixture_key,round.fixture(team.id).key);}
 const r=record();r.away='valencia';assert.throws(()=>history.detail(r));
});
test('rejects duplicates, invalid season, changed baselines, bad official data and unsafe source URLs',()=>{
 for(const change of [r=>r.season='2027-28',r=>r.matchday=12,r=>r.official_starters[1]=r.official_starters[0],r=>r.hits=12,r=>r.prediction_published_at=r.kickoff_at,r=>r.prediction.team='valencia',r=>r.cutoff_at=r.kickoff_at,r=>r.source_url='https://evil.test/partidos/x',r=>r.status='pending']){const r=record();change(r);assert.throws(()=>history.detail(r));}
 assert.throws(()=>history.rows([record(),record()]));assert.equal(history.sourceUrl('https://www.futbolfantasy.com.evil.test/partidos/123'), '');
});
function browser(){const dom=new JSDOM(read('index.html'),{url:'https://preview.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;w.CUBAN_LEAGUE_SUPABASE={url:'https://example.supabase.co',publishableKey:'test'};w.CubanLeaguePlayerCatalog={load:async()=>({playersById:new Map()})};for(const f of runtime)w.eval(read(f));return dom;}
test('history opens lazily, preserves 11 names without photos, and changes clubs/metrics without requests',async()=>{
 const dom=browser(),w=dom.window,calls=[];let data=[record(),record('fc-barcelona',10)],fail=false;
 try{
  w.fetch=async(url,options)=>{calls.push({url:String(url),options});const u=new URL(url);return {ok:!fail,json:async()=>u.searchParams.get('select').includes('prediction')?data:data.map(summary)};};w.eval(read('forecast-history.js'));assert.equal(calls.length,0);
  w.document.body.dataset.section='forecasts';await tick();assert.equal(calls.length,0);w.document.getElementById('forecastViewHistory').click();await tick();await tick();
  assert.equal(calls.length,2);assert.ok(calls.every(c=>c.options.cache==='no-store'));assert.equal(w.document.querySelectorAll('.fh-player').length,11);assert.equal(w.document.querySelectorAll('.fh-player.fh-hit').length,9);assert.equal(w.document.querySelectorAll('.fh-player.fh-miss').length,2);assert.equal(w.document.querySelectorAll('.fh-initials').length,11);assert.match(w.document.getElementById('forecastHistoryBody').textContent,/81,8%/);
  const madrid=w.document.querySelector('[data-history-team="real-madrid"]');assert.equal(madrid.firstElementChild.className,'fh-club-score');assert.equal(madrid.getAttribute('aria-pressed'),'true');w.document.getElementById('forecastHistoryAccumulated').click();w.document.querySelector('[data-history-team="fc-barcelona"]').click();assert.equal(calls.length,2);assert.match(w.document.getElementById('forecastHistoryBody').textContent,/90,9%/);
  data=[];w.document.getElementById('forecastPublicReload').click();await tick();await tick();assert.equal(w.document.querySelectorAll('.fh-player').length,0);assert.equal(w.document.querySelector('[data-history-team="fc-barcelona"] .fh-club-score').textContent,'—');assert.match(w.document.getElementById('forecastHistoryBody').textContent,/Todavía no hay historial público/);
  fail=true;w.document.getElementById('forecastPublicReload').click();await tick();await tick();assert.match(w.document.getElementById('forecastHistoryStatus').textContent,/No se pudo verificar/);assert.equal(w.document.querySelectorAll('.fh-player').length,0);
 }finally{dom.window.close();}
});
test('pending has no red players or false zero and late responses cannot restore a hidden history',async()=>{
 const dom=browser(),w=dom.window;let data=[pending(record())],deferred=false;const resolves=[];
 try{
  w.fetch=async url=>{if(deferred)await new Promise(r=>{resolves.push(r);});return {ok:true,json:async()=>new URL(url).searchParams.get('select').includes('prediction')?data:data.map(summary)};};w.eval(read('forecast-history.js'));w.document.body.dataset.section='forecasts';w.document.getElementById('forecastViewHistory').click();await tick();await tick();assert.equal(w.document.querySelectorAll('.fh-player.fh-miss').length,0);assert.equal(w.document.querySelector('.fh-accuracy').textContent,'—');assert.match(w.document.getElementById('forecastHistoryBody').textContent,/no cuenta como fallo/);
  deferred=true;const select=w.document.getElementById('forecastHistoryRound');select.value='14';select.dispatchEvent(new w.Event('change'));await tick();w.document.getElementById('forecastViewCurrent').click();await tick();resolves.forEach(resolve=>resolve());await tick();await tick();assert.equal(w.document.getElementById('forecastHistoryBody').children.length,0);assert.equal(w.document.getElementById('forecastHistoryPanel').hidden,true);assert.equal(w.document.getElementById('forecastPublicReload').disabled,false);
 }finally{dom.window.close();}
});
test('changing round refreshes accumulated scores and clears a withdrawal from the previous round',async()=>{
 const dom=browser(),w=dom.window,calls=[];let data=[record()];
 try{
  w.fetch=async url=>{const u=new URL(url);calls.push(u);return{ok:true,json:async()=>u.searchParams.get('select').includes('prediction')?data:data.map(summary)};};w.eval(read('forecast-history.js'));w.document.body.dataset.section='forecasts';w.document.getElementById('forecastViewHistory').click();await tick();await tick();w.document.getElementById('forecastHistoryAccumulated').click();const score=()=>w.document.querySelector('[data-history-team="real-madrid"] .fh-club-score').textContent;assert.equal(score(),'81,8%');assert.equal(calls.length,2);
  data=[];const select=w.document.getElementById('forecastHistoryRound');select.value='14';select.dispatchEvent(new w.Event('change'));assert.equal(score(),'—');await tick();await tick();assert.equal(calls.length,4);assert.equal(calls.filter(u=>!u.searchParams.has('matchday')).length,2);assert.equal(score(),'—');assert.equal(w.document.querySelectorAll('.fh-player').length,0);assert.match(w.document.getElementById('forecastHistoryBody').textContent,/Todavía no hay historial público/);
  w.document.getElementById('forecastHistoryThisRound').click();w.document.getElementById('forecastHistoryAccumulated').click();assert.equal(calls.length,4);assert.equal(score(),'—');
 }finally{dom.window.close();}
});
test('switching history/current never fetches both feeds on reload and retains club selection',async()=>{
 const dom=browser(),w=dom.window,calls=[];
 try{
  w.fetch=async url=>{const u=new URL(url);calls.push(u.pathname);if(u.pathname.endsWith('/forecast_season_public'))return{ok:true,json:async()=>round.config.teams.map(t=>({team:t.id,payload:publication(t.id),published_at:'2026-11-11T20:01:00Z',checked_at:'2026-11-11T20:00:00Z',status:'published'}))};return{ok:true,json:async()=>u.searchParams.get('select').includes('prediction')?[record(),record('fc-barcelona',10)]:[record(),record('fc-barcelona',10)].map(summary)};};w.eval(read('forecast-season-public.js'));w.eval(read('forecast-history.js'));w.document.body.dataset.section='forecasts';await tick();await tick();assert.equal(calls.filter(x=>x.endsWith('/forecast_season_public')).length,1);w.document.getElementById('forecastViewHistory').click();await tick();await tick();w.document.querySelector('[data-history-team="fc-barcelona"]').click();w.document.getElementById('forecastPublicReload').click();await tick();await tick();assert.equal(calls.filter(x=>x.endsWith('/forecast_season_public')).length,1);w.document.getElementById('forecastViewCurrent').click();await tick();await tick();assert.equal(w.document.querySelector('[data-forecast-team="fc-barcelona"]').getAttribute('aria-pressed'),'true');assert.equal(w.document.querySelectorAll('#forecastPublicBody .fp-player').length,11);
 }finally{dom.window.close();}
});
test('manual history publication retries the same request and clears private results on logout',async()=>{
 const dom=new JSDOM(read('admin.html'),{url:'https://preview.test/admin.html',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,calls=[];let failed=false,ready=[{fixture_key:record().fixture_key,team:'real-madrid',matchday:13,hits:9,version:1,verification_stage:'final'}];
 try{
  for(const f of runtime)w.eval(read(f));w.eval(read('forecast-history-admin.js'));const client={rpc:async(name,args)=>{calls.push({name,args});if(name==='get_forecast_history_admin')return{data:{ready,pending_count:0}};if(!failed){failed=true;throw Error('lost response');}ready=[];return{data:{outcome:'processed',results:[{fixture_key:record().fixture_key,team:'real-madrid',outcome:'published'}]}};}};
  w.CubanForecastHistoryAdmin.init({client});w.CubanForecastHistoryAdmin.authorize();assert.equal(calls.length,0);w.document.getElementById('forecastTool').open=true;await tick();await tick();assert.equal(w.document.getElementById('forecastHistoryPublish').disabled,false);w.document.getElementById('forecastHistoryPublish').click();await tick();const first=calls.find(c=>c.name==='publish_forecast_history').args;assert.equal(w.document.getElementById('forecastHistoryAdminRetry').hidden,false);w.document.getElementById('forecastHistoryAdminRetry').click();await tick();await tick();assert.deepEqual(calls.filter(c=>c.name==='publish_forecast_history')[1].args,first);assert.match(w.document.getElementById('forecastHistoryAdminStatus').textContent,/1 resultados publicados/);w.CubanForecastHistoryAdmin.reset();assert.equal(w.document.getElementById('forecastHistoryAdminRows').children.length,0);assert.equal(w.document.getElementById('forecastHistoryPublish').disabled,true);
 }finally{dom.window.close();}
});
test('responsive rules, keyboard controls and service worker include all history assets',()=>{
 const css=read('forecast-history.css'),index=read('index.html'),sw=read('sw.js');assert.match(css,/@media\(max-width:360px\)/);assert.match(css,/grid-template-columns:minmax\(0,1fr\)/);assert.match(css,/focus-visible/);assert.match(index,/id="forecastHistoryRound" aria-label=/);assert.match(index,/id="forecastViewHistory"[^>]*aria-pressed="false"/);
 for(const asset of ['forecast-history.js','forecast-history-core.js','forecast-history-admin.js','forecast-history.css'])assert.ok(sw.includes(asset+'?v=209-20261112'));assert.match(sw,/cuban-league-v219-audience/);assert.match(index,/forecast-history-core\.js\?v=209/);
});
