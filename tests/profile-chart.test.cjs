'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
function setup(){
 const dom=new JSDOM(read('index.html'),{url:'https://league.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 w.fetch=()=>assert.fail('The chart reuses the published scores');
 w.eval(read('app.js').replace(/init\(\);\s*$/,`DATA=${read('data.json')};window.chartTest={profileCurrentSnapshot,profileFormCardMarkup,profileMatchdayScoreTone,openPlayer,refreshOpenProfileCurrentSummary,
 set(rows){LIVE_MATCHDAY_ROWS=normalizeMatchdayRows(rows);PUBLISHED_MATCHDAYS=[...new Set(LIVE_MATCHDAY_ROWS.map(r=>r.matchday))].sort((a,b)=>a-b);},
 render(){const snapshot=profileCurrentSnapshot('Ernesto');document.getElementById('modalContent').innerHTML=profileFormCardMarkup(snapshot);return snapshot;}};`));
 return {dom,w,api:w.chartTest};
}
const row=(matchday,points,name='Ernesto')=>({participant_name:name,matchday,points,goals:0,clean_sheets:0,red_cards:0});
test('all 38 published jornadas remain chronological, with exact totals and the season average',()=>{
 const {dom,w,api}=setup();try{
  const rows=Array.from({length:38},(_,i)=>row(i+1,i+40));const before=JSON.stringify(rows);
  api.set([...rows].reverse());const snapshot=api.render(),bars=w.document.querySelectorAll('.profile-chart-column');
  assert.equal(snapshot.matchdays.length,38);assert.equal(bars.length,38);
  assert.equal(bars[0].textContent,'40J1');assert.equal(bars[37].textContent,'77J38');
  assert.equal(w.document.querySelector('.profile-chart-footer b').textContent,'58,5');assert.equal(JSON.stringify(rows),before);
  assert.equal(w.document.querySelector('.profile-chart-scroll').tabIndex,0);
 }finally{dom.window.close();}
});
test('the exact thresholds include 100 as brilliant gold and never recolor rounded values',()=>{
 const {dom,api}=setup();try{
  for(const [points,tone] of [[-5,'red'],[0,'red'],[39,'red'],[39.9,'red'],[40,'orange'],[49,'orange'],[49.9,'orange'],[50,'green'],[79,'green'],[79.9,'green'],[80,'gold'],[99,'gold'],[99.9,'gold'],[100,'brilliant'],[120,'brilliant']])assert.equal(api.profileMatchdayScoreTone(points),tone);
 }finally{dom.window.close();}
});
test('pending rows stay visible without counting as zero; real zero and negative scores count in the mean',()=>{
 const {dom,w,api}=setup();try{
  api.set([row(1,100),row(2,0,'Yovany R9'),row(3,0),row(4,-20)]);api.render();
  const d=w.document,chart=d.querySelector('.profile-score-chart');
  assert.equal(d.querySelectorAll('.profile-chart-column').length,4);assert.equal(d.querySelector('.profile-chart-column.is-pending b').textContent,'—');
  assert.match(d.querySelector('.profile-chart-column.is-pending').getAttribute('aria-label'),/pendiente/);
  assert.equal(d.querySelector('.profile-chart-column.is-negative b').textContent,'-20');
  assert.equal(d.querySelector('.profile-chart-footer b').textContent,'26,7');
  assert.ok(parseFloat(chart.style.getPropertyValue('--chart-baseline'))>0);
  assert.equal(d.querySelectorAll('.is-red.profile-chart-column').length,2);
  api.set([]);api.render();assert.match(d.getElementById('profileCurrentForm').textContent,/Todavía no hay jornadas/);
 }finally{dom.window.close();}
});
test('an open profile updates the whole chart after corrections without adding captain bonus again or losing scroll',()=>{
 const {dom,w,api}=setup();try{
  const rows=Array.from({length:12},(_,i)=>row(i+1,50));api.set(rows);api.openPlayer('Ernesto');
  const scroll=w.document.querySelector('.profile-chart-scroll');scroll.scrollLeft=120;scroll.focus();
  rows[0].points=105;api.set(rows);api.refreshOpenProfileCurrentSummary();
  const d=w.document;assert.equal(d.querySelector('.profile-chart-column b').textContent,'105');assert.ok(d.querySelector('.profile-chart-column.is-brilliant'));
  assert.equal(d.querySelector('.profile-chart-footer b').textContent,'54,6');
  assert.equal(d.querySelector('.profile-chart-scroll').scrollLeft,120);assert.equal(d.activeElement,d.querySelector('.profile-chart-scroll'));
 }finally{dom.window.close();}
});
