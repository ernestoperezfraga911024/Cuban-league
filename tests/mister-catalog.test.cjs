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
    assert.equal(c.recordCount,583);
    assert.equal(c.resolve({misterPlayerId:'1396108'}).id,'mister-1396108');
    assert.equal(c.resolve({misterPlayerId:'61009'}).id,'a-ortiz');
    assert.equal(c.resolve({misterPlayerId:'2586746'}).id,'mister-2586746');
    assert.equal(c.resolve({misterPlayerId:'59089'}).id,'a-padilla');
    assert.equal(c.resolve({misterPlayerId:'71503'}).id,'m-rodriguez-alaves-2');
    assert.equal(c.resolve({misterPlayerId:'24691'}).id,'m-rodriguez');
  } finally { dom.window.close(); }
});

test('J8: Mayol y Olaiz resuelven por los IDs del error y no por coincidencias aproximadas',async()=>{
  const {dom,catalog:c}=await catalog();
  try {
    for(const [misterPlayerId,playerName,clubId,position,fullName] of [
      ['5340038','A. Mayol','valencia','MC','Aaron Mayol'],
      ['5235247','X. Olaiz','alaves','DF','Xanet Olaiz']
    ]) {
      const player=c.resolveMister({misterPlayerId,playerName,clubId,position});
      assert.equal(player.id,'mister-'+misterPlayerId);
      assert.equal(player.clubId,clubId);
      assert.equal(player.position,position);
      assert.equal(c.players.filter(p=>p.misterId===misterPlayerId).length,1);
      assert.equal(c.search(fullName)[0].id,player.id);
      assert.equal(c.resolveMister({misterPlayerId:'999999999',playerName,clubId,position}),null);
    }
    assert.equal(c.declaredRecordCount,c.recordCount);
  } finally {dom.window.close();}
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

test('Burcio has one verified catalog identity shared with forecasts and searchable full name',async()=>{
 const {dom,catalog:c}=await catalog();try{
  const p=c.resolve({misterPlayerId:'68516'});assert.equal(p.id,'mister-68516');assert.equal(p.clubId,'celta-vigo');
  assert.equal(c.search('Hugo Burcio')[0].id,'mister-68516');
  const raw=JSON.parse(fs.readFileSync(require.resolve('../catalog/players.json'),'utf8'));
  assert.equal(raw.players.filter(p=>p.mister_id==='68516').length,1);
  assert.equal(raw.record_count,raw.players.filter(p=>p.active!==false).length);
 }finally{dom.window.close();}
});
test('Burcio roster insertion is idempotent, preserves earlier players and rejects a conflicting identity',async()=>{
 const {PGlite}=require('@electric-sql/pglite'),db=new PGlite();try{
  await db.exec("create schema forecast_league;create table forecast_league.roster(id text primary key,team text,name text);insert into forecast_league.roster values('h-alvarez','celta-vigo','H. Álvarez');");
  const sql=fs.readFileSync(require.resolve('../docs/catalog/burcio-20261117.sql'),'utf8');
  await db.exec(sql);await db.exec(sql);
  assert.deepEqual((await db.query('select * from forecast_league.roster order by id')).rows,[{id:'h-alvarez',team:'celta-vigo',name:'H. Álvarez'},{id:'mister-68516',team:'celta-vigo',name:'H. Burcio'}]);
  await db.exec("insert into forecast_league.roster values('other','other-team','Hugo Burcio');");
  await assert.rejects(db.exec(sql),/Conflicto de identidad/);
  assert.equal((await db.query('select count(*)::int n from forecast_league.roster')).rows[0].n,3);
 }finally{await db.close();}
});

test('Dani Díaz retains his verified Real Sociedad identity without an inferred Mister ID', async () => {
  const {dom, catalog: c} = await catalog();
  try {
    const player = c.resolve({playerId: 'dani-diaz'});
    assert.equal(player.clubId, 'real-sociedad');
    assert.equal(c.search('Daniel Díaz Gándara')[0].id, player.id);
    assert.ok(!player.misterId);
    const {identityReference} = require('../scripts/forecast/identity-reference.cjs');
    const refs = identityReference(player.clubId, [{id:player.id, name:'Dani Díaz', team:player.clubId}], ['Daniel Díaz Gándara']);
    assert.equal(refs.candidates[0].verified_alias.id, player.id);
  } finally { dom.window.close(); }
});

test('Unai Santos retains his verified Osasuna identity without an inferred Mister ID', async () => {
  const {dom, catalog: c} = await catalog();
  try {
    const player = c.resolve({playerId: 'unai-santos'});
    assert.equal(player.clubId, 'osasuna');
    assert.equal(player.position, 'DF');
    assert.equal(c.search('Unai Santos')[0].id, player.id);
    assert.equal(c.search('Unai Santos Mañeru')[0].id, player.id);
    assert.ok(!player.misterId);
  } finally { dom.window.close(); }
});

test('Unai Santos roster insertion is idempotent and preserves prior identities', async () => {
  const {PGlite}=require('@electric-sql/pglite'),db=new PGlite();
  try {
    await db.exec("create schema forecast_league;create table forecast_league.roster(id text primary key,team text,name text);insert into forecast_league.roster values('r-garcia','osasuna','R. García');");
    const sql=fs.readFileSync(require.resolve('../docs/catalog/unai-santos-20261119.sql'),'utf8');
    await db.exec(sql); await db.exec(sql);
    assert.deepEqual((await db.query('select * from forecast_league.roster order by id')).rows,[
      {id:'r-garcia',team:'osasuna',name:'R. García'},
      {id:'unai-santos',team:'osasuna',name:'U. Santos'}
    ]);
    await db.exec("insert into forecast_league.roster values('other','osasuna','Unai Santos');");
    await assert.rejects(db.exec(sql),/Conflicto de identidad/);
  } finally { await db.close(); }
});

test('Hugo Pérez Sañudo resuelve en el Racing con la identidad de LaLiga y FutbolFantasy', async () => {
  const {dom,catalog:c} = await catalog();
  try {
    const player = c.resolve({playerId:'hugo-perez-sanudo'});
    assert.equal(player.clubId, 'racing-santander');
    assert.equal(player.position, 'MC');
    assert.ok(!player.misterId);
    const {identityReference} = require('../scripts/forecast/identity-reference.cjs');
    const names = ['Hugo Pérez', 'Hugo Pérez Sañudo'];
    const refs = identityReference(player.clubId, [{id:player.id, name:'Hugo Pérez', team:player.clubId}], names);
    assert.deepEqual(refs.candidates.map(row => row.observed_name), names);
    assert.ok(refs.candidates.every(row => row.id === player.id && row.verified_alias));
  } finally { dom.window.close(); }
});

test('Rafa Fernández resolves to the Osasuna goalkeeper independently of the Espanyol player', async () => {
  const {dom, catalog: c} = await catalog();
  try {
    const player = c.resolve({playerId: 'rafa-fernandez-osasuna'});
    assert.equal(player.position, 'PT');
    assert.equal(player.clubId, 'osasuna');
    assert.equal(c.search('Rafael Fernández Rodríguez')[0].id, player.id);
    assert.equal(c.resolve({playerId: 'r-fernandez'}).clubId, 'espanyol');
    assert.ok(!player.misterId);
    const {identityReference} = require('../scripts/forecast/identity-reference.cjs');
    const names = ['Rafa Fernández Rodríguez', 'Rafael Fernández Rodríguez'];
    const roster = [{id: player.id, name: 'Rafa Fernández', team: player.clubId}];
    const {candidates} = identityReference(player.clubId, roster, names);
    assert.deepEqual(candidates.map(row => row.verified_alias.id), [player.id, player.id]);
  } finally {
    dom.window.close();
  }
});

test('Óscar González Campos del filial del Málaga tiene ficha y alias propios', async () => {
  const {dom, catalog: c} = await catalog();
  try {
    const player = c.search('Óscar González Campos')[0];
    assert.equal(player.id, 'oscar-gonzalez-malaga');
    assert.equal(player.clubId, 'malaga');
    assert.equal(player.position, 'DF');
    assert.ok(!player.misterId);
    const {identityReference} = require('../scripts/forecast/identity-reference.cjs');
    const roster = [{id: player.id, name: 'Óscar González', team: player.clubId}];
    const {candidates} = identityReference(player.clubId, roster, ['Óscar González Campos']);
    assert.equal(candidates[0].verified_alias.id, player.id);
  } finally {
    dom.window.close();
  }
});

test('Makar Kotovshchikov y Ángel Arcos resuelven con su club y sus alias verificados', async () => {
  const {dom, catalog: c} = await catalog();
  try {
    const {identityReference} = require('../scripts/forecast/identity-reference.cjs');
    for (const [fullName, name, id, team, position] of [
      ['Makar Vladislavovich Kotovshchikov', 'Makar Kotovshchikov', 'makar-kotovshchikov', 'espanyol', 'DL'],
      ['Ángel Arcos Cadilla', 'Ángel Arcos', 'angel-arcos', 'celta-vigo', 'MC']
    ]) {
      const player = c.search(fullName)[0];
      assert.equal(player.id, id);
      assert.equal(player.clubId, team);
      assert.equal(player.position, position);
      assert.ok(!player.misterId);
      const {candidates} = identityReference(team, [{id, name, team}], [name, fullName]);
      assert.deepEqual(candidates.map(row => row.verified_alias.id), [id, id]);
    }
  } finally {
    dom.window.close();
  }
});
