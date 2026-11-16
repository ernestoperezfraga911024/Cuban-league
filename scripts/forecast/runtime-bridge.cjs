'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),readline=require('node:readline');
const {createHash}=require('node:crypto');
const {responseValue}=require('./bridge-response.cjs');
// The file inbox is independent of the orchestration tool's stdin/session handle.
// The append-only event log is the reconnect cursor, never sporting authority.
async function createRuntimeBridge({directory,lock,fileMode=false,trace=null,input=process.stdin,output=process.stdout,timeoutMs=null,reviewTimeoutMs=600000,sqlTimeoutMs=300000,pollMs=200}) {
  const pending=new Map(),eventLog=path.join(directory,'events.ndjson');
  let sequence=0,eventSequence=0,closed=false,outputClosed=false,events=Promise.resolve(),inputEvents=Promise.resolve();
  const digest=value=>createHash('sha256').update(value).digest('hex');
  const record=async value=>{if(trace)await trace.record(value);};
  await fs.writeFile(eventLog,'',{flag:'wx',mode:0o600});
  const outputError=error=>{if(fileMode&&['EPIPE','ERR_STREAM_DESTROYED'].includes(error.code)){outputClosed=true;return;}rejectAll('Output channel failed; reread state before resuming');};
  output.on('error',outputError);
  async function emit(value) {
    const event={...value,event_seq:++eventSequence,emitted_at:new Date().toISOString(),event_log:eventLog,transport:fileMode?'file':'stdin'};
    events=events.then(async()=>{const line=JSON.stringify(event)+'\n';await fs.appendFile(eventLog,line,{mode:0o600});if(!outputClosed)output.write(line);});
    await events;return event;
  }
  function settle(id,error,result) {
    const p=pending.get(id);if(!p)return;
    pending.delete(id);clearTimeout(p.timer);clearInterval(p.poller);
    error?p.reject(error):p.resolve(result);
  }
  function rejectAll(reason) {for(const id of pending.keys())settle(id,Error(reason));}
  async function accept(message) {
    const p=pending.get(message?.id);
    if(!p){await emit({event:'bridge_error',id:message?.id||null,reason:'Unknown response id; current request unchanged'});return;}
    if(p.accepting)return;p.accepting=true;
    try {
      const value=await responseValue(message,{directory,id:message.id,requireFile:true});
      const body=await fs.readFile(message.result_file);
      // A response arriving after the deadline is retained for inspection but
      // must never resolve a request that has already timed out.
      if(pending.get(message.id)!==p)return;
      if(Date.now()>=p.deadlineAt){
        if(p.trace)await record({phase:'bridge_'+p.kind,status:'error',request_id:message.id,error_code:'bridge_timeout',duration_ms:Date.now()-p.started});
        settle(message.id,Error(p.kind+' response timed out; state must be reread'));return;
      }
      if(p.trace)await record({phase:'bridge_'+p.kind,status:value.error?'error':'completed',request_id:message.id,response_sha256:digest(body),bytes:body.length,duration_ms:Date.now()-p.started,error_code:value.error?'connector_error':undefined});
      if(fileMode)await fs.writeFile(message.result_file+'.accepted',JSON.stringify({response_sha256:digest(body),accepted_at:new Date().toISOString()}),{flag:'wx',mode:0o600});
      settle(message.id,value.error?Error(String(value.error)):null,value.result);
    } catch(error) {
      if(pending.get(message.id)!==p)return;
      if(p.trace)await record({phase:'bridge_'+p.kind,status:'error',request_id:message.id,error_code:'invalid_bridge_response'});
      await emit({event:'bridge_error',id:message.id,reason:error.message,response_path:path.join(directory,message.id+'-response.json')});
      if(++p.invalid>=3)settle(message.id,Error('Repeated invalid bridge responses'));
    } finally {p.accepting=false;}
  }
  const rl=fileMode?null:readline.createInterface({input});
  if(rl){
    rl.on('line',line=>{inputEvents=inputEvents.then(async()=>{
      let message;try{message=JSON.parse(line);}catch(error){
        const [id,p]=pending.size===1?[...pending][0]:[];
        await emit({event:'bridge_error',id:id||null,reason:error.message,response_path:id?path.join(directory,id+'-response.json'):null});
        if(p&&++p.invalid>=3)settle(id,Error('Repeated invalid bridge responses'));return;
      }
      await accept(message);
    }).catch(error=>rejectAll(error.message));});
    rl.on('close',()=>{closed=true;rejectAll('Input closed; resume existing saved/missing attempts');});
  }
  async function request(kind,body,{trace:enableTrace=true}={}) {
    lock.assertHeld();if(closed)throw Error('Input closed; resume existing saved/missing attempts');
    const id=String(++sequence),file=path.join(directory,id+'-'+kind+'.json'),serialized=JSON.stringify(body),started=Date.now();
    const windowEnd=kind==='review'?Date.parse(body?.window?.expiresAt):NaN;
    const budget=Math.min(timeoutMs??(kind==='review'?reviewTimeoutMs:sqlTimeoutMs),Number.isFinite(windowEnd)?windowEnd-started:Infinity);
    if(budget<=0)throw Error('Review window expired; reread database plan before resuming');
    await fs.writeFile(file,serialized,{flag:'wx',mode:0o600});
    if(enableTrace)await record({phase:'bridge_'+kind,status:'started',request_id:id,body_sha256:digest(serialized),bytes:Buffer.byteLength(serialized)});
    // Check again after asynchronous file IO: EOF may precede registration.
    if(closed)throw Error('Input closed; resume existing saved/missing attempts');
    return new Promise((resolve,reject)=>{
      const p={resolve,reject,kind,started,deadlineAt:started+budget,invalid:0,accepting:false,lastVersion:null,trace:enableTrace};
      p.timer=setTimeout(async()=>{
        try{if(enableTrace)await record({phase:'bridge_'+kind,status:'error',request_id:id,error_code:'bridge_timeout',duration_ms:Date.now()-started});}
        finally{settle(id,Error(kind+' response timed out; state must be reread'));}
      },Math.max(1,p.deadlineAt-Date.now()));
      pending.set(id,p);
      if(fileMode)p.poller=setInterval(async()=>{
        if(p.accepting||pending.get(id)!==p)return;
        try{
          const info=await fs.lstat(path.join(directory,id+'-response.json'));
          // Invalid atomic publications count once; wait for a replacement.
          const version=[info.ino,info.size,info.mtimeMs,info.ctimeMs].join(':');
          if(version===p.lastVersion)return;p.lastVersion=version;
          await accept({id,result_file:path.join(directory,id+'-response.json')});
        }catch(error){if(error.code!=='ENOENT')settle(id,error);}
      },pollMs);
      emit({event:kind,id,path:file,response_path:path.join(directory,id+'-response.json'),response_format:'file',deadline_at:new Date(started+budget).toISOString()}).catch(error=>settle(id,error));
    });
  }
  async function close(){closed=true;rejectAll('Runner closed');rl?.close();await inputEvents;await events;output.removeListener('error',outputError);}
  return {request,emit,close,eventLog};
}
module.exports={createRuntimeBridge};
