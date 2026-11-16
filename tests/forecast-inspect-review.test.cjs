'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {parseSource,inspectReview}=require('../scripts/forecast/inspect-review.cjs');
const {example}=require('./fixtures/forecast-producer.cjs');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');

test('FF inspection scopes opponents and bench cards to the reviewed side without guessing percentages',()=>{
 const html=`<div class="fecha">LaLiga 2026/27 - Jornada 13</div>
 <section class="physical-status-widget local"><div class="elemento"><a class="jugador">Opponent</a><div class="datos">Opponent Baja</div></div></section>
 <section class="physical-status-widget visitante"><div class="elemento"><div class="datos"><a class="jugador">Target</a>Lesión muscular Baja hasta finales de noviembre</div></div></section>
 <div class="match-p11-side row-visitante" data-match-p11-team="2"><div data-onceff="titular" data-onceff-x="25%" data-onceff-y="30%"><span class="truncate-name">Target</span><span class="truncate-name">Replacement</span><span class="truncate-name">No percentage</span></div></div>
 <div class="match-p11-suplentes-side local" data-match-p11-team="1"><div data-onceff="suplente"><span class="truncate-name">Replacement</span><a data-probabilidad="90%"></a></div></div>
 <div class="match-p11-suplentes-side visitante" data-match-p11-team="2"><div data-onceff="suplente"><span class="truncate-name">Replacement</span><a data-probabilidad="0%"></a></div></div>`;
 const r=parseSource('futbolfantasy',html,{side:'visitante'});
 assert.deepEqual(r.health.map(x=>x.name),['Target']);
 assert.deepEqual(r.alternative_pairs.map(x=>[x.alternative,x.probability]),[['Replacement',0],['No percentage',null]]);
 assert.equal(r.fixture_text[0].text,'LaLiga 2026/27 - Jornada 13');
});

test('JP inspection keeps each side news and actual same-cell alternatives',()=>{
 const html=`<div class="campo-futbol"><table><tr><td><div class="campo-fila"><div class="player-name-pintar"><a>Opponent</a></div></div></td></tr></table></div>
 <div class="campo-futbol"><table><tr><td><div class="campo-fila"><div class="player-name-pintar"><a>Target</a></div><div class="alternatives-container"><div class="alternative"><div class="player-name-pintar"><a>Replacement</a></div> 40%</div></div></div></td></tr></table></div>
 <div class="partido-ultimas-noticias local"><ul><li><a href="/opponent"><span>Opponent lesionado</span></a></li></ul></div>
 <div class="partido-ultimas-noticias visitante"><ul><li><a href="/target"><span>Target hace una parte con el grupo</span><div class="partido-ultimas-noticias-fecha">Hace 3 días</div></a></li></ul></div>`;
 const r=parseSource('jornadaperfecta',html,{side:'visitante'});
 assert.deepEqual(r.news.map(n=>n.title),['Target hace una parte con el grupo']);
 assert.deepEqual(r.news[0].signals,['partial_training']);
 assert.deepEqual(r.alternative_pairs,[{starter:'Target',alternative:'Replacement',probability:40,x:50,y:0}]);
});

test('Comuniate labels and body can expose an internal conflict without declaring a medical outcome',()=>{
 const player=name=>`<div class="ficha-player"><div class="player-row"><a class="player-name">${name}</a><img class="player-status-icon" alt="TOCADO, DUDA"> Lesión muscular Baja</div></div>`;
 const html=`<div class="cm-lineup-col">${player('Opponent')}</div><div class="cm-lineup-col">${player('Target')}</div>`;
 const r=parseSource('comuniate',html,{side:'visitante'});
 assert.deepEqual(r.health.map(n=>n.name),['Target']);
 assert.deepEqual(r.health[0].signals,['doubt','out']);
 assert.equal(r.health[0].confirmed_out,undefined);
 const ambiguous=parseSource('comuniate',html.replace(/class="cm-lineup-col"/g,'class="unknown"'),{side:'visitante'});
 assert.deepEqual(ambiguous.health,[]);assert.equal(ambiguous.scope.health_scope_found,false);
});

test('inspection verifies captured body hash and reports cross-source conflict only as review evidence',()=>{
 const x=example(),html={
  ff:'<section class="physical-status-widget local"><div class="elemento"><div class="datos"><a class="jugador">Observed full name</a>Rotura fibrilar, baja</div></div></section>',
  cm:'<div class="ficha-player"><a class="player-name">Other observed name</a><img class="player-status-icon" alt="DUDA">Tocado</div>'
 };
 x.packet.docs={futbolfantasy:{path:'ff',sha256:hash(html.ff),fetched_at:x.window.notBefore,url:'https://www.futbolfantasy.com/partido/test'},comuniate_team:{path:'cm',sha256:hash(html.cm),fetched_at:x.window.notBefore,url:'https://www.comuniate.com/equipos/test'}};
 const request={packet:x.packet,roster:x.roster,identity_names:[],identity_reference:{}};
 const mappings={identities:{'Observed full name':x.roster[0].id,'Other observed name':x.roster[0].id}};
 const r=inspectReview(request,{review:mappings,readFile:p=>Buffer.from(html[p]),catalogPlayers:[]});
 assert.equal(r.fixture_verified,false);assert.equal(r.potential_availability_conflicts.length,1);
 assert.equal(r.potential_availability_conflicts[0].resolved_id,x.roster[0].id);
 assert.equal(r.potential_availability_conflicts[0].requires_review,true);
 const withoutMapping=inspectReview(request,{readFile:p=>Buffer.from(html[p]),catalogPlayers:[]});
 assert.deepEqual(withoutMapping.potential_availability_conflicts,[]);
 x.packet.docs.futbolfantasy.sha256='a'.repeat(64);
 const bad=inspectReview(request,{review:mappings,readFile:p=>Buffer.from(html[p]),catalogPlayers:[]});
 assert.equal(bad.errors[0].kind,'inspection_error');assert.equal(bad.sources.some(s=>s.source==='futbolfantasy'),false);
 assert.equal(bad.potential_availability_conflicts.length,0);
});
