'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8'),tick=()=>new Promise(r=>setTimeout(r,15));
test('Noticias loads lazily, filters on the server, escapes content and preserves a failed refresh snapshot',async()=>{
 const dom=new JSDOM(read('index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''),{url:'https://example.test/',runScripts:'outside-only'}),w=dom.window;try{
 let calls=0,fail=false;const club={id:'real-madrid',name:'Real Madrid',crest:'https://example.test/crest.png'};
 w.CUBAN_LEAGUE_SUPABASE={url:'https://example.test',publishableKey:'public-test-key'};
 w.CubanLeaguePlayerCatalog={load:async()=>({clubs:[club],clubsById:new Map([[club.id,club]]),playersById:new Map()})};
 const row={key:'test-transfer',news_day:'2026-11-12',updated_at:'2026-11-13T13:00:00.123456+00:00',payload:{team:club.id,category:'transfer',certainty:'rumor',title:'<img src=x onerror=alert(1)>',summary:'Una información sin confirmar.',impact:'No cambia de club ni confirma titularidad.',players:[],timeline:[],sources:[{name:'Comuniate',url:'https://www.comuniate.com/noticias/test',published_at:null,published_label:'12/11/2026 (fecha de la fuente)',fetched_at:new Date().toISOString()}]}};
 w.fetch=async url=>{calls++;if(fail)throw Error('offline');const u=new URL(url);return {ok:true,json:async()=>url.includes('news_status')?[{checked_at:new Date().toISOString(),result:'partial'}]:u.searchParams.get('payload->>category')==='eq.injury'?[]:[row]};};
 w.eval(read('news.js'));assert.equal(calls,0);w.document.body.dataset.section='news';await tick();assert.equal(calls,2);assert.equal(w.document.querySelectorAll('.cn-row').length,1);assert.equal(w.document.querySelector('.cn-copy strong').textContent,row.payload.title);assert.equal(w.document.querySelector('.cn-copy img'),null);assert.match(w.document.getElementById('newsStatus').textContent,/parcial/);const closed=()=>{assert.equal(w.document.querySelectorAll('.cn-open[aria-expanded="true"],.cn-detail,.cn-layout.has-selection').length,0);assert.equal(w.document.getElementById('newsDetail').hidden,true);};closed();
 const open=()=>{w.document.querySelector('.cn-open').click();assert.equal(w.document.getElementById('newsDetail').hidden,false);assert.match(w.document.getElementById('newsDetail').textContent,/Rumor/);assert.equal(w.document.querySelector('.cn-open').getAttribute('aria-expanded'),'true');};
 open();w.document.querySelector('.cn-open').click();closed();
 open();w.document.querySelector('#newsClubs button').click();closed();
 open();[...w.document.querySelectorAll('#newsFilters button')].find(x=>x.textContent==='Todas').click();closed();
 [...w.document.querySelectorAll('#newsFilters button')].find(x=>x.textContent==='Bajas').click();await tick();assert.equal(w.document.querySelectorAll('.cn-row').length,0);assert.equal(calls,3);
 [...w.document.querySelectorAll('#newsFilters button')].find(x=>x.textContent==='Todas').click();await tick();assert.equal(w.document.querySelectorAll('.cn-row').length,1);closed();open();assert.equal(w.document.querySelector('.cn-detail a').rel,'noopener noreferrer');
 w.document.getElementById('newsReload').click();await tick();assert.equal(calls,6);closed();
 open();w.document.body.dataset.section='home';await tick();closed();w.document.body.dataset.section='news';await tick();assert.equal(calls,8);closed();open();
 fail=true;w.document.getElementById('newsReload').click();await tick();assert.equal(w.document.querySelectorAll('.cn-row').length,1);assert.equal(w.document.getElementById('newsDetail').textContent,'');assert.match(w.document.getElementById('newsStatus').textContent,/conservan.*reintentar/);closed();
 }finally{w.close();}
});
test('Noticias admin preserves the request after a lost response and resets on logout',async()=>{
 const dom=new JSDOM(read('admin.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''),{url:'https://example.test/',runScripts:'outside-only'}),w=dom.window;try{
 const requests=[];let lost=true;w.eval(read('news-admin.js'));w.CubanNewsAdmin.init({client:{rpc:async(name,p)=>{requests.push({...p});if(p.p_action==='automatic'&&lost){lost=false;return {error:{message:'response lost'}};}return {data:{mode:'automatic',version:5,items:[]}};}}});w.CubanNewsAdmin.authorize();
 w.document.getElementById('newsAdminReload').click();await tick();w.document.getElementById('newsAdmin-automatic').click();await tick();assert.equal(w.document.getElementById('newsAdminRetry').hidden,false);w.document.getElementById('newsAdminRetry').click();await tick();assert.deepEqual(requests.at(-1),requests.at(-2));assert.equal(w.document.getElementById('newsAdminRetry').hidden,true);
 w.CubanNewsAdmin.reset();assert.equal(w.document.getElementById('newsAdmin-publish').disabled,true);assert.equal(w.document.getElementById('newsAdminRows').textContent,'');
 }finally{w.close();}
});
