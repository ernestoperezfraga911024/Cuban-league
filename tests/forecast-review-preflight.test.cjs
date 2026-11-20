'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {example}=require('./fixtures/forecast-producer.cjs');
const {reviewPreflight}=require('../scripts/forecast/review-preflight.cjs');
const {compile}=require('../scripts/forecast/editorial-producer.cjs');
const {orderSelection}=require('../scripts/forecast/lineup-layout.cjs');

test('one preflight lists Eric and Joan Garcia together without guessing accent mappings',()=>{
 const x=example(), before=structuredClone(x);
 x.packet.observations.comuniate[0].name='Eric García';
 x.packet.observations.comuniate[1].name='Joan García';
 x.review.identities={'Eric Garcia':x.roster[0].id,'Joan Garcia':x.roster[1].id};
 const issues=reviewPreflight(x.packet,x.review,x.roster);
 assert.deepEqual(issues.filter(i=>i.code==='identity_unresolved').map(i=>i.name),['Eric García','Joan García']);
 assert.throws(()=>compile(x.packet,x.review,x.roster,x.window),/Eric García/);
 assert.deepEqual(x.review.identities,{'Eric Garcia':x.roster[0].id,'Joan Garcia':x.roster[1].id});
 x.review.identities['Eric García']=x.roster[0].id;x.review.identities['Joan García']=x.roster[1].id;
 assert.deepEqual(reviewPreflight(x.packet,x.review,x.roster),[]);
 assert.equal(compile(x.packet,x.review,x.roster,x.window).payload.proposal.players.length,11);
 assert.deepEqual(x.roster,before.roster);
});

test('Celta and Levante starter-alternative roles are accepted without double counting',()=>{
 const x=example();x.review.sources.futbolfantasy.alternatives.push(...x.packet.observations.futbolfantasy.slice(0,2));
 const before=structuredClone(x);assert.deepEqual(reviewPreflight(x.packet,x.review,x.roster),[]);
 const out=compile(x.packet,x.review,x.roster,x.window);
 assert.equal(out.source_roles.length,2);assert.equal(out.payload.sources[0].player_observations.length,12);assert.deepEqual(x,before);
 x.packet.observations.futbolfantasy[1].name=x.roster[0].name;
 assert.ok(reviewPreflight(x.packet,x.review,x.roster).some(i=>i.code==='source_duplicate'));
 assert.throws(()=>compile(x.packet,x.review,x.roster,x.window),/once incompleto/);
});
test('Getafe regression reports identity plus all row collisions before the sole correction',()=>{
 const x=example();
 x.packet.observations.comuniate[10].name='Ünal';
 const points=x.packet.layouts.jornadaperfecta.points;
 points[2].x=points[1].x;points[6].x=points[5].x;
 const before=structuredClone(x),issues=reviewPreflight(x.packet,x.review,x.roster);
 assert.ok(issues.some(i=>i.code==='identity_unresolved'&&i.name==='Ünal'));
 assert.deepEqual(issues.filter(i=>i.code==='layout_invalid').map(i=>i.row),[1,2]);
 assert.deepEqual(x,before);
 assert.throws(()=>orderSelection(x.packet,x.review.selection,name=>x.roster.find(p=>p.name===name).id),/fila 1/);
});

test('preflight checks manually supplied alternatives and permits only explicit optional exclusions',()=>{
 const x=example();x.review.sources.futbolfantasy.alternatives.push({name:'Unknown alternate',probability:null});
 let issues=reviewPreflight(x.packet,x.review,x.roster);
 assert.ok(issues.some(i=>i.code==='identity_unresolved'&&i.name==='Unknown alternate'));
 x.review.exclusions=[{source:'futbolfantasy',name:'Unknown alternate',reason:'Identidad opcional no acreditada en el catálogo.'}];
 assert.deepEqual(reviewPreflight(x.packet,x.review,x.roster),[]);
 x.packet.observations.futbolfantasy[0].name='Unknown alternate';
 issues=reviewPreflight(x.packet,x.review,x.roster);
 assert.ok(issues.some(i=>i.code==='identity_unresolved'&&i.name==='Unknown alternate'));
});

test('all missing alternatives are reported together without raising probabilities',()=>{
 const x=example();
 for(const index of [0,1]){x.packet.observations.comuniate[index].probability=0;delete x.review.selection.players[index].alternative_id;}
 assert.throws(()=>compile(x.packet,x.review,x.roster,x.window),error=>{
   assert.match(error.message,/Test player 1 \(64%\)/);assert.match(error.message,/Test player 2 \(64%\)/);return true;
 });
});

test('Athletic keeps both tactical links and counts one alternative per source',()=>{
 for (const probability of [null,0,35]) {
   const x=example(), player=x.roster[11], source=x.review.sources.comuniate;
   const names=['Gerenebarrena','Gerenabarrena'];
   source.alternatives=names.map(name=>({name,probability}));
   x.packet.comuniate_alternatives.players=structuredClone(source.alternatives);
   x.review.identities=Object.fromEntries(names.map(name=>[name,player.id]));
   for (const starter of x.packet.observations.comuniate.slice(0,2)) starter.probability=0;
   const before=structuredClone(x);
   assert.deepEqual(reviewPreflight(x.packet,x.review,x.roster),[]);
   const {payload}=compile(x.packet,x.review,x.roster,x.window);
   assert.deepEqual(payload.proposal.players.slice(0,2).map(p=>p.alternative.id),[player.id,player.id]);
   const signals=payload.sources.find(s=>s.id==='comuniate').player_observations.filter(o=>o.player_id===player.id);
   assert.deepEqual(signals,[{player_id:player.id,prediction:'alternative',probability}]);
   assert.deepEqual(x,before);
   source.alternatives[1].probability=40;
   x.packet.comuniate_alternatives.players=structuredClone(source.alternatives);
   assert.ok(reviewPreflight(x.packet,x.review,x.roster).some(i=>i.code==='source_duplicate'));
   assert.throws(()=>compile(x.packet,x.review,x.roster,x.window),/incompatibles/);
 }
});
