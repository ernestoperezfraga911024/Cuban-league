'use strict';
const {hash,fail}=require('./core.cjs');
const {validateLedger}=require('./history.cjs');
// A matching tuple does not prove event identity. Keep both source records and
// report a conservative multiset union: max(profile occurrences, feed IDs).
function reconcile(verification,ledger){
 validateLedger(ledger);
 if(verification.leagueId!==ledger.leagueId||!Array.isArray(verification.histories))fail('reconciliation_context_mismatch');
 const groups=new Map();
 function add(e,source){
  if(!e.from||!e.to||e.from===e.to||!Number.isSafeInteger(e.amount)||e.amount<0)fail('unresolved_history_identity');
  const key=hash([ledger.leagueId,ledger.season,e.playerId,e.from,e.to,e.amount]);
  if(!groups.has(key))groups.set(key,{key,profiles:[],feed:[]});
  groups.get(key)[source].push(e);
 }
 for(const h of verification.histories)h.movements.forEach((m,i)=>{if(m.type==='clause')add({reference:`${h.playerId}:row:${i}`,playerId:h.playerId,date:m.occurredOn,from:m.from.managerId,to:m.to.managerId,amount:m.amount},'profiles');});
 for(const e of ledger.events)if(e.type==='clause')add({reference:e.eventId,playerId:e.playerId,date:null,from:e.fromOwnerId,to:e.toOwnerId,amount:e.amount},'feed');
 const events=[],evidence=[];
 for(const g of [...groups.values()].sort((a,b)=>a.key.localeCompare(b.key))){
  events.push(...g.profiles);
  // Extra units represent a group lower bound, not guessed individual matches.
  for(let i=g.profiles.length;i<g.feed.length;i++)events.push({...g.feed[0],reference:`minimum:${g.key}:${i}`,date:null});
  evidence.push({key:g.key,profileReferences:g.profiles.map(e=>e.reference),feedReferences:g.feed.map(e=>e.reference),minimumCount:Math.max(g.profiles.length,g.feed.length),possibleOverlap:Math.min(g.profiles.length,g.feed.length)});
 }
 return {source:'reconciled',completeSeason:false,reconciliation:'minimum_confirmed',observedAt:ledger.completedAt,events,evidence,
  profileCount:evidence.reduce((n,g)=>n+g.profileReferences.length,0),feedCount:evidence.reduce((n,g)=>n+g.feedReferences.length,0),
  overlapCandidates:evidence.reduce((n,g)=>n+g.possibleOverlap,0),coverageGapCount:ledger.coverageGaps?.length||0};
}
module.exports={reconcile};
