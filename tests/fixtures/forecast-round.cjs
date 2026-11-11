const config=require('../../forecast-round-config.js'),core=require('../../forecast-round-core.js'),catalog=require('../../catalog/players.json');
function publication(team,formation='4-2-3-1'){
 const f=core.fixture(team),roster=catalog.players.filter(p=>p.club_id===team),date='2026-11-11T20:00:00Z';
 return {schema_version:2,fixture_key:f.key,team,home:f.home,away:f.away,opponent:team===f.home?f.away:f.home,matchday:13,kickoff_at:f.kickoff_at,formation,probability_kind:'editorial_uncalibrated',note:'Synthetic test fixture. Not a sporting prediction.',evidence_at:date,
 sources:Object.entries(f.sources).map(([id,url])=>({id,url,fetched_at:date,source_updated_at:null})),players:roster.slice(0,11).map((p,i)=>({id:p.id,name:p.display_name,slot:i+1,position:core.position(formation,i+1),probability:i===2?60:80,alternative:i===2?{id:roster[11].id,name:roster[11].display_name}:null,reason:'Synthetic explanation for a controlled browser test.',method:'editorial-v2'}))};
}
module.exports={publication,rows:()=>config.teams.filter(t=>t.id!=='real-madrid').map((t,i)=>({team:t.id,published_at:'2026-11-11T20:01:00Z',payload:publication(t.id,core.formations[i%core.formations.length])}))};
