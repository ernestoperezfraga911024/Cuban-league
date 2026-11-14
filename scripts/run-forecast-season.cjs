#!/usr/bin/env node
'use strict';
// NDJSON bridge: the trusted automation forwards sql requests through its existing
// Supabase connector and returns the result. No personal credentials or new service.
const fs=require('node:fs/promises'),path=require('node:path'),{tmpdir}=require('node:os');
const readline=require('node:readline');
const {responseValue}=require('./forecast/bridge-response.cjs');
const {SeasonGateway}=require('./forecast/season-gateway.cjs');
const {runSeason}=require('./forecast/season-workflow.cjs');
const {ReadSession}=require('./forecast/read-session.cjs');
const {TeamCollector}=require('./forecast/collect-team.cjs');
const {evidenceStore}=require('./forecast/evidence-store.cjs');
async function main() {
  const [flag,runKey,recoveryRequest,...extra]=process.argv.slice(2);
  if(flag!=='--existing-run'||!runKey||extra.length)throw Error('Usage: node scripts/run-forecast-season.cjs --existing-run RUN_KEY [RECOVERY_UUID]');
  const directory=await fs.mkdtemp(path.join(tmpdir(),'forecast-season-'));
  const pending=new Map();let sequence=0,closed=false;
  const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
  const rl=readline.createInterface({input:process.stdin});
  const rejectAll=reason=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error(reason));}pending.clear();};
  rl.on('line',async line=>{
    try {const m=JSON.parse(line),p=pending.get(m.id);if(!p)throw Error('Unknown response id');
      const value=await responseValue(m,{directory,id:m.id});
      clearTimeout(p.timer);pending.delete(m.id);value.error?p.reject(Error(String(value.error))):p.resolve(value.result);
    } catch(error){rejectAll(error.message);}
  });
  rl.on('close',()=>{closed=true;rejectAll('Input closed; resume existing saved/missing attempts');});
  async function request(kind,body) {
    if(closed)throw Error('Input closed; resume existing saved/missing attempts');
    const id=String(++sequence),file=path.join(directory,id+'-'+kind+'.json');
    await fs.writeFile(file,JSON.stringify(body),{flag:'wx',mode:0o600});
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(Error(kind+' response timed out; state must be reread'));},300000);
      pending.set(id,{resolve,reject,timer});emit({event:kind,id,path:file,response_path:path.join(directory,id+'-response.json')});
    });
  }
  const gateway=new SeasonGateway({runKey,recoveryRequest:recoveryRequest||null,execute:args=>request('sql',args)});
  try {
    const result=await runSeason({gateway,makeCollector:async window=>{
      const reader=new ReadSession(window),collector=new TeamCollector(reader,evidenceStore(directory));
      return {reader,collector};
    },reviewTeam:body=>request('review',body),onEvent:team=>emit({event:'team',...team})});
    const file=path.join(directory,'result.json');await fs.writeFile(file,JSON.stringify(result,null,2),{flag:'wx',mode:0o600});
    emit({event:'finished',path:file,counts:result.counts,publication_complete:result.publication_complete});
  } finally {rejectAll('Runner closed');rl.close();}
}
if(require.main===module)main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
