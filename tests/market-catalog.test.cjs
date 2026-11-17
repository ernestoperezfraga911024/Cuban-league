'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { hash, MarketError } = require('../scripts/mister-market/core.cjs');
const { collectComplete } = require('../scripts/mister-market/catalog-read.cjs');
function capture(ids, time) {
  const s = {schemaVersion:1,leagueId:'649733',season:'2026-27',catalogComplete:true,
    publicationReady:false,startedAt:time,completedAt:time,movements:[],
    players:ids.map(id=>({playerId:id,name:'Player '+id,ownerId:null,marketValue:100,clauseValue:null}))};
  return {...s,snapshotHash:hash(s)};
}
const old = capture(['1','2'],'2026-11-16T22:00:00Z');
const current = ids => capture(ids,'2026-11-17T14:00:00Z');
test('Complete capture reads once and keeps observed current data', async()=>{
  let calls=0;const fresh=current(['1','2','3']);
  const r=await collectComplete({},old,{read:async()=>{calls++;return fresh;}});
  assert.equal(calls,1);assert.equal(r.current,fresh);assert.equal(r.catalogReads,1);
});
test('Partial capture retries once and uses only the fresh complete result',async()=>{
  const reads=[current(['1','3']),current(['1','2'])],events=[];
  const r=await collectComplete({},old,{read:async()=>reads.shift(),progress:e=>events.push(e)});
  assert.equal(r.catalogReads,2);assert.deepEqual(r.current.players.map(p=>p.playerId),['1','2']);
  assert.equal(events[0].missing[0].playerId,'2');assert.equal(events[0].action,'reread_catalog');
});
test('Persistent omission blocks; two complementary partial reads are never merged',async()=>{
  const reads=[current(['1']),current(['2'])],before=JSON.stringify(old),events=[];
  await assert.rejects(collectComplete({},old,{read:async()=>reads.shift(),progress:e=>events.push(e)}),/missing_catalog_players/);
  assert.equal(reads.length,0);assert.equal(events.length,2);assert.equal(events[1].action,'blocked_incomplete_catalog');
  assert.equal(JSON.stringify(old),before);
});
test('Context, hash and transport errors do not trigger a retry',async()=>{
  for(const value of [new MarketError('wrong_league'),{...current(['1','2']),snapshotHash:'bad'},old]){
    let calls=0;
    const earlier={...old,completedAt:'2026-11-17T15:00:00Z'};delete earlier.snapshotHash;earlier.snapshotHash=hash(earlier);
    await assert.rejects(collectComplete({},earlier,{read:async()=>{calls++;if(value instanceof Error)throw value;return value;}}));
    assert.equal(calls,1);
  }
});
