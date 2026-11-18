'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),{build}=require('../ideal-xi.js');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
function lineup(formation=[4,3,3],day=1){
 const positions=['PT',...formation.flatMap((n,i)=>Array(n).fill(['DF','MC','DL'][i]))];
 return {participant_name:'Ernesto',matchday:day,points:22,lineup:positions.map((position,i)=>({player_id:'p'+i,player_name:'Jugador '+i,position,slot_number:i+1,displayed_points:2,is_captain:false}))};
}
function setup(){
 const dom=new JSDOM(read('index.html'),{url:'https://league.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 w.fetch=()=>assert.fail('The historical XI must reuse the profile data without new reads');
 w.eval(read('ideal-xi.js'));
 w.eval(read('app.js').replace(/init\(\);\s*$/,`DATA=${read('data.json')};window.idealTest={buildProfileSeasonStats,profileSeasonIdealMarkup,openPlayer,setProfileSeasonSection,
  render(data){PROFILE_SEASON_STATE={name:data.name,status:'ready',section:'ideal',data};renderProfileSeasonContent();},
  state(){return PROFILE_SEASON_STATE;}};`));
 return {dom,w,api:w.idealTest};
}
test('historical XI uses the favourite formation and cumulative contributions including captain bonus exactly once',()=>{
 const {dom,api}=setup();try{
  const a=lineup([4,3,3],1),b=lineup([4,3,3],2),c=lineup([3,5,2],3);
  c.lineup.forEach(player=>{player.player_id='other-'+player.player_id;});
  a.lineup[8].displayed_points=30;a.lineup[8].is_captain=true;a.lineup[8].captain_multiplier=3;
  b.lineup[8].player_id='old-striker';b.lineup[8].player_name='Antiguo delantero';b.lineup[8].displayed_points=29;
  // A historical player remains eligible, with no reference to the current market roster.
  const data=api.buildProfileSeasonStats('Ernesto',[a,b,c]),before=JSON.stringify(data),xi=build(data);
  assert.equal(xi.formation,'4-3-3');assert.equal(xi.uses,2);assert.equal(xi.players.length,11);
  assert.deepEqual(xi.lines.map(x=>[x.position,x.players.length]),[['DL',3],['MC',3],['DF',4],['PT',1]]);
  assert.ok(xi.players.some(p=>p.playerId==='old-striker'));assert.equal(xi.players.find(p=>p.playerId==='p8').contributionPoints,30);
  assert.equal(new Set(xi.players.map(p=>p.key)).size,11);
  assert.equal(xi.total,xi.players.reduce((sum,p)=>sum+p.contributionPoints,0));assert.equal(JSON.stringify(data),before);
 }finally{dom.window.close();}
});
test('exact-score ties use appearances, then name; negative players can fill a required position; missing slots stay empty',()=>{
 const {dom,api}=setup();try{
  const data=api.buildProfileSeasonStats('Ernesto',[lineup()]);
  data.players=data.players.filter(p=>p.position!=='DL');
  data.players.push(...[['z','Zeta',10,1],['a','Alfa',10,1],['m','Más jornadas',10,2]].map(([key,playerName,contributionPoints,appearances])=>({key,playerId:key,playerName,contributionPoints,appearances,position:'DL'})));
  data.players.find(p=>p.position==='PT').contributionPoints=-4;
  const xi=build(data);assert.deepEqual(xi.lines[0].players.map(p=>p.playerId),['m','a','z']);assert.equal(xi.lines.at(-1).players[0].contributionPoints,-4);
  data.players=data.players.filter(p=>p.position!=='DF');const partial=build(data);assert.equal(partial.complete,false);assert.equal(partial.lines.find(l=>l.position==='DF').missing,4);
  const html=api.profileSeasonIdealMarkup(data);assert.equal((html.match(/is-empty/g)||[]).length,4);assert.match(html,/No hay suficientes/);
 }finally{dom.window.close();}
});
test('six midfielders, no forwards, formation ties and empty published seasons are handled without inventing a formation',()=>{
 const {dom,api}=setup();try{
  const data=api.buildProfileSeasonStats('Ernesto',[lineup([4,6,0])]);
  const xi=build(data);assert.equal(xi.complete,true);assert.equal(xi.formation,'4-6-0');assert.equal(xi.lines[0].players.length,6);assert.match(api.profileSeasonIdealMarkup(data),/--xi-cols:3/);
  const tied=api.buildProfileSeasonStats('Ernesto',[lineup([4,4,2]),lineup([3,5,2],2)]);
  assert.equal(build(tied).formation,tied.favoriteFormation.formation);
  assert.equal(build(api.buildProfileSeasonStats('Ernesto',[])),null);
  assert.equal(build({rows:[{players:Array(11).fill({position:'PT'})}],players:[]}),null);
 }finally{dom.window.close();}
});
test('Equipo opens on the XI, retains other tabs, escapes player names and rebuilds after a published correction',()=>{
 const {dom,w,api}=setup();try{
  api.openPlayer('Ernesto');assert.equal(api.state().section,'ideal');
  const row=lineup();row.lineup[8].player_name='<img src=x onerror=alert(1)>';
  const data=api.buildProfileSeasonStats('Ernesto',[row]);api.render(data);
  const d=w.document;assert.equal(d.querySelector('[data-profile-season-section="ideal"]').getAttribute('aria-selected'),'true');
  assert.equal(d.querySelectorAll('.profile-ideal-player').length,11);assert.equal(d.querySelector('[onerror]'),null);
  assert.ok([...d.querySelectorAll('.profile-ideal-name')].some(el=>el.textContent===row.lineup[8].player_name));
  assert.equal(d.querySelectorAll('[data-profile-season-section]').length,4);
  api.setProfileSeasonSection('players');assert.ok(d.querySelector('.profile-season-ranking'));api.setProfileSeasonSection('ideal');
  row.lineup[8].displayed_points=30;row.lineup[8].is_captain=true;row.lineup[8].captain_multiplier=3;
  api.render(api.buildProfileSeasonStats('Ernesto',[row]));assert.equal(d.querySelector('[data-ideal-player="p8"] .profile-ideal-points').textContent,'30');
  assert.equal(d.querySelector('.profile-ideal-total b').textContent,'50 pts');
 }finally{dom.window.close();}
});
test('historical XI assets load before app, are cached offline, and are refreshed with profile publications',()=>{
 const html=read('index.html'),sw=read('sw.js'),app=read('app.js');
 for(const file of ['ideal-xi.js','ideal-xi.css','app.js']){assert.ok(html.includes(file+'?v='+(file==='app.js'?'247-20261118-profile-chart':'246-20261118-ideal-xi')));assert.ok(sw.includes(file+'?v='+(file==='app.js'?'247-20261118-profile-chart':'246-20261118-ideal-xi')));}
 assert.ok(html.indexOf('<script src="ideal-xi.js')<html.indexOf('<script src="app.js'));
 assert.match(app,/if\(liveStatsChanged\)ensureProfileSeasonData\(\{force:true\}\)/);
});
