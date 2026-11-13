'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const root=path.join(__dirname,'..'),stamp='2026-11-12T20:00:00.123456+00:00';
function browser(){const dom=new JSDOM('<main id="host"></main>',{url:'https://test.invalid/',runScripts:'outside-only'}),w=dom.window;w.eval(fs.readFileSync(path.join(root,'forecast-context.js'),'utf8'));w.CUBAN_LEAGUE_SUPABASE={url:'https://db.test',publishableKey:'public'};w.Date.now=()=>Date.parse('2026-11-13T20:00:00Z');return{dom,w,c:w.CubanForecastContext};}
function news(id,status='doubt',team='real-madrid',day='2026-11-12'){
 const url='https://www.futbolfantasy.com/laliga/noticias/'+id;
 return{key:id,visible:true,updated_at:stamp,published_at:stamp,payload:{season:'2026-27',team,category:'injury',certainty:'reported',title:'Información verificada del jugador',summary:'Resumen original de la situación del jugador.',players:[{id:'player',name:'Player',health:{status,event_date:day,detail:'Estado físico atribuido a la fuente consultada.',refs:[url]}}],sources:[{name:'FútbolFantasy',url,fetched_at:'2026-11-13T18:00:00Z',published_label:day,published_at:null}]}};
}
function physical(id,team='real-madrid'){return{team,player_id:id,published_at:stamp,payload:{season:'2026-27',team,matchday:13,id,name:id,status:'available',detail:'Disponible según la fuente consultada.',source:{id:'futbolfantasy',url:'https://www.futbolfantasy.com/laliga/equipos/real-madrid',fetched_at:stamp}}};}
test('context news loads one club with lookahead and retains microsecond cursor',async()=>{
 const{dom,w,c}=browser();try{
  const calls=[];w.fetch=async(u,o)=>{calls.push({u:new URL(u),o});return{ok:true,json:async()=>Array.from({length:6},(_,i)=>news('story-'+i))};};
  const page=await c.load('real-madrid');assert.equal(page.rows.length,5);assert.equal(page.hasMore,true);assert.equal(page.cursor.updated_at,stamp);assert.equal(calls[0].u.searchParams.get('payload->>team'),'eq.real-madrid');assert.equal(calls[0].u.searchParams.get('limit'),'6');assert.equal(calls[0].o.cache,'no-store');
  await c.load('real-madrid',undefined,{after:page.cursor,pageSize:20});assert.equal(calls[1].u.searchParams.get('or'),'(updated_at.lt.'+stamp+',and(updated_at.eq.'+stamp+',key.gt.story-4))');assert.equal(calls[1].u.searchParams.get('limit'),'21');
 }finally{dom.window.close();}
});
test('player requests require both club and exact player filters',async()=>{
 const{dom,w,c}=browser();try{let url;w.fetch=async u=>{url=new URL(u);return{ok:true,json:async()=>[news('story-player')]};};assert.equal((await c.load('real-madrid',undefined,{playerId:'player'})).rows.length,1);assert.equal(url.searchParams.get('payload->>team'),'eq.real-madrid');assert.equal(url.searchParams.get('payload->players'),'cs.[{"id":"player"}]');
  await assert.rejects(()=>c.load('real-madrid',undefined,{playerId:'another'}));
 }finally{dom.window.close();}
});
test('malformed, hidden, foreign and nonadvancing pages reject rather than mixing clubs',async()=>{
 const{dom,w,c}=browser();try{
  for(const mutate of[r=>r.payload.team='valencia',r=>r.visible=false,r=>r.updated_at='bad',r=>r.key='bad,key',r=>r.payload.sources[0].url='javascript:alert(1)']){const r=news('story-valid');mutate(r);w.fetch=async()=>({ok:true,json:async()=>[r]});await assert.rejects(()=>c.load('real-madrid'));}
  w.fetch=async()=>({ok:true,json:async()=>[news('story-same')]});await assert.rejects(()=>c.load('real-madrid',undefined,{after:{key:'story-same',updated_at:stamp}}));
  await assert.rejects(()=>c.load('real-madrid',undefined,{after:{key:'story',updated_at:'2026-11-12),visible.eq.false'}}));
 }finally{dom.window.close();}
});
test('health article scan is scoped, includes old injuries and later availability outside recent page',async()=>{
 const{dom,w,c}=browser();try{
  const first=Array.from({length:101},(_,i)=>news('article-'+String(i).padStart(3,'0'),'injured','real-madrid','2026-09-01')),old=news('old-injury','injured','real-madrid','2026-08-01'),clear=news('later-available','available','real-madrid','2026-11-11');let n=0;const calls=[];
  w.fetch=async u=>{calls.push(new URL(u));return{ok:true,json:async()=>++n===1?first:[old,clear]};};
  const rows=await c.loadHealthNews('real-madrid');assert.equal(rows.length,102);assert.equal(calls.length,2);assert.equal(calls[0].searchParams.get('payload->players'),'cs.[{"health":{}}]');assert.equal(calls[0].searchParams.get('payload->>team'),'eq.real-madrid');assert.equal(calls[0].searchParams.get('limit'),'101');assert.ok(!calls[0].searchParams.has('offset'));assert.ok(!calls[0].searchParams.has('updated_at'));assert.equal(c.health(rows,'player').status,'available');
 }finally{dom.window.close();}
});
test('failed second health page never returns an incomplete health history',async()=>{
 const{dom,w,c}=browser();try{let n=0;w.fetch=async()=>({ok:++n===1,json:async()=>Array.from({length:101},(_,i)=>news('article-'+i))});await assert.rejects(()=>c.loadHealthNews('real-madrid'));assert.equal(n,2);
  w.fetch=async()=>{const r=news('missing-health');delete r.payload.players[0].health;return{ok:true,json:async()=>[r]};};await assert.rejects(()=>c.loadHealthNews('real-madrid'));
 }finally{dom.window.close();}
});
test('direct physical requests are scoped, paginate by identity and reject foreign evidence',async()=>{
 const{dom,w,c}=browser();try{let n=0;const calls=[];w.fetch=async u=>{calls.push(new URL(u));return{ok:true,json:async()=>++n===1?Array.from({length:200},(_,i)=>physical('player-'+String(i).padStart(3,'0'))):[physical('player-zzz')]};};const rows=await c.loadHealth('real-madrid');assert.equal(rows.length,201);assert.equal(calls[0].searchParams.get('team'),'eq.real-madrid');assert.equal(calls[1].searchParams.get('player_id'),'gt.player-199');
  w.fetch=async()=>({ok:true,json:async()=>[physical('player','valencia')]});await assert.rejects(()=>c.loadHealth('real-madrid'));
 }finally{dom.window.close();}
});
test('cancelled context requests cannot deliver late response bodies',async()=>{
 const{dom,w,c}=browser();try{const ctl=new w.AbortController();let resolve;w.fetch=async()=>({ok:true,json:()=>new Promise(r=>resolve=r)});const pending=c.load('real-madrid',ctl.signal);await new Promise(r=>setImmediate(r));ctl.abort();resolve([news('late-story')]);await assert.rejects(()=>pending);let calls=0;w.fetch=async()=>{calls++;return{ok:true,json:async()=>[]};};await assert.rejects(()=>c.load('real-madrid',ctl.signal));assert.equal(calls,0);
 }finally{dom.window.close();}
});
