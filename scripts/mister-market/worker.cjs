'use strict';
const {collect}=require('./collector.cjs'),{verifySnapshot}=require('./verification.cjs'),{collectHistory,mergeLedger}=require('./history.cjs');
const {fail,MarketError}=require('./core.cjs'),{clauseReport}=require('./clause-stats.cjs');
const {restoreArchive}=require('./restore-archive.cjs'),{prepare}=require('./publication.cjs'),{sealSession}=require('./seal-session.cjs');
const {refreshPendingDates}=require('./profile-refresh.cjs');
const {collectComplete}=require('./catalog-read.cjs');
const endpoint='https://pyahosamoisqcbpvzwka.supabase.co/functions/v1/mister-market-sync';
async function rpc(action,data){
 const url=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);url.searchParams.set('audience',endpoint);
 const auth=await fetch(url,{headers:{Authorization:`Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`},signal:AbortSignal.timeout(20000)});
 if(!auth.ok)fail('workload_identity_failed');const token=(await auth.json()).value;
 const response=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({action,data}),signal:AbortSignal.timeout(90000)});
 const result=await response.json();if(!response.ok)fail(/^[a-z_]+$/.test(result.error)?result.error:'worker_transport_failed');return result;
}
async function run({request=rpc,mode=process.env.MARKET_MODE||'test',dispatchId=process.env.MARKET_DISPATCH_ID||''}={}){
 const start=Date.now(),state=await request('begin',{mode,dispatchId});if(state.skipped){console.log(JSON.stringify(state));return state;}
 let browser,finishing=false,phase='setup';
 const progress=details=>console.log(JSON.stringify({status:'reading',...details,elapsedMs:Date.now()-start,aiCalls:0}));
 const stage=name=>{phase=name;progress({phase});};
 try{
  const backup=restoreArchive(state.archive),previous=backup.captures.at(-1),baseline=backup.captures.find(s=>s.snapshotHash===backup.verification.snapshotHash);
  const {chromium}=require('playwright');browser=await chromium.launch({headless:true});
  const context=await browser.newContext({storageState:state.storageState,locale:'es-ES',timezoneId:'America/New_York',viewport:{width:1280,height:900}});
  delete state.storageState;const page=await context.newPage();
  stage('market');
  const {current,delta,catalogReads}=await collectComplete(page,previous,{read:collect,progress});
  stage('teams');
  const rosters=await verifySnapshot(page,current,{teamsOnly:true,maxDuration:6*60000,progress});
  stage('history');
  const history=await collectHistory(page,current,{progress});
  if(JSON.stringify(current.movements.map(e=>e.eventId).sort())!==JSON.stringify(history.headEventIds.slice().sort()))fail('feed_changed_during_verification');
  stage('reconciliation');
  const ledger=mergeLedger(backup.feedLedger,history);
  stage('profile_dates');
  const refreshed=await refreshPendingDates(page,current,ledger,backup.verification,{progress});
  const next={...backup,exportedAt:new Date().toISOString(),captures:[baseline,current],rosterVerification:rosters,feedLedger:ledger,verification:refreshed.verification,clauseStatistics:clauseReport(baseline,ledger,refreshed.verification)};
  const participants=require('../../data.json').participants;
  const prepared=prepare(next,participants,{reconciled:true});
  const sealedSession=sealSession(await context.storageState(),state.publicKey);
  const metrics={methodology:'mister-market-v2',aiCalls:0,catalogReads,players:current.players.length,teams:rosters.teams.length,changes:delta.changes.length,feedEvents:ledger.events.length,newEvents:ledger.newlyObservedIds.length,documentedClauses:prepared.payload.history.events.length,coverageGaps:ledger.coverageGaps.length,...refreshed.metrics,readMs:Date.now()-start};
  // Once finish is sent its outcome may be unknown. Never retry a write or mark
  // it failed merely because the response was lost; inspect the durable run.
  stage('publication');finishing=true;
  const result=await request('finish',{payload:prepared.payload,archive:prepared.archive,sealedSession,expectedRevision:state.expectedRevision,metrics});
  console.log(JSON.stringify({...result,metrics,elapsedMs:Date.now()-start}));return result;
 }catch(error){
  console.error(JSON.stringify({status:'diagnostic',phase,code:error instanceof MarketError?error.code:'reader_failed',
   ...(error instanceof MarketError&&error.waitDetails?{wait:error.waitDetails}:{}),elapsedMs:Date.now()-start,aiCalls:0}));
  if(!finishing)try{await request('fail',{code:error instanceof MarketError?error.code:'reader_failed'});}catch{}
  throw error;
 }finally{if(browser)await browser.close();}
}
module.exports={run};
if(require.main===module)run().catch(e=>{console.error(JSON.stringify({status:'failed',code:e instanceof MarketError?e.code:'reader_failed',aiCalls:0}));process.exitCode=1;});
