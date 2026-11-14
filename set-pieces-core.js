/* Read-only set-piece references. No scores, lineups or player identities are changed. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CubanSetPiecesCore=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const SEASON='2026-27';
 const ROLES={penalties:'Penaltis',direct_free_kicks:'Faltas directas',wide_free_kicks:'Faltas laterales'};
 const SOURCES={jornadaperfecta:{name:'Jornada Perfecta',url:'https://www.jornadaperfecta.com/lanzadores/'},comuniate:{name:'Comuniate',url:'https://www.comuniate.com/lanzadores/penaltis'}};
 const fold=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 function assert(ok){if(!ok)throw Error('Referencia de balón parado no válida');}
 function validate(data,teams,now=Date.now()){
  assert(data?.schema_version===1&&data.season===SEASON&&Array.isArray(data.sources)&&data.sources.length>0&&data.sources.length<=2);
  const validDate=d=>typeof d==='string'&&Number.isFinite(Date.parse(d))&&Date.parse(d)<=now+300000;
  assert(validDate(data.checked_at));const seen=new Set();
  for(const s of data.sources){
   assert(SOURCES[s.id]&&!seen.has(s.id));seen.add(s.id);
   assert(s.url===SOURCES[s.id].url&&validDate(s.fetched_at)&&validDate(s.changed_at)&&Date.parse(s.changed_at)<=Date.parse(s.fetched_at)&&Date.parse(s.fetched_at)<=Date.parse(data.checked_at)&&typeof s.ok==='boolean');
   assert(/^[a-f0-9]{64}$/.test(s.content_hash)&&s.teams&&Object.keys(s.teams).length===teams.length&&teams.every(t=>Object.hasOwn(s.teams,t.id)));
   for(const roles of Object.values(s.teams)){
    const expected=s.id==='comuniate'?['penalties']:Object.keys(ROLES);
    assert(Object.keys(roles).length===expected.length&&expected.every(k=>Object.hasOwn(roles,k)));
    for(const entries of Object.values(roles)){
     assert(Array.isArray(entries)&&entries.length>0&&entries.length<=8);
     const ids=new Set(),playerIds=new Set();
     for(const p of entries){assert(p&&typeof p.name==='string'&&p.name.length>0&&p.name.length<=90&&typeof p.key==='string'&&/^[a-z0-9-]{1,100}$/.test(p.key)&&!ids.has(p.key));ids.add(p.key);
      assert(p.player_id===null||typeof p.player_id==='string'&&/^[a-z0-9-]{1,100}$/.test(p.player_id));if(p.player_id){assert(!playerIds.has(p.player_id));playerIds.add(p.player_id);}assert(typeof p.preferred==='boolean'&&(s.id==='comuniate'||!p.preferred));
      assert([p.attempts,p.scored].every(n=>n===null||Number.isInteger(n)&&n>=0&&n<100));assert(p.scored===null||p.attempts!==null&&p.scored<=p.attempts);
     }
     assert(entries.filter(p=>p.preferred).length<=1);
    }
   }
  }
  return data;
 }
 function model(data,team,now=Date.now()){
  const sources=data.sources.filter(s=>s.teams[team]);
  return Object.entries(ROLES).map(([id,label])=>{
   const byKey=new Map();
   for(const source of sources){for(const p of source.teams[team][id]||[]){
    const key=p.player_id||fold(p.name),entry=byKey.get(key)||{...p,sources:[],preferred:false};
    entry.sources.push({id:source.id,ok:source.ok,fetched_at:source.fetched_at});entry.preferred ||= p.preferred;
    if(source.id==='comuniate'){entry.attempts=p.attempts;entry.scored=p.scored;}
    byKey.set(key,entry);
   }}
   const players=[...byKey.values()],preferred=players.find(p=>p.preferred),hasJP=sources.some(s=>s.id==='jornadaperfecta'&&s.teams[team][id]);
   const conflict=Boolean(preferred&&hasJP&&!preferred.sources.some(s=>s.id==='jornadaperfecta'));
   players.sort((a,b)=>Number(b.preferred)-Number(a.preferred)||b.sources.length-a.sources.length||a.name.localeCompare(b.name,'es'));
   return {id,label,players,conflict,stale:sources.filter(s=>s.teams[team][id]).some(s=>!s.ok||now-Date.parse(s.fetched_at)>48*3600000)};
  });
 }
 return {SEASON,ROLES,SOURCES,fold,validate,model};
});
