'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8'),tick=()=>new Promise(r=>setTimeout(r,20));
const timestamp='2026-11-13T13:03:25.691609+00:00';
const clubs=[{id:'real-madrid',name:'Real Madrid',crest:'https://example.test/madrid.png'},{id:'malaga',name:'Málaga',crest:'https://example.test/malaga.png'}];
function row(i,team='real-madrid',category='injury'){
 return {key:'article-'+String(i).padStart(4,'0'),updated_at:timestamp,published_at:timestamp,payload:{season:'2026-27',team,category,certainty:'reported',title:'Novedad verificada número '+i,summary:'Resumen propio completo de lo sucedido con los jugadores del equipo.',impact:'La disponibilidad se revisará con la siguiente sesión de entrenamiento.',players:[],timeline:[],sources:[{name:'FutbolFantasy',url:'https://www.futbolfantasy.com/laliga/noticias/'+i,fetched_at:timestamp,published_at:null,published_label:'13/11/2026'}]}};
}
function setup(handler){
 const dom=new JSDOM(read('index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''),{url:'https://example.test/',runScripts:'outside-only'}),w=dom.window,calls=[];let catalogs=0;
 w.CUBAN_LEAGUE_SUPABASE={url:'https://example.test',publishableKey:'public-test'};
 w.CubanLeaguePlayerCatalog={load:async()=>{catalogs++;return {clubs,clubsById:new Map(clubs.map(c=>[c.id,c])),playersById:new Map()};}};
 w.fetch=async(url,options)=>{const u=new URL(url);calls.push({url:u,options});const data=await handler(u,options,calls);return {ok:true,json:async()=>data};};
 w.eval(read('news.js'));
 return {dom,w,calls,get catalogs(){return catalogs;},get count(){return w.document.querySelectorAll('.cn-row').length;},get status(){return w.document.getElementById('newsStatus').textContent;},get more(){return w.document.getElementById('newsMore');},open:async()=>{w.document.body.dataset.section='news';await tick();},reload:async()=>{w.document.getElementById('newsReload').click();await tick();},club:async(name)=>{w.document.querySelector('#newsClubs button[aria-label="'+name+'"]').click();await tick();},category:async(name)=>{[...w.document.querySelectorAll('#newsFilters button')].find(b=>b.textContent===name).click();await tick();}};
}
function page(data,u){
 const team=u.searchParams.get('payload->>team')?.slice(3),category=u.searchParams.get('payload->>category')?.slice(3);
 let filtered=data.filter(r=>(!team||r.payload.team===team)&&(!category||r.payload.category===category));
 const after=u.searchParams.get('or');if(after){const match=after.match(/^\(updated_at\.lt\.(.+),and\(updated_at\.eq\.(.+),key\.gt\.([a-z0-9-]+)\)\)$/);assert.ok(match,'valid keyset');assert.equal(match[1],match[2]);filtered=filtered.filter(r=>r.updated_at<match[1]||(r.updated_at===match[1]&&r.key>match[3]));}
 return filtered.slice(0,Number(u.searchParams.get('limit')));
}

test('news pages on demand past 80 and fetches old club stories directly without a global scan',async()=>{
 const data=Array.from({length:121},(_,i)=>row(i,i===120?'malaga':'real-madrid'));
 const s=setup(u=>u.pathname.endsWith('news_status')?[{checked_at:timestamp,result:'checked'}]:page(data,u));
 try{
  assert.equal(s.calls.length,0);await s.open();assert.equal(s.count,40);assert.equal(s.calls.length,2);assert.equal(s.catalogs,1);assert.equal(s.more.hidden,false);
  assert.match(s.w.document.getElementById('newsCount').textContent,/40 noticias cargadas/);assert.doesNotMatch(s.w.document.getElementById('newsHighlights').textContent,/novedades disponibles/);
  const first=s.calls.find(c=>c.url.pathname.endsWith('news_public')).url;assert.equal(first.searchParams.get('visible'),'eq.true');assert.equal(first.searchParams.get('limit'),'41');assert.equal(first.searchParams.get('order'),'updated_at.desc,key.asc');assert.equal(first.searchParams.has('offset'),false);
  s.more.click();await tick();assert.equal(s.count,80);assert.equal(s.calls.length,3);assert.match(s.calls[2].url.searchParams.get('or'),/691609\+00:00/);assert.match(s.calls[2].url.searchParams.get('or'),/article-0039/);
  s.more.click();await tick();assert.equal(s.count,120);assert.equal(s.more.hidden,false);
  s.more.click();await tick();assert.equal(s.count,121);assert.equal(s.more.hidden,true);assert.equal(s.calls.length,5);assert.equal(s.catalogs,1);
  await s.club('Málaga');assert.equal(s.count,1);assert.equal(s.w.document.querySelector('.cn-row').dataset.key,'article-0120');assert.equal(s.calls.at(-1).url.searchParams.get('payload->>team'),'eq.malaga');assert.equal(s.calls.at(-1).url.searchParams.has('or'),false);assert.equal(s.calls.length,6);
  await s.category('Entrenamientos');assert.equal(s.count,0);assert.equal(s.calls.at(-1).url.searchParams.get('payload->>team'),'eq.malaga');assert.equal(s.calls.at(-1).url.searchParams.get('payload->>category'),'eq.training');
 }finally{s.w.close();}
});

test('news exact page boundaries avoid an unnecessary empty request',async()=>{
 for(const size of [0,39,40,41]){
  const data=Array.from({length:size},(_,i)=>row(i));const s=setup(u=>u.pathname.endsWith('news_status')?[]:page(data,u));
  try{await s.open();assert.equal(s.count,Math.min(40,size));assert.equal(s.more.hidden,size<=40);assert.equal(s.calls.length,2);if(size===41){s.more.click();await tick();assert.equal(s.count,41);assert.equal(s.more.hidden,true);assert.equal(s.calls.length,3);}}
  finally{s.w.close();}
 }
});

test('news deduplicates overlapping pages and advances the raw cursor instead of the number of unique rows',async()=>{
 const data=Array.from({length:80},(_,i)=>row(i));let request=0;
 const s=setup(u=>{if(u.pathname.endsWith('news_status'))return [];request++;if(request===1)return data.slice(0,41);if(request===2)return [data[39],...data.slice(40)];return [data[79]];});
 try{await s.open();s.more.click();await tick();assert.equal(s.count,79);assert.equal(s.more.hidden,false);s.more.click();await tick();assert.match(s.calls.at(-1).url.searchParams.get('or'),/article-0078/);assert.equal(s.count,80);assert.equal(new Set([...s.w.document.querySelectorAll('.cn-row')].map(n=>n.dataset.key)).size,80);assert.equal(s.more.hidden,true);}
 finally{s.w.close();}
});

test('news cancels stale filter responses and ignores late responses after navigation',async()=>{
 let resolveOld,resolveHidden;const delayed=new Promise(r=>{resolveOld=r;}),hidden=new Promise(r=>{resolveHidden=r;});let phase=0;
 const s=setup(u=>{if(u.pathname.endsWith('news_status'))return [];const filter=u.searchParams.get('payload->>team');if(phase===0)return [row(0)];if(phase===2)return hidden;if(filter==='eq.real-madrid')return delayed;return [row(1,'malaga')];});
 try{
  await s.open();phase=1;s.w.document.querySelector('#newsClubs button[aria-label="Real Madrid"]').click();await tick();const old=s.calls.at(-1);await s.club('Málaga');assert.equal(old.options.signal.aborted,true);assert.equal(s.count,1);assert.equal(s.w.document.querySelector('.cn-row').dataset.key,'article-0001');
  resolveOld([row(2)]);await tick();assert.equal(s.w.document.querySelector('.cn-row').dataset.key,'article-0001');
  phase=2;s.w.document.getElementById('newsReload').click();await tick();const inFlight=s.calls.findLast(x=>x.url.pathname.endsWith('news_public'));s.w.document.body.dataset.section='home';await tick();assert.equal(inFlight.options.signal.aborted,true);resolveHidden([row(3,'malaga')]);await tick();assert.equal(s.w.document.querySelector('.cn-row').dataset.key,'article-0001');assert.equal(s.w.document.getElementById('newsDetail').hidden,true);
 }finally{s.w.close();}
});

test('news failed append is retryable, double-clicks do not duplicate requests, and failed filters never show another club',async()=>{
 const data=Array.from({length:43},(_,i)=>row(i));let fail=false,release;let hold=false;
 const s=setup(async u=>{if(u.pathname.endsWith('news_status'))return [];if(fail)throw Error('offline');if(hold){await new Promise(r=>{release=r;});hold=false;}return page(data,u);});
 try{
  await s.open();fail=true;s.more.click();await tick();assert.equal(s.count,40);assert.equal(s.more.hidden,false);assert.match(s.status,/Ver más noticias.*reintentar/);assert.equal(s.more.disabled,false);
  fail=false;hold=true;s.more.click();s.more.click();await tick();const before=s.calls.length;assert.equal(s.more.disabled,true);s.more.click();assert.equal(s.calls.length,before);release();await tick();assert.equal(s.count,43);assert.equal(s.more.hidden,true);
  fail=true;await s.club('Málaga');assert.equal(s.count,0);assert.equal(s.more.hidden,true);assert.match(s.status,/No se pudieron consultar/);assert.doesNotMatch(s.status,/Se conservan/);assert.equal(s.w.document.querySelector('.cn-empty'),null);
 }finally{s.w.close();}
});

test('news progress distinguishes legacy source checks, unfinished coverage, partial access and complete review',async()=>{
 let status={checked_at:timestamp,result:'checked'};const s=setup(u=>u.pathname.endsWith('news_status')?[status]:[row(1)]);
 try{
  await s.open();assert.match(s.status,/Fuentes consultadas/);assert.doesNotMatch(s.status,/Revisión completa/);
  status={...status,progress:{status:'running',teams_expected:20,teams_reviewed:7,teams_partial:2,pending:4,new:3,updated:2,ready:1}};await s.reload();assert.match(s.status,/Revisión en curso: 7\/20/);assert.match(s.status,/2 clubes con fuentes incompletas/);assert.match(s.status,/4 pendientes/);assert.match(s.status,/3 nuevas · 2 actualizadas/);assert.match(s.status,/1 listas sin publicar/);
  status.progress={...status.progress,status:'partial',teams_reviewed:18,teams_partial:2,pending:0};await s.reload();assert.match(s.status,/Cobertura parcial: 18\/20/);assert.doesNotMatch(s.status,/Revisión completa/);
  status.progress={...status.progress,status:'complete',teams_reviewed:20,teams_partial:0,pending:0,ready:0};await s.reload();assert.match(s.status,/Revisión completa: 20\/20/);
  status.progress.pending=1;await s.reload();assert.match(s.status,/Revisión en curso/);assert.doesNotMatch(s.status,/Revisión completa/);
  status.progress={status:'complete',teams_expected:20,teams_reviewed:'20',pending:0};await s.reload();assert.match(s.status,/Fuentes consultadas/);assert.doesNotMatch(s.status,/Revisión completa/);
 }finally{s.w.close();}
});

test('news status failure does not hide usable articles, and invalid pages do not replace the last good snapshot',async()=>{
 let invalid=false;const s=setup(u=>{if(u.pathname.endsWith('news_status'))throw Error('status unavailable');const r=row(1);if(invalid)r.updated_at='now()),key.gt.injected';return [r];});
 try{await s.open();assert.equal(s.count,1);assert.match(s.status,/No se pudo consultar el estado/);invalid=true;await s.reload();assert.equal(s.count,1);assert.match(s.status,/Se conservan/);assert.equal(s.more.hidden,true);}
 finally{s.w.close();}
});

test('news articles render while coverage is slow and a coverage timeout never leaves a loading state',async()=>{
 let statusSignal;
 const s=setup((u,options)=>{if(u.pathname.endsWith('news_status')){statusSignal=options.signal;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('coverage timeout'))));}return [row(1)];});
 const realTimeout=s.w.setTimeout.bind(s.w);s.w.setTimeout=(fn,ms)=>realTimeout(fn,ms===3000?80:ms);
 try{await s.open();assert.equal(s.count,1);assert.equal(s.w.document.getElementById('newsReload').disabled,false);assert.match(s.status,/Comprobando cobertura/);await new Promise(r=>setTimeout(r,100));assert.equal(statusSignal.aborted,true);assert.equal(s.count,1);assert.match(s.status,/No se pudo consultar el estado/);assert.doesNotMatch(s.status,/Consultando noticias publicadas|Comprobando cobertura/);}
 finally{s.w.close();}
});

