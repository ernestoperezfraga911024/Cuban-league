'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {generateKeyPairSync,sign}=require('crypto'),{gzipSync}=require('zlib'),{createHash}=require('crypto');
const {PGlite}=require('@electric-sql/pglite');
const {reconcile}=require('../scripts/mister-market/reconciliation.cjs'),{hash}=require('../scripts/mister-market/core.cjs');
const fixture=require('./helpers/market-fixture.cjs'),{validate}=require('../market-core.js');
function ledger(events){const l={schemaVersion:1,leagueId:'649733',season:'2026-27',publicationReady:false,headEventIds:[],events,completedAt:'2026-11-15T20:00:00Z'};l.ledgerHash=hash(l);return l;}
test('Reconciliation preserves multiplicity and unknown dates without summing candidate overlaps',()=>{
 const movement={type:'clause',occurredOn:'2026-09-01',from:{managerId:'1'},to:{managerId:'2'},amount:1000};
 const v={leagueId:'649733',histories:[{playerId:'1',movements:[movement,movement]}]};
 const e={type:'clause',playerId:'1',fromOwnerId:'1',toOwnerId:'2',amount:1000};
 const r=reconcile(v,ledger([{...e,eventId:'a'},{...e,eventId:'b'},{...e,eventId:'c'}]));
 assert.equal(r.events.length,3);assert.equal(r.overlapCandidates,2);assert.equal(r.events.filter(x=>x.date===null).length,1);
 const p=fixture();p.schemaVersion=2;p.history=r;assert.equal(validate(p),p);
 assert.equal(reconcile(v,ledger([{...e,eventId:'a'}])).events.length,2);
 assert.throws(()=>reconcile(v,ledger([{...e,eventId:'a'},{...e,eventId:'a'}])),/duplicate_event/);
 const other=reconcile(v,ledger([{...e,eventId:'a',amount:1001}]));assert.equal(other.events.length,3);
 assert.deepEqual(reconcile(v,ledger([])).events.map(e=>e.date),['2026-09-01','2026-09-01']);
});
test('OIDC checks signature, exact repository/workflow/main, event type, audience and lifetime',async()=>{
 const {verifyToken,audience}=await import('../supabase/functions/mister-market-sync/security.mjs');
 const pair=generateKeyPairSync('rsa',{modulusLength:2048}),jwk={...pair.publicKey.export({format:'jwk'}),kid:'test',use:'sig',alg:'RS256'};
 const claims={iss:'https://token.actions.githubusercontent.com',aud:audience,repository:'ernestoperezfraga911024/Cuban-league',repository_id:'1309155979',ref:'refs/heads/main',workflow_ref:'ernestoperezfraga911024/Cuban-league/.github/workflows/mister-market-sync.yml@refs/heads/main',event_name:'schedule',runner_environment:'github-hosted',run_id:'1234',run_attempt:'1',sha:'a'.repeat(40),iat:1000,nbf:1000,exp:1300};
 const token=c=>{const message=[{alg:'RS256',typ:'JWT',kid:'test'},c].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');return message+'.'+sign('RSA-SHA256',Buffer.from(message),pair.privateKey).toString('base64url');};
 assert.equal((await verifyToken(token(claims),[jwk],1100)).run_id,'1234');
 for(const change of [{repository_id:'4'},{repository:'fork/Cuban-league'},{ref:'refs/pull/1/merge'},{event_name:'pull_request'},{workflow_ref:'other'},{aud:'other'},{exp:1001},{iat:100},{nbf:1200},{runner_environment:'self-hosted'}])await assert.rejects(verifyToken(token({...claims,...change}),[jwk],1100));
 const parts=token(claims).split('.');parts[1]=Buffer.from(JSON.stringify({...claims,run_id:'2'})).toString('base64url');await assert.rejects(verifyToken(parts.join('.'),[jwk],1100));
 await assert.rejects(verifyToken(token(claims),[],1100));
});
test('Session envelope is authenticated and decrypts only with its enrolled private key',async()=>{
 const {decryptSession}=await import('../supabase/functions/mister-market-sync/security.mjs'),{sealSession}=require('../scripts/mister-market/seal-session.cjs');
 const keys=generateKeyPairSync('rsa',{modulusLength:2048}),pub=keys.publicKey.export({format:'der',type:'spki'}).toString('base64'),priv=keys.privateKey.export({format:'der',type:'pkcs8'}).toString('base64');
 const state={cookies:[{name:'example',value:'sensitive-test',domain:'mister.mundodeportivo.com'}],origins:[]},sealed=sealSession(state,pub);
 assert.ok(!JSON.stringify(sealed).includes('sensitive-test'));assert.deepEqual(await decryptSession(sealed,priv),state);
 const filtered=sealSession({cookies:[...state.cookies,{name:'other',value:'unrelated',domain:'.unrelated.test'}],origins:[{origin:'https://unrelated.test',localStorage:[]}]},pub);assert.deepEqual(await decryptSession(filtered,priv),state);
 const broken={...sealed,body:sealed.body.slice(0,8)+'AAAA'+sealed.body.slice(12)};await assert.rejects(decryptSession(broken,priv));
});
test('Worker DB gates activation, isolates credentials, fences jobs and publishes atomically',async()=>{
 const db=new PGlite(),q=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 try{
  await db.exec("create role anon;create role authenticated;create role service_role;create schema vault;create table vault.decrypted_secrets(id uuid,decrypted_secret text);insert into vault.decrypted_secrets values('00000000-0000-0000-0000-000000000001','private-test')");
  for(const suffix of ['_mister_market_archive.sql','_mister_market_automation.sql']){const file=fs.readdirSync(path.join(__dirname,'../supabase/migrations')).find(x=>x.endsWith(suffix));await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8'));}
  const raw=Buffer.from('{"test":true}'),compressed=gzipSync(raw),archive={sha256:createHash('sha256').update(compressed).digest('hex'),rawSha256:createHash('sha256').update(raw).digest('hex'),rawBytes:raw.length,compressedBase64:compressed.toString('base64')};
  let payload=fixture();payload.capturedAt=new Date().toISOString();
  const first=(await q('select mister_market.stage($1,$2,$3,$4) r',[compressed,archive.rawSha256,raw.length,JSON.stringify(payload)])).r;
  await db.query("update mister_market.worker_config set latest_archive=$1,public_key='public-test',vault_key='00000000-0000-0000-0000-000000000001',sealed_session='{}'",[archive.sha256]);
  const rpc=async(action,run,data={})=>(await q('select public.mister_market_worker($1,$2,$3,$4) r',[action,run,'a'.repeat(40),JSON.stringify(data)])).r;
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(rpc('begin','123:1',{mode:'test'}));await assert.rejects(q('select * from mister_market.worker_config'));await db.exec('reset role');}
  await db.exec('set role service_role');assert.equal((await rpc('begin','123:1',{mode:'sync'})).skipped,true);
  const start=await rpc('begin','123:1',{mode:'test'});assert.equal(start.privateKey,'private-test');
  await assert.rejects(rpc('begin','124:1',{mode:'test'}),/worker_busy/);await assert.rejects(rpc('fail','124:1',{code:'failed'}),/worker_fence/);
  const data={archive,payload:{...payload,schemaVersion:2,history:{...payload.history,source:'reconciled',reconciliation:'minimum_confirmed'}},expectedRevision:first.revision,sealedSession:{version:1,algorithm:'RSA-OAEP-256+A256GCM'},metrics:{aiCalls:0}};
  assert.equal((await rpc('finish','123:1',data)).outcome,'tested');await assert.rejects(rpc('finish','123:1',data),/worker_fence/);
  await db.exec('reset role');assert.equal((await q('select visible from public.mister_market_public')).visible,false);assert.equal((await q('select status from mister_market.worker_runs')).status,'tested');
  await db.exec('update mister_market.worker_config set enabled=true;set role service_role');await rpc('begin','125:1',{mode:'sync'});
  assert.equal((await rpc('finish','125:1',data)).visible,true);
  await db.exec('reset role');assert.equal((await q('select visible from public.mister_market_public')).visible,true);
  await db.exec('set role service_role');await rpc('begin','126:1',{mode:'sync'});const bad=structuredClone(data);bad.payload.players[0].value=null;await assert.rejects(rpc('finish','126:1',bad));await rpc('fail','126:1',{code:'invalid_player'});
  await db.exec('reset role');assert.equal((await q('select visible from public.mister_market_public')).visible,true);
  assert.equal((await q("select status from mister_market.worker_runs where run_id='126:1'")).status,'failed');
 }finally{await db.close();}
});
