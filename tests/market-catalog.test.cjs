'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { hash, MarketError } = require('../scripts/mister-market/core.cjs');
const { collectComplete } = require('../scripts/mister-market/catalog-read.cjs');
function capture(ids, time) {
  const s = {schemaVersion:1,leagueId:'649733',season:'2026-27',catalogComplete:true,
    publicationReady:false,startedAt:time,completedAt:time,movements:[],managers:[],clubs:[],
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
  assert.equal(reads.length,0);assert.equal(events.length,2);assert.equal(events[1].action,'review_catalog_absences');
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

function absenceFixture() {
  const ids=Array.from({length:100},(_,i)=>String(i+1)), previous=capture(ids,'2026-11-16T22:00:00Z');
  previous.players.forEach(p=>p.ownershipStatus='free');delete previous.snapshotHash;previous.snapshotHash=hash(previous);
  const next=structuredClone(previous);next.players=next.players.filter(p=>p.playerId!=='100');
  next.startedAt=next.completedAt='2026-11-17T14:00:00Z';delete next.snapshotHash;next.snapshotHash=hash(next);
  return {previous,next};
}
test('Only a small stable set of unowned players without public history can reach club confirmation',async()=>{
  const {previous,next}=absenceFixture();
  const result=await collectComplete({},previous,{read:async()=>next,protectedPlayerIds:[]});
  assert.equal(result.absentFreePlayers.length,1);assert.equal(result.absentFreePlayers[0].playerId,'100');
  assert.equal(result.readings.length,2);assert.equal(result.readings[0].playersHash,result.readings[1].playersHash);
  assert.equal(result.current.players.length,99);
});
test('Owned players, historical clauses, changing catalogs and large losses remain blocked',async()=>{
  for(const mode of ['owned','history','changing','large','overlap']){
    const {previous,next}=absenceFixture();let calls=0;
    if(mode==='owned'){previous.players.at(-1).ownerId='1';delete previous.snapshotHash;previous.snapshotHash=hash(previous);}
    if(mode==='large'){next.players=next.players.slice(0,90);delete next.snapshotHash;next.snapshotHash=hash(next);}
    await assert.rejects(collectComplete({},previous,{protectedPlayerIds:mode==='history'?['100']:[],read:async()=>{
      calls++;const n=structuredClone(next);
      if(mode==='changing'&&calls===2)n.players[0].marketValue++;
      if(mode==='overlap'&&calls===2)n.startedAt='2026-11-17T13:59:00Z';
      delete n.snapshotHash;n.snapshotHash=hash(n);return n;
    }}),/missing_catalog_players/);assert.equal(calls,2);
  }
});
const {confirmFreeAbsences}=require('../scripts/mister-market/catalog-absence.cjs');
const {player}=require('../scripts/mister-market/core.cjs');
function clubBrowser(options={}){
  const managers=Array.from({length:20},(_,i)=>({id:String(i+1),name:'Manager '+(i+1)}));
  const clubs=Array.from({length:20},(_,i)=>({id:String(i+1),name:'Club '+(i+1)}));
  const raw=id=>({id,href:'/players/'+id,name:'Player '+id,value:'100',position:'1',clubId:'1',header:'',photoUrl:null});
  const ctx={leagueId:'649733',season:'2026-27',managers,clubs};
  const current={...ctx,players:[player(raw('1'),'free',ctx)],movements:[]};
  const candidate={...player(raw('2'),'free',ctx)};
  const ranges=['value_from','value_to','clause_from','clause_to'].map(name=>({name,value:name.endsWith('_from')?'0':'1000000'}));
  let url='',popup=false,owner='0',team='0',rows=[raw('1'),raw('3')];
  const page={url:()=>url,goto:async u=>{url=u;rows=[raw('1'),raw('3')];},
    locator:selector=>({waitFor:async()=>{},fill:async()=>{},selectOption:async value=>{if(selector.includes('owner'))owner=value;else team=value;},
      click:async()=>{if(selector==='.search-players-filter-btn')popup=true;
        else if(selector.includes('reset')){popup=false;owner=team='0';}
        else if(selector.includes('apply')){popup=false;rows=[raw('1')];if(options.found)rows.push(raw('2'));if(options.changed)rows[0].value='101';}}}),
    evaluate:async fn=>{
      if(fn.name==='readFilterDocument')return {...ctx,managers:options.spaces?ctx.managers.map(m=>({...m,name:m.name.replace(' ','  ')})):ctx.managers,owner,team,position:'0',injured:false,stealable:false,ranges};
      if(fn.name==='readFeedDocument')return {...ctx,ready:true,cards:1,events:options.feedChanged?[{feedId:'feed-1',playerId:'1',name:'Player 1',title:'Fichaje',from:{id:null,name:'Mister'},to:{id:'1',name:'Manager 1'},amount:'100'}]:[]};
      return {...ctx,leagueId:options.wrongLeague?'other':ctx.leagueId,ready:true,popupOpen:popup,search:'',favorites:false,hasMore:false,rows};
    }};
  const wait=async(read,accept)=>{const s=await read();assert.equal(accept(s),true);return s;};
  return {page,current,candidate,wait};
}
test('Independent club search confirms all known rows and records only observed absence',async()=>{
  const f=clubBrowser(),result=await confirmFreeAbsences(f.page,f.current,[f.candidate],{wait:f.wait});
  assert.deepEqual(result[0].playerIds,['1']);assert.deepEqual(result[0].absentPlayerIds,['2']);
});
test('Club searches reject a reappearing player, missing/changed rows, wrong league or concurrent feed',async()=>{
  for(const [option,code] of [['found','catalog_absence_not_confirmed'],['changed','catalog_club_mismatch'],['wrongLeague','wrong_league'],['feedChanged','feed_changed_during_verification']]){
    const f=clubBrowser({[option]:true});
    await assert.rejects(confirmFreeAbsences(f.page,f.current,[f.candidate],{wait:f.wait}),new RegExp(code));
  }
});

test('Reader diagnostic omits secrets, error messages, URLs and raw DOM',async()=>{
 const {readerDiagnostic,readSessionDiagnostic}=require('../scripts/mister-market/reader-diagnostic.cjs');
 const err=new Error('secret-token-and-HTML');err.name='TimeoutError';
 err.stack='Error: secret-token-and-HTML\n at go (/home/runner/repo/scripts/mister-market/collector.cjs:74:2)';
 const result=await readerDiagnostic(err,{url:()=> 'https://mister.mundodeportivo.com/new-onboarding/?secret=hidden',
  evaluate:async fn=>{assert.equal(fn,readSessionDiagnostic);return {activeLeague:false,passwordForm:true};}});
 assert.equal(result.browserError,'timeout');assert.equal(result.page,'/new-onboarding/');
 assert.deepEqual(result.source,[{file:'collector.cjs',line:74}]);
 assert.ok(!JSON.stringify(result).includes('secret'));assert.ok(!JSON.stringify(result).includes('HTML'));
 assert.equal((await readerDiagnostic(err,{url:()=> 'https://other.example/private',evaluate:async()=>{throw Error('secret');}})).page,'external');
});

const {selectLeague}=require('../scripts/mister-market/league-context.cjs');
test('Uses the exact existing target league link when the account opens a different community',async()=>{
 let leagueId='978196';const visits=[],events=[];
 const page={url:()=> 'https://mister.mundodeportivo.com/feed',
  evaluate:async()=>({leagueId,links:['https://mister.mundodeportivo.com/action/change?id_community=649733']}),
  goto:async url=>{visits.push(url);leagueId='649733';}};
 const wait=async(read,accept)=>{const s=await read();assert.ok(accept(s));return s;};
 assert.equal(await selectLeague(page,{leagueId:'649733'},{wait,progress:e=>events.push(e)}),true);
 assert.deepEqual(visits,['https://mister.mundodeportivo.com/action/change?id_community=649733']);
 assert.equal(events[0].previousLeagueId,'978196');
 assert.equal(await selectLeague(page,{leagueId:'649733'},{wait}),false);assert.equal(visits.length,1);
});
test('Missing, foreign or ambiguous target navigation cannot select another league',async()=>{
 for(const link of ['', 'https://evil.example/action/change?id_community=649733',
  'https://mister.mundodeportivo.com/action/delete?id_community=649733',
  'https://mister.mundodeportivo.com/action/change?id_community=978196',
  'https://mister.mundodeportivo.com/action/change?id_community=649733&other=1']){
  let visits=0;
  const page={evaluate:async()=>({leagueId:'978196',links:link?[link]:[]}),goto:async()=>{visits++;}};
  await assert.rejects(selectLeague(page,{leagueId:'649733'},{wait:async read=>read()}),/target_league_unavailable/);
  assert.equal(visits,0);
 }
});

test('League selection reads the active ID and existing navigation links from rendered markup',()=>{
 const {JSDOM}=require('jsdom'),vm=require('node:vm'),{readLeagueDocument}=require('../scripts/mister-market/league-context.cjs');
 const dom=new JSDOM('<a class="active" href="/action/change?id_community=978196">Other</a><a href="/action/change?id_community=649733">Cuban League</a>',{url:'https://mister.mundodeportivo.com/feed'});
 const s=vm.runInNewContext('('+readLeagueDocument.toString()+')()',{document:dom.window.document,URL});
 assert.equal(s.leagueId,'978196');assert.equal(s.links[1],'https://mister.mundodeportivo.com/action/change?id_community=649733');
});

test('Club confirmation uses the same normalized manager identities as the complete catalog',async()=>{
 const f=clubBrowser({spaces:true});
 assert.equal((await confirmFreeAbsences(f.page,f.current,[f.candidate],{wait:f.wait})).length,1);
});
