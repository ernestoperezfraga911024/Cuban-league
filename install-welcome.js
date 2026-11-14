/* Installation welcome: local browser signals, no accounts or server tracking. */
(() => {
  'use strict';
  const INSTALLED_KEY='cuban-install-confirmed-v1';
  const DISMISSED_KEY='cuban-install-welcome-session-v1';
  const $=id=>document.getElementById(id);
  const read=(storage,key)=>{try{return window[storage].getItem(key)==='1';}catch{return false;}};
  const write=(storage,key,value)=>{try{if(value)window[storage].setItem(key,'1');else window[storage].removeItem(key);}catch{}};
  const isStandalone=()=>navigator.standalone===true||['standalone','minimal-ui'].some(mode=>window.matchMedia?.(`(display-mode: ${mode})`).matches);
  let initialized=false,handoff=false,returnFocus=null,requestInstall=null;
  const waiting=[];
  const busy=()=>$('installWelcome')?.open||handoff||Boolean($('installModal')&&!$('installModal').hidden);
  function resume(){
    if(busy())return;
    for(const callback of waiting.splice(0))callback();
  }
  function whenReady(callback){if(busy())waiting.push(callback);else callback();}
  function close({remember=true}={}){
    const dialog=$('installWelcome');
    if(remember)write('sessionStorage',DISMISSED_KEY,true);
    if(dialog?.open)dialog.close();
    document.body.classList.remove('install-welcome-open');
    document.documentElement.classList.remove('install-welcome-open');
    if(returnFocus?.isConnected&&returnFocus!==document.body)returnFocus.focus({preventScroll:true});
    else if(!$('installApp')?.hidden)$('installApp')?.focus({preventScroll:true});
    returnFocus=null;
    resume();
  }
  function installed(){
    write('localStorage',INSTALLED_KEY,true);
    close({remember:false});
  }
  function available(){
    // A fresh install offer supersedes an old local hint (e.g. after uninstalling).
    write('localStorage',INSTALLED_KEY,false);
  }
  function init(options){
    if(initialized)return;
    initialized=true;requestInstall=options.requestInstall;
    for(const mode of ['standalone','minimal-ui']){
      const media=window.matchMedia?.(`(display-mode: ${mode})`);
      const changed=()=>{if(isStandalone())installed();};
      if(media?.addEventListener)media.addEventListener('change',changed);
      else media?.addListener?.(changed);
    }
    if(isStandalone()){installed();return;}
    const dialog=$('installWelcome');
    // Older browsers keep the normal page and its existing installation button.
    if(!dialog||typeof dialog.showModal!=='function'||read('localStorage',INSTALLED_KEY)||read('sessionStorage',DISMISSED_KEY))return;
    $('installWelcomeClose').onclick=()=>close();
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    dialog.addEventListener('close',()=>{
      if(dialog.open)return;
      document.body.classList.remove('install-welcome-open');
      document.documentElement.classList.remove('install-welcome-open');
      resume();
    });
    $('installWelcomeAction').onclick=async()=>{
      if(handoff)return;
      handoff=true;close();
      try{await requestInstall();}finally{handoff=false;resume();}
    };
    // Decorative assets are requested only when this screen will actually appear.
    const crest=$('installWelcomeCrest');
    crest.src=crest.dataset.src;
    returnFocus=document.activeElement;
    dialog.showModal();
    document.body.classList.add('install-welcome-open');
    document.documentElement.classList.add('install-welcome-open');
    $('installWelcomeClose').focus({preventScroll:true});
  }
  window.CubanInstallWelcome=Object.freeze({init,isStandalone,installed,available,whenReady,resume});
})();
