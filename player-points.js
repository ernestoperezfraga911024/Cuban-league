/* Published Cuban League points. Identity is always a stored catalog ID, never a name. */
(function(root){
 'use strict';
 const text=v=>String(v??'').trim();
 const number=v=>v==null||typeof v==='boolean'||text(v)===''?NaN:Number(text(v).replace(',','.'));
 function build({rows=[],catalog,participants=[],season='',captainAdjustment,isEmpty}={}){
  const people=new Map(participants.filter(p=>p.active!==false).map(p=>[text(p.name),p]));
  const playersById=new Map(),playersByMisterId=new Map(),groups=new Map(),days=new Set();
  const diagnostics={invalidRows:0,ambiguousRows:0,missingRows:0,unlinkedPlayers:0};
  for(const r of rows){
   const day=number(r.matchday),name=text(r.participant_name);
   if(!people.has(name)||!Number.isInteger(day)||day<1||r.published===false||(r.season&&r.season!==season))continue;
   days.add(day);const key=JSON.stringify([name,day]);
   if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);
  }
  diagnostics.missingRows=days.size*people.size-groups.size;
  for(const group of groups.values()){
   const latest=Math.max(...group.map(r=>Date.parse(r.updated_at)||0));
   const candidates=group.filter(r=>(Date.parse(r.updated_at)||0)===latest);
   if(new Set(candidates.map(r=>JSON.stringify([r.points,r.lineup,r.negative_balance_no_score,r.has_postponed_matches]))).size>1){diagnostics.ambiguousRows++;continue;}
   const r=candidates[0],day=number(r.matchday),person=people.get(text(r.participant_name));
   if(r.negative_balance_no_score===true&&number(r.points)===0)continue;
   let lineup=r.lineup;
   if(typeof lineup==='string'){try{lineup=JSON.parse(lineup);}catch{lineup=null;}}
   lineup=Array.isArray(lineup)?lineup:lineup?.players;
   const slots=new Set(),ids=new Set();let captains=0;
   const valid=Array.isArray(lineup)&&lineup.length===11&&Number.isFinite(number(r.points))&&r.negative_balance_no_score!==true&&lineup.every(p=>{
    const slot=number(p.slot_number),id=text(p.player_id),empty=isEmpty?.(p)===true;
    const captain=p.is_captain===true||p.is_captain==='true';if(captain)captains++;
    if(!Number.isInteger(slot)||slot<1||slot>11||slots.has(slot)||!Number.isFinite(number(p.displayed_points))||(!empty&&(!id||ids.has(id)))||(empty&&captain))return false;
    slots.add(slot);if(!empty)ids.add(id);return true;
   })&&captains<=1;
   if(!valid){diagnostics.invalidRows++;continue;}
   for(const p of lineup){
    if(isEmpty?.(p))continue;
    const id=text(p.player_id),identity=catalog?.playersById?.get(id);
    const misterId=/^\d+$/.test(text(identity?.misterId))?text(identity.misterId):null;
    if(!playersById.has(id))playersById.set(id,{playerId:id,misterId,name:text(p.player_name),matchdays:new Map()});
    const player=playersById.get(id),captain=p.is_captain===true||p.is_captain==='true';
    const bonus=captain?captainAdjustment?.(p):0,points=number(p.displayed_points);
    const appearance={participantId:person.id,participantName:person.name,points:Number.isFinite(bonus)?points-bonus:null,
     contributionPoints:points,captainBonus:Number.isFinite(bonus)?bonus:null,provisional:r.has_postponed_matches===true};
    if(!player.matchdays.has(day))player.matchdays.set(day,[]);player.matchdays.get(day).push(appearance);
   }
  }
  for(const player of playersById.values()){
   player.matchdays=[...player.matchdays].sort((a,b)=>a[0]-b[0]).map(([matchday,appearances])=>{
    const base=appearances[0].points;
    // A player can appear for two managers in one round. Count his own score once;
    // retain both real contributions and withhold the score if the sources disagree.
    const points=base!==null&&appearances.every(a=>a.points!==null&&Math.abs(a.points-base)<.000001)?base:null;
    return {matchday,points,appearances,provisional:appearances.some(a=>a.provisional)};
   });
   player.points=player.matchdays.every(d=>d.points!==null)?player.matchdays.reduce((n,d)=>n+d.points,0):null;
   const appearances=player.matchdays.flatMap(d=>d.appearances);
   player.contributionPoints=appearances.reduce((n,a)=>n+a.contributionPoints,0);
   player.captainBonus=appearances.every(a=>a.captainBonus!==null)?appearances.reduce((n,a)=>n+a.captainBonus,0):null;
   player.provisional=player.matchdays.some(d=>d.provisional);
   if(player.misterId)playersByMisterId.set(player.misterId,playersByMisterId.has(player.misterId)?null:player);
   else diagnostics.unlinkedPlayers++;
  }
  return {season,playersById,playersByMisterId,matchdays:[...days].sort((a,b)=>a-b),diagnostics,
   partial:diagnostics.invalidRows+diagnostics.ambiguousRows+diagnostics.missingRows>0};
 }
 function createStore(){
  let loader=null,options=null,generation=0,pending=null,rows=null,model=null,status='idle',requested=false;
  const listeners=new Set(),snapshot=()=>({model,status}),emit=()=>listeners.forEach(fn=>fn(snapshot()));
  function configure(config){loader=config.load;options=config.options;if(requested)void readRows().catch(()=>{});}
  function invalidate({reload=true}={}){
   generation++;pending=null;rows=null;model=null;status='idle';emit();
   if(reload&&requested&&loader)void readRows().catch(()=>{});
  }
  function readRows({force=false}={}){
   requested=true;if(force)invalidate({reload:false});
   if(!loader)return Promise.resolve(null);
   if(pending)return pending;if(rows)return Promise.resolve(rows);
   const token=generation;status='loading';emit();
   pending=Promise.resolve().then(loader).then(result=>{
    if(token!==generation)return readRows();
    const next=build({...options(),rows:result});rows=result;model=next;status='ready';emit();return rows;
   }).catch(error=>{if(token!==generation)return readRows();status='error';emit();throw error;})
    .finally(()=>{if(token===generation)pending=null;});
   return pending;
  }
  return {configure,invalidate,readRows,snapshot,get configured(){return !!loader;},subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);}};
 }
 const api={build,createStore};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.CubanLeaguePlayerPoints={...api,store:createStore()};
})(typeof globalThis==='object'?globalThis:this);
