/* Historical XI, projected from one participant's published season statistics. */
(function(root){
 'use strict';
 function build(data){
  const formations=new Map();
  for(const row of data?.rows||[]){
   if(row.players?.length!==11)continue;
   const counts={PT:0,DF:0,MC:0,DL:0};
   for(const player of row.players)if(Object.hasOwn(counts,player.position))counts[player.position]++;
   if(counts.PT!==1||counts.DF+counts.MC+counts.DL!==10)continue;
   const key=`${counts.DF}-${counts.MC}-${counts.DL}`;
   if(!formations.has(key))formations.set(key,{formation:key,counts,uses:0});
   formations.get(key).uses++;
  }
  // Match the existing favourite-formation tie break used in the profile summary.
  const favourite=[...formations.values()].sort((a,b)=>b.uses-a.uses||a.formation.localeCompare(b.formation,'es'))[0];
  if(!favourite)return null;
  const ranked=[...(data.players||[])].filter(p=>p.appearances>0&&Number.isFinite(p.contributionPoints))
   .sort((a,b)=>b.contributionPoints-a.contributionPoints||b.appearances-a.appearances||a.playerName.localeCompare(b.playerName,'es')||a.key.localeCompare(b.key));
  const selected=new Set(),lines=[];
  for(const position of ['DL','MC','DF','PT']){
   const count=favourite.counts[position];if(!count)continue;
   const players=[];
   for(const player of ranked){
    const key=player.playerId||player.key;
    if(player.position!==position||selected.has(key)||players.length===count)continue;
    players.push(player);selected.add(key);
   }
   lines.push({position,count,players,missing:count-players.length});
  }
  const players=lines.flatMap(line=>line.players);
  return {...favourite,lines,players,total:players.reduce((sum,p)=>sum+p.contributionPoints,0),
   complete:players.length===11,provisional:(data.rows||[]).some(row=>row.hasPostponedMatches),
   missingLineups:Math.max(0,(data.publishedMatchdays||0)-(data.lineupMatchdays||0))};
 }
 const api={build};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CubanLeagueIdealXI=api;
})(typeof globalThis==='object'?globalThis:this);
