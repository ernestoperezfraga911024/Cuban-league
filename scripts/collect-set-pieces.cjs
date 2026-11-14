#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const core=require('../set-pieces-core.js'),config=require('../forecast-round-config.js');
const {parseJP,parseCM}=require('./set-pieces/parse.cjs');
const {ReadSession}=require('./forecast/read-session.cjs');
function reconcile(previous,results,catalog,now=new Date().toISOString()){
 if(previous)core.validate(previous,config.teams,Date.parse(now));
 const sources=[],errors=[];
 for(const id of Object.keys(core.SOURCES)){
  const prior=previous?.sources.find(s=>s.id===id),result=results[id];
  try{
   if(!result||result.error)throw Error(result?.error||'missing source');
   if(result.url!==core.SOURCES[id].url||!Number.isFinite(Date.parse(result.fetched_at))||Date.parse(result.fetched_at)>Date.parse(now)||Date.parse(now)-Date.parse(result.fetched_at)>2*3600000)throw Error('Invalid or old source read');
   const teams=(id==='jornadaperfecta'?parseJP:parseCM)(result.body,catalog);
   const content_hash=crypto.createHash('sha256').update(JSON.stringify(teams)).digest('hex');
   sources.push({id,url:core.SOURCES[id].url,ok:true,fetched_at:result.fetched_at,changed_at:prior?.content_hash===content_hash?prior.changed_at:result.fetched_at,content_hash,teams});
  }catch(error){errors.push(id+': '+error.message);if(prior)sources.push({...prior,ok:false});}
 }
 if(!sources.some(s=>s.ok))throw Error('No verified source; previous publication is preserved. '+errors.join('; '));
 const data={schema_version:1,season:core.SEASON,checked_at:now,sources};core.validate(data,config.teams,Date.parse(now));
 return {data,errors};
}
async function collect({previous=null,catalog,session,now=()=>new Date().toISOString()}){
 const results={};await Promise.all(Object.entries(core.SOURCES).map(async([id,s])=>{try{results[id]=await session.read(s.url);}catch(e){results[id]={error:e.message};}}));
 return reconcile(previous,results,catalog,now());
}
async function main(){
 const [output,previousPath]=process.argv.slice(2);if(!output)throw Error('Usage: node scripts/collect-set-pieces.cjs OUTPUT [PREVIOUS]');
 const previous=previousPath&&fs.existsSync(previousPath)?JSON.parse(fs.readFileSync(previousPath,'utf8')):null;
 const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../catalog/players.json'),'utf8'));
 const start=Date.now();if(start>=Date.parse('2027-07-01T00:00:00Z'))throw Error('Season review required; leaving the last publication unchanged');
 const session=new ReadSession({runKey:'set-pieces-'+start,notBefore:new Date(start).toISOString(),expiresAt:new Date(start+120000).toISOString(),concurrency:2,maxBytes:1500000});
 try{
  const {data,errors}=await collect({previous,catalog,session});fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});
  fs.writeFileSync(output+'.tmp',JSON.stringify(data)+'\n');fs.renameSync(output+'.tmp',output);
  console.log(JSON.stringify({teams:20,sources:data.sources.map(s=>({id:s.id,ok:s.ok,fetched_at:s.fetched_at})),errors,metrics:session.stats(),duration_ms:Date.now()-start}));
 }finally{session.close();}
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={reconcile,collect};
