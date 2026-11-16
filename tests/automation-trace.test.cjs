'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {TraceJournal,errorCode}=require('../scripts/forecast/trace-journal.cjs');
const {SeasonGateway}=require('../scripts/forecast/season-gateway.cjs');
const {createHash}=require('node:crypto');
const {ReadSession}=require('../scripts/forecast/read-session.cjs');
function journal(){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'trace-test-'));return {directory,trace:new TraceJournal({directory,executionKey:'cuban-league-trace-test',codeSha:'a'.repeat(40),runKey:'season-test'})};}
test('trace journal keeps append-only metadata and never serializes arbitrary messages or secrets',()=>{
 const {directory,trace}=journal();try{
  const a=trace.record({phase:'review',status:'started',team:'celta-vigo',request_id:'3',sql:'select secret',url:'https://x?token=private',error_message:'private error'});
  trace.record({phase:'review',status:'error',duration_ms:3,error_code:errorCode(Error('unresolved identity; private detail'))});
  const raw=fs.readFileSync(trace.file,'utf8');assert.equal(raw.trim().split('\n').length,2);assert.doesNotMatch(raw,/private|select|https/);assert.equal(a.seq,1);
  assert.equal(trace.manifest.confirmed_events,0);const b=trace.pendingBatch();trace.markSent(b);assert.equal(trace.pendingBatch().events.length,0);
  assert.equal(trace.events.length,2);trace.ack(b);assert.equal(trace.manifest.confirmed_events,2);
  assert.equal(errorCode(Error('bridge JSON invalid')),'bridge_protocol');assert.equal(errorCode(Error('input closed')),'channel_closed');
  assert.equal(errorCode({code:'40001'}),'sqlstate_40001');assert.equal(errorCode(Error('arbitrary secret')),'unclassified_error');
  for(const bad of [{phase:'https://secret',status:'error'},{phase:'review',status:'fake'},{phase:'review',status:'error',error_code:'secret value'},{phase:'review',status:'completed',bytes:-1}])assert.throws(()=>trace.record(bad));
  assert.equal(fs.statSync(trace.file).mode&0o777,0o600);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('gateway piggybacks metadata before sporting transaction and closes with idempotent acknowledged replay',async()=>{
 const {directory,trace}=journal();try{
  const queries=[],options=[];const gateway=new SeasonGateway({runKey:'season-test',trace,execute:async(a,o)=>{queries.push(a);options.push(o);if(a.query.startsWith('WITH stored'))return {events:1,missing:[2],digest:createHash('md5').update(trace.events[0].event_sha256).digest('hex'),identity_matches:true};if(a.query.startsWith('SELECT automation_ops.record_trace')){const p=JSON.parse(a.query.match(/\$forecast\$(.*?)\$forecast\$/s)[1]);assert.equal(p.events.length,1);return {accepted:true,events:p.events.length};}return {stable:'sporting-result'};}});
  const result=await gateway.plan();assert.deepEqual(result,{stable:'sporting-result'});assert.equal(queries.length,1);
  assert.match(queries[0].query,/record_trace.*EXCEPTION WHEN OTHERS THEN NULL.*COMMIT;\nBEGIN;/s);
  assert.deepEqual(Object.keys(queries[0]).sort(),['link_id','project_id','query']);assert.equal(trace.manifest.confirmed_events,0);
  const saved=await gateway.flushTrace();assert.equal(saved.accepted,true);assert.equal(saved.events,2);assert.equal(trace.manifest.confirmed_events,2);
  assert.equal(queries.length,3);assert.equal(trace.events.length,2);assert.deepEqual(options.slice(1),[{trace:false},{trace:false}]);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('local journal IO failure stays observable without losing queued metadata or breaking a sporting result',async()=>{
 const trace=new TraceJournal({directory:'/not-written',executionKey:'cuban-league-io-test',codeSha:'a'.repeat(40),runKey:'season-test',io:{writeFileSync(){throw Error('disk full');}}});
 trace.record({phase:'read',status:'error',source:'predicted11',kind:'ballot',http_status:503,error_code:'http_503'});
 const gateway=new SeasonGateway({runKey:'season-test',trace,execute:async()=>({published:true})});assert.deepEqual(await gateway.deliver('alaves'),{published:true});
 assert.equal(trace.manifest.local_error_code,'trace_local_io');assert.equal(trace.manifest.local_events,0);assert.equal(trace.events.length,3);
});
test('lost query reply preserves trace for replay and trace acknowledgement failure never masquerades as persisted',async()=>{
 const {directory,trace}=journal();try{
  const gateway=new SeasonGateway({runKey:'season-test',trace,execute:async()=>{throw Error('channel closed');}});
  await assert.rejects(gateway.plan(),/channel closed/);assert.equal(trace.pendingBatch().events.length,2);
  const failed=await gateway.flushTrace();assert.equal(failed.accepted,false);assert.equal(failed.events,0);assert.equal(failed.error_code,'channel_closed');
  gateway.execute=async()=>({accepted:false,events:2});assert.equal((await gateway.flushTrace()).accepted,false);assert.equal(trace.confirmedThrough,0);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('receipt checksum mismatch cannot claim stored events verified',async()=>{
 const {directory,trace}=journal();try{
  trace.record({phase:'runner',status:'completed'});
  const gateway=new SeasonGateway({runKey:'season-test',trace,execute:async()=>({events:1,missing:[],identity_matches:true,digest:'0'.repeat(32)})});
  assert.equal((await gateway.flushTrace()).accepted,false);assert.equal(trace.confirmedThrough,0);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('source tracing records fresh reads, reuse and HTTP failures without ballot URLs or tokens',async()=>{
 const {directory,trace}=journal();try{
  const now=Date.now(),reader=new ReadSession({runKey:'season-test',notBefore:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString(),trace,
   fetchImpl:async url=>url.includes('/api/')?new Response('private',{status:503}):new Response('<p>captured body</p>',{headers:{'content-type':'text/html'}})});
  reader.traceTeam='getafe';await reader.read('https://www.futbolfantasy.com/partidos/example');await reader.read('https://www.futbolfantasy.com/partidos/example');
  await assert.rejects(reader.readBallot('https://frpg.predicted11.com/api/juegos/participacion-criterios/11/28/16/13/get/999-SECRETTOKEN'),/503/);
  assert.deepEqual(trace.events.map(x=>x.status),['started','completed','reused','started','error']);
  assert.equal(trace.events[1].body_sha256,createHash('sha256').update('<p>captured body</p>').digest('hex'));assert.equal(trace.events[4].error_code,'http_503');assert.equal(trace.events[4].kind,'ballot');
  assert.ok(trace.events.every(x=>x.team==='getafe'));assert.doesNotMatch(fs.readFileSync(trace.file,'utf8'),/SECRETTOKEN|https|captured body|private/);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
