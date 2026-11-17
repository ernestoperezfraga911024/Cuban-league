'use strict';
// Interactive maintenance only: never called by the scheduled producer.
const fs=require('node:fs'),path=require('node:path');
const {literal}=require('./season-gateway.cjs');
function repairSql({targets,codeSha,executionKey}){
 if(!/^[a-f0-9]{40}$/.test(codeSha)||!/^cuban-league-\d{8}t\d{6}z$/.test(executionKey))throw Error('Invalid maintenance identity');
 if(!Array.isArray(targets)||!targets.length||targets.length>20||new Set(targets.map(t=>t.team)).size!==targets.length)throw Error('Invalid repair scope');
 for(const t of targets){
  if(!/^[a-z0-9-]+$/.test(t.team)||!['draft_hash','public_hash'].every(k=>/^[a-f0-9]{32}$/.test(t[k]))||!Array.isArray(t.pairs)||!t.pairs.length)throw Error('Invalid repair fingerprint');
  if(new Set(t.pairs.flatMap(p=>[p.from,p.to])).size!==t.pairs.length*2)throw Error('Repair pairs must be disjoint');
  for(const p of t.pairs)if(![p.from,p.to].every(id=>typeof id==='string'&&/^[a-z0-9-]+$/.test(id)))throw Error('Invalid player identity');
 }
 return `begin;\nset local lock_timeout='5s';\nset local statement_timeout='30s';\nselect set_config('forecast_maintenance.priority_targets',${literal(JSON.stringify(targets))},true);\nselect set_config('forecast_maintenance.code_sha',${literal(codeSha)},true);\nselect set_config('forecast_maintenance.execution_key',${literal(executionKey)},true);\n`+
 fs.readFileSync(path.join(__dirname,'../../docs/forecast-publish/selection-priority-repair.sql'),'utf8')+'\ncommit;';
}
module.exports={repairSql};
