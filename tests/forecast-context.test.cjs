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
  assert.equal((await context.loadHealth('real-madrid')).length,201);assert.equal(calls.length,2);assert.equal(calls[0].o.cache,'no-store');
  w.fetch=async()=>({ok:false});await assert.rejects(()=>context.loadHealth('real-madrid'));
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
function serve(u,{forecasts=feed(),articles=[],physical=[],failNews=false,failForecast=false}={}){
 const url=new URL(u),q=url.searchParams;
 if(url.pathname.endsWith('forecast_season_public'))return {ok:!failForecast,json:async()=>forecasts};
 const team=(q.get('payload->>team')||q.get('team')||'').replace(/^eq\./,'');
 if(url.pathname.endsWith('forecast_health_public'))return {ok:true,json:async()=>physical.filter(r=>r.team===team)};
 assert.ok(url.pathname.endsWith('news_public'));assert.ok(team,'news must have a server-side club filter');
 let rows=articles.filter(r=>r.visible!==false&&r.payload.team===team);
 const playerFilter=q.get('payload->players');if(playerFilter){const [target]=JSON.parse(playerFilter.slice(3));rows=rows.filter(r=>r.payload.players.some(p=>target.id?p.id===target.id:p.health&&typeof p.health==='object'));}
 rows=rows.sort((a,b)=>b.updated_at.localeCompare(a.updated_at)||a.key.localeCompare(b.key));
 const cursor=q.get('or');if(cursor){const m=cursor.match(/updated_at\.lt\.([^,]+),and\(updated_at\.eq\.[^,]+,key\.gt\.([^)]+)/);assert.ok(m);rows=rows.filter(r=>r.updated_at<m[1]||(r.updated_at===m[1]&&r.key>m[2]));}
 return {ok:!failNews,json:async()=>rows.slice(0,Number(q.get('limit'))||100)};
}
function setup(w,fetch){w.CUBAN_LEAGUE_SUPABASE={url:'https://db.test',publishableKey:'public'};w.CubanLeaguePlayerCatalog={load:async()=>({players:[],playersById:new Map()})};w.fetch=fetch;w.eval(read('forecast-season-public.js'));}
async function settle(){await tick();await tick();await tick();}

test('the XI appears while selected-club context is unresolved, without waiting for its timeout',async()=>{
 const {dom,w}=browser();try{
  const calls=[],pending=[];
  setup(w,(u,{signal})=>{calls.push(String(u));if(String(u).includes('forecast_season_public'))return Promise.resolve(serve(u));return new Promise(resolve=>pending.push({resolve,signal,u}));});
  assert.equal(calls.length,0);w.document.body.dataset.section='forecasts';await settle();
  assert.equal(w.document.querySelectorAll('.fp-player').length,11);assert.equal(w.document.getElementById('forecastPublicReload').disabled,false);
  assert.ok(calls.every(u=>u.includes('forecast_season_public')||new URL(u).searchParams.get('payload->>team')==='eq.real-madrid'||new URL(u).searchParams.get('team')==='eq.real-madrid'));
  assert.match(w.document.querySelector('.fc-club-news').textContent,/Consultando|Cargando/);
  w.document.body.dataset.section='home';await tick();assert.ok(pending.every(p=>p.signal.aborted));
  for(const p of pending)p.resolve(serve(p.u));await settle();assert.equal(w.document.getElementById('forecastPublicBody').textContent,'');
 }finally{dom.window.close();}
});

test('old injuries and subsequent clearances remain accurate beyond the recent news page',async()=>{
 const {dom,w}=browser();try{
  const p=publication('real-madrid'),injured=p.players[0].id,available=p.players[1].id;
  const old=news(injured,'injured','2026-10-01');old.updated_at='2026-10-01T20:00:00Z';
  const before=news(available,'injured','2026-10-02');before.updated_at='2026-10-02T20:00:00Z';
  const clear=news(available,'available','2026-10-03');clear.updated_at='2026-10-03T20:00:00Z';
  const recent=Array.from({length:30},(_,i)=>{const r=news('unrelated-'+i);delete r.payload.players[0].health;return r;});
  const articles=[...recent,old,before,clear],calls=[];
  setup(w,async(u)=>{calls.push(String(u));return serve(u,{articles});});w.document.body.dataset.section='forecasts';await settle();
  assert.equal(w.document.querySelectorAll('.fc-club-news .fc-story').length,5);
  const bad=w.document.querySelector('[data-player-id="'+injured+'"]'),good=w.document.querySelector('[data-player-id="'+available+'"]');
  assert.equal(bad.querySelector('.fc-health').textContent,'+');assert.equal(good.querySelector('.fc-health'),null);
  bad.click();await settle();assert.match(w.document.querySelector('.fc-player-context').textContent,/Lesionado/);
  assert.ok(calls.some(u=>new URL(u).searchParams.get('payload->players')==='cs.'+JSON.stringify([{id:injured}])));
  const more=[...w.document.querySelectorAll('.fc-club-news button')].find(b=>/más|anteriores/i.test(b.textContent));assert.ok(more);more.click();await settle();
  assert.ok(w.document.querySelectorAll('.fc-club-news .fc-story').length>5);assert.equal(w.document.querySelector('[data-player-id="'+injured+'"] .fc-health').textContent,'+');
  assert.equal(w.document.querySelector('.fp-detail').hidden,false,'paging must preserve open player');
 }finally{dom.window.close();}
});

