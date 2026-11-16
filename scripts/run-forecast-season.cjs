#!/usr/bin/env node
'use strict';
// NDJSON bridge: the trusted automation forwards sql requests through its existing
// Supabase connector and returns the result. No personal credentials or new service.
const fs=require('node:fs/promises'),path=require('node:path'),{tmpdir}=require('node:os');
const {createRuntimeBridge}=require('./forecast/runtime-bridge.cjs');
const {SeasonGateway}=require('./forecast/season-gateway.cjs');
const {runSeason}=require('./forecast/season-workflow.cjs');
const {ReadSession}=require('./forecast/read-session.cjs');
const {TeamCollector}=require('./forecast/collect-team.cjs');
const {evidenceStore}=require('./forecast/evidence-store.cjs');
const {acquireRunnerLock}=require('./forecast/runner-lock.cjs');
async function main() {
  const args=process.argv.slice(2),fileMode=args.includes('--file-bridge');
  if(args.filter(a=>a==='--file-bridge').length>1)throw Error('Repeated --file-bridge');
  const [flag,runKey,recoveryRequest,...extra]=args.filter(a=>a!=='--file-bridge');
  if(flag!=='--existing-run'||!runKey||extra.length)throw Error('Usage: node scripts/run-forecast-season.cjs --existing-run RUN_KEY [RECOVERY_UUID]');
  if(fileMode&&(!process.env.FORECAST_EXECUTION_KEY||!process.env.FORECAST_CODE_SHA))throw Error('File bridge requires FORECAST_EXECUTION_KEY and FORECAST_CODE_SHA for durable traces');
  const lock=await acquireRunnerLock();
  try {await runLocked(runKey,recoveryRequest,lock,fileMode);} finally {await lock.release();}
}
async function runLocked(runKey,recoveryRequest,lock,fileMode) {
  const directory=await fs.mkdtemp(path.join(tmpdir(),'forecast-season-'));
  let trace=null;
  if(process.env.FORECAST_EXECUTION_KEY||process.env.FORECAST_CODE_SHA){
    if(!process.env.FORECAST_EXECUTION_KEY||!process.env.FORECAST_CODE_SHA)throw Error('Both FORECAST_EXECUTION_KEY and FORECAST_CODE_SHA are required for durable trace');
    const {TraceJournal}=require('./forecast/trace-journal.cjs');
    trace=new TraceJournal({directory,executionKey:process.env.FORECAST_EXECUTION_KEY,codeSha:process.env.FORECAST_CODE_SHA,runKey});
  }
  const bridge=await createRuntimeBridge({directory,lock,fileMode,trace});
  const checkpoint={run_key:runKey,teams:[],status:'running',started_at:new Date().toISOString(),pid:process.pid,transport:fileMode?'file':'stdin',event_log:bridge.eventLog,trace:trace?.manifest||null};
  const saveCheckpoint=async()=>{checkpoint.trace=trace?.manifest||null;const file=path.join(directory,'checkpoint.json');await fs.writeFile(file+'.tmp',JSON.stringify(checkpoint),{mode:0o600});await fs.rename(file+'.tmp',file);};
  await saveCheckpoint();
  if(trace)await trace.record({phase:'runner',status:'started'});
  const gateway=new SeasonGateway({runKey,recoveryRequest:recoveryRequest||null,execute:(args,options)=>bridge.request('sql',args,options),trace});
  try {
    const result=await runSeason({gateway,makeCollector:async window=>{
      const reader=new ReadSession({...window,trace}),collector=new TeamCollector(reader,evidenceStore(directory));
      return {reader,collector};
    },reviewTeam:async body=>{
      if(trace&&body.correction){const {errorCode}=require('./forecast/trace-journal.cjs');await trace.record({phase:'review_correction',status:'started',team:body.packet.team,error_code:errorCode(body.correction.reason)});}
      return bridge.request('review',body);
    },onEvent:async team=>{
      checkpoint.teams.push(team);if(trace)await trace.record({phase:'team',status:team.outcome,team:team.team});await saveCheckpoint();await bridge.emit({event:'team',...team});
    }});
    const file=path.join(directory,'result.json');await fs.writeFile(file,JSON.stringify(result,null,2),{flag:'wx',mode:0o600});
    checkpoint.status=result.publication_complete?'completed':'partial';await saveCheckpoint();
    if(trace){await trace.record({phase:'runner',status:checkpoint.status});checkpoint.trace_delivery=await gateway.flushTrace();await saveCheckpoint();}
    await bridge.emit({event:'finished',path:file,counts:result.counts,publication_complete:result.publication_complete,trace:trace?.manifest||null,trace_delivery:checkpoint.trace_delivery||null});
  } catch(error){
    checkpoint.status='interrupted';checkpoint.error=error.message;await saveCheckpoint();
    if(trace){const {errorCode}=require('./forecast/trace-journal.cjs');await trace.record({phase:'runner',status:'interrupted',error_code:errorCode(error)});checkpoint.trace_delivery=await gateway.flushTrace();await saveCheckpoint();}
    await bridge.emit({event:'interrupted',path:path.join(directory,'checkpoint.json'),reason:error.message,trace:trace?.manifest||null,trace_delivery:checkpoint.trace_delivery||null});throw error;
  } finally {await bridge.close();}
}
if(require.main===module)main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=error.code==='RUNNER_BUSY'?73:1;});
