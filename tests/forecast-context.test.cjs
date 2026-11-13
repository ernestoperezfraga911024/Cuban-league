'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const {publication}=require('./fixtures/forecast-round.cjs'),round=require('../forecast-round-core.js');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8'),tick=()=>new Promise(r=>setTimeout(r,10));
const stamp='2026-11-12T20:00:00Z',source='https://www.futbolfantasy.com/laliga/noticias/test';
function directHealth(id,status='doubt',at=stamp,team='real-madrid'){
 return {team,player_id:id,published_at:at,payload:{season:'2026-27',team,matchday:13,id,name:id,status,source_label:status==='doubt'?'Duda':status==='injured'?'Lesionado':'Disponible',event_date:null,detail:'FutbolFantasy describe el estado físico actual de este jugador.',source:{id:'futbolfantasy',url:'https://www.futbolfantasy.com/laliga/equipos/real-madrid',fetched_at:at,source_updated_at:null}}};
}
test('direct physical evidence works without a news article, clears on availability and preserves percentages',()=>{
 const {dom,w,context}=browser();try{
  const p=publication('real-madrid'),id=p.players[0].id,before=JSON.stringify(p),row=directHealth(id);
  const c=context.create(p.team,[],null,true,[row]);assert.equal(c.badge({id}).textContent,'?');assert.match(c.detail({id}).textContent,/FutbolFantasy.*Revisado:/);
  w.CubanForecastPitch.render(w.document.getElementById('forecastPublicBody'),p,null,{playerContext:c});assert.equal(w.document.querySelector('.fp-player .fc-health').textContent,'?');assert.equal(JSON.stringify(p),before);
  const available=directHealth(id,'available');assert.equal(context.create(p.team,[],null,false,[available]).badge({id}),null);
  assert.equal(context.create('valencia',[],null,false,[row]).badge({id}),null);
  assert.equal(context.create(p.team,[],null,false,[directHealth(id,'injured')]).badge({id}).textContent,'+');
 }finally{dom.window.close();}
});
test('an old article reimport does not override current FF availability; a later dated event can',()=>{
 const {dom,context}=browser();try{
  const old=news('player','injured','2026-11-11');old.updated_at='2026-11-13T20:00:00Z';
  const physical=directHealth('player','available');assert.equal(context.currentHealth([old],'player',[physical]).status,'available');
  const later=news('player','doubt','2026-11-13');later.payload.sources[0].fetched_at='2026-11-13T20:00:00Z';
  assert.equal(context.currentHealth([later],'player',[physical]).status,'doubt');
  // Same-day dated publication, rather than import time, resolves ordering.
  const sameDay=news('player','injured');sameDay.payload.sources[0].published_at='2026-11-12T20:01:00Z';
  assert.equal(context.currentHealth([sameDay],'player',[physical]).status,'injured');
 }finally{dom.window.close();}
});
test('physical feed validates identities, domain, dates, state and pagination',async()=>{
 const {dom,w,context}=browser();try{
  for(const mutate of [r=>r.team='foreign',r=>r.player_id='another',r=>r.payload.status='constructor',r=>r.payload.source.url='https://www.futbolfantasy.com.evil.test/equipos/real-madrid',r=>r.payload.source.fetched_at=null,r=>r.payload.source.fetched_at='2099-01-01T00:00:00Z']){
   const row=directHealth('player');mutate(row);assert.equal(context.validHealth(row),false);
  }
  w.CUBAN_LEAGUE_SUPABASE={url:'https://db.test',publishableKey:'public'};const calls=[];
  w.fetch=async(u,o)=>{calls.push({u:String(u),o});return{ok:true,json:async()=>calls.length===1?Array.from({length:200},(_,i)=>directHealth('p'+i)):[directHealth('last')]};};
  assert.equal((await context.loadHealth()).length,201);assert.equal(calls.length,2);assert.equal(calls[0].o.cache,'no-store');
  w.fetch=async()=>({ok:false});await assert.rejects(()=>context.loadHealth());
 }finally{dom.window.close();}
});
function news(id,status='doubt',day='2026-11-12',team='real-madrid'){
 return {key:id+'-'+status,visible:true,updated_at:stamp,published_at:stamp,payload:{season:'2026-27',team,category:'injury',certainty:'reported',title:'Situación del jugador',summary:'Resumen de prueba con una noticia publicada.',impact:'Pendiente de la próxima sesión.',players:[{id,name:id,health:{status,event_date:day,detail:'Información física de prueba, atribuida a la fuente.',refs:[source]}}],sources:[{name:'FutbolFantasy',url:source,fetched_at:stamp,published_label:day,published_at:null}]}};
}
function browser(){
 const dom=new JSDOM(read('index.html'),{url:'https://preview.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 for(const f of ['player-catalog.js','forecast-publish-core.js','forecast-round-config.js','forecast-round-core.js','forecast-pitch.js','forecast-context.js'])w.eval(read(f));
 w.Date.now=()=>Date.parse(stamp);
 return {dom,w,context:w.CubanForecastContext};
}
const feed=()=>round.config.teams.map(t=>({team:t.id,payload:publication(t.id),status:'published',published_at:stamp,checked_at:stamp}));

test('health belongs to the named player; partial training, an unrelated report and a rumor cannot clear it',()=>{
 const {dom,context}=browser();try{
  const injury=news('injured','injured','2026-11-11');injury.payload.players.push({id:'replacement',name:'Replacement'});
  const training=news('injured');training.payload.category='recovery';delete training.payload.players[0].health;training.payload.summary='Parte de la sesión con el grupo, sin alta.';
  const rumor=news('injured','available');rumor.payload.category='transfer';rumor.payload.certainty='rumor';
  assert.equal(context.health([injury,training,rumor],'injured').status,'injured');
  assert.equal(context.health([injury],'replacement'),null);
  assert.equal(context.health([news('other','available'),injury],'injured').status,'injured');
 }finally{dom.window.close();}
});
test('later availability removes the question/cross without changing the XI or percentage',()=>{
 const {dom,w,context}=browser();try{
  const p=publication('real-madrid'),player=p.players[0],before=JSON.stringify(p),injury=news(player.id,'injured','2026-11-11'),clear=news(player.id,'available');
  const old=structuredClone(injury);old.updated_at='2026-11-12T21:00:00Z'; // Import time is not the event date.
  const current=context.create('real-madrid',[old,clear],null);
  assert.equal(current.badge(player),null);assert.match(current.detail(player).textContent,/Disponible/);
  w.CubanForecastPitch.render(w.document.getElementById('forecastPublicBody'),p,null,{playerContext:current});
  assert.equal(w.document.querySelectorAll('.fp-player').length,11);assert.equal(JSON.stringify(p),before);
  const relapse=news(player.id,'doubt');relapse.updated_at='2026-11-12T21:01:00Z';
  assert.equal(context.create('real-madrid',[clear,relapse],null).badge(player).textContent,'?');
 }finally{dom.window.close();}
});
test('invalid, hidden, future and unreferenced health evidence never creates a marker',()=>{
 const {dom,context}=browser();try{
  for(const mutate of [r=>r.visible=false,r=>r.payload.players[0].health.refs=['https://other.test/'],r=>r.payload.players[0].health.event_date='2026-02-31',r=>r.payload.players[0].health.event_date='2026-12-31',r=>r.payload.players[0].health.status='constructor',r=>r.payload.players[0].health.detail=' ',r=>r.payload.sources[0].url='javascript:alert(1)',r=>r.payload.sources[0].url='https://user:pass@example.test/',r=>r.payload.sources[0].fetched_at=null]){
   const r=news('player');mutate(r);assert.equal(context.health([r],'player'),null);
  }
  const legacy=news('player');delete legacy.payload.players[0].health;assert.equal(context.health([legacy],'player'),null);
 }finally{dom.window.close();}
});
test('club/player news uses safe text, source links and actual information/consultation dates',()=>{
 const {dom,context}=browser();try{
  const row=news('player');row.payload.title='<img src=x onerror=alert(1)>';row.payload.summary='<script>alert(1)</script>';
  const c=context.create('real-madrid',[row,news('foreign','doubt','2026-11-12','fc-barcelona')],null),host=dom.window.document.createElement('div');c.renderClub(host);
  assert.equal(host.querySelectorAll('.fc-story').length,1);assert.equal(host.querySelector('img,script'),null);assert.equal(host.querySelector('summary').textContent,row.payload.title);assert.equal(host.querySelector('a').rel,'noopener noreferrer');
  const detail=c.detail({id:'player'});assert.match(detail.textContent,/12\/11\/2026/);assert.match(detail.textContent,/Revisada:.*Miami/);assert.doesNotMatch(detail.textContent,/Invalid Date/);assert.equal(detail.querySelectorAll('details[open]').length,0);
  const legacy=news('player');delete legacy.payload.players[0].health;
  const legacyDetail=context.create('real-madrid',[legacy],null).detail({id:'player'});assert.equal(legacyDetail.querySelectorAll('details[open]').length,0);legacyDetail.querySelector('summary').click();assert.equal(legacyDetail.querySelector('details').open,true);
 }finally{dom.window.close();}
});
test('rest of squad uses active catalog identities, excludes all XI and supports keyboard detail/return',async()=>{
 const {dom,w,context}=browser();try{
  w.fetch=async()=>({ok:true,json:async()=>JSON.parse(read('catalog/players.json'))});const catalog=await w.CubanLeaguePlayerCatalog.load(),p=publication('real-madrid');
  const reserve=catalog.players.find(x=>x.active&&x.clubId===p.team&&!p.players.some(y=>y.id===x.id));assert.ok(reserve);
  const rows=[news(p.players[0].id),news(reserve.id,'injured')],host=w.document.getElementById('forecastPublicBody');
  w.CubanForecastPitch.render(host,p,catalog,{playerContext:context.create(p.team,rows,catalog)});
  assert.equal(host.querySelector('.fp-detail').hidden,true);
  const buttons=[...host.querySelectorAll('.fp-reserve')],ids=buttons.map(b=>b.dataset.playerId),expected=catalog.players.filter(x=>x.active&&x.clubId===p.team&&!p.players.some(y=>y.id===x.id));
  assert.deepEqual(new Set(ids),new Set(expected.map(x=>x.id)));assert.equal(new Set(ids).size,ids.length);
  assert.equal(host.querySelector('.fp-player .fc-health').textContent,'?');
  const button=buttons.find(b=>b.dataset.playerId===reserve.id);assert.equal(button.querySelector('.fc-health').textContent,'+');assert.match(button.getAttribute('aria-label'),/Lesionado/);button.click();
  const detail=host.querySelector('.fp-detail');assert.equal(w.document.activeElement,detail);assert.match(detail.textContent,/Lesionado/);assert.doesNotMatch(detail.textContent,/titularidad estimada|Revisión editorial manual/);
  detail.querySelector('.fp-link').click();assert.equal(w.document.activeElement,button);assert.equal(detail.hidden,true);
  w.CubanForecastPitch.render(host,p,catalog);assert.equal(host.querySelector('.fp-squad'),null);assert.equal(host.querySelector('.fc-health'),null);
 }finally{dom.window.close();}
});
test('news pagination includes old injuries and rejects a partially failed response',async()=>{
 const {dom,w,context}=browser();try{
  w.CUBAN_LEAGUE_SUPABASE={url:'https://db.test',publishableKey:'public'};const calls=[];
  w.fetch=async(u,o)=>{calls.push({url:new URL(u),options:o});return {ok:true,json:async()=>calls.length===1?Array.from({length:100},(_,i)=>news('player-'+i)):[news('older','injured','2026-11-10')]};};
  const rows=await context.load(new w.AbortController().signal);assert.equal(rows.length,101);assert.equal(calls[1].url.searchParams.get('offset'),'100');assert.equal(calls[0].options.cache,'no-store');assert.equal(calls[0].url.searchParams.get('visible'),'eq.true');
  assert.equal(context.health(rows,'older').status,'injured');let n=0;w.fetch=async()=>({ok:++n===1,json:async()=>Array.from({length:100},(_,i)=>news('player-'+i))});await assert.rejects(()=>context.load());
 }finally{dom.window.close();}
});
test('independent news read is lazy, local by club, survives withdrawn/failed XI and clears stale data on refresh',async()=>{
 const {dom,w}=browser();try{
  const calls=[];let data=feed(),articles=[news(data[0].payload.players[0].id,'injured','2026-11-12',data[0].team)],failNews=false,failForecast=false;
  w.CUBAN_LEAGUE_SUPABASE={url:'https://db.test',publishableKey:'public'};w.CubanLeaguePlayerCatalog={load:async()=>({players:[],playersById:new Map()})};
  w.fetch=async(u,o)=>{calls.push(String(u));const isNews=String(u).includes('news_public');if(String(u).includes('forecast_health_public'))return {ok:true,json:async()=>[]};return {ok:!(isNews?failNews:failForecast),json:async()=>isNews?articles:data};};
  w.eval(read('forecast-season-public.js'));assert.equal(calls.length,0);w.document.body.dataset.section='forecasts';await tick();await tick();assert.equal(calls.length,3);
  for(const b of w.document.querySelectorAll('[data-forecast-team]')){b.click();assert.equal(w.document.querySelector('.fp-detail').hidden,true);assert.equal(w.document.querySelectorAll('.fc-story[open]').length,0);w.document.querySelector('.fp-player').click();assert.equal(w.document.querySelector('.fp-detail').hidden,false);}assert.equal(calls.length,3);
  const select=()=>w.document.querySelector('[data-forecast-team="'+data[0].team+'"]').click();select();assert.equal(w.document.querySelectorAll('.fc-club-news .fc-story').length,1);
  data[0].status='withdrawn';data[0].payload=null;w.document.getElementById('forecastPublicReload').click();await tick();await tick();assert.equal(w.document.querySelectorAll('.fp-player').length,0);assert.equal(w.document.querySelectorAll('.fc-club-news .fc-story').length,1);
  failForecast=true;w.document.getElementById('forecastPublicReload').click();await tick();await tick();assert.equal(w.document.querySelectorAll('.fc-club-news .fc-story').length,1);
  failForecast=false;data=feed();failNews=true;w.document.getElementById('forecastPublicReload').click();await tick();await tick();assert.equal(w.document.querySelectorAll('.fp-player').length,11);assert.equal(w.document.querySelectorAll('.fc-story,.fc-health').length,0);assert.match(w.document.querySelector('.fc-club-news').textContent,/No se pudieron cargar/);
  failNews=false;articles=[];w.document.getElementById('forecastPublicReload').click();await tick();await tick();assert.match(w.document.querySelector('.fc-club-news').textContent,/Sin noticias/);
  w.document.body.dataset.section='home';await tick();assert.equal(w.document.getElementById('forecastPublicBody').textContent,'');
 }finally{dom.window.close();}
});
test('a delayed response after navigation cannot reinsert player news or a withdrawn lineup',async()=>{
 const {dom,w}=browser();try{
  w.CUBAN_LEAGUE_SUPABASE={url:'https://db.test',publishableKey:'public'};w.CubanLeaguePlayerCatalog={load:async()=>null};let resolveNews;
  w.fetch=async u=>String(u).includes('news_public')?new Promise(r=>resolveNews=r):{ok:true,json:async()=>feed()};
  w.eval(read('forecast-season-public.js'));w.document.body.dataset.section='forecasts';await tick();w.document.body.dataset.section='home';await tick();resolveNews({ok:true,json:async()=>[news('player')]});await tick();await tick();assert.equal(w.document.getElementById('forecastPublicBody').textContent,'');
 }finally{dom.window.close();}
});
test('a news timeout cannot abort an already received XI body',async()=>{
 const {dom,w}=browser();try{
  w.CUBAN_LEAGUE_SUPABASE={url:'https://db.test',publishableKey:'public'};w.CubanLeaguePlayerCatalog={load:async()=>null};
  const realTimeout=w.setTimeout.bind(w);w.setTimeout=(fn,ms)=>realTimeout(fn,ms===15000?40:ms);
  w.fetch=async(u,{signal})=>String(u).includes('news_public')?new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('timeout')))):{ok:true,json:async()=>{if(signal.aborted)throw Error('Body was aborted');return feed();}};
  w.eval(read('forecast-season-public.js'));w.document.body.dataset.section='forecasts';await new Promise(r=>setTimeout(r,80));
  assert.equal(w.document.querySelectorAll('.fp-player').length,11);assert.match(w.document.querySelector('.fc-club-news').textContent,/No se pudieron cargar/);assert.match(w.document.querySelector('.fp-squad').textContent,/No se pudo cargar la plantilla/);
 }finally{dom.window.close();}
});
test('entry points and service worker ship the same version; context CSS parses',()=>{
 const index=read('index.html'),sw=read('sw.js'),css=read('forecast-context.css');
 for(const asset of ['forecast-context.js','forecast-context.css','forecast-pitch.js','forecast-season-public.js']){const version={'forecast-context.js':213,'forecast-pitch.js':220,'forecast-context.css':211,'forecast-season-public.js':215}[asset];assert.ok(index.includes(asset+'?v='+version+(version>=215?'-20261113':'-20261112')));assert.ok(sw.includes(asset+'?v='+version+(version>=215?'-20261113':'-20261112')));}
 assert.ok(index.indexOf('forecast-context.js')<index.indexOf('forecast-season-public.js'));assert.match(sw,/\|context\|/);assert.ok(require('rrweb-cssom').parse(css).cssRules.length>10);assert.match(css,/@media\(max-width:350px\)/);
});