test('news feed timeout keeps the matching snapshot and finishes the loading state',async()=>{
 let hang=false;
 const s=setup((u,options)=>{if(u.pathname.endsWith('news_status'))return [];if(hang)return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('feed timeout'))));return [row(1)];});
 const realTimeout=s.w.setTimeout.bind(s.w);s.w.setTimeout=(fn,ms)=>realTimeout(fn,ms===15000?30:ms);
 try{await s.open();assert.equal(s.count,1);hang=true;s.w.document.getElementById('newsReload').click();await new Promise(r=>setTimeout(r,60));assert.equal(s.count,1);assert.equal(s.w.document.getElementById('newsReload').disabled,false);assert.match(s.status,/Se conservan.*reintentar/);assert.doesNotMatch(s.status,/Consultando noticias publicadas/);}
 finally{s.w.close();}
});

test('news loading another page while the first coverage request is pending still obtains coverage',async()=>{
 let statusCalls=0,firstSignal;const data=Array.from({length:42},(_,i)=>row(i));
 const s=setup((u,options)=>{if(u.pathname.endsWith('news_status')){statusCalls++;if(statusCalls===1){firstSignal=options.signal;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('replaced'))));}return [{checked_at:timestamp,result:'checked',progress:{status:'complete',teams_expected:20,teams_reviewed:20,pending:0}}];}return page(data,u);});
 try{await s.open();assert.equal(s.count,40);assert.match(s.status,/Comprobando cobertura/);s.more.click();await tick();assert.equal(firstSignal.aborted,true);assert.equal(s.count,42);assert.equal(statusCalls,2);assert.match(s.status,/Revisión completa: 20\/20/);}
 finally{s.w.close();}
});
