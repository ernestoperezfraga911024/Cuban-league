const {test} = require('node:test');
const assert = require('node:assert/strict');
const core = require('../mister-import-core.js');
const stats = values => Object.fromEntries(Object.entries(values).map(([k,v])=>[k,{value:v,rating:k==='goalsAgainst'?4:0}]));
test('no jugó, pendiente y dato ilegible tienen estados distintos', () => {
  assert.deepEqual(core.points('—'),{value:0,status:'did-not-play',didPlay:false});
  assert.deepEqual(core.points('',true),{value:0,status:'pending',didPlay:null});
  assert.throws(()=>core.points('')); assert.throws(()=>core.points('cargando')); assert.throws(()=>core.points('3 goles'));
  assert.equal(core.points('−2').value,-2); assert.equal(core.points('7,5').value,7.5);
});
test('estadísticas explícitas: roja doble no duplica, portero sin jugar no recibe CS', () => {
  const data = stats({goals:2,redCard:1,doubleYellowCard:1,minutesPlayed:90,goalsAgainst:0});
  assert.deepEqual(core.statistics(data,'PT'),{goals:2,cleanSheet:1,redCard:1});
  assert.equal(core.statistics(data,'DF').cleanSheet,0);
  data.minutesPlayed.value=0; assert.equal(core.statistics(data,'PT').cleanSheet,0);
  delete data.goals; assert.equal(core.statistics(data,'PT').goals,null);
  assert.deepEqual(core.statistics(null,'PT'),{goals:null,cleanSheet:null,redCard:null});
});
function lineup() { return Array.from({length:11},(_,i)=>({misterPlayerId:String(i+1),position:i===0?'PT':i<4?'DF':i<8?'MC':'DL',displayedPoints:2,isCaptain:false,captainMultiplier:1,didPlay:true,status:'scored',goals:i===10?1:0,cleanSheet:i===0?1:0,redCard:0})); }
test('puntos del capitán ya multiplicados y estadísticas sin multiplicar', () => {
  for (const factor of [1.5,2,3]) {
    const xi=lineup();xi[10].isCaptain=true;xi[10].captainMultiplier=factor;xi[10].displayedPoints=2*factor;
    const total=20+2*factor;const result=core.summarize(xi,total);
    assert.equal(result.points,total);assert.equal(result.goals,1);assert.equal(result.cleanSheets,1);assert.deepEqual(result.warnings,[]);
  }
});
test('sin capitán, negativos y discrepancias de origen', () => {
  assert.deepEqual(core.summarize(lineup(),22).warnings,[]);
  assert.match(core.summarize(lineup(),23).warnings[0],/22.*23/);
  assert.deepEqual(core.summarize(lineup(),0,true),{points:0,goals:0,cleanSheets:0,redCards:0,negativeBalanceNoScore:true,lineup:[],warnings:[]});
  assert.throws(()=>core.summarize(lineup(),1,true));
  const duplicate=lineup();duplicate[10].misterPlayerId='1';assert.throws(()=>core.summarize(duplicate,22));
});
test('reimportar sustituye, no suma; protege cambios y otro dispositivo', () => {
  const base={points:51,goals:1,clean_sheets:0,red_cards:0,lineup:[]};
  const incoming={...base,points:55};
  assert.equal(core.conflict(base,incoming,base,true),false);
  assert.equal(core.conflict({...base,goals:2},incoming,base,true),true);
  assert.equal(core.conflict(base,incoming,null,true),true);
  assert.equal(core.conflict(incoming,incoming,null,true),false);
  assert.equal(core.conflict({points:null,lineup:[]},incoming,null,true),false);
});
