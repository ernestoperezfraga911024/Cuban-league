'use strict';
const {hash,validateSnapshot,compare,fail}=require('./core.cjs');
const {clauseReport}=require('./clause-stats.cjs');
const {validate}=require('../../market-core.js');
const {key}=require('../../mister-import-core.js');
const {gzipSync}=require('node:zlib');
const {createHash}=require('node:crypto');

// Exact normalized names only; ambiguity or a changed participant blocks preparation.
function bindManagers(managers,participants){
 const active=participants.filter(p=>p.active!==false);
 return managers.map(m=>{
  const matches=active.filter(p=>key(p.name)===key(m.name));
  if(matches.length!==1)fail('ambiguous_participant_binding');
  return {id:m.id,participantId:matches[0].id,name:matches[0].name};
 });
}
function prepare(backup,participants){
 if(backup.schemaVersion!==1||backup.leagueId!=='649733'||backup.season!=='2026-27'||backup.completeSeason!==false)fail('invalid_backup');
 const captures=backup.captures.map(validateSnapshot);
 const current=captures[captures.length-1],verified=captures.find(s=>s.snapshotHash===backup.verification?.snapshotHash);
 if(!verified||!current)fail('missing_verified_snapshot');
 if(verified!==current){const delta=compare(verified,current);if(delta.changes.length||delta.missingPlayerIds.length||hash(verified.players)!==hash(current.players)||hash(verified.managers)!==hash(current.managers)||hash(verified.clubs)!==hash(current.clubs))fail('unverified_market_changes');}
 const v=backup.verification;
 if(v.teams?.length!==current.managers.length||new Set(v.teams.map(t=>t.managerId)).size!==current.managers.length||v.teams.some(t=>t.verified!==true||!current.managers.some(m=>m.id===t.managerId)||t.playerCount!==current.players.filter(p=>p.ownerId===t.managerId).length))fail('unverified_teams');
 const report=clauseReport(verified,backup.feedLedger,v);
 if(!report.profiles.identityComplete)fail('unresolved_history_identity');
 const clubs=new Map(current.clubs.map(c=>[c.id,c.name]));
 const payload=validate({schemaVersion:1,leagueId:current.leagueId,season:current.season,snapshotHash:current.snapshotHash,capturedAt:current.completedAt,
  managers:bindManagers(current.managers,participants),
  players:current.players.map(p=>({id:p.playerId,name:p.name,position:p.position,club:clubs.get(p.clubId),photo:p.photoUrl,value:p.marketValue,clause:p.clauseValue,ownerId:p.ownerId})),
  history:{source:'player_profiles',completeSeason:false,reconciliation:'pending',observedAt:v.completedAt,
   events:v.histories.flatMap(h=>h.movements.flatMap((m,i)=>m.type==='clause'?[{reference:`${h.playerId}:row:${i}`,playerId:h.playerId,date:m.occurredOn,from:m.from.managerId,to:m.to.managerId,amount:m.amount}]:[]))}});
 // Only the explicit reader export is archived. Browser credentials are never accepted.
 const keys=['schemaVersion','leagueId','season','exportedAt','completeSeason','captures','verification','feedLedger','clauseStatistics'];
 if(Object.keys(backup).some(k=>!keys.includes(k)))fail('unexpected_backup_field');
 const bytes=Buffer.from(JSON.stringify(backup)), compressed=gzipSync(bytes);
 return {payload,archive:{sha256:createHash('sha256').update(compressed).digest('hex'),rawSha256:createHash('sha256').update(bytes).digest('hex'),rawBytes:bytes.length,compressedBase64:compressed.toString('base64')},
  review:{marketPlayers:payload.players.length,managers:payload.managers.length,profileClauses:payload.history.events.length,feedClauses:report.feed.totals.clauseCount,completeSeason:false,reconciliation:'pending',visible:false}};
}
module.exports={prepare,bindManagers};
if(require.main===module){
 const fs=require('node:fs'),[input,participantsFile,output]=process.argv.slice(2);
 if(!input||!participantsFile||!output)throw Error('Usage: node publication.cjs backup.json data.json output.json');
 const result=prepare(JSON.parse(fs.readFileSync(input,'utf8')),JSON.parse(fs.readFileSync(participantsFile,'utf8')).participants);
 fs.writeFileSync(output,JSON.stringify(result),{mode:0o600,flag:'wx'});
 process.stdout.write(JSON.stringify(result.review)+'\n');
}
