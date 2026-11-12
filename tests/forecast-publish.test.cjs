const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),core=require('../forecast-publish-core.js'),{publication,draft}=require('./fixtures/forecast-publication.cjs');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8'),tick=()=>new Promise(r=>setTimeout(r,0));
function browser(file='admin.html'){
 const dom=new JSDOM(read(file),{url:'https://preview.test/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;w.confirm=()=>true;w.scrollTo=()=>{};
 w.fetch=async()=>({ok:true,json:async()=>JSON.parse(read('catalog/players.json'))});
 for(const f of ['player-catalog.js','forecast-review-core.js','forecast-publish-core.js','forecast-pitch.js'])w.eval(read(f));
 return {dom,w,$:id=>w.document.getElementById(id)};
}
function editor(handler){
 const b=browser(),calls=[];b.w.eval(read('forecast-editor.js'));
 b.w.CubanForecastEditor.init({client:{rpc:async(name,args)=>{calls.push({name,args});return handler(name,args);}}});
 return {...b,calls};
}
const emptyState={version:0,current_revision:null,revisions:[]};
test('visible publication entry opens the selected draft and enables save without an empty history detour',async()=>{
 const source={...draft(),created_at:'2026-11-11T17:00:00Z',status:'draft'},b=browser();
 const calls=[];try{
 b.w.eval(read('forecast-editor.js'));b.w.eval(read('forecast-review.js'));
 b.w.CubanForecastReview.init({client:{rpc:async(name,args)=>{
  calls.push({name,args});return {data:name==='get_forecast_publication'?emptyState:args.p_run_key?source:[source]};
 }}});b.w.CubanForecastReview.authorize();b.$('forecastTool').open=true;
 b.$('forecastTool').dispatchEvent(new b.w.Event('toggle'));await tick();await tick();
 assert.equal(b.$('forecastVersions').value,source.run_key);
 b.$('forecastEditor').scrollIntoView=()=>{throw Error('Scrolling unavailable');};
 b.$('forecastManage').click();await tick();await tick();
 assert.equal(b.$('forecastEditPlayers').querySelectorAll('fieldset').length,11);
 assert.equal(b.$('forecastSaveRevision').disabled,false);assert.equal(b.$('forecastPublish').disabled,true);
 assert.equal(calls.filter(x=>x.name==='command_forecast_publication').length,0);
 }finally{b.dom.window.close();}
});
test('publication validation enforces fixture, XI, roles, probabilities, alternatives and exact source hosts',()=>{
 assert.equal(core.validate(publication()).players.length,11);
 const mutations=[p=>p.team='celta',p=>p.players.pop(),p=>p.players[0].id=p.players[1].id,p=>p.players[0].slot=2,
  p=>p.players[0].position='FW',p=>p.players[0].probability=100.1,p=>p.players[1].alternative=null,
  p=>p.players[0].alternative={id:'a-lunin',name:'Lunin'},p=>p.players[1].alternative=p.players[0],
  p=>p.sources[0].url='https://www.futbolfantasy.com.evil.test/',p=>p.sources[0].url='javascript:alert(1)',
  p=>p.sources[0].url='https://user@www.futbolfantasy.com/',p=>p.sources[0].id='unknown',p=>p.evidence_at='2026-11-12T00:00:00Z'];
 for(const mutate of mutations){const p=publication();mutate(p);assert.throws(()=>core.validate(p));}
 assert.match(core.freshness(publication(),Date.parse('2026-11-13T00:00Z')),/24 horas/);
 assert.match(core.freshness(publication(),Date.parse('2026-11-21T20:00Z')),/Archivo/);
});
test('catalog portraits, fallback, safe text and accessible detail are shared by preview and public',async()=>{
 const b=browser();try{
 const p=publication();p.players[0].name='<img src=x onerror=alert(1)>';p.players[0].photo='https://evil.test/x';
 const c=await b.w.CubanLeaguePlayerCatalog.load(),host=b.$('forecastPreview');b.w.CubanForecastPitch.render(host,p,c,{preview:true});
 assert.equal(host.querySelectorAll('.fp-player').length,11);assert.equal(host.querySelectorAll('.fp-alt-name').length,1);
 assert.equal(host.querySelectorAll('img[src^="https://evil"]').length,0);assert.equal(host.querySelectorAll('img[src="x"]').length,0);
 const img=host.querySelector('.fp-player img');assert.match(img.getAttribute('src'),/^catalog\/faces\//);assert.equal(img.loading,'lazy');
 const frame=img.parentElement;img.dispatchEvent(new b.w.Event('error'));assert.equal(frame.querySelector('img'),null);assert.equal(frame.querySelector('.fp-initials').hidden,false);
 const detail=host.querySelector('.fp-detail'),button=host.querySelector('.fp-player');
 const closed=()=>{assert.equal(detail.hidden,true);assert.equal(detail.textContent,'');assert.equal(host.querySelectorAll('[aria-pressed="true"],.fp-layout.has-selection').length,0);};closed();
 button.click();assert.equal(detail.hidden,false);button.click();closed();
 button.click();detail.dispatchEvent(new b.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));closed();assert.equal(b.w.document.activeElement,button);
 button.click();assert.equal(button.getAttribute('aria-pressed'),'true');assert.equal(b.w.document.activeElement,host.querySelector('.fp-detail'));
 host.querySelector('.fp-link').click();assert.equal(b.w.document.activeElement,button);closed();assert.match(host.textContent,/No consta/);
 }finally{b.dom.window.close();}
});
test('public module makes no requests on home, reads only published table, clears withdrawn and failed snapshots',async()=>{
 const b=browser('index.html'),requests=[];let rows=[{payload:publication(),published_at:'2026-11-11T17:00:00Z',revision_id:1}],fail=false;
 try{
 const original=b.w.fetch;b.w.CUBAN_LEAGUE_SUPABASE={url:'https://db.test',publishableKey:'public-test'};
 b.w.fetch=async(url,options)=>{if(String(url).includes('catalog/'))return original(url,options);requests.push({url:String(url),options});if(fail)throw Error('offline');return {ok:true,json:async()=>rows};};
 b.w.eval(read('forecast-public.js'));await tick();assert.equal(requests.length,0);
 b.w.document.body.dataset.section='forecasts';await tick();await tick();assert.equal(requests.length,1);assert.equal(b.$('forecastPublicBody').querySelectorAll('.fp-player').length,11);assert.match(requests[0].url,/\/rest\/v1\/forecast_public\?/);assert.equal(requests[0].options.cache,'no-store');
 rows=[];b.$('forecastPublicReload').click();await tick();assert.equal(b.$('forecastPublicBody').textContent,'');assert.match(b.$('forecastPublicStatus').textContent,/no hay/);
 fail=true;b.$('forecastPublicReload').click();await tick();assert.match(b.$('forecastPublicStatus').textContent,/No se pudo verificar/);assert.equal(b.$('forecastPublicBody').textContent,'');
 }finally{b.dom.window.close();}
});
test('editor refuses unauthenticated loads, checks original method and never publishes on save',async()=>{
 let state=structuredClone(emptyState);const b=editor((name,args)=>{
  if(name==='get_forecast_publication')return {data:state};
  state={version:1,current_revision:null,revisions:[{id:1,source_key:draft().run_key,created_at:'2026-11-11T17:00Z',ever_published:false}]};return {data:{version:1,current_revision:null,revision_id:1,action:'save'}};
 });try{
 await b.w.CubanForecastEditor.open(draft());assert.equal(b.calls.length,0);
 b.w.CubanForecastEditor.authorize();await b.w.CubanForecastEditor.open(draft());assert.equal(b.$('forecastEditPlayers').querySelectorAll('fieldset').length,11);
 assert.equal(b.$('forecastPublish').disabled,true);b.$('forecastSaveRevision').click();await tick();await tick();
 const commands=b.calls.filter(x=>x.name==='command_forecast_publication');assert.equal(commands.length,1);assert.equal(commands[0].args.p_action,'save');assert.equal(commands[0].args.p_players.length,11);assert.equal(commands[0].args.p_players[0].alternative_id,null);assert.equal(b.$('forecastPublish').disabled,true);
 assert.match(b.$('forecastEditorStatus').textContent,/guardada en privado/);
 }finally{b.dom.window.close();}
});
test('uncertain network result retains exact command UUID and locks editing until retry resolves',async()=>{
 let fail=true;const b=editor((name)=>name==='get_forecast_publication'?{data:emptyState}:fail?{error:{code:'FETCH_ERROR'}}:{data:{action:'save',revision_id:1,version:1,current_revision:null}});
 try{
 b.w.CubanForecastEditor.authorize();await b.w.CubanForecastEditor.open(draft());b.$('forecastSaveRevision').click();await tick();
 assert.equal(b.$('forecastCommandRetry').hidden,false);assert.equal(b.$('forecastPublicNote').disabled,true);
 fail=false;b.$('forecastCommandRetry').click();await tick();await tick();const cmds=b.calls.filter(x=>x.name==='command_forecast_publication');assert.equal(cmds.length,2);assert.deepEqual(cmds[0].args,cmds[1].args);assert.equal(b.$('forecastCommandRetry').hidden,true);
 }finally{b.dom.window.close();}
});
test('save opens the persisted preview automatically and still needs checkbox plus explicit publish',async()=>{
 const source=draft(),payload=publication();payload.note='Nota devuelta por el servidor, no una vista previa de campos sin guardar.';
 let version=0,current=null;const b=editor((name,args)=>{
  if(name==='command_forecast_publication'){version++;if(args.p_action==='publish')current=7;return {data:{version,current_revision:current,revision_id:7,action:args.p_action}};}
  return {data:args.p_revision_id?{version,revision:{id:7,source_key:source.run_key,payload}}:{version,current_revision:current,revisions:version?[{id:7,created_at:'2026-11-11T17:00Z',ever_published:!!current}]:[]}};
 });try{
 b.w.CubanForecastEditor.authorize();await b.w.CubanForecastEditor.open(source);b.$('forecastSaveRevision').click();await tick();await tick();
 assert.equal(b.$('forecastPreview').querySelectorAll('.fp-player').length,11);assert.equal(b.$('forecastPublicNote').value,payload.note);
 assert.deepEqual(b.calls.filter(x=>x.name==='command_forecast_publication').map(x=>x.args.p_action),['save']);
 assert.equal(b.$('forecastPublish').disabled,true);assert.match(b.$('forecastPublishHint').textContent,/casilla/);
 b.$('forecastPublishConfirm').checked=true;b.$('forecastPublishConfirm').dispatchEvent(new b.w.Event('change'));assert.equal(b.$('forecastPublish').disabled,false);
 b.$('forecastPublish').click();await tick();await tick();assert.deepEqual(b.calls.filter(x=>x.name==='command_forecast_publication').map(x=>x.args.p_action),['save','publish']);
 }finally{b.dom.window.close();}
});
test('failed post-save reads keep a known saved revision recoverable without issuing a duplicate save',async()=>{
 for(const failAt of ['list','detail']){
  let saved=false,fail=true;const source=draft(),payload=publication();const b=editor((name,args)=>{
   if(name==='command_forecast_publication'){saved=true;return {data:{version:1,current_revision:null,revision_id:7,action:'save'}};}
   if(saved&&fail&&((failAt==='list'&&!args.p_revision_id)||(failAt==='detail'&&args.p_revision_id)))return {error:{code:'FETCH_ERROR'}};
   return {data:args.p_revision_id?{version:1,revision:{id:7,source_key:source.run_key,payload}}:{version:saved?1:0,current_revision:null,revisions:saved?[{id:7,created_at:'2026-11-11T17:00Z',ever_published:false}]:[]}};
  });try{
   b.w.CubanForecastEditor.authorize();await b.w.CubanForecastEditor.open(source);b.$('forecastSaveRevision').click();await tick();await tick();
   assert.match(b.$('forecastEditorStatus').textContent,/guardada en privado.*no necesitas guardar de nuevo/s);assert.equal(b.$('forecastSavedRevisions').value,'7');assert.equal(b.$('forecastPublish').disabled,true);assert.equal(b.$('forecastCommandRetry').hidden,true);
   fail=false;b.$('forecastLoadRevision').click();await tick();assert.equal(b.$('forecastPreview').querySelectorAll('.fp-player').length,11);
   assert.equal(b.calls.filter(x=>x.name==='command_forecast_publication').length,1);
  }finally{b.dom.window.close();}
 }
});
test('losing permission during the automatic preview clears private fields after a successful save',async()=>{
 let saved=false;const b=editor((name,args)=>{
  if(name==='command_forecast_publication'){saved=true;return {data:{version:1,current_revision:null,revision_id:1,action:'save'}};}
  return saved?{error:{code:'42501'}}:{data:emptyState};
 });try{
 b.w.CubanForecastEditor.authorize();await b.w.CubanForecastEditor.open(draft());b.$('forecastSaveRevision').click();await tick();await tick();
 assert.equal(b.$('forecastEditor').hidden,true);assert.equal(b.$('forecastEditPlayers').textContent,'');assert.equal(b.$('forecastPreview').textContent,'');assert.equal(b.$('forecastPublicNote').value,'');
 }finally{b.dom.window.close();}
});
test('changing source locks the entry until the new read completes and cannot reuse the previous draft',async()=>{
 const source={...draft(),created_at:'2026-11-11T17:00:00Z',status:'draft'},blocked={...draft(),run_key:'pilot-blocked-ui',created_at:'2026-11-11T17:00:00Z',status:'blocked'};
 blocked.payload={...blocked.payload,status:'blocked',proposal:null};let resolve;const b=browser();try{
 b.w.eval(read('forecast-editor.js'));b.w.eval(read('forecast-review.js'));
 b.w.CubanForecastReview.init({client:{rpc:async(name,args)=>{
  if(name==='get_forecast_publication')return {data:emptyState};
  if(args.p_run_key===blocked.run_key)return new Promise(r=>resolve=r);
  return {data:args.p_run_key?source:[source,blocked]};
 }}});b.w.CubanForecastReview.authorize();b.$('forecastTool').open=true;b.$('forecastTool').dispatchEvent(new b.w.Event('toggle'));
 await tick();await tick();assert.equal(b.$('forecastContent').querySelectorAll('.forecast-player').length,11);
 b.$('forecastVersions').value=blocked.run_key;b.$('forecastVersions').dispatchEvent(new b.w.Event('change'));await tick();
 assert.equal(b.$('forecastManage').disabled,true);resolve({data:blocked});await tick();await tick();assert.equal(b.$('forecastManage').disabled,false);
 b.$('forecastManage').click();await tick();assert.equal(b.$('forecastEditPlayers').querySelectorAll('fieldset').length,0);assert.equal(b.$('forecastSaveRevision').disabled,true);assert.match(b.$('forecastEditorStatus').textContent,/necesita una nueva lectura/);
 }finally{b.dom.window.close();}
});
test('saved revision requires preview and explicit confirmation; changing text disables publication',async()=>{
 const r={id:1,source_key:draft().run_key,payload:publication()},state={version:2,current_revision:1,revisions:[{id:1,created_at:'2026-11-11T17:00Z',ever_published:true}]};
 const b=editor((name,args)=>({data:args.p_revision_id?{version:2,revision:r}:state}));try{
 b.w.CubanForecastEditor.authorize();await b.w.CubanForecastEditor.open();b.$('forecastSavedRevisions').value='1';b.$('forecastLoadRevision').click();await tick();
 assert.equal(b.$('forecastPreview').querySelectorAll('.fp-player').length,11);assert.equal(b.$('forecastPublish').disabled,true);
 b.$('forecastPublishConfirm').checked=true;b.$('forecastPublishConfirm').dispatchEvent(new b.w.Event('change'));assert.equal(b.$('forecastPublish').disabled,false);assert.equal(b.$('forecastRestore').disabled,false);
 b.$('forecastPublicNote').value='Otro análisis público.';b.$('forecastPublicNote').dispatchEvent(new b.w.Event('input'));assert.equal(b.$('forecastPublish').disabled,true);assert.equal(b.$('forecastPreview').textContent,'');
 b.w.CubanForecastEditor.reset();assert.equal(b.$('forecastEditor').hidden,true);assert.equal(b.$('forecastEditPlayers').textContent,'');assert.equal(b.$('forecastPublicNote').value,'');
 }finally{b.dom.window.close();}
});
test('late admin responses after logout cannot repopulate private inputs',async()=>{
 let resolve;const b=editor(()=>new Promise(r=>resolve=r));try{
 b.w.CubanForecastEditor.authorize();const promise=b.w.CubanForecastEditor.open(draft());await tick();b.w.CubanForecastEditor.reset();resolve({data:emptyState});await promise;
 assert.equal(b.$('forecastEditor').hidden,true);assert.equal(b.$('forecastEditPlayers').textContent,'');
 }finally{b.dom.window.close();}
});
test('publication SQL is isolated, guarded and projected; public code has no private API or storage',()=>{
 const sql=read('docs/forecast-publish/migration.sql');assert.match(sql,/for update/);assert.match(sql,/old_event\.request is distinct from request/);assert.match(sql,/state_row\.version <> p_expected_version/);
 assert.doesNotMatch(sql,/alter table forecast_pilot|update forecast_pilot|delete from forecast_pilot|create or replace|cron\./i);
 assert.match(sql,/create policy forecast_public_read.*for select to anon, authenticated/);
 assert.doesNotMatch(read('forecast-public.js'),/command_forecast|get_forecast|localStorage|setInterval/);
 assert.doesNotMatch(read('index.html'),/forecast-editor|forecast-review/);
 const raw=JSON.parse(read('catalog/players.json'));for(const p of raw.players.filter(p=>p.club_id==='real-madrid'))assert.ok(sql.includes("('"+p.id+"','"+p.display_name+"')"),p.id);
});
