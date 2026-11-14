'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {orderSelection}=require('../scripts/forecast/lineup-layout.cjs');
const {layout}=require('../scripts/forecast/collect-team.cjs');
const {compile}=require('../scripts/forecast/editorial-producer.cjs');
const {example}=require('./fixtures/forecast-producer.cjs');
const {apply,incidents}=require('../forecast-layout-repair.js');
const round=require('../forecast-round-core.js');
const ordered=x=>orderSelection(x.packet,x.review.selection,name=>x.roster.find(p=>p.name===name)?.id);
test('geometry uses FF coordinates and JP table cells, independently of DOM starter order',()=>{
 const ff='<div class="match-p11-side row-local"><div data-onceff="titular" data-onceff-x="89%" data-onceff-y="27%"><b class="truncate-name">Right</b><i class="truncate-name">Right alternative</i></div><div data-onceff="titular" data-onceff-x="11%" data-onceff-y="27%"><b class="truncate-name">Left</b></div></div>';
 assert.deepEqual(layout(ff,'futbolfantasy','local').map(p=>[p.name,p.x,p.kind]),[['Right',89,'starter'],['Right alternative',89,'alternative'],['Left',11,'starter']]);
 assert.deepEqual(layout(ff,'futbolfantasy','visitante'),[]);
 const cell=name=>`<td><div class="campo-fila"><div class="player-name-pintar"><a>${name}</a></div><div class="alternatives-container"><div class="alternative"><span>Sub ${name} 40%</span></div></div></div></td>`;
 const jp=`<div class="campo-futbol"><table><tr>${cell('Left')}${cell('Right')}</tr></table><table><tr>${cell('Keeper')}</tr></table></div>`;
 assert.deepEqual(layout(jp,'jornadaperfecta','local').map(p=>[p.name,p.x,p.y]),[['Left',25,0],['Sub Left',25,0],['Right',75,0],['Sub Right',75,0],['Keeper',50,1],['Sub Keeper',50,1]]);
});
test('all seven formations order each row left to right, preserving choices and alternatives',()=>{
 for(const formation of round.formations){const x=example(),choices=x.review.selection.players;
  x.review.selection.formation=formation;let off=0;
  const sizes=[1,...formation.split('-').map(Number)];
  x.packet.layouts.jornadaperfecta.points=sizes.flatMap((count,y)=>Array.from({length:count},(_,i)=>({name:x.roster[off++].name,kind:'starter',x:100*(i+.5)/count,y})));
  x.review.selection.layout.rows=sizes.map(()=>({source:'jornadaperfecta',sha256:'a'.repeat(64)}));
  off=0;x.review.selection.players=sizes.flatMap(count=>{const row=choices.slice(off,off+count).reverse();off+=count;return row;});
  const before=structuredClone(x),result=ordered(x);assert.deepEqual(result.players,choices);assert.deepEqual(x,before);assert.equal(result.audit.reordered,true);
 }
});
test('producer fixes mirrored selection without changing individual scores, candidates or provenance',()=>{
 const x=example(),expected=compile(x.packet,x.review,x.roster,x.window);let off=0;
 x.review.selection.players=[1,4,2,3,1].flatMap(n=>{const row=x.review.selection.players.slice(off,off+n).reverse();off+=n;return row;});
 const actual=compile(x.packet,x.review,x.roster,x.window);
 assert.deepEqual(actual.payload,expected.payload);assert.deepEqual(actual.fixture,expected.fixture);assert.equal(actual.layout.reordered,true);
});
test('unverified, absent, tied or stale geometry remains pending instead of fabricating positions',()=>{
 for(const change of [x=>delete x.review.selection.layout,x=>x.review.selection.layout.rows[1].sha256='old',x=>x.packet.layouts.jornadaperfecta.fetched_at='old',x=>x.packet.layouts.jornadaperfecta.points[1].x=NaN,x=>x.packet.layouts.jornadaperfecta.points[2].x=x.packet.layouts.jornadaperfecta.points[1].x,x=>x.packet.layouts.jornadaperfecta.points.splice(1,1)]){
  const x=example();change(x);assert.throws(()=>ordered(x),/colocación pendiente/);
 }
});
test('an explicit replacement can occupy an absent player, never an occupied or already observed slot',()=>{
 const x=example();x.review.selection.players[1]={id:x.roster[11].id};
 assert.throws(()=>ordered(x),/sin posición observada/);
 x.review.selection.layout.rows[1].anchors=[{id:x.roster[11].id,source_name:x.roster[1].name,reason:'Sustitución revisada del lateral ausente.'}];
 assert.equal(ordered(x).players[1].id,x.roster[11].id);
 x.review.selection.layout.rows[1].anchors[0].source_name=x.roster[2].name;assert.throws(()=>ordered(x),/ancla ocupada/);
 x.review.selection.players[1]={id:x.roster[1].id};x.review.selection.layout.rows[1].anchors[0].id=x.roster[1].id;assert.throws(()=>ordered(x),/injustificada/);
});
test('an optional player with unavailable geometry cannot prevent placement of a complete XI',()=>{
 const x=example();x.packet.layouts.jornadaperfecta.points.push({name:x.roster[12].name,kind:'alternative',x:NaN,y:NaN});
 assert.deepEqual(ordered(x).players,x.review.selection.players);
});
function historical(r){return {schema_version:4,method_version:'editorial-v5',team:r.team,fixture_key:r.fixture,formation:r.formation,evidence_at:r.evidence_at,note:'Historical regression only; never new source evidence.',candidates:[{id:'test-candidate',probability:31}],players:r.input.map((id,i)=>({id,slot:i+1,position:round.position(r.formation,i+1),probability:r.probabilities[i],alternative:null,reason:'Unchanged historical observation.'}))};}
test('incident repair covers exactly 20 clubs and 220 players without touching source objects or non-slot data',()=>{
 assert.equal(incidents.length,20);assert.equal(new Set(incidents.map(r=>r.team)).size,20);
 assert.deepEqual(incidents.map(r=>r.team).sort(),round.config.teams.map(t=>t.id).sort());
 for(const r of incidents){const p=historical(r),before=structuredClone(p),fixed=apply(p,{publishedAt:r.published_at});
  assert.notEqual(fixed,p);assert.deepEqual(p,before);assert.deepEqual(fixed.players.map(p=>p.id),r.target);
  assert.deepEqual({...fixed,players:[]},{...p,players:[]});
  for(const player of fixed.players){const old=p.players.find(p=>p.id===player.id);assert.deepEqual({...player,slot:old.slot},old);assert.equal(player.position,round.position(fixed.formation,player.slot));}
  for(const slots of round.lines(r.formation))assert.deepEqual(slots.map(s=>p.players[s-1].id).sort(),slots.map(s=>fixed.players[s-1].id).sort());
  assert.equal(apply(fixed),fixed); // already corrected is a no-op
 }
});
test('display repair cannot affect a new publication, new evidence, changed XI, changed probability or legacy method',()=>{
 for(const r of incidents){const p=historical(r);
  assert.equal(apply(p,{publishedAt:'2026-11-15T12:00:00Z'}),p);
  for(const change of [p=>p.evidence_at='2026-11-15T12:00:00Z',p=>p.method_version='editorial-v4',p=>p.players[1].id='different-player',p=>p.players[1].probability++]){const changed=structuredClone(p);change(changed);assert.equal(apply(changed),changed);}
 }
});
test('reviewed wings and unchanged Sevilla attack protect against a blanket reverse',()=>{
 const fixed=t=>apply(historical(incidents.find(r=>r.team===t))).players.map(p=>p.id);
 assert.deepEqual(fixed('real-madrid').slice(7,10),['y-diomande','j-bellingham','a-guler']);
 assert.deepEqual(fixed('athletic-club').slice(7,10),['n-williams','o-sancet','a-berenguer']);
 assert.deepEqual(fixed('fc-barcelona').slice(7,10),['a-gordon','f-lopez','l-yamal']);
 assert.deepEqual(fixed('elche').slice(7,10),['g-valera','f-buonanotte','l-cepeda']);
 const s=incidents.find(r=>r.team==='sevilla');assert.deepEqual(fixed('sevilla').slice(5),s.input.slice(5));
 assert.deepEqual(fixed('villarreal').slice(8),['a-moleiro','g-mikautadze','t-buchanan']);
});
test('public, admin and offline shell load the repair before the shared pitch with fresh asset versions',()=>{
 for(const name of ['index.html','admin.html']){const html=fs.readFileSync(name,'utf8');assert.ok(html.indexOf('forecast-layout-repair.js?v=225')<html.indexOf('forecast-pitch.js?v=225'));}
 const sw=fs.readFileSync('sw.js','utf8');assert.match(sw,/cuban-league-v226-set-pieces/);assert.match(sw,/forecast-layout-repair.js\?v=225/);assert.match(sw,/forecast-pitch.js\?v=225/);
});
