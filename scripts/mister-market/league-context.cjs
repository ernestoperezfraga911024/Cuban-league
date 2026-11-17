'use strict';
const { ORIGIN, fail } = require('./core.cjs');
function readLeagueDocument(){
 const active=document.querySelector('a.active[href*="action/change?id_community="]');
 return {leagueId:active?new URL(active.href).searchParams.get('id_community'):null,
  links:[...document.querySelectorAll('a[href*="action/change?id_community="]')].map(a=>a.href)};
}
async function selectLeague(page,config,{wait,progress=()=>{}}){
 const before=await wait(()=>page.evaluate(readLeagueDocument),s=>!!s.leagueId,{stableFor:300,label:'active_league'});
 if(before.leagueId===config.leagueId)return false;
 const targets=(before.links||[]).flatMap(href=>{
  try{const u=new URL(href);return u.origin===ORIGIN&&u.pathname==='/action/change'
   &&u.searchParams.get('id_community')===config.leagueId&&[...u.searchParams.keys()].length===1
   &&!u.hash&&!u.username&&!u.password?[u.href]:[];}catch{return [];}
 });
 if(!targets.length)fail('target_league_unavailable');
 progress({phase:'market',step:'select_target_league',previousLeagueId:before.leagueId,targetLeagueId:config.leagueId});
 // Follow only the existing account link for the configured league; no guessed route or new access.
 await page.goto(targets[0],{waitUntil:'domcontentloaded',timeout:30000});
 if(new URL(page.url()).origin!==ORIGIN)fail('session_or_page_unavailable');
 await wait(()=>page.evaluate(readLeagueDocument),s=>s.leagueId===config.leagueId,{stableFor:300,label:'selected_league'});
 return true;
}
module.exports={selectLeague,readLeagueDocument};
