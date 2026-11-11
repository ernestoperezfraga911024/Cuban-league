// Synthetic UI fixture. Not a sporting forecast and never written to Supabase.
const catalog=require('../../catalog/players.json');
const ids=['t-courtois','m-cucurella','d-huijsen','i-konate','f-valverde','e-camavinga','b-silva','y-diomande','j-bellingham','a-guler','k-mbappe'];
const name=id=>catalog.players.find(p=>p.id===id).display_name;
function publication(){
 return {schema_version:1,fixture_key:'laliga-2026-27-j13-real-madrid-celta',team:'real-madrid',opponent:'celta',matchday:13,kickoff_at:'2026-11-21T20:00:00Z',formation:'4-2-3-1',probability_kind:'editorial_uncalibrated',evidence_at:'2026-11-11T17:00:00Z',note:'Datos sintéticos para revisar el diseño. No constituyen una previsión publicada.',sources:[['futbolfantasy','https://www.futbolfantasy.com/partidos/22550-real-madrid-celta'],['jornadaperfecta','https://www.jornadaperfecta.com/partido/13441/real-madrid-celta'],['comuniate','https://www.comuniate.com/equipos/15/real-madrid-alineacion']].map(([id,url])=>({id,url,fetched_at:'2026-11-11T17:00:00Z',source_updated_at:null})),players:ids.map((id,i)=>({id,name:name(id),slot:i+1,position:i===0?'GK':i<5?'DF':i<10?'MF':'FW',probability:i===1?60:75,method:'editorial-v1',alternative:i===1?{id:'a-carreras',name:name('a-carreras')}:null,reason:'Explicación sintética para comprobar el detalle y la legibilidad del jugador.'}))};
}
function draft(){
 const p=publication();return {run_key:'pilot-ui-synthetic-source',payload:{...p,status:'draft',publication_allowed:false,method_version:'editorial-v1',limitations:[p.note],proposal:{formation:p.formation,players:p.players.map((x,i)=>({...x,assessment:{method:'editorial-v1',confirmed_out:false,...Object.fromEntries(Object.entries({role:'established',availability:i===1?'concern':'clear',rotation:'low',agreement:'consistent',quality:'primary',horizon:'distant'}).map(([k,value])=>[k,{value,reason:'Evidencia sintética de prueba.',refs:[p.sources[0].url]}]))}}))}}};
}
module.exports={publication,draft};
