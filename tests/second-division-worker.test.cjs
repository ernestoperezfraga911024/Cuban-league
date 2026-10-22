const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const {webcrypto} = require('node:crypto');
const script=fs.readFileSync(require.resolve('../mister-extension/background.js'),'utf8');
function worker(storage={}) {
  let listener; const visits=[];
  const chrome={storage:{session:{get:async key=>structuredClone(key?{[key]:storage[key]}:storage),set:async values=>Object.assign(storage,structuredClone(values)),remove:async key=>{delete storage[key];}}},
    tabs:{create:async data=>{visits.push(data.url);return{id:50};},update:async (id,data)=>visits.push(data.url),sendMessage:async()=>({ok:true})},
    runtime:{onMessage:{addListener(fn){listener=fn;}}}};
  vm.runInNewContext(script,{chrome,URL,crypto:webcrypto,setTimeout,Date});
  const call=(type,input={},tabId=10,url='https://ernestoperezfraga911024.github.io/Cuban-league/admin.html',frameId=0)=>new Promise(resolve=>listener({type,input},{url,tab:{id:tabId},frameId},resolve));
  return{call,storage,visits};
}

test('Second captures are bound to scope, owning tabs and league, and survive worker restart',async()=>{
  let w=worker();const input={season:'2026/27',matchday:5,excludedManagerId:'999'};
  const start=await w.call('SECOND_START',input);assert.equal(start.ok,true);
  assert.equal((await w.call('SECOND_START',input)).id,start.id);
  assert.equal((await w.call('SECOND_START',{...input,matchday:6})).ok,false);
  assert.equal((await w.call('START',{season:'2026/27',matchday:1})).ok,false);
  assert.equal((await w.call('SECOND_STATUS',{id:start.id},11)).ok,false);
  w=worker(w.storage);const origin='https://mister.mundodeportivo.com/standings';
  assert.equal((await w.call('SECOND_READY',{},50,origin)).job.id,start.id);
  assert.equal((await w.call('MISTER_READY',{},50,origin)).job,null);
  const payload={league:{id:'978196'},kind:'matchday',matchday:5,excludedManagerId:'999',season:'2026/27'};
  assert.equal((await w.call('SECOND_RESULT',{id:start.id,payload:{...payload,matchday:6}},50,origin)).ok,false);
  assert.equal((await w.call('SECOND_RESULT',{id:start.id,payload},51,origin)).ok,false);
  assert.equal((await w.call('SECOND_RESULT',{id:start.id,payload},50,origin)).ok,true);
  assert.equal((await w.call('SECOND_STATUS',{id:start.id})).job.payload.matchday,5);
  await w.call('SECOND_CONSUME',{id:start.id});
  assert.equal((await w.call('SECOND_STATUS',{id:start.id})).job.payload,undefined);
});
test('First capture blocks Second; cancellation rejects late Second results and untrusted origins',async()=>{
  const w=worker();const first=await w.call('START',{season:'2026/27',matchday:1});
  const input={season:'2026/27',matchday:0,excludedManagerId:''};
  assert.equal((await w.call('SECOND_START',input)).ok,false);
  await w.call('CANCEL',{id:first.id});
  assert.equal((await w.call('SECOND_START',input,10,'https://evil.example')).ok,false);
  assert.equal((await w.call('SECOND_START',input,10,undefined,1)).ok,false);
  const second=await w.call('SECOND_START',input);assert.equal(second.ok,true);
  await w.call('SECOND_CANCEL',{id:second.id});
  assert.equal((await w.call('SECOND_RESULT',{id:second.id,payload:{}},50,'https://mister.mundodeportivo.com')).ok,false);
  assert.equal((await w.call('START',{season:'2026/27',matchday:1})).ok,true);
});
