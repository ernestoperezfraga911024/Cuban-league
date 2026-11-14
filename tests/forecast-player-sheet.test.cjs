'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const {publication}=require('./fixtures/forecast-round.cjs');

function setup({native=false}={}){
 const dom=new JSDOM('<main><div id="host"></div><button id="outside">Fuera</button></main>',{runScripts:'outside-only',url:'https://test.invalid/'}),w=dom.window;
 if(native){
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 }
 for(const name of ['forecast-publish-core.js','forecast-round-config.js','forecast-round-core.js','forecast-pitch.js'])w.eval(fs.readFileSync(name,'utf8'));
 const host=w.document.getElementById('host'),p=publication('real-madrid');
 w.CubanForecastPitch.render(host,p,null);
 return {dom,w,host,p,button:host.querySelector('.fp-player'),sheet:host.querySelector('.fp-detail')};
}

test('modal controls and Escape restore focus without scrolling the pitch or changing its layout/data',()=>{
 for(const native of [false,true]){
  const b=setup({native});try{
   const before=JSON.stringify(b.p),order=[...b.host.querySelectorAll('.fp-player')].map(n=>n.dataset.playerId);
   for(const control of ['.fp-sheet-close','.fp-sheet-grip','.fp-link','Escape','cancel']){
    b.button.click();assert.equal(b.sheet.open,true);assert.equal(b.sheet.hidden,false);
    assert.equal(b.w.document.activeElement,b.sheet);assert.equal(b.sheet.getAttribute('aria-labelledby'),b.sheet.querySelector('h3').id);
    if(control==='Escape')b.sheet.dispatchEvent(new b.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    else if(control==='cancel')b.sheet.dispatchEvent(new b.w.Event('cancel',{cancelable:true}));
    else b.sheet.querySelector(control).click();
    assert.equal(b.sheet.open,false);assert.equal(b.sheet.hidden,true);assert.equal(b.sheet.children.length,0);
    assert.equal(b.w.document.activeElement,b.button);assert.equal(b.button.getAttribute('aria-pressed'),'false');
   }
   assert.deepEqual([...b.host.querySelectorAll('.fp-player')].map(n=>n.dataset.playerId),order);assert.equal(JSON.stringify(b.p),before);
  }finally{b.dom.window.close();}
 }
});

test('keyboard wraps inside the sheet and skips links in collapsed explanations',()=>{
 const b=setup();try{
  b.button.click();const first=b.sheet.querySelector('.fp-sheet-grip'),last=b.sheet.querySelector('.fp-link');
  b.sheet.dispatchEvent(new b.w.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));assert.equal(b.w.document.activeElement,last);
  last.dispatchEvent(new b.w.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));assert.equal(b.w.document.activeElement,first);
  first.dispatchEvent(new b.w.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));assert.equal(b.w.document.activeElement,last);
  assert.equal(b.sheet.querySelector('.fp-detail-method').open,false);
 }finally{b.dom.window.close();}
});

test('closing restores the original reading position after browser focus or scroll anchoring shifts it',()=>{
 const b=setup();try{
  b.w.scrollY=430;b.w.scrollTo=({top})=>{b.w.scrollY=top;};b.button.click();b.w.scrollY=457;
  b.sheet.querySelector('.fp-link').click();assert.equal(b.w.scrollY,430);
 }finally{b.dom.window.close();}
});

test('a backdrop gesture dismisses; clicking sheet padding or ending an inside gesture outside does not',()=>{
 const b=setup();try{
  b.button.click();b.sheet.getBoundingClientRect=()=>({left:50,top:50,right:350,bottom:650});
  const event=(type,x,y)=>b.sheet.dispatchEvent(new b.w.MouseEvent(type,{clientX:x,clientY:y,bubbles:true}));
  event('pointerdown',70,70);event('click',70,70);assert.equal(b.sheet.open,true);
  event('pointerdown',70,70);event('click',10,10);assert.equal(b.sheet.open,true);
  event('pointerdown',10,10);event('click',10,10);assert.equal(b.sheet.hidden,true);assert.equal(b.w.document.activeElement,b.button);
 }finally{b.dom.window.close();}
});

test('dragging the handle downward dismisses and pointer cancellation resets only the gesture',()=>{
 const b=setup();try{
  b.button.click();const handle=b.sheet.querySelector('.fp-sheet-grip');
  const event=(type,y)=>handle.dispatchEvent(new b.w.MouseEvent(type,{clientX:100,clientY:y,button:0,bubbles:true}));
  event('pointerdown',10);event('pointermove',50);assert.equal(b.sheet.style.getPropertyValue('--fp-drag-y'),'40px');
  event('pointercancel',50);assert.equal(b.sheet.style.getPropertyValue('--fp-drag-y'),'');assert.equal(b.sheet.open,true);
  event('pointerdown',10);event('pointerup',100);assert.equal(b.sheet.hidden,true);assert.equal(b.w.document.activeElement,b.button);
 }finally{b.dom.window.close();}
});

test('an external close releases selection; a queued close event cannot dismiss a newly opened player',()=>{
 const b=setup({native:true});try{
  b.button.click();b.sheet.close();assert.equal(b.sheet.hidden,true);assert.equal(b.w.document.activeElement,b.button);
  b.button.click();b.sheet.dispatchEvent(new b.w.Event('close'));assert.equal(b.sheet.open,true);
  b.w.CubanForecastPitch.render(b.host,b.p,null);assert.equal(b.sheet.isConnected,false);
  assert.equal(b.w.document.querySelectorAll('dialog[open]').length,0);
  b.host.querySelector('.fp-player').click();assert.equal(b.host.querySelector('dialog').open,true);
 }finally{b.dom.window.close();}
});

test('an alternative without a recorded estimate never inherits a score or a complementary percentage',()=>{
 const b=setup();try{
  const player=b.p.players.find(p=>p.alternative);b.host.querySelector('[data-player-id="'+player.id+'"]').click();
  const pair=b.sheet.querySelector('.fp-alternative-pair');assert.match(pair.textContent,/Sin estimación/);
  assert.equal(pair.querySelectorAll('.fp-alternative-copy strong').length,1);
  assert.equal(pair.querySelector('.fp-alternative-copy strong').textContent,player.probability+'%');
 }finally{b.dom.window.close();}
});
