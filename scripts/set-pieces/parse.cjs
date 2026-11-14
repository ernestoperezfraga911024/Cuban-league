'use strict';
const {JSDOM}=require('jsdom');
const {fold}=require('../../set-pieces-core.js');
const config=require('../../forecast-round-config.js');
const aliases={'barcelona':'fc-barcelona','betis':'real-betis','atletico':'atletico-madrid','alaves':'alaves','athletic':'athletic-club','celta':'celta-vigo','deportivo':'deportivo-la-coruna','racing':'racing-santander','osasuna':'osasuna','malaga':'malaga','elche':'elche','espanyol':'espanyol','getafe':'getafe','levante':'levante','sevilla':'sevilla','valencia':'valencia','villarreal':'villarreal'};
const teamFor=name=>aliases[fold(name)]||config.teams.find(t=>fold(t.name)===fold(name))?.id;
function identity(names,team,catalog){
 const normalized=names.map(n=>fold(n).replace(/\bjr\b/g,'junior')).filter(Boolean),eligible=catalog.players.filter(p=>p.active!==false&&p.club_id===team);
 // Reviewed nicknames, scoped to the existing club and identity. Never transfer a player.
 const nicknames={'real-betis':{cucho:'c-hernandez',antony:'a-santos'},'deportivo-la-coruna':{yeremay:'y-hernandez'},malaga:{chupe:'chupete'},osasuna:{aimar:'a-oroz'},'real-madrid':{trent:'t-alexander-arnold'},sevilla:{peque:'p-fernandez'}};
 const nickname=normalized.map(n=>nicknames[team]?.[n]).find(Boolean);if(nickname)return eligible.find(p=>p.id===nickname)||null;
 const exact=eligible.filter(p=>normalized.includes(fold(p.display_name))||p.full_name&&normalized.includes(fold(p.full_name)));
 if(exact.length)return exact.length===1?exact[0]:null;
 const abbreviated=s=>{const tokens=fold(s).split(' ');return tokens.length>1?tokens[0][0]+' '+tokens.slice(1).join(' '):s;};
 const matches=eligible.filter(p=>normalized.some(n=>abbreviated(n)===fold(p.display_name)||fold(p.display_name).replace(/^[a-z] /,'')===n||!n.includes(' ')&&fold(p.display_name).split(' ').at(-1)===n));
 return matches.length===1?matches[0]:null;
}
function player(name,slug,team,catalog,extra={}){
 if(!name||!slug||name.length>90||!/^[a-z0-9-]+$/.test(slug))throw Error('Invalid source player');
 const found=identity([name,slug.replace(/-/g,' ')],team,catalog);
 return {key:slug,name:found?.display_name||name,player_id:found?.id||null,preferred:false,attempts:null,scored:null,...extra};
}
function complete(teams,source){
 if(Object.keys(teams).length!==20||config.teams.some(t=>!teams[t.id]))throw Error(source+': expected 20 explicitly identified clubs');
 for(const roles of Object.values(teams))for(const entries of Object.values(roles))if(!entries.length||entries.length>8||new Set(entries.map(p=>p.key)).size!==entries.length)throw Error(source+': incomplete/duplicate role');
 return teams;
}
function parseJP(html,catalog){
 const dom=new JSDOM(html);try{
  const doc=dom.window.document,teams={},roles={'Penaltis':'penalties','F. directas':'direct_free_kicks','F. laterales':'wide_free_kicks'};
  if(!doc.querySelector('h1')?.textContent.includes('lanzadores'))throw Error('JP: unexpected page');
  for(const heading of doc.querySelectorAll('.title-block')){
   const name=heading.querySelector('span')?.textContent.trim();if(!name?.startsWith('Lanzadores '))continue;
   const team=teamFor(name.slice(11));if(!team||teams[team])throw Error('JP: unknown/duplicate club');
   const club={penalties:[],direct_free_kicks:[],wide_free_kicks:[]};
   const cards=heading.nextElementSibling;if(!cards?.classList.contains('row'))throw Error('JP: missing club card group');
   for(const card of cards.querySelectorAll('a.fifa-card')){
    const label=card.querySelector('span.capitalize')?.textContent.trim();if(label==='Córners')continue;
    const role=roles[label];if(!role)throw Error('JP: unexpected role');
    const url=new URL(card.href,'https://www.jornadaperfecta.com'),slug=/^\/jugador\/([a-z0-9-]+)\/$/.exec(url.pathname)?.[1];
    if(url.origin!=='https://www.jornadaperfecta.com')throw Error('JP: unexpected player URL');
    const name=card.querySelector('.name')?.getAttribute('title')?.replace(/^Nombre de /,'').trim()||card.querySelector('.name')?.textContent.trim();
    club[role].push(player(name,slug,team,catalog));
   }
   teams[team]=club;
  }
  return complete(teams,'JP');
 }finally{dom.window.close();}
}
function parseCM(html,catalog){
 const dom=new JSDOM(html);try{
  const doc=dom.window.document,teams={};
  if(!doc.querySelector('h1')?.textContent.includes('Penaltis'))throw Error('CM: unexpected page');
  for(const label of doc.querySelectorAll('.comu-team-mini__name')){
   const row=label.closest('.row');if(!row?.querySelector('img.img-circle'))continue;
   const team=teamFor(label.textContent.trim());if(!team||teams[team])throw Error('CM: unknown/duplicate club');
   const entries=[];
   for(const card of row.children){if(!card.classList.contains('col-md-4'))continue;
    const a=card.querySelector('a[href*="/jugadores/"]'),url=new URL(a?.href||'https://invalid.test');
    const slug=/^\/jugadores\/\d+\/([a-z0-9-]+)$/.exec(url.pathname)?.[1];if(url.origin!=='https://www.comuniate.com')throw Error('CM: unexpected player URL');
    const text=card.textContent,attempts=/Penaltis lanzados:\s*(\d+)/.exec(text),scored=/Penaltis anotados:\s*(\d+)/.exec(text);
    if(!attempts||!scored)throw Error('CM: missing penalty totals');
    entries.push(player(a.title||a.querySelector('img')?.alt,slug,team,catalog,{preferred:text.includes('Recomendación responsable'),attempts:Number(attempts[1]),scored:Number(scored[1])}));
   }
   teams[team]={penalties:entries};
  }
  return complete(teams,'CM');
 }finally{dom.window.close();}
}
module.exports={parseJP,parseCM,identity};
