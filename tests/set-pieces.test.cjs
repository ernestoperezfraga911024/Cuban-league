const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const core=require('../set-pieces-core.js'),config=require('../forecast-round-config.js'),catalog=require('../catalog/players.json'),seed=require('../data/set-pieces.json');
const {parseJP,parseCM,identity}=require('../scripts/set-pieces/parse.cjs'),{reconcile,collect}=require('../scripts/collect-set-pieces.cjs'),{publish}=require('../scripts/publish-set-pieces.cjs');
const tick=()=>new Promise(r=>setTimeout(r,5));
const escape=s=>s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
function html(source,reverse=false){
 const data=seed.sources.find(s=>s.id===source),teams=[...config.teams];if(reverse)teams.reverse();
 if(source==='jornadaperfecta')return '<h1>Los lanzadores de LaLiga</h1><div>'+teams.map(t=>'<div class="title-block"><span>Lanzadores '+t.name+'</span></div><div class="row">'+Object.entries(data.teams[t.id]).map(([r,ps])=>ps.map(p=>`<a class="fifa-card" href="https://www.jornadaperfecta.com/jugador/${p.key}/"><span class="name" title="Nombre de ${escape(p.name)}">${escape(p.name)}</span><span class="capitalize">${{penalties:'Penaltis',direct_free_kicks:'F. directas',wide_free_kicks:'F. laterales'}[r]}</span></a>`).join('')).join('')+'<a class="fifa-card"><span class="capitalize">Córners</span></a></div>').join('')+'</div>';
 return '<h1>Lanzadores Penaltis por equipos</h1>'+teams.map(t=>'<div class="row"><span><strong class="comu-team-mini__name">'+t.name+'</strong></span>'+data.teams[t.id].penalties.map(p=>`<div class="col-md-4"><div class="row"><a href="https://www.comuniate.com/jugadores/123/${p.key}" title="${escape(p.name)}"><img class="img-circle"></a>${p.preferred?'Recomendación responsable':''}<div>Penaltis lanzados: ${p.attempts}</div><div>Penaltis anotados: ${p.scored}</div></div></div>`).join('')+'</div>').join('');
}
function results(stamp=new Date().toISOString()){return Object.fromEntries(Object.keys(core.SOURCES).map(id=>[id,{url:core.SOURCES[id].url,fetched_at:stamp,body:html(id)}]));}
test('20 real clubs have three roles, catalog identities stay in the same club, and corners are rejected',()=>{
 assert.equal(core.validate(seed,config.teams),seed);assert.equal(seed.sources.length,2);
 for(const s of seed.sources)for(const [team,roles]of Object.entries(s.teams))for(const ps of Object.values(roles))for(const p of ps){if(p.player_id)assert.equal(catalog.players.find(x=>x.id===p.player_id).club_id,team);}
 const bad=structuredClone(seed);bad.sources[0].teams['real-madrid'].corners=[];assert.throws(()=>core.validate(bad,config.teams));
 const duplicate=structuredClone(seed);duplicate.sources[0].teams['real-madrid'].penalties.push({...duplicate.sources[0].teams['real-madrid'].penalties[0],key:'different-slug'});assert.throws(()=>core.validate(duplicate,config.teams));
});
test('HTML extraction identifies each club explicitly, survives reordering and excludes corners',()=>{
 for(const [id,parse]of [['jornadaperfecta',parseJP],['comuniate',parseCM]]){
  assert.deepEqual(parse(html(id),catalog),parse(html(id,true),catalog));
  const data=parse(html(id),catalog);assert.equal(Object.keys(data).length,20);assert.ok(data['real-madrid'].penalties.some(p=>p.player_id==='k-mbappe'));
  assert.doesNotMatch(JSON.stringify(data),/corners|Córners/);assert.throws(()=>parse(html(id).replace(/Lanzadores Real Madrid|>Real Madrid</,'Unknown club'),catalog));
 }
 assert.throws(()=>parseJP(html('jornadaperfecta').replace('class="row"','class="changed"'),catalog));
 assert.throws(()=>parseCM('<html>Access denied</html>',catalog));
});
test('names never match a different club or an ambiguous surname',()=>{
 assert.equal(identity(['Trent'],'real-madrid',catalog).id,'t-alexander-arnold');assert.equal(identity(['Trent'],'fc-barcelona',catalog),null);
 const duplicate={players:[{id:'a',club_id:'test',display_name:'A. García'},{id:'b',club_id:'test',display_name:'B. García'}]};assert.equal(identity(['García'],'test',duplicate),null);
});
test('collector uses two shared reads, preserves failed-source dates and does not rejuvenate unchanged content',async()=>{
 const now=new Date(Date.now()+1000).toISOString(),r=results(now),first=reconcile(null,r,catalog,now).data;
 const later=new Date(Date.parse(now)+1000).toISOString(),second=reconcile(first,results(later),catalog,later).data;
 assert.equal(second.sources[0].changed_at,first.sources[0].changed_at);assert.equal(second.sources[0].fetched_at,later);
 const partial=reconcile(first,{...r,comuniate:{error:'HTTP 503'}},catalog,later).data;assert.equal(partial.sources[1].fetched_at,first.sources[1].fetched_at);assert.equal(partial.sources[1].ok,false);assert.deepEqual(partial.sources[1].teams,first.sources[1].teams);
 assert.throws(()=>reconcile(first,{jornadaperfecta:{error:'blocked'},comuniate:{error:'blocked'}},catalog,later));
 const calls=[];const result=await collect({catalog,session:{read:async url=>{calls.push(url);return Object.values(r).find(x=>x.url===url);}},now:()=>now});assert.equal(calls.length,2);assert.equal(result.data.sources.length,2);
});
test('preferred, historical takers and unordered candidates remain distinct, with discrepancies visible',()=>{
 const data=structuredClone(seed),jp=data.sources[0].teams['real-madrid'].penalties,cm=data.sources[1].teams['real-madrid'].penalties;
 cm[0].preferred=true;jp.splice(0,jp.length,{...jp[1]});
 const penalties=core.model(data,'real-madrid')[0];assert.equal(penalties.conflict,true);assert.ok(penalties.players.some(p=>p.preferred));
 for(const role of core.model(data,'real-madrid').slice(1))assert.ok(role.players.every(p=>!p.preferred));
});
test('publication only changes the dedicated feed file with optimistic concurrency; failures write nothing',async()=>{
 const calls=[],existing={sha:'file-sha',content:Buffer.from(JSON.stringify(seed)).toString('base64')},api=async(method,url,body)=>{calls.push({method,url,body});return method==='GET'&&url.startsWith('contents/')?existing:{};};
 await publish({api,sourceSha:'a'.repeat(40),collector:async()=>({data:seed,errors:[]})});
 const writes=calls.filter(c=>c.method!=='GET');assert.equal(writes.length,1);assert.equal(writes[0].url,'contents/set-pieces.json');assert.equal(writes[0].body.branch,'set-pieces-feed');assert.equal(writes[0].body.sha,'file-sha');
 calls.length=0;await assert.rejects(()=>publish({api,sourceSha:'a'.repeat(40),collector:async()=>{throw Error('sources down');}}));assert.equal(calls.filter(c=>c.method!=='GET').length,0);
});
function browser(){
 const dom=new JSDOM('<body><div id="host"></div></body>',{url:'https://preview.test/',runScripts:'outside-only',pretendToBeVisual:true});
 dom.window.eval(read('forecast-round-config.js'));dom.window.eval(read('set-pieces-core.js'));return dom;
}
test('UI is lazy, shares one feed across clubs, handles source failure and uses text rather than HTML',async()=>{
 const dom=browser(),w=dom.window,calls=[];let fail=false;
 try{
  const data=structuredClone(seed);data.sources[0].teams['real-madrid'].direct_free_kicks[0].name='<img src=x onerror=alert(1)>';
  w.fetch=async url=>{calls.push(url);if(fail)throw Error('offline');return {ok:true,text:async()=>JSON.stringify(data)};};w.eval(read('set-pieces.js'));
  const host=w.document.getElementById('host');w.CubanSetPieces.mount(host,'real-madrid',null);assert.equal(calls.length,0);
  let details=host.querySelector('details');details.open=true;details.dispatchEvent(new w.Event('toggle'));await tick();await tick();
  assert.equal(calls.length,1);assert.equal(host.querySelectorAll('.sp-role').length,3);assert.equal(host.querySelector('img[onerror]'),null);assert.match(host.textContent,/<img src=x/);assert.doesNotMatch(host.textContent,/Córners/);
  host.replaceChildren();w.CubanSetPieces.mount(host,'fc-barcelona',null);details=host.querySelector('details');details.open=true;details.dispatchEvent(new w.Event('toggle'));await tick();assert.equal(calls.length,1);
  fail=true;host.querySelector('.sp-refresh').click();await tick();assert.match(host.textContent,/No se pudo comprobar/);assert.equal(host.querySelectorAll('.sp-role').length,3);
 }finally{dom.window.close();}
});
test('a detached club cannot be repainted by an old request, and initial offline fallback is clearly marked',async()=>{
 const dom=browser(),w=dom.window;try{
  let finish;w.fetch=()=>new Promise(resolve=>{finish=resolve;});w.eval(read('set-pieces.js'));const host=w.document.getElementById('host');w.CubanSetPieces.mount(host,'real-madrid',null);
  const first=host.querySelector('details');first.open=true;first.dispatchEvent(new w.Event('toggle'));host.replaceChildren();w.CubanSetPieces.mount(host,'fc-barcelona',null);
  finish({ok:true,text:async()=>JSON.stringify(seed)});await tick();assert.equal(host.querySelectorAll('.sp-role').length,0);assert.equal(host.querySelectorAll('.sp-panel').length,1);
 }finally{dom.window.close();}
 const fallback=browser(),v=fallback.window;try{
  const calls=[];v.fetch=async url=>{calls.push(url);if(String(url).startsWith('https://raw.'))throw Error();return {ok:true,text:async()=>JSON.stringify(seed)};};v.eval(read('set-pieces.js'));const host=v.document.getElementById('host');v.CubanSetPieces.mount(host,'real-madrid',null);const d=host.querySelector('details');d.open=true;d.dispatchEvent(new v.Event('toggle'));await tick();await tick();assert.equal(calls.length,2);assert.match(host.textContent,/referencia guardada/);
 }finally{fallback.window.close();}
});
test('integration is additive and the daily publisher has no database or model API access',()=>{
 const index=read('index.html'),sw=read('sw.js'),workflow=read('.github/workflows/set-pieces.yml');
 for(const f of ['set-pieces-core.js','set-pieces.js','set-pieces.css']){assert.ok(index.includes(f+'?v=226'));assert.ok(sw.includes(f+'?v=226'));}
 assert.ok(require('rrweb-cssom').parse(read('set-pieces.css')).cssRules.length>10);
 assert.match(read('forecast-season-public.js'),/try\{window\.CubanSetPieces\?\.mount/);assert.doesNotMatch(read('scripts/publish-set-pieces.cjs'),/supabase|OPENAI|anthropic/i);assert.match(workflow,/contents: write/);assert.match(workflow,/github\.event_name != 'pull_request'/);assert.match(workflow,/37 12 \* \* \*/);
});