test('switching clubs cancels context; late responses cannot update the new club or reopen a player panel',async()=>{
 const {dom,w}=browser();try{
  const pending=[],calls=[],p=publication('real-madrid'),articles=[news(p.players[0].id,'injured')];
  setup(w,async(u,{signal})=>{calls.push(String(u));if(String(u).includes('forecast_season_public'))return serve(u);const q=new URL(u).searchParams;if((q.get('payload->>team')||q.get('team'))==='eq.real-madrid')return new Promise(resolve=>pending.push({resolve,signal,u}));return serve(u);});
  w.document.body.dataset.section='forecasts';await settle();const oldButton=w.document.querySelector('.fp-player');oldButton.click();
  w.document.querySelector('[data-forecast-team="fc-barcelona"]').click();await settle();assert.ok(pending.every(p=>p.signal.aborted));
  for(const p of pending)p.resolve(serve(p.u,{articles}));await settle();
  assert.equal(w.document.querySelector('.fp-detail').hidden,true);assert.equal(w.document.querySelectorAll('.fc-health,.fc-story').length,0);
  assert.equal(w.document.querySelector('[data-forecast-team="fc-barcelona"]').getAttribute('aria-pressed'),'true');
  assert.equal(calls.filter(u=>u.includes('forecast_season_public')).length,1);
 }finally{dom.window.close();}
});

test('refresh clears withdrawn news and XI, and news errors do not remove the current XI',async()=>{
 const {dom,w}=browser();try{
  let forecasts=feed(),articles=[news(publication('real-madrid').players[0].id,'injured')],failNews=false,failForecast=false;
  setup(w,async u=>serve(u,{forecasts,articles,failNews,failForecast}));w.document.body.dataset.section='forecasts';await settle();assert.equal(w.document.querySelectorAll('.fc-club-news .fc-story').length,1);
  const madrid=forecasts.find(x=>x.team==='real-madrid');madrid.status='withdrawn';madrid.payload=null;w.document.getElementById('forecastPublicReload').click();await settle();assert.equal(w.document.querySelectorAll('.fp-player').length,0);assert.equal(w.document.querySelectorAll('.fc-club-news .fc-story').length,1);
  failForecast=true;w.document.getElementById('forecastPublicReload').click();await settle();assert.equal(w.document.querySelectorAll('.fc-club-news .fc-story').length,1);
  failForecast=false;forecasts=feed();failNews=true;w.document.getElementById('forecastPublicReload').click();await settle();assert.equal(w.document.querySelectorAll('.fp-player').length,11);assert.equal(w.document.querySelectorAll('.fc-story,.fc-health').length,0);assert.match(w.document.querySelector('.fc-club-news').textContent,/No se pudieron|No se pudo/);
  failNews=false;articles=[];w.document.getElementById('forecastPublicReload').click();await settle();assert.equal(w.document.querySelectorAll('.fc-story,.fc-health').length,0);assert.match(w.document.querySelector('.fc-club-news').textContent,/Sin noticias/);
 }finally{dom.window.close();}
});

test('context arrivals preserve an opened player and the keyboard focus',async()=>{
 const {dom,w}=browser();try{
  const pending=[],p=publication('real-madrid'),articles=[news(p.players[0].id,'injured')];
  setup(w,async(u)=>String(u).includes('forecast_season_public')?serve(u):new Promise(resolve=>pending.push({resolve,u})));
  w.document.body.dataset.section='forecasts';await settle();const button=w.document.querySelector('[data-player-id="'+p.players[0].id+'"]');button.click();await tick();const detail=w.document.querySelector('.fp-detail'),back=detail.querySelector('.fp-link');back.focus();
  for(const request of pending)request.resolve(serve(request.u,{articles}));await settle();
  assert.equal(w.document.querySelector('.fp-detail'),detail);assert.equal(detail.hidden,false);assert.equal(w.document.activeElement,back);assert.match(detail.querySelector('.fc-player-context').textContent,/Lesionado/);
  back.click();assert.equal(detail.hidden,true);assert.equal(w.document.activeElement,button);
 }finally{dom.window.close();}
});

test('entry points and service worker ship the same version; context CSS parses',()=>{
 const index=read('index.html'),sw=read('sw.js'),css=read('forecast-context.css');
 for(const asset of ['forecast-context.js','forecast-context.css','forecast-pitch.js','forecast-season-public.js']){const version={'forecast-context.js':222,'forecast-pitch.js':216,'forecast-context.css':222,'forecast-season-public.js':222}[asset];assert.ok(index.includes(asset+'?v='+version+(version>=215?'-20261113':'-20261112')));assert.ok(sw.includes(asset+'?v='+version+(version>=215?'-20261113':'-20261112')));}
 assert.ok(index.indexOf('forecast-context.js')<index.indexOf('forecast-season-public.js'));assert.match(sw,/\|context\|/);assert.ok(require('rrweb-cssom').parse(css).cssRules.length>10);assert.match(css,/@media\(max-width:350px\)/);
});
