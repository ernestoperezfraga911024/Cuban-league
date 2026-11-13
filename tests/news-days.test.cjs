'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8'),tick=()=>new Promise(r=>setTimeout(r,20));
const timestamp='2026-11-13T16:30:42.123456+00:00';
const clubs=[{id:'real-madrid',name:'Real Madrid'},{id:'sevilla',name:'Sevilla'}];
function row(i,day='2026-11-13',team='real-madrid',category='training'){
 return {key:'dated-news-'+String(i).padStart(4,'0'),news_day:day,updated_at:timestamp,published_at:timestamp,payload:{team,category,certainty:'reported',title:'Noticia número '+i,summary:'Resumen publicado en la fuente.',impact:'Seguimiento de la próxima jornada.',players:[],timeline:[],sources:[{name:'FutbolFantasy',url:'https://www.futbolfantasy.com/laliga/noticias/'+i,published_at:null,published_label:day?day.split('-').reverse().join('/'):'Sin fecha',fetched_at:timestamp}]}};
}
// Model the REST predicates, including NULL ordering; data arrive deliberately unsorted.
function page(data,u){
 assert.equal(u.searchParams.get('order'),'news_day.desc.nullslast,updated_at.desc,key.asc');
 assert.equal(u.searchParams.get('select'),'key,payload,published_at,updated_at,news_day');
 assert.equal(u.searchParams.get('limit'),'41');assert.equal(u.searchParams.has('offset'),false);
 const team=u.searchParams.get('payload->>team')?.slice(3),category=u.searchParams.get('payload->>category')?.slice(3),after=u.searchParams.get('or');
 let filtered=data.filter(r=>(!team||r.payload.team===team)&&(!category||r.payload.category===category));
 if(after){
  const date=after.match(/^\(news_day\.lt\.(\d{4}-\d{2}-\d{2}),news_day\.is\.null,and\(news_day\.eq\.(\d{4}-\d{2}-\d{2}),or\(updated_at\.lt\.(.+),and\(updated_at\.eq\.(.+),key\.gt\.([a-z0-9-]+)\)\)\)\)$/);
  const empty=after.match(/^\(updated_at\.lt\.(.+),and\(updated_at\.eq\.(.+),key\.gt\.([a-z0-9-]+)\)\)$/);
  assert.ok(date||empty,'cursor uses a supported predicate');
  if(date){assert.equal(date[1],date[2]);assert.equal(date[3],date[4]);assert.equal(u.searchParams.has('news_day'),false);filtered=filtered.filter(r=>r.news_day===null||r.news_day<date[1]||(r.news_day===date[1]&&(r.updated_at<date[3]||(r.updated_at===date[3]&&r.key>date[5]))));}
  else{assert.equal(u.searchParams.get('news_day'),'is.null');assert.equal(empty[1],empty[2]);filtered=filtered.filter(r=>r.news_day===null&&(r.updated_at<empty[1]||(r.updated_at===empty[1]&&r.key>empty[3])));}
 }
 return filtered.sort((a,b)=>(a.news_day===b.news_day?0:a.news_day===null?1:b.news_day===null?-1:a.news_day>b.news_day?-1:1)||(a.updated_at===b.updated_at?0:a.updated_at>b.updated_at?-1:1)||a.key.localeCompare(b.key)).slice(0,41);
}
function setup(data,now='2026-11-13T18:00:00Z'){
 const dom=new JSDOM(read('index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''),{url:'https://example.test/',runScripts:'outside-only'}),w=dom.window,calls=[],intervals=new Map();let clock=Date.parse(now),seq=0,handler=u=>page(data,u);
 const NativeDate=w.Date;w.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
 w.setInterval=(fn,delay)=>{const id=++seq;intervals.set(id,{fn,delay});return id;};w.clearInterval=id=>intervals.delete(id);
 w.CUBAN_LEAGUE_SUPABASE={url:'https://example.test',publishableKey:'public-test'};w.CubanLeaguePlayerCatalog={load:async()=>({clubs,clubsById:new Map(clubs.map(c=>[c.id,c])),playersById:new Map()})};
 w.fetch=async(url,options)=>{const u=new URL(url);calls.push({url:u,options});return {ok:true,json:async()=>u.pathname.endsWith('news_status')?[]:handler(u)};};w.eval(read('news.js'));
 return {w,calls,intervals,setHandler(fn){handler=fn;},setClock(now){clock=Date.parse(now);},pulse(){for(const {fn} of intervals.values())fn();},get groups(){return [...w.document.querySelectorAll('#newsList .cn-day')];},get articles(){return [...w.document.querySelectorAll('#newsList .cn-row')];},get more(){return w.document.getElementById('newsMore');},get titles(){return [...w.document.querySelectorAll('.cn-day-title')].map(n=>n.textContent);},async open(){w.document.body.dataset.section='news';await tick();},async next(){w.document.getElementById('newsMore').click();await tick();},async reload(){w.document.getElementById('newsReload').click();await tick();}};
}

test('news is grouped by source day with accessible headings; imported older stories stay on their day',async()=>{
 const data=[row(4,null),row(3,'2026-11-11'),row(2,'2026-11-12'),row(1,'2026-11-13')];
 // A zoned source published on the 13th can belong to the 12th in Miami; use the server day, never reparse labels.
 data[2].payload.sources[0].published_at='2026-11-13T01:00:00+01:00';data[2].payload.sources[0].published_label='13/11/2026';
 const s=setup(data);
 try{
  assert.equal(s.calls.length,0);await s.open();assert.deepEqual(s.groups.map(n=>n.dataset.day),['2026-11-13','2026-11-12','2026-11-11','unknown']);assert.equal(s.titles[0],'Hoy');assert.equal(s.titles[1],'Ayer');assert.match(s.titles[2],/mi[eé]rcoles.*11.*noviembre/i);assert.equal(s.titles[3],'Sin fecha confirmada');
  for(const g of s.groups){const h=g.querySelector('h3.cn-day-heading');assert.ok(h);assert.equal(g.getAttribute('aria-labelledby'),h.id);assert.equal(g.querySelectorAll('.cn-row').length,1);}
  const time=s.groups[0].querySelector('time');assert.equal(time.getAttribute('datetime'),'2026-11-13');assert.match(time.textContent,/viernes.*13.*noviembre/i);
  assert.equal(s.groups[3].querySelector('time'),null);assert.equal(s.more.hidden,true);assert.equal(s.calls.length,2);
  const first=s.articles[0],second=s.articles[1];first.querySelector('.cn-open').click();assert.equal(first.querySelector('.cn-open').getAttribute('aria-expanded'),'true');assert.equal(first.querySelector('.cn-inline').hidden,false);assert.match(first.querySelector('.cn-inline').textContent,/Noticia número 1/);assert.match(s.w.document.getElementById('newsDetail').textContent,/Noticia número 1/);
  second.querySelector('.cn-open').click();assert.equal(first.querySelector('.cn-inline').hidden,true);assert.equal(second.querySelector('.cn-inline').hidden,false);assert.match(s.w.document.getElementById('newsDetail').textContent,/Noticia número 2/);second.querySelector('.cn-open').click();assert.equal(s.w.document.getElementById('newsDetail').hidden,true);
 }finally{s.w.close();}
});

test('news keeps one heading across pages, dates sort globally, and dated cursors transition safely into unknown dates',async()=>{
 const data=[...Array.from({length:45},(_,i)=>row(i)),...Array.from({length:5},(_,i)=>row(45+i,'2026-11-12')),...Array.from({length:75},(_,i)=>row(50+i,null))].reverse(),s=setup(data);
 try{
  await s.open();assert.equal(s.articles.length,40);assert.deepEqual(s.groups.map(g=>g.dataset.day),['2026-11-13']);
  await s.next();assert.equal(s.articles.length,80);assert.deepEqual(s.groups.map(g=>g.dataset.day),['2026-11-13','2026-11-12','unknown']);assert.deepEqual(s.groups.map(g=>g.querySelectorAll('.cn-row').length),[45,5,30]);assert.match(s.calls.at(-1).url.searchParams.get('or'),/news_day\.is\.null/);assert.match(s.calls.at(-1).url.searchParams.get('or'),/123456\+00:00/);
  await s.next();assert.equal(s.articles.length,120);assert.equal(s.calls.at(-1).url.searchParams.get('news_day'),'is.null');assert.doesNotMatch(s.calls.at(-1).url.searchParams.get('or'),/news_day\.lt/);
  await s.next();assert.equal(s.articles.length,125);assert.equal(s.more.hidden,true);assert.equal(new Set(s.articles.map(a=>a.dataset.key)).size,125);assert.equal(s.calls.length,5);assert.deepEqual(s.groups.map(g=>g.querySelectorAll('.cn-row').length),[45,5,75]);
 }finally{s.w.close();}
});

test('news filters preserve daily sections while clearing prior selection and pagination',async()=>{
 const s=setup([...Array.from({length:45},(_,i)=>row(i)),row(46,'2026-11-11','sevilla'),row(47,'2026-11-12','sevilla','injury')]);
 try{await s.open();s.articles[0].querySelector('.cn-open').click();s.w.document.querySelector('#newsClubs button[aria-label="Sevilla"]').click();await tick();assert.equal(s.articles.length,2);assert.deepEqual(s.groups.map(g=>g.dataset.day),['2026-11-12','2026-11-11']);assert.equal(s.more.hidden,true);assert.equal(s.calls.at(-1).url.searchParams.has('or'),false);assert.equal(s.w.document.getElementById('newsDetail').hidden,true);[...s.w.document.querySelectorAll('#newsFilters button')].find(b=>b.textContent==='Bajas').click();await tick();assert.equal(s.groups.length,1);assert.equal(s.groups[0].dataset.day,'2026-11-12');assert.equal(s.articles.length,1);assert.equal(s.calls.at(-1).url.searchParams.get('payload->>team'),'eq.sevilla');assert.equal(s.calls.at(-1).url.searchParams.get('payload->>category'),'eq.injury');}
 finally{s.w.close();}
});

test('invalid or absent server day cannot replace a valid daily snapshot or enter a cursor',async()=>{
 const s=setup([row(1)]);
 try{await s.open();for(const bad of ['2026-02-30','2026-13-01','2026-1-3','today','2026-11-13),key.gt.inject',undefined]){s.setHandler(()=>[{...row(2),news_day:bad}]);await s.reload();assert.equal(s.articles.length,1);assert.equal(s.articles[0].dataset.key,'dated-news-0001');assert.deepEqual(s.groups.map(g=>g.dataset.day),['2026-11-13']);assert.match(s.w.document.getElementById('newsStatus').textContent,/Se conservan.*reintentar/);}}
 finally{s.w.close();}
});

test('Hoy and Ayer use Miami midnight, update without network or lost selection, and stop timers when leaving',async()=>{
 const s=setup([row(1,'2026-11-13'),row(2,'2026-11-12')],'2026-11-14T04:59:00Z');
 try{await s.open();assert.deepEqual(s.titles,['Hoy','Ayer']);assert.equal(s.intervals.size,1);assert.equal([...s.intervals.values()][0].delay,60000);s.articles[0].querySelector('.cn-open').click();const article=s.articles[0],calls=s.calls.length;s.setClock('2026-11-14T05:00:00Z');s.pulse();assert.equal(s.titles[0],'Ayer');assert.match(s.titles[1],/jueves.*12.*noviembre/i);assert.equal(s.calls.length,calls);assert.equal(s.articles[0],article);assert.equal(article.querySelector('.cn-open').getAttribute('aria-expanded'),'true');assert.equal(s.w.document.getElementById('newsDetail').hidden,false);s.w.document.body.dataset.section='home';await tick();assert.equal(s.intervals.size,0);}
 finally{s.w.close();}
});

test('Miami relative days survive the spring and fall DST transitions',async()=>{
 for(const [now,day,yesterday] of [['2026-03-09T04:30:00Z','2026-03-09','2026-03-08'],['2026-11-02T05:30:00Z','2026-11-02','2026-11-01']]){
  const s=setup([row(1,day),row(2,yesterday)],now);try{await s.open();assert.deepEqual(s.titles,['Hoy','Ayer']);}finally{s.w.close();}
 }
});


test('daily pagination preserves timestamp ordering and stable key ties within one day',async()=>{
 const data=Array.from({length:43},(_,i)=>({...row(i),updated_at:i<3?'2026-11-13T16:00:00.123456+00:00':timestamp})),s=setup(data);
 try{await s.open();assert.equal(s.articles.length,40);assert.equal(s.articles[0].dataset.key,'dated-news-0003');assert.equal(s.articles.at(-1).dataset.key,'dated-news-0042');await s.next();assert.equal(s.articles.length,43);assert.deepEqual(s.articles.slice(-3).map(n=>n.dataset.key),['dated-news-0000','dated-news-0001','dated-news-0002']);assert.equal(s.groups.length,1);assert.equal(s.more.hidden,true);}
 finally{s.w.close();}
});
