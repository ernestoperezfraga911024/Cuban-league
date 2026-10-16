const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'sw.js'),'utf8');
function setup(){
  const base='https://example.test/Cuban-league/sw.js';
  const records=new Map(),events={};
  const key=value=>new URL(typeof value==='string'?value:value.url,base).href;
  const cache={
    async match(value){return records.get(key(value))?.clone();},
    async put(value,response){records.set(key(value),response.clone());}
  };
  const context=vm.createContext({
    URL,Response,
    self:{location:new URL(base),addEventListener:(name,handler)=>{events[name]=handler;}},
    caches:{open:async()=>cache},
    fetch:async()=>{throw new Error('Offline');}
  });
  vm.runInContext(source+'\nglobalThis.shell=APP_SHELL;',context);
  const dispatch=url=>{
    let result;const waits=[];
    events.fetch({request:{url:new URL(url,base).href,method:'GET',mode:'cors'},respondWith(p){result=p;},waitUntil(p){waits.push(p);}});
    return {result,waits};
  };
  return {context,cache,dispatch};
}

test('offline JavaScript uses matching precache version, never index.html',async()=>{
  const {context,cache,dispatch}=setup();
  await cache.put('./index.html',new Response('<html>home</html>',{headers:{'Content-Type':'text/html'}}));
  const app=context.shell.find(asset=>asset.startsWith('./app.js?'));
  await cache.put(app,new Response('window.appLoaded=true;',{headers:{'Content-Type':'text/javascript'}}));
  const recovered=await dispatch('./app.js?v=old-installed-page').result;
  assert.match(recovered.headers.get('Content-Type'),/javascript/);
  assert.equal(await recovered.text(),'window.appLoaded=true;');
  const missing=await dispatch('./mister-import-helper.js?v=missing').result;
  assert.equal(missing.status,504);
  assert.doesNotMatch(await missing.text(),/<html>/);
});

test('a transient HTTP 503 uses cached data; quota errors still deliver a good network response',async()=>{
  const {context,cache,dispatch}=setup();
  const data=context.shell.find(asset=>asset.startsWith('./data.json?'));
  await cache.put(data,new Response('{"historicalTables":{}}',{headers:{'Content-Type':'application/json'}}));
  context.fetch=async()=>new Response('Unavailable',{status:503});
  const fallback=await dispatch(data).result;
  assert.equal(fallback.status,200);
  assert.deepEqual(await fallback.json(),{historicalTables:{}});
  cache.put=async()=>{throw new Error('QuotaExceededError');};
  context.fetch=async()=>new Response('fresh javascript',{headers:{'Content-Type':'text/javascript'}});
  assert.equal(await (await dispatch('./app.js?v=current').result).text(),'fresh javascript');
});

test('asset revalidation stays alive until the updated image is cached',async()=>{
  const {context,cache,dispatch}=setup();
  await cache.put('./team-01.png',new Response('old-image'));
  context.fetch=async()=>new Response('new-image');
  const event=dispatch('./team-01.png');
  assert.equal(await (await event.result).text(),'old-image');
  await Promise.all(event.waits);
  assert.equal(await (await cache.match('./team-01.png')).text(),'new-image');
});

test('Supabase requests bypass the worker; public script versions match precache',()=>{
  const {context,dispatch}=setup();
  assert.equal(dispatch('https://league.test/rest/v1/matchday_stats').result,undefined);
  const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'));
  try{
    for(const script of dom.window.document.querySelectorAll('script[src]')){
      assert.ok(context.shell.includes('./'+script.getAttribute('src')),script.getAttribute('src'));
    }
    for(const asset of context.shell){
      assert.ok(fs.existsSync(path.join(root,asset.split('?')[0])),asset);
    }
  }finally{dom.window.close();}
});
