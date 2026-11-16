'use strict';
// Metadata only. Exact request/reply/evidence files stay private in the runner directory.
const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const TEXT=/^[a-zA-Z0-9_-]{1,80}$/;
const HASH=/^[a-f0-9]{64}$/;
const optionalText=['team','request_id','error_code'];
const optionalNumber=['duration_ms','bytes','count','http_status'];
const optionalHash=['body_sha256','response_sha256'];
const STATUSES=new Set(['started','completed','error','pending','accepted','timeout','protocol_error','published','ready','blocked','saved','missing','unknown','interrupted','partial','idle','reused']);
const SOURCES=new Set(['futbolfantasy','jornadaperfecta','comuniate','predicted11']);
function errorCode(error) {
  if (/^[0-9A-Z]{5}$/.test(error?.code||'')) return 'sqlstate_'+error.code;
  const message=String(error?.message||error||'');
  for(const [pattern,code] of [
    [/timed?\s*out|timeout/i,'response_timeout'],[/input closed|stdin|channel.*closed/i,'channel_closed'],
    [/identity|identidad|unknown player|unresolved/i,'identity_unresolved'],[/layout|geometr|horizontal|anchor|colocaci/i,'layout_invalid'],
    [/duplicate|duplicad/i,'duplicate_observation'],[/alternative|alternativ/i,'alternative_invalid'],
    [/window|ventana|expired|caduc/i,'window_expired'],[/concurren|40001|attempt changed/i,'concurrent_change'],
    [/JSON|response.*file|bridge|protocol/i,'bridge_protocol'],[/fetch|HTTP|network|ENOTFOUND|ECONN/i,'source_access'],
  ]) if(pattern.test(message))return code;
  return 'unclassified_error';
}
function sanitizeEvent(input,seq,now) {
  if(!input||!TEXT.test(input.phase||'')||!STATUSES.has(input.status))throw Error('Invalid trace phase/status');
  const event={seq,occurred_at:new Date(now).toISOString(),phase:input.phase,status:input.status};
  for(const key of optionalText) if(input[key]!=null){if(!TEXT.test(input[key]))throw Error('Invalid trace '+key);event[key]=input[key];}
  for(const key of optionalNumber) if(input[key]!=null){if(!Number.isSafeInteger(input[key])||input[key]<0)throw Error('Invalid trace '+key);event[key]=input[key];}
  for(const key of optionalHash) if(input[key]!=null){if(!HASH.test(input[key]))throw Error('Invalid trace '+key);event[key]=input[key];}
  if(input.source!=null){if(!SOURCES.has(input.source))throw Error('Invalid trace source');event.source=input.source;}
  if(input.kind!=null){if(!['page','script','ballot'].includes(input.kind))throw Error('Invalid trace resource kind');event.kind=input.kind;}
  // No spreading input: error messages, URLs, SQL, tokens and arbitrary nested fields never enter the journal.
  return event;
}
class TraceJournal {
  constructor({directory,executionKey,codeSha,runKey,processId=randomUUID(),now=()=>Date.now(),io=fs}) {
    if(!/^[a-z0-9-]{5,120}$/.test(executionKey)||!/^season-[a-z0-9-]{1,150}$/.test(runKey)||! /^[a-f0-9]{40}$/.test(codeSha)||! /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(processId))throw Error('Invalid trace identity');
    this.identity={execution_key:executionKey,process_id:processId,run_key:runKey,code_sha:codeSha};
    this.file=path.join(directory,'trace.jsonl');this.events=[];this.sentThrough=0;this.confirmedThrough=0;this.now=now;this.io=io;this.localEventsStored=0;this.localError=null;
    try {io.writeFileSync(this.file,'',{flag:'wx',mode:0o600});}catch{this.localError='trace_local_io';}
  }
  get manifest(){return {...this.identity,path:this.file,events:this.events.length,confirmed_events:this.confirmedThrough,local_events:this.localEventsStored,local_error_code:this.localError};}
  record(input){
    const event=sanitizeEvent(input,this.events.length+1,this.now());
    event.event_sha256=createHash('sha256').update(JSON.stringify(event)).digest('hex');
    this.events.push(event);
    if(!this.localError){try{this.io.appendFileSync(this.file,JSON.stringify({...this.identity,...event})+'\n');this.localEventsStored++;}catch{this.localError='trace_local_io';}}
    return event;
  }
  pendingBatch(){return this.batch(this.sentThrough);}
  batch(from=0){return {...this.identity,events:this.events.slice(from,from+64)};}
  markSent(batch){if(batch.process_id!==this.identity.process_id)throw Error('Trace process changed');this.sentThrough=Math.max(this.sentThrough,...batch.events.map(e=>e.seq));}
  ack(batch){if(batch.process_id!==this.identity.process_id)throw Error('Trace process changed');this.confirmedThrough=Math.max(this.confirmedThrough,...batch.events.map(e=>e.seq));}
}
module.exports={TraceJournal,sanitizeEvent,errorCode};
