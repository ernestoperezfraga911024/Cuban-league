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

test('Celta regression reports every starter-alternative duplicate and preserves original evidence',()=>{
 const x=example();
 x.review.sources.futbolfantasy.alternatives.push(...x.packet.observations.futbolfantasy.slice(0,2));
 const before=structuredClone(x),issues=reviewPreflight(x.packet,x.review,x.roster);
 assert.deepEqual(issues.filter(i=>i.code==='source_duplicate').map(i=>i.id),x.roster.slice(0,2).map(p=>p.id));
 assert.deepEqual(x,before);
 assert.throws(()=>compile(x.packet,x.review,x.roster,x.window),/observación duplicada/);
 // A reviewed omission must remove both redundancies, not only the first issue.
 x.review.sources.futbolfantasy.alternatives.pop();
 assert.equal(reviewPreflight(x.packet,x.review,x.roster).filter(i=>i.code==='source_duplicate').length,1);
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
