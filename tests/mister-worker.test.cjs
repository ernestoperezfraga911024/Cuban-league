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
test('orígenes exactos, subframes y pestañas ajenas no controlan capturas',async()=>{
  const w=worker();
  assert.equal((await w.call('START',{matchday:3,season:'2026/27'},10,'https://evil.example')).ok,false);
  assert.equal((await w.call('HELLO',{},10,undefined,1)).ok,false);
  const start=await w.call('START',{matchday:3,season:'2026/27'});assert.equal(start.ok,true);
  assert.equal((await w.call('STATUS',{id:start.id},11)).ok,false);
  assert.equal((await w.call('PUBLISH',{id:start.id})).ok,false);
  assert.equal(w.visits[1],'https://mister.mundodeportivo.com/standings');
  assert.equal(w.visits.some(url=>/token|password|cuban_request/.test(url)),false);
});
test('captura sobrevive reinicio del worker, cancelación rechaza respuesta tardía',async()=>{
  let w=worker();const {id}=await w.call('START',{matchday:3,season:'2026/27'});
  w=worker(w.storage);
  const sender='https://mister.mundodeportivo.com/standings';
  const ready=await w.call('MISTER_READY',{},50,sender);assert.equal(ready.job.id,id);
  const discovery={league:{id:'649733'},gameweekId:4044};
  assert.equal((await w.call('DISCOVERED',{id,discovery},50,sender)).ok,true);
  assert.equal((await w.call('CAPTURE',{id})).ok,true);
  assert.equal((await w.call('CANCEL',{id})).ok,true);
  assert.equal((await w.call('RESULT',{id,payload:{managers:[]}},50,sender)).ok,false);
  assert.equal((await w.call('STATUS',{id})).job.status,'cancelled');
});
test('resultado se conserva hasta confirmación del panel y luego se elimina',async()=>{
  const w=worker();const {id}=await w.call('START',{matchday:6,season:'2026/27'});const sender='https://mister.mundodeportivo.com/standings';
  await w.call('DISCOVERED',{id,discovery:{gameweekId:4047}},50,sender);await w.call('CAPTURE',{id});
  await w.call('RESULT',{id,payload:{matchday:6,managers:[]}},50,sender);
  assert.equal((await w.call('STATUS',{id})).job.payload.matchday,6);
  await w.call('CONSUME',{id});assert.equal((await w.call('STATUS',{id})).job.payload,undefined);
});

test('reintento tras perder START recupera solo la captura de la misma pestaña, jornada y temporada',async()=>{
  const w=worker();const input={matchday:6,season:'2026/27'};
  const start=await w.call('START',input);
  assert.equal((await w.call('START',input)).id,start.id);
  assert.equal(w.visits.length,2);
  assert.equal((await w.call('START',input,11)).ok,false);
  assert.equal((await w.call('START',{...input,matchday:3})).ok,false);
  assert.equal((await w.call('START',{...input,season:'2025/26'})).ok,false);
});
