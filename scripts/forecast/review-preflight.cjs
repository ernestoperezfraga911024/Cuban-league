'use strict';
// Diagnostics only. No identities, source observations, choices or coordinates
// are inferred or changed. The strict compiler and SQL still decide publication.
const {diagnoseLayout} = require('./lineup-layout.cjs');
const BASE = ['futbolfantasy','jornadaperfecta','comuniate'];
const probability = n => n === null || Number.isInteger(n) && n >= 0 && n <= 100;
function reviewPreflight(packet, review, roster) {
  const issues=[], byId=new Map(roster.map(p=>[p.id,p]));
  const add=(code,message,details={})=>issues.push({code,message,...details});
  const exclusions=Array.isArray(review.exclusions)?review.exclusions:[];
  if(review.exclusions!=null&&!Array.isArray(review.exclusions))add('review_shape_invalid',`${packet.team}: exclusions debe ser una lista`);
  const resolve=name=>{
    const exact=roster.filter(p=>p.name===name);
    const id=review.identities?.[name] ?? (exact.length===1?exact[0].id:null);
    return byId.has(id)?id:null;
  };
  const unresolved=new Map();
  const inspectName=(name,source,required=true)=>{
    if(resolve(name))return;
    const excluded=!required && exclusions.some(e=>e?.source===source&&e.name===name&&typeof e.reason==='string'&&e.reason.length>=10);
    if(excluded)return;
    if(!unresolved.has(name))unresolved.set(name,new Set());
    unresolved.get(name).add(source);
  };
  for(const source of BASE){
    const supplied=review.sources?.[source]?.alternatives;
    if(supplied!==undefined&&!Array.isArray(supplied))add('review_shape_invalid',`${source}: alternativas debe ser una lista`,{source});
    const observed=packet.observations?.[source]||[], alternatives=(Array.isArray(supplied)?supplied:[]).filter(p=>{
      if(p&&typeof p.name==='string')return true;
      add('review_shape_invalid',`${source}: alternativa sin nombre válido`,{source});return false;
    });
    observed.forEach(p=>inspectName(p.name,source));
    alternatives.forEach(p=>inspectName(p.name,source,false));
    const entries=[...observed.map(p=>({...p,kind:'starter'})),...alternatives.map(p=>({...p,kind:'alternative'}))];
    const grouped=new Map();
    for(const p of entries){
      const id=resolve(p.name);
      if(!probability(p.probability))add('probability_invalid',`${source}: porcentaje inválido de ${p.name}`,{source,name:p.name});
      if(!id)continue;
      if(!grouped.has(id))grouped.set(id,[]);
      grouped.get(id).push(p);
    }
    // Exactly one primary starter plus secondary alternatives is valid. The
    // compiler keeps the starter signal once; two starter identities still fail.
    for(const [id,rows] of grouped)if(rows.length>1&&rows.filter(p=>p.kind==='starter').length!==1)add('source_duplicate',`${source}: observación duplicada de ${rows.map(p=>p.name+' ('+p.kind+')').join(', ')}`,{source,id,names:rows.map(p=>p.name)});
  }
  if(review.predicted11?.fixture_verified===true)for(const prediction of packet.predictions||[]){
    if(prediction.status==='complete_unvalidated')for(const p of prediction.data?.participacion||[])inspectName(p.nombre?.trim(),'predicted11');
  }
  for(const [name,sources] of unresolved)add('identity_unresolved',`${packet.team}: identidad sin resolver: ${name}`,{name,sources:[...sources]});
  const selection=review.selection;
  const playersValid=Array.isArray(selection?.players)&&selection.players.every(p=>p&&typeof p.id==='string');
  if(selection?.players!==undefined&&!playersValid)add('review_shape_invalid',`${packet.team}: selección sin lista válida de jugadores`);
  if(typeof selection?.formation==='string'&&/^\d+(?:-\d+)+$/.test(selection.formation)&&playersValid){
    const strictResolve=name=>{const id=resolve(name);if(!id)throw Error('Unresolved identity: '+name);return id;};
    for(const issue of diagnoseLayout(packet,selection,strictResolve))add('layout_invalid',issue.message,{row:issue.row});
  }
  return issues;
}
module.exports={reviewPreflight};
