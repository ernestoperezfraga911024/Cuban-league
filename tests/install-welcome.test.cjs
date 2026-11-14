'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const read=name=>fs.readFileSync(name,'utf8');
function setup({standalone=false,ios=false,stored=false,dismissed=false,blocked=false,native=true}={}){
  const dom=new JSDOM(read('index.html'),{runScripts:'outside-only',url:'https://test.invalid/Cuban-league/',pretendToBeVisual:true}),w=dom.window;
  w.scrollTo=()=>{};
  w.matchMedia=query=>({matches:standalone&&query==='(display-mode: standalone)',addEventListener(){}});
  if(ios)Object.defineProperty(w.navigator,'standalone',{value:true});
  if(stored)w.localStorage.setItem('cuban-install-confirmed-v1','1');
  if(dismissed)w.sessionStorage.setItem('cuban-install-welcome-session-v1','1');
  if(blocked)for(const type of ['localStorage','sessionStorage'])Object.defineProperty(w,type,{get(){throw Error('Denied');}});
  if(native){
    w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
    w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
  }
  w.eval(read('install-welcome.js'));
  w.eval(read('app.js').replace(/init\(\);\s*$/,`window.installTest={setupPWA,requestInstall,closeInstallGuide};`));
  w.installTest.setupPWA();
  return {dom,w,doc:w.document,api:w.CubanInstallWelcome,dialog:w.document.getElementById('installWelcome')};
}
const cleanup=async(options,fn)=>{const b=setup(options);try{await fn(b);}finally{b.dom.window.close();}};

test('unknown installation shows the welcome without waiting for data or an install prompt',()=>cleanup({},({doc,dialog})=>{
  assert.equal(dialog.open,true);
  assert.equal(doc.activeElement.id,'installWelcomeClose');
  assert.equal(doc.querySelector('#installWelcomeCrest').getAttribute('src'),'install-crest-3d.webp');
  assert.doesNotMatch(dialog.textContent,/Tu liga,?\s*a un toque/i);
}));

test('standalone, iOS installed launch, local confirmation and session dismissal suppress assets and welcome',async()=>{
  for(const options of [{standalone:true},{ios:true},{stored:true},{dismissed:true}])await cleanup(options,({doc,dialog,w})=>{
    assert.equal(dialog.open,false);
    assert.equal(doc.querySelector('#installWelcomeCrest').hasAttribute('src'),false);
    if(options.standalone||options.ios){assert.equal(doc.querySelector('#installApp').hidden,true);assert.equal(w.localStorage.getItem('cuban-install-confirmed-v1'),'1');}
  });
});

test('close and Escape release deferred profile selection; dismissal is not installation',async()=>{
  for(const control of ['button','cancel'])await cleanup({},({doc,dialog,api,w})=>{
    let opened=0;api.whenReady(()=>opened++);assert.equal(opened,0);
    if(control==='button')doc.querySelector('#installWelcomeClose').click();
    else dialog.dispatchEvent(new w.Event('cancel',{cancelable:true}));
    assert.equal(dialog.open,false);assert.equal(opened,1);assert.equal(doc.body.classList.contains('install-welcome-open'),false);
    assert.equal(w.sessionStorage.getItem('cuban-install-welcome-session-v1'),'1');assert.equal(w.localStorage.getItem('cuban-install-confirmed-v1'),null);
  });
});

test('manual install hands off to the existing guide, then opens the queued profile once',()=>cleanup({},async({doc,dialog,api,w})=>{
  let opened=0;api.whenReady(()=>opened++);
  doc.querySelector('#installWelcomeAction').click();await Promise.resolve();await Promise.resolve();
  assert.equal(dialog.open,false);assert.equal(doc.querySelector('#installModal').hidden,false);assert.equal(opened,0);
  assert.equal(doc.querySelector('#installTitle').textContent,'Instalar Cuban League');
  w.installTest.closeInstallGuide();assert.equal(opened,1);
  assert.equal(w.localStorage.getItem('cuban-install-confirmed-v1'),null);
}));

test('the real profile picker waits behind the welcome and guide without stacking dialogs',()=>cleanup({},async({doc,w})=>{
  w.requestAnimationFrame=callback=>callback();
  w.eval(read('viewer-profile.js'));
  w.CubanLeagueViewer.init([{id:1,name:'Participante',active:true}]);
  assert.equal(doc.querySelector('#viewerDialog').open,false);
  doc.querySelector('#installWelcomeAction').click();
  for(let i=0;i<4;i++)await Promise.resolve();
  assert.equal(doc.querySelector('#viewerDialog').open,false);
  w.installTest.closeInstallGuide();
  assert.equal(doc.querySelector('#viewerDialog').open,true);
  assert.equal(doc.querySelector('#installWelcome').open,false);
  assert.equal(doc.querySelector('#installModal').hidden,true);
}));

test('native prompt runs once, a rejected prompt falls back, and accepted choice alone is not install proof',async()=>{
  for(const result of ['accepted','dismissed','throw'])await cleanup({},async({doc,w,api})=>{
    let calls=0,released=0;
    const event=new w.Event('beforeinstallprompt',{cancelable:true});
    event.prompt=async()=>{calls++;if(result==='throw')throw Error('Expired prompt');};
    event.userChoice=Promise.resolve({outcome:result});w.dispatchEvent(event);
    api.whenReady(()=>released++);doc.querySelector('#installWelcomeAction').click();
    for(let i=0;i<8;i++)await Promise.resolve();
    assert.equal(calls,1);assert.equal(doc.querySelector('#nativeInstall').hidden,true);
    assert.equal(doc.querySelector('#installModal').hidden,result!=='throw');assert.equal(released,result==='throw'?0:1);
    assert.equal(w.localStorage.getItem('cuban-install-confirmed-v1'),null);
  });
});

test('appinstalled hides the invitation and records only a browser-local hint; a new offer clears it',()=>cleanup({},({w,dialog})=>{
  w.dispatchEvent(new w.Event('appinstalled'));assert.equal(dialog.open,false);assert.equal(w.localStorage.getItem('cuban-install-confirmed-v1'),'1');
  w.dispatchEvent(new w.Event('beforeinstallprompt',{cancelable:true}));assert.equal(w.localStorage.getItem('cuban-install-confirmed-v1'),null);
}));

test('blocked storage never blocks closing; unsupported dialogs leave the existing install button usable',async()=>{
  await cleanup({blocked:true},({doc,dialog})=>{assert.equal(dialog.open,true);doc.querySelector('#installWelcomeClose').click();assert.equal(dialog.open,false);});
  await cleanup({native:false},async({w,doc,dialog})=>{assert.equal(dialog.open,false);assert.equal(doc.querySelector('#installApp').hidden,false);await w.installTest.requestInstall();assert.equal(doc.querySelector('#installModal').hidden,false);});
});

test('the welcome is public-only, versioned offline shell includes logic, decorative assets stay on demand',()=>{
  const html=read('index.html'),sw=read('sw.js');
  for(const name of ['install-welcome.js','install-welcome.css','app.js','viewer-profile.js']){assert.ok(html.includes(name+'?v=229-20261114'));assert.ok(sw.includes(name+'?v=229-20261114'));}
  assert.doesNotMatch(read('admin.html'),/installWelcome|install-welcome/);
  assert.doesNotMatch(sw,/['"]\.\/install-(stadium|crest-3d)\.webp/);
  assert.ok(fs.statSync('install-stadium.webp').size+fs.statSync('install-crest-3d.webp').size<160000);
});
