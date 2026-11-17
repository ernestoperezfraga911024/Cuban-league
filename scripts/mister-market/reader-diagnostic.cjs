'use strict';
// Only booleans, numeric league IDs, static labels and our source line numbers; never HTML or error messages.
function readSessionDiagnostic() {
 const visible=e=>!!e&&!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length);
 const active=document.querySelector('a.active[href*="action/change?id_community="]');
 const leagueId=active?new URL(active.href).searchParams.get('id_community'):null;
 return { activeLeagueId:/^[1-9]\d*$/.test(leagueId||'')?leagueId:null,activeLeague:!!document.querySelector('a.active[href*="action/change?id_community="]'),
  passwordForm:!!document.querySelector('input[type="password"]'),
  feed:!!document.querySelector('.feed-cards'), search:!!document.querySelector('.search-players-list'),
  consent:visible(document.querySelector('#didomi-notice')),
  filterPopup:visible(document.querySelector('#popup-content select[name="owner"]')) };
}
async function readerDiagnostic(error,page){
 const source=[...String(error.stack||'').matchAll(/[\/]scripts[\/]mister-market[\/]([a-z-]+\.cjs):(\d+):/g)]
  .slice(0,3).map(m=>({file:m[1],line:Number(m[2])}));
 const result={browserError:error.name==='TimeoutError'?'timeout':'other',source};
 if(!page)return result;
 try{const url=new URL(page.url());result.page=url.origin!=='https://mister.mundodeportivo.com'?'external':
  ['/feed','/search','/new-onboarding/','/login','/login/'].includes(url.pathname)?url.pathname:'other_mister_page';}catch{}
 let timer;
 try{result.state=await Promise.race([page.evaluate(readSessionDiagnostic),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),2000);})]);}
 catch{result.state=null;}finally{clearTimeout(timer);}
 return result;
}
module.exports={readerDiagnostic,readSessionDiagnostic};
