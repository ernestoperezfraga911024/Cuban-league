#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {ReadSession}=require('./forecast/read-session.cjs');
const {collect}=require('./collect-set-pieces.cjs');
const core=require('../set-pieces-core.js'),config=require('../forecast-round-config.js');
const REPOSITORY='ernestoperezfraga911024/Cuban-league',BRANCH='set-pieces-feed',FILE='set-pieces.json';
async function publish({api,sourceSha,collector,fallback}){
 if(!/^[a-f0-9]{40}$/.test(sourceSha))throw Error('Invalid source commit');
 let existing=null;
 try{existing=await api('GET',`contents/${FILE}?ref=${BRANCH}`);}catch(e){if(e.status!==404)throw e;}
 const previous=existing?JSON.parse(Buffer.from(existing.content,'base64').toString('utf8')):fallback;
 if(previous)core.validate(previous,config.teams);
 const result=await collector(previous);core.validate(result.data,config.teams);
 // Validate and collect before any mutation; a failed read leaves the feed intact.
 try{await api('GET',`git/ref/heads/${BRANCH}`);}catch(e){if(e.status!==404)throw e;await api('POST','git/refs',{ref:`refs/heads/${BRANCH}`,sha:sourceSha});}
 await api('PUT',`contents/${FILE}`,{branch:BRANCH,message:'Refresh verified set-piece references',content:Buffer.from(JSON.stringify(result.data)+'\n').toString('base64'),...(existing?{sha:existing.sha}:{})});
 return result;
}
async function main(){
 if(process.env.GITHUB_REPOSITORY!==REPOSITORY||process.env.GITHUB_REF!=='refs/heads/main'||!process.env.GITHUB_TOKEN)throw Error('Publication only runs in this repository on main');
 const start=Date.now();if(start>=Date.parse('2027-07-01T00:00:00Z'))throw Error('Season review required');
 const session=new ReadSession({runKey:'set-pieces-'+start,notBefore:new Date(start).toISOString(),expiresAt:new Date(start+120000).toISOString(),concurrency:2,maxBytes:1500000});
 const api=async(method,endpoint,body)=>{
  const response=await fetch(`https://api.github.com/repos/${REPOSITORY}/${endpoint}`,{method,headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  if(!response.ok){const error=Error(`GitHub ${method} ${endpoint}: HTTP ${response.status}`);error.status=response.status;throw error;}return response.json();
 };
 try{
  const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../catalog/players.json'),'utf8'));
  const fallback=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/set-pieces.json'),'utf8'));
  const result=await publish({api,sourceSha:process.env.GITHUB_SHA,collector:previous=>collect({previous,catalog,session}),fallback});
  console.log(JSON.stringify({branch:BRANCH,teams:20,errors:result.errors,metrics:session.stats(),duration_ms:Date.now()-start}));
 }finally{session.close();}
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={publish,BRANCH,FILE};
