'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const {publication}=require('./fixtures/forecast-round.cjs'),round=require('../forecast-round-core.js');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8'),tick=()=>new Promise(r=>setTimeout(r,10));
const stamp='2026-11-12T20:00:00Z',source='https://www.futbolfantasy.com/laliga/noticias/test';
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
  const detail=c.detail({id:'player'});assert.match(detail.textContent,/12\/11\/2026/);assert.match(detail.textContent,/Revisada:.*Miami/);assert.doesNotMatch(detail.textContent,/Invalid Date/);
 }finally{dom.window.close();}
});
test('rest of squad uses active catalog identities, excludes all XI and supports keyboard detail/return',async()=>{
 const {dom,w,context}=browser();try{
  w.fetch=async()=>({ok:true,json:async()=>JSON.parse(read('catalog/players.json'))});const catalog=await w.CubanLeaguePlayerCatalog.load(),p=publication('real-madrid');
  const reserve=catalog.players.find(x=>x.active&&x.clubId===p.team&&!p.players.some(y=>y.id===x.id));assert.ok(reserve);
  const rows=[news(p.players[0].id),news(reserve.id,'injured')],host=w.document.getElementById('forecastPublicBody');
  w.CubanForecastPitch.render(host,p,catalog,{playerContext:context.create(p.team,rows,catalog)});
  const buttons=[...host.querySelectorAll('.fp-reserve')],ids=buttons.map(b=>b.dataset.playerId),expected=catalog.players.filter(x=>x.active&&x.clubId===p.team&&!p.players.some(y=>y.id===x.id));
  assert.deepEqual(new Set(ids),new Set(expected.map(x=>x.id)));assert.equal(new Set(ids).size,ids.length);
  assert.equal(host.querySelector('.fp-player .fc-health').textContent,'?');
  const button=buttons.find(b=>b.dataset.playerId===reserve.id);assert.equal(button.querySelector('.fc-health').textContent,'+');assert.match(button.getAttribute('aria-label'),/Lesionado/);button.click();
  const detail=host.querySelector('.fp-detail');assert.equal(w.document.activeElement,detail);assert.match(detail.textContent,/Lesionado/);assert.doesNotMatch(detail.textContent,/titularidad estimada|Revisión editorial manual/);
  detail.querySelector('.fp-link').click();assert.equal(w.document.activeElement,button);
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
  w.fetch=async(u,o)=>{calls.push(String(u));const isNews=String(u).includes('news_public');return {ok:!(isNews?failNews:failForecast),json:async()=>isNews?articles:data};};
  w.eval(read('forecast-season-public.js'));assert.equal(calls.length,0);w.document.body.dataset.section='forecasts';await tick();await tick();assert.equal(calls.length,2);
  for(const b of w.document.querySelectorAll('[data-forecast-team]'))b.click();assert.equal(calls.length,2);
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
 for(const asset of ['forecast-context.js','forecast-context.css','forecast-pitch.js','forecast-season-public.js']){assert.ok(index.includes(asset+'?v=211-20261112'));assert.ok(sw.includes(asset+'?v=211-20261112'));}
 assert.ok(index.indexOf('forecast-context.js')<index.indexOf('forecast-season-public.js'));assert.match(sw,/\|context\|/);assert.ok(require('rrweb-cssom').parse(css).cssRules.length>10);assert.match(css,/@media\(max-width:350px\)/);
});
