'use strict';
const {createHash}=require('node:crypto'),{gunzipSync}=require('node:zlib');
const {hash,validateSnapshot,fail}=require('./core.cjs');
const {validateLedger}=require('./history.cjs');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function restoreArchive(record){
 if(!record||!Number.isSafeInteger(record.rawBytes)||record.rawBytes<1||record.rawBytes>30000000||typeof record.compressedBase64!=='string')fail('invalid_archive');
 const compressed=Buffer.from(record.compressedBase64,'base64');
 if(digest(compressed)!==record.sha256)fail('archive_hash_mismatch');
 const raw=gunzipSync(compressed,{maxOutputLength:30000000});
 if(raw.length!==record.rawBytes||digest(raw)!==record.rawSha256)fail('archive_content_mismatch');
 const backup=JSON.parse(raw);
 if(backup.leagueId!=='649733'||backup.season!=='2026-27'||backup.completeSeason!==false)fail('invalid_backup');
 backup.captures.forEach(validateSnapshot);validateLedger(backup.feedLedger);
 if(!backup.captures.some(s=>s.snapshotHash===backup.verification?.snapshotHash))fail('missing_verified_snapshot');
 const {reportHash,...report}=backup.clauseStatistics;if(hash(report)!==reportHash)fail('clause_report_hash_mismatch');
 return backup;
}
module.exports={restoreArchive};
if(require.main===module){
 const fs=require('node:fs'),[input,output]=process.argv.slice(2);
 if(!input||!output)throw Error('Usage: node restore-archive.cjs archive.json backup.json');
 const backup=restoreArchive(JSON.parse(fs.readFileSync(input,'utf8')));
 fs.writeFileSync(output,JSON.stringify(backup),{mode:0o600,flag:'wx'});
 process.stdout.write(JSON.stringify({restored:true,captures:backup.captures.length,feedEvents:backup.feedLedger.events.length})+'\n');
}
