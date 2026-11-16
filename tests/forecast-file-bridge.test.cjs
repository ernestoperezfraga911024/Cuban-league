'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {spawn,execFile}=require('node:child_process'),{promisify}=require('node:util'),{PassThrough}=require('node:stream');
const {createRuntimeBridge}=require('../scripts/forecast/runtime-bridge.cjs');
const {createConnectorBridge}=require('../scripts/forecast/connector-bridge.cjs');
const {createHash}=require('node:crypto');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const atomic=async(file,value)=>{await fs.writeFile(file+'.tmp',JSON.stringify(value),{mode:0o600});await fs.rename(file+'.tmp',file);};
const readEvents=async file=>(await fs.readFile(file,'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));
test('file runner finishes with stdin closed and stdout/exec delivery lost; events remain recoverable',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'runner-file-mode-'));
 const child=spawn(process.execPath,['scripts/run-forecast-season.cjs','--file-bridge','--existing-run','season-file-test'],{stdio:['ignore','pipe','pipe'],env:{...process.env,TMPDIR:root,FORECAST_EXECUTION_KEY:'cuban-league-transport-test',FORECAST_CODE_SHA:'a'.repeat(40)}});
 let errorText='',directory,finished,requests=0,lastSequence=0;const storedTrace=new Map();
 child.stderr.on('data',data=>errorText+=data);
 const done=new Promise(resolve=>child.once('close',code=>resolve(code)));
 const first=await new Promise((resolve,reject)=>{
  let text='';const timer=setTimeout(()=>reject(Error('No first file event')),5000);
  child.stdout.on('data',data=>{text+=data;if(text.includes('\n')){clearTimeout(timer);resolve(JSON.parse(text.split('\n')[0]));}});
  child.once('error',reject);
 });
 directory=path.dirname(first.path);child.stdout.destroy(); // All following work uses disk, not an exec session.
 const at=new Date().toISOString(),state={observed_at:at,run:{expected:[],slot_at:at,started_at:at,finished_at:at},attempts:[]};
 try{
  const until=Date.now()+10000;
  while(!finished&&Date.now()<until){
   for(const event of (await readEvents(first.event_log)).filter(e=>e.event_seq>lastSequence)){
    lastSequence=event.event_seq;assert.equal(event.transport,'file');assert.ok(event.emitted_at);
    if(event.event==='finished'){finished=JSON.parse(await fs.readFile(event.path,'utf8'));continue;}
    assert.equal(event.event,'sql');requests++;
    const request=JSON.parse(await fs.readFile(event.path,'utf8'));
    let batch;
    for(const match of request.query.matchAll(/record_trace\(\$forecast\$([\s\S]*?)\$forecast\$::jsonb\)/g)){
      batch=JSON.parse(match[1]);for(const row of batch.events)storedTrace.set(row.seq,row);
    }
    let result=request.query.includes("'teams',(")?{observed_at:at,teams:null}:state;
    if(request.query.startsWith('WITH stored AS')){
      const target=Number(request.query.match(/seq<=(\d+)/)[1]),rows=[...storedTrace.values()].filter(e=>e.seq<=target).sort((a,b)=>a.seq-b.seq);
      result={events:rows.length,missing:Array.from({length:target},(_,i)=>i+1).filter(seq=>!storedTrace.has(seq)),identity_matches:true,digest:createHash('md5').update(rows.map(e=>e.event_sha256).join('')).digest('hex')};
    }else if(request.query.startsWith('SELECT automation_ops.record_trace('))result={accepted:true,events:batch.events.length};
    await atomic(event.response_path,{result});
   }
   if(!finished)await sleep(30);
  }
  assert.ok(finished,'Runner did not finish from files');assert.equal(await done,0,errorText);assert.equal(requests,5);
  assert.equal(finished.no_eligible_teams,true);assert.equal(finished.publication_complete,false);
  const checkpoint=JSON.parse(await fs.readFile(path.join(directory,'checkpoint.json'),'utf8'));
  assert.equal(checkpoint.transport,'file');assert.equal(checkpoint.status,'partial');assert.equal(checkpoint.event_log,first.event_log);
  assert.equal(checkpoint.trace_delivery.accepted,true);assert.equal(checkpoint.trace.confirmed_events,checkpoint.trace.events);
  assert.equal((await fs.stat(first.event_log)).mode&0o777,0o600);
 }finally{if(child.exitCode===null)child.kill('SIGKILL');await done;await fs.rm(root,{recursive:true,force:true});}
});
test('file adapter returns persisted next events without stdin and claims each SQL request once',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'forecast-season-'));
 try{
  const event={event:'sql',id:'1',path:path.join(directory,'1-sql.json'),response_path:path.join(directory,'1-response.json'),transport:'file',event_log:path.join(directory,'events.ndjson'),event_seq:1};
  const args={link_id:'link_6aad67ea13208191b8315f9bb7f2cce7',project_id:'pyahosamoisqcbpvzwka',query:'select true as result'};
  await fs.writeFile(event.path,JSON.stringify(args));await fs.writeFile(event.event_log,JSON.stringify({...event,event_seq:2})+'\n');
  const run=promisify(execFile);let calls=0;
  const tools={exec_command:async({cmd})=>{const r=await run('/bin/bash',['-c',cmd]);return {exit_code:0,output:r.stdout};},
   write_stdin:async()=>{throw Error('No stdin/session may be used');},
   mcp__codex_apps__supabase_execute_sql:async actual=>{assert.deepEqual(actual,args);calls++;return {structuredContent:[{result:{ok:true}}]};}};
  const bridge=createConnectorBridge(tools),next=await bridge.sql(event);
  assert.equal(calls,1);assert.equal(JSON.parse(next.output).event_seq,2);
  assert.deepEqual(JSON.parse(await fs.readFile(event.response_path,'utf8')),{result:{ok:true}});
  await bridge.sql(event);assert.equal(calls,1,'A replay must not execute SQL again');
  await fs.writeFile(event.response_path+'.accepted','{}');
  await bridge.reply(event,{error:'A replay must not replace an accepted result'});
  assert.deepEqual(JSON.parse(await fs.readFile(event.response_path,'utf8')),{result:{ok:true}});
  await fs.unlink(event.response_path);
  await assert.rejects(bridge.sql(event),/already claimed/);assert.equal(calls,1,'Lost mutation response must never trigger a retry');
  const history=Array.from({length:70},(_,i)=>({...event,event_seq:i+1,note:'x'.repeat(1500)}));
  await fs.writeFile(event.event_log,history.map(e=>JSON.stringify(e)).join('\n')+'\n');
  const found=[];let cursor={...event,event_seq:0};
  while(found.length<history.length){
    const page=await bridge.poll(cursor);assert.ok(Buffer.byteLength(page.output)<=16000);
    const rows=page.output.trim().split('\n').map(line=>JSON.parse(line));assert.ok(rows.length>0&&rows.length<=20);
    found.push(...rows.map(e=>e.event_seq));cursor=rows.at(-1);
  }
  assert.deepEqual(found,history.map(e=>e.event_seq));
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
test('file-mode CLI refuses to start without durable trace identity',async()=>{
 await assert.rejects(promisify(execFile)(process.execPath,['scripts/run-forecast-season.cjs','--file-bridge','--existing-run','season-missing-trace'],{env:{...process.env,FORECAST_EXECUTION_KEY:'',FORECAST_CODE_SHA:''}}),error=>{
  assert.equal(error.code,1);assert.equal(error.stdout,'');assert.match(error.stderr,/requires FORECAST_EXECUTION_KEY and FORECAST_CODE_SHA/);return true;
 });
});
test('file inbox reports one malformed publication, accepts its atomic correction and records real deadlines',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'forecast-season-')),output=new PassThrough();output.resume();
 const runtime=await createRuntimeBridge({directory,lock:{assertHeld(){}},fileMode:true,output,pollMs:10,reviewTimeoutMs:600000});
 try{
  const end=new Date(Date.now()+1500).toISOString(),pending=runtime.request('review',{window:{expiresAt:end}});
  let event;while(!(event=(await readEvents(runtime.eventLog))[0]))await sleep(5);
  assert.equal(event.deadline_at,end);
  await fs.writeFile(event.response_path,'{"result":');await sleep(100);
  let events=await readEvents(runtime.eventLog);assert.equal(events.filter(e=>e.event==='bridge_error').length,1);
  await atomic(event.response_path,{result:{quality:'reviewed'}});assert.deepEqual(await pending,{quality:'reviewed'});
  events=await readEvents(runtime.eventLog);assert.equal(events.filter(e=>e.event==='bridge_error').length,1);
 }finally{await runtime.close();await fs.rm(directory,{recursive:true,force:true});}
});
test('stdin EOF before request registration fails immediately instead of waiting five minutes',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'forecast-season-')),input=new PassThrough(),output=new PassThrough();output.resume();
 const runtime=await createRuntimeBridge({directory,lock:{assertHeld(){}},input,output});
 try{input.end();await sleep(10);const start=Date.now();await assert.rejects(runtime.request('sql',{query:'never executed'}),/Input closed/);assert.ok(Date.now()-start<1000);}
 finally{await runtime.close();await fs.rm(directory,{recursive:true,force:true});}
});
