/* Read-only market projection shared by the publisher and the public page. */
(function(root){
 'use strict';
 const positions=['PT','DF','MC','DL'];
 const key=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 function validate(p){
  const require=(ok)=>{if(!ok)throw Error('invalid_market_publication');};
  const money=n=>Number.isSafeInteger(n)&&n>=0;
  require([1,2].includes(p?.schemaVersion)&&p.leagueId==='649733'&&p.season==='2026-27');
  require(/^[a-f0-9]{64}$/.test(p.snapshotHash)&&Number.isFinite(Date.parse(p.capturedAt)));
  require(Array.isArray(p.managers)&&p.managers.length===20&&Array.isArray(p.players)&&p.players.length>=100);
  const managers=new Map(),participants=new Set(),players=new Set();
  for(const m of p.managers){
   require(/^\d+$/.test(m.id)&&!managers.has(m.id)&&Number.isSafeInteger(m.participantId)&&!participants.has(m.participantId)&&typeof m.name==='string'&&m.name.length>0);
   managers.set(m.id,m);participants.add(m.participantId);
  }
  for(const x of p.players){
   require(/^\d+$/.test(x.id)&&!players.has(x.id)&&typeof x.name==='string'&&x.name.length>0&&positions.includes(x.position)&&typeof x.club==='string');
   require(money(x.value)&&(x.ownerId===null?x.clause===null:managers.has(x.ownerId)&&money(x.clause)));
   if(x.photo!==null){const url=new URL(x.photo);require(url.protocol==='https:'&&url.hostname==='cdn-mister.mundodeportivo.com'&&url.pathname===`/file/cdn-common/players/${x.id}.png`);}
   players.add(x.id);
  }
  const history=p.history;
  require(history?.completeSeason===false&&(p.schemaVersion===1?history.source==='player_profiles'&&history.reconciliation==='pending':history.source==='reconciled'&&history.reconciliation==='minimum_confirmed')&&Number.isFinite(Date.parse(history.observedAt))&&Array.isArray(history.events));
  const refs=new Set();
  for(const e of history.events){
   require(typeof e.reference==='string'&&!refs.has(e.reference)&&players.has(e.playerId)&&managers.has(e.from)&&managers.has(e.to)&&e.from!==e.to&&money(e.amount)&&(p.schemaVersion===2&&e.date===null||/^\d{4}-\d{2}-\d{2}$/.test(e.date)&&Number.isFinite(Date.parse(e.date))));
   refs.add(e.reference);
  }
  return p;
 }
 function select(p,{search='',owner='all',position='all',sort='value'}={}){
  const q=key(search).trim(), managers=new Map(p.managers.map(m=>[m.id,m.name]));
  return p.players.filter(x=>(owner==='all'||(owner==='free'?x.ownerId===null:x.ownerId===owner))&&(position==='all'||x.position===position)&&(!q||key(`${x.name} ${x.club} ${managers.get(x.ownerId)||'Libre'}`).includes(q)))
   .sort((a,b)=>(sort==='name'?a.name.localeCompare(b.name,'es'):sort==='clause'?(b.clause??-1)-(a.clause??-1):b.value-a.value)||a.name.localeCompare(b.name,'es')||a.id.localeCompare(b.id));
 }
 function stats(p){
  const rows=new Map(p.managers.map(m=>[m.id,{...m,made:0,received:0,spent:0,collected:0}]));
  for(const e of p.history.events){const from=rows.get(e.from),to=rows.get(e.to);from.received++;from.collected+=e.amount;to.made++;to.spent+=e.amount;}
  return [...rows.values()].map(row=>({...row,net:row.collected-row.spent}));
 }
 function rank(p,metric='made'){
  if(!['made','received','spent','collected'].includes(metric))metric='made';
  const rows=stats(p).sort((a,b)=>b[metric]-a[metric]||a.name.localeCompare(b.name,'es'));
  let lastRank=0;return rows.map((row,i)=>{if(i===0||row[metric]!==rows[i-1][metric])lastRank=i+1;return {...row,rank:lastRank};});
 }
 // Incoming clauses: from is the participant who lost the footballer; to paid.
 // Use the reconciled events as-is, including repeated transfers and unknown dates.
 function clauseRivals(p){
  const managers=new Map(p.managers.map(m=>[m.id,m]));
  const targets=new Map(p.managers.map(m=>[m.id,{...m,received:0,rivals:new Map()}]));
  for(const event of p.history.events){
   const target=targets.get(event.from);target.received++;
   if(!target.rivals.has(event.to))target.rivals.set(event.to,{...managers.get(event.to),count:0,events:[]});
   const rival=target.rivals.get(event.to);rival.count++;rival.events.push(event);
  }
  return [...targets.values()].map(({rivals,...target})=>({...target,rivalCount:rivals.size,
   top:[...rivals.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'es')||a.id.localeCompare(b.id)).slice(0,3)
    .map(rival=>({...rival,events:rival.events.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')||a.reference.localeCompare(b.reference))}))
  })).sort((a,b)=>a.name.localeCompare(b.name,'es')||a.id.localeCompare(b.id));
 }
 function topClauses(p){
  const events=p.history.events.slice().sort((a,b)=>b.amount-a.amount||(b.date||'').localeCompare(a.date||'')||a.reference.localeCompare(b.reference));
  let rank=0;return events.slice(0,10).map((event,i)=>{if(i===0||event.amount!==events[i-1].amount)rank=i+1;return {...event,rank};});
 }
 // One row per confirmed owner. A lineup's contribution already includes captain
 // bonus; never multiply it again or use the footballer's deduplicated base score.
 function playerOwners(p,playerId,pointsPlayer=null){
  const player=p.players.find(x=>x.id===String(playerId));if(!player)return [];
  const managers=new Map(p.managers.map(m=>[m.id,m])),byParticipant=new Map(p.managers.map(m=>[String(m.participantId),m]));
  const owners=new Map();
  function add(id){
   const manager=managers.get(id);if(!manager)return null;
   if(!owners.has(id))owners.set(id,{...manager,current:id===player.ownerId,lastMovement:null,matchdays:[],points:null,average:null,provisional:false});
   return owners.get(id);
  }
  add(player.ownerId);
  for(const event of p.history.events){
   if(event.playerId!==player.id)continue;
   for(const id of [event.from,event.to]){const owner=add(id);if(owner&&event.date&&(!owner.lastMovement||event.date>owner.lastMovement))owner.lastMovement=event.date;}
  }
  if(pointsPlayer?.misterId===player.id)for(const day of pointsPlayer.matchdays){
   for(const appearance of day.appearances){
    const manager=byParticipant.get(String(appearance.participantId)),owner=manager&&add(manager.id);
    if(!owner||owner.matchdays.includes(day.matchday))continue;
    owner.matchdays.push(day.matchday);owner.points=(owner.points??0)+appearance.contributionPoints;
    owner.provisional=owner.provisional||appearance.provisional;
   }
  }
  for(const owner of owners.values()){
   owner.matchdays.sort((a,b)=>a-b);
   if(owner.matchdays.length)owner.average=owner.points/owner.matchdays.length;
  }
  return [...owners.values()].sort((a,b)=>Number(b.current)-Number(a.current)||(b.matchdays.at(-1)||0)-(a.matchdays.at(-1)||0)||(b.lastMovement||'').localeCompare(a.lastMovement||'')||a.name.localeCompare(b.name,'es')||a.id.localeCompare(b.id));
 }
 // XI ownership is the primary clock. Missing appearances are not transfers.
 // Attribution is based on observed stages, not an assertion of full tenure.
 function lineupStages(pointsPlayer,byParticipant){
  const stages=[],ambiguous=new Set();let current=null;
  for(const day of [...(pointsPlayer?.matchdays||[])].sort((a,b)=>a.matchday-b.matchday)){
   const owners=new Map();
   for(const a of day.appearances){
    const id=byParticipant.get(String(a.participantId));if(!id)continue;
    if(owners.has(id))ambiguous.add(id);
    owners.set(id,{...a,matchday:day.matchday});
   }
   if(owners.size!==1){
    // Real contributions for simultaneous owners remain in the owner subtotal,
    // but their order cannot delimit a purchase stage.
    for(const id of owners.keys())ambiguous.add(id);
    current=null;continue;
   }
   const [id,appearance]=[...owners][0];
   if(!current||current.owner!==id){current={owner:id,appearances:[]};stages.push(current);}
   current.appearances.push(appearance);
  }
  return {stages,ambiguous};
 }
 const contributionTotal=(appearances,field)=>appearances.length&&appearances.every(a=>Number.isFinite(a[field]))?appearances.reduce((n,a)=>n+a[field],0):null;
 function attributeStages(events,pointsPlayer,byParticipant){
  const {stages,ambiguous}=lineupStages(pointsPlayer,byParticipant),result=new Map(),byOwner=new Map();
  for(const event of events){if(!byOwner.has(event.to))byOwner.set(event.to,[]);byOwner.get(event.to).push(event);}
  for(const [owner,purchases] of byOwner){
   const owned=stages.filter(s=>s.owner===owner);
   let reason=!pointsPlayer?'no_lineups':ambiguous.has(owner)?'shared_round':!owned.length?'no_appearances':owned.length!==purchases.length?'stage_count':null;
   const ordered=[...purchases].sort((a,b)=>(a.date||'').localeCompare(b.date||'')||a.reference.localeCompare(b.reference));
   if(!reason&&purchases.length>1&&(ordered.some(e=>!e.date)||new Set(ordered.map(e=>e.date)).size!==ordered.length))reason='purchase_order';
   for(let i=0;i<ordered.length;i++){
    const event=ordered[i],stage=owned[i],index=stages.indexOf(stage),previous=stages[index-1];
    // A different observed seller signals an omitted intermediate movement.
    const mismatch=!reason&&previous&&previous.owner!==event.from;
    result.set(event.reference,{reason:reason||(mismatch?'seller_mismatch':null),stage:reason||mismatch?null:stage});
   }
  }
  const mapped=events.map(event=>({event,match:result.get(event.reference)})).filter(x=>x.match.stage);
  // A purchase after a known outgoing clause cannot fund the initial XI stage.
  // Cross-check purchase order without using edited matchday/calendar dates.
  const conflicts=new Set();
  for(let i=0;i<mapped.length;i++)for(let j=i+1;j<mapped.length;j++){
   const a=mapped[i],b=mapped[j];if(!a.event.date||!b.event.date||a.event.date===b.event.date)continue;
   const dayOrder=a.match.stage.appearances[0].matchday-b.match.stage.appearances[0].matchday;
   if(dayOrder*a.event.date.localeCompare(b.event.date)<0){conflicts.add(a.event.reference);conflicts.add(b.event.reference);}
  }
  for(const reference of conflicts)result.set(reference,{reason:'movement_order',stage:null});
  return result;
 }
 // League rates supplied by the owner in the Mister bonus settings screenshot.
 // Fixed matchday money belongs to the manager, never to each footballer.
 const incomeRates=Object.freeze({point:100000,goal:250000,idealXi:1000000});
 function officialXiIds(players){
  if(!Array.isArray(players)||players.length!==11||players.some(p=>!/^\d+$/.test(String(p?.misterPlayerId||''))))return null;
  const ids=new Set(players.map(p=>String(p.misterPlayerId)));return ids.size===11?ids:null;
 }
 function playingIncome(appearances,playerId,officialXiByDay=new Map()){
  if(!appearances.length)return null;
  const points=contributionTotal(appearances,'contributionPoints');
  if(points===null)return null;
  const missingGoals=[],missingIdeal=[];let goals=0,ideal=0;
  for(const a of appearances){
   if(Number.isSafeInteger(a.goals)&&a.goals>=0)goals+=a.goals;else missingGoals.push(a.matchday);
   const ids=officialXiByDay.get(a.matchday);
   if(ids instanceof Set)ideal+=Number(ids.has(String(playerId)));else missingIdeal.push(a.matchday);
  }
  const pointIncome=points*incomeRates.point,goalIncome=goals*incomeRates.goal,idealIncome=ideal*incomeRates.idealXi;
  return {points,goals,ideal,pointIncome,goalIncome,idealIncome,knownTotal:pointIncome+goalIncome+idealIncome,
   complete:!missingGoals.length&&!missingIdeal.length,missingGoals,missingIdeal};
 }
 function recordedExit(event,events){
  // Only a directly consecutive, distinctly dated clause can be linked as an exit.
  // Undated movements or same-day ties cannot establish that order.
  if(events.some(e=>!e.date))return null;
  const ordered=[...events].sort((a,b)=>a.date.localeCompare(b.date)),index=ordered.findIndex(e=>e.reference===event.reference),next=ordered[index+1];
  if(!next||next.from!==event.to||next.to===event.to||next.date<=event.date
   ||ordered.filter(e=>e.date===event.date).length!==1||ordered.filter(e=>e.date===next.date).length!==1)return null;
  return {reference:next.reference,amount:next.amount,date:next.date,to:next.to};
 }
 function performance(p,model=null,officialXiByDay=new Map()){
  const players=new Map(p.players.map(player=>[player.id,player]));
  const byParticipant=new Map(p.managers.map(m=>[String(m.participantId),m.id])),byPlayer=new Map(),assignments=new Map();
  for(const event of p.history.events){if(!byPlayer.has(event.playerId))byPlayer.set(event.playerId,[]);byPlayer.get(event.playerId).push(event);}
  for(const [id,events] of byPlayer)assignments.set(id,attributeStages(events,model?.playersByMisterId.get(id),byParticipant));
  const rows=new Map(p.managers.map(m=>[m.id,{...m,spent:0,events:[]}]));
  for(const event of p.history.events){
   const manager=rows.get(event.to),player=players.get(event.playerId);
   if(!manager||!player)continue;
   manager.spent+=event.amount;
   manager.events.push({...event,player});
  }
  return [...rows.values()].map(manager=>({...manager,events:manager.events
   .sort((a,b)=>(b.date||'').localeCompare(a.date||'')||a.reference.localeCompare(b.reference))
   .map(event=>{
    const pointsPlayer=model?.playersByMisterId.get(event.playerId);
    const appearances=(pointsPlayer?.matchdays||[]).flatMap(day=>day.appearances
     .filter(a=>String(a.participantId)===String(manager.participantId))
     .map(a=>({...a,matchday:day.matchday})));
    const total=field=>contributionTotal(appearances,field),attribution=assignments.get(event.playerId).get(event.reference);
    const operationAppearances=attribution.stage?.appearances||[];
    return {...event,purchases:manager.events.filter(e=>e.playerId===event.playerId).length,
     ownerPoints:total('contributionPoints'),ownerBase:total('points'),ownerBonus:total('captainBonus'),
     appearances,partial:!!model?.partial,provisional:appearances.some(a=>a.provisional),
     attribution:attribution.reason?'pending':'lineup_sequence',reason:attribution.reason,operationAppearances,
     operationPoints:contributionTotal(operationAppearances,'contributionPoints'),
     operationBase:contributionTotal(operationAppearances,'points'),operationBonus:contributionTotal(operationAppearances,'captainBonus'),
     operationProvisional:operationAppearances.some(a=>a.provisional),
     income:playingIncome(operationAppearances,event.playerId,officialXiByDay),exit:recordedExit(event,byPlayer.get(event.playerId))};
   }).sort((a,b)=>Number(b.operationPoints!==null)-Number(a.operationPoints!==null)||(b.operationPoints??0)-(a.operationPoints??0)||(b.date||'').localeCompare(a.date||'')||a.reference.localeCompare(b.reference))})).sort((a,b)=>a.name.localeCompare(b.name,'es')||a.id.localeCompare(b.id));
 }
 const api={validate,select,stats,rank,clauseRivals,topClauses,playerOwners,performance,playingIncome,officialXiIds,incomeRates,positions};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CubanLeagueMarketCore=api;
})(typeof globalThis==='object'?globalThis:this);
