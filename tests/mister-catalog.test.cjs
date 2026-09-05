const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const observedRoster = require('./fixtures/mister-roster-20260905.json');

test('los 522 futbolistas observados en Mister resuelven por ID con su club y posición',async()=>{
  const {dom,catalog:c}=await catalog();
  try {
    assert.equal(observedRoster.paginationComplete,true);
    assert.equal(observedRoster.players.length,522);
    const problems=[];
    const identities=new Set();
    for (const raw of observedRoster.players) {
      const club=c.clubsByMisterId.get(raw.misterClubId);
      const found=c.resolveMister({...raw,clubId:club?.id});
      if (!found || found.misterId!==raw.misterPlayerId || found.clubId!==club.id || found.position!==raw.position || identities.has(found.id)) {
        problems.push(raw.playerName+' / '+raw.misterPlayerId);
      }
      if (found) identities.add(found.id);
    }
    assert.deepEqual(problems,[]);
  } finally {dom.window.close();}
});

async function catalog() {
  const dom=new JSDOM('',{url:'https://ernestoperezfraga911024.github.io/Cuban-league/',runScripts:'outside-only'});
  dom.window.fetch=async()=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(require.resolve('../catalog/players.json'),'utf8'))});
  dom.window.eval(fs.readFileSync(require.resolve('../player-catalog.js'),'utf8'));
  return {dom,catalog:await dom.window.CubanLeaguePlayerCatalog.load()};
}
test('identidad Mister distingue homónimos y conserva los identificadores del historial',async()=>{
  const {dom,catalog:c}=await catalog();
  try {
    assert.equal(c.resolve({misterPlayerId:'55743',playerName:'C. Romero'}).id,'c-romero');
    assert.equal(c.resolve({misterPlayerId:'1385821',playerName:'C. Romero'}).id,'c-romero-atletico');
    assert.equal(c.resolve({playerId:'c-romero'}).clubId,'villarreal');
    assert.equal(c.resolve({misterPlayerId:'28779',playerName:'I. Romero'}).id,'i-romero');
    assert.equal(c.resolve({misterPlayerId:'56632',playerName:'I. Romero'}).id,'i-romero-sevilla');
    assert.equal(c.resolve({playerName:'C. Romero'}),null);
    assert.equal(c.resolve({misterPlayerId:'999999',playerName:'C. Romero'}),null);
    assert.equal(c.search('Cristian Romero')[0].clubId,'atletico-madrid');
    assert.equal(c.search('Carlos Romero')[0].clubId,'villarreal');
    assert.equal(c.recordCount,569);
    assert.equal(c.resolve({misterPlayerId:'1396108'}).id,'mister-1396108');
    assert.equal(c.resolve({misterPlayerId:'61009'}).id,'a-ortiz');
    assert.equal(c.resolve({misterPlayerId:'2586746'}).id,'mister-2586746');
    assert.equal(c.resolve({misterPlayerId:'59089'}).id,'a-padilla');
    assert.equal(c.resolve({misterPlayerId:'71503'}).id,'m-rodriguez-alaves-2');
    assert.equal(c.resolve({misterPlayerId:'24691'}).id,'m-rodriguez');
  } finally { dom.window.close(); }
});

test('clubes explícitos y resolución de importación impiden inferencias y cruces de homónimos',async()=>{
  const {dom,catalog:c}=await catalog();
  try {
    assert.equal(c.clubsByMisterId.size,20);
    assert.equal(c.clubsByMisterId.get('14').id,'rayo-vallecano');
    const cardenas=c.resolveMister({misterPlayerId:'24742',playerName:'D. Cárdenas',clubId:'rayo-vallecano',position:'PT'});
    assert.equal(cardenas.id,'d-cardenas');
    assert.equal(cardenas.photo,'catalog/faces/d-cardenas.webp');
    assert.equal(c.resolveMister({misterPlayerId:'58958',playerName:'P. Fernández',clubId:'rayo-vallecano',position:'DF'}).id,'p-fernandez-rayo-vallecano');
    assert.equal(c.resolveMister({misterPlayerId:'4947929',playerName:'E. Audero',clubId:'rayo-vallecano',position:'PT'}).id,'emil-audero');
    assert.equal(c.resolveMister({misterPlayerId:'3848779',playerName:'G. Bouare',clubId:'rayo-vallecano',position:'MC'}).id,'g-bouare');
    assert.equal(c.resolveMister({misterPlayerId:'999999',playerName:'C. Romero',clubId:'atletico-madrid',position:'DF'}),null);
    assert.equal(c.resolveMister({misterPlayerId:'999999',playerName:'Koke',clubId:'rayo-vallecano',position:'MC'}),null);
    assert.equal(c.resolveMister({misterPlayerId:'24742',playerName:'D. Cárdenas',clubId:'unknown'}),null);
    const harvey=c.players.find(p=>p.displayName==='Harvey Elliott');
    assert.ok(harvey);
    // A future entry without provider metadata still supports a unique initial.
    harvey.misterId='';
    assert.equal(c.resolveMister({misterPlayerId:'999999',playerName:'H. Elliott',clubId:harvey.clubId,position:harvey.position}).id,harvey.id);
    c.players.push({...harvey,id:'different-elliott',displayName:'Harry Elliott'});
    assert.equal(c.resolveMister({misterPlayerId:'999999',playerName:'H. Elliott',clubId:harvey.clubId,position:harvey.position}),null);
  } finally {dom.window.close();}
});
test('retratos de Mister solo aceptan el origen y formato verificados',async()=>{
  const {dom,catalog:c}=await catalog();
  try {
    const asset=dom.window.CubanLeaguePlayerCatalog.assetUrl;
    assert.equal(asset('faces/c-romero.webp'),'catalog/faces/c-romero.webp');
    assert.match(c.resolve({misterPlayerId:'1385821'}).photo,/^https:\/\/cdn-mister\.mundodeportivo\.com\/file\/cdn-common\/players\/1385821\.png/);
    assert.equal(asset('https://evil.example/photo.png'),'');
    assert.equal(asset('https://cdn-mister.mundodeportivo.com.evil.example/file/cdn-common/players/1385821.png'),'');
  } finally { dom.window.close(); }
});
