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
 const api={validate,select,stats,rank,clauseRivals,positions};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CubanLeagueMarketCore=api;
})(typeof globalThis==='object'?globalThis:this);
