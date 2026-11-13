'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {ReadSession} = require('../scripts/forecast/read-session.cjs');
const {TeamCollector, starters, eligible, classifyBallot} = require('../scripts/forecast/collect-team.cjs');

test('Comuniate keeps missing percentages null, explicit zero and separate alternative names', () => {
  const rows = starters('<div class="cuerpo_campo">' +
    '<div class="jugador_campo"><div class="cara_jugador"><span class="icono_porcentaje">0%</span></div><div class="nombre_jugador">Starter A<span class="alternativo">Alternative A 40%</span></div></div>' +
    '<div class="jugador_campo"><div class="cara_jugador"></div><div class="nombre_jugador">Starter B<span class="alternativo">Alternative B 60%</span></div></div></div>', 'comuniate');
  assert.deepEqual(rows, [{name: 'Starter A', probability: 0}, {name: 'Starter B', probability: null}]);
});

test('anonymous ballot failures differ from absent, incomplete and complete-but-unvalidated lineups', () => {
  const expected = {teamId: '28', seasonId: '143', matchday: 13};
  const data = {temporada: 143, jornada: 13, info_respuesta: 28, participacion: []};
  assert.equal(classifyBallot(null, expected), 'unavailable');
  assert.equal(classifyBallot([], expected), 'not_created');
  assert.equal(classifyBallot({}, expected), 'unavailable');
  assert.equal(classifyBallot(data, expected), 'not_created');
  assert.equal(classifyBallot({...data, jornada: 12}, expected), 'mismatch');
  assert.equal(classifyBallot({...data, participacion: [{nombre: 'one'}]}, expected), 'incomplete');
  assert.equal(classifyBallot({...data, participacion: Array.from({length: 11}, (_, i) => ({nombre: 'name-' + i}))}, expected), 'complete_unvalidated');
});

test('deduplicates public authors and excludes FutbolFantasy without filling its place', () => {
  const author = (id, name) => ({id, url: 'https://www.predicted11.com/es/usuario/' + name});
  assert.deepEqual(eligible([{authors: [author('1', 'FutbolFantasy'), author('2', 'someone')]},
    {authors: [author('2', 'someone'), author('3', 'another')]}]).map(a => a.id), ['2','3']);
});

test('parallel evidence writes cannot collide, and concurrent captures of the same page share its file', async () => {
  const fs = require('node:fs/promises'), path = require('node:path');
  const {tmpdir} = require('node:os');
  const {evidenceStore} = require('../scripts/forecast/evidence-store.cjs');
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'evidence-store-test-'));
  try {
    const capture = evidenceStore(dir);
    const pages = Array.from({length: 20}, (_, i) => ({url: 'https://www.comuniate.com/test/' + i, fetched_at: '2026-11-13T20:30:00Z', body: 'body-' + i, reused: false}));
    const results = await Promise.all([...pages, ...pages].map(capture));
    assert.equal(new Set(results.map(x => x.path)).size, 20);
    for (let i = 0; i < 20; i++) {
      assert.equal(results[i].path, results[i + 20].path);
      assert.equal(await fs.readFile(results[i].path, 'utf8'), pages[i].body);
    }
  } finally { await fs.rm(dir, {recursive: true, force: true}); }
});

test('integrated two-club collection reuses pages/profiles but fetches each team ballot separately', async () => {
  const now = Date.now(), calls = [];
  const ff = 'https://www.futbolfantasy.com/partidos/999-test';
  const jp = 'https://www.jornadaperfecta.com/partido/999/test';
  const co = 'https://www.comuniate.com/partido/26/1/13/test';
  const home = 'https://www.predicted11.com/es/laliga/';
  const p11match = home + 'partido/999-test';
  const teams = ['home-test','away-test'];
  const rows = side => Array.from({length: 11}, (_, i) => side + '-' + i);
  const ffHTML = teams.map((team, i) => `<a href="${home}equipo/${team}"></a><div class="match-p11-side row-${i ? 'visitante' : 'local'}" data-match-p11-team="${i + 1}">` +
    rows(team).map(n => `<div data-onceff="titular"><a data-probabilidad="80"><span class="truncate-name">${n}</span></a></div>`).join('') + '</div>').join('');
  const jpHTML = teams.map(team => '<div class="campo-futbol">' + rows(team).map(n => `<div class="campo-fila"><div class="player-name-pintar"><a>${n}</a></div></div>`).join('') + '</div>').join('');
  const rankHTML = Array.from({length: 7}, (_, i) => `<a class="ranking-link-block" href="https://www.predicted11.com/es/usuario/${i ? 'author-' + i : 'FutbolFantasy'}?campeonato=laliga"><span data-user-id="${i + 10}"></span></a>`).join('');
  const reader = new ReadSession({runKey: 'offline-only', notBefore: new Date(now).toISOString(), expiresAt: new Date(now + 60000).toISOString(), fetchImpl: async url => {
    calls.push(url);
    let body, type = 'text/html';
    if (url === ff) body = ffHTML;
    else if (url === jp) body = jpHTML;
    else if (url === co) body = '<main>fixture body</main>';
    else if (url.startsWith('https://www.comuniate.com/equipos/')) {
      const team = url.split('/').pop();
      body = '<div class="cuerpo_campo">' + rows(team).map(n => `<div class="jugador_campo"><div class="nombre_jugador">${n}</div></div>`).join('') + '</div>';
    } else if (url === home) body = `<a href="${p11match}">match</a>`;
    else if (url === p11match) body = '<p>Consulta las alineaciones para la jornada 13 de LaLiga.</p>' + teams.map(t => `<a href="${home}ranking-equipo/${t}">club</a>`).join('');
    else if (url.includes('/ranking-')) body = rankHTML;
    else if (url.includes('/usuario/author-')) {
      const id = Number(url.match(/author-(\d+)/)[1]) + 10;
      body = `<select id="ligaFilter"><option value="143">LaLiga 26/27</option></select><script>window.API_URL = "https://frpg.predicted11.com/api";window.currentTemporadaId=143;window.currentJornada=12;window.grupoId=16;window.profileUserId=${id};</script><script src="/js/profile-show.js?id=test"></script>`;
    } else if (url.includes('/js/profile-show.js')) {
      type = 'application/javascript';
      body = 'p={username:"Invitado",id:"999",apiToken:"TESTONLY"};var route="/juegos/participacion-criterios/";';
    } else if (url.includes('/participacion-criterios/')) {
      type = 'application/json';
      const teamId = Number(url.match(/participacion-criterios\/\d+\/(\d+)\//)[1]);
      body = JSON.stringify({temporada:143,jornada:13,info_respuesta:teamId,participacion:rows(teams[teamId - 1]).map(nombre => ({nombre}))});
    } else throw Error('Unexpected public request');
    return new Response(body, {headers: {'content-type': type}});
  }});
  const collector = new TeamCollector(reader, async page => ({url: page.url, fetched_at: page.fetched_at}));
  const fixture = {home: teams[0], away: teams[1], season:'2026-27', matchday: 13, source_urls: {futbolfantasy:ff,jornadaperfecta:jp,comuniate:co}};
  const results = [];
  for (const team of teams) results.push(await collector.collect({team,fixture,comuniate_team_url:'https://www.comuniate.com/equipos/' + team}));
  for (let i = 0; i < 2; i++) {
    assert.equal(results[i].publication_ready, false);
    assert.deepEqual(results[i].errors, []);
    assert.equal(results[i].predictions.length, 6);
    assert.ok(results[i].predictions.every(p => p.status === 'complete_unvalidated'));
    assert.equal(results[i].predictions[0].data.participacion[0].nombre, rows(teams[i])[0]);
    for (const observations of Object.values(results[i].observations)) assert.equal(observations.length, 11);
  }
  assert.equal(calls.filter(u => u === ff).length, 1);
  assert.equal(calls.filter(u => u.includes('/usuario/')).length, 6);
  assert.equal(calls.filter(u => u.includes('/js/profile-show.js')).length, 1);
  assert.equal(calls.filter(u => u.includes('/participacion-criterios/')).length, 12);
  assert.ok(calls.filter(u => u.includes('/participacion-criterios/')).every(u => u.includes('/16/13/get/')));
  assert.equal(results[0].docs.futbolfantasy.fetched_at, results[1].docs.futbolfantasy.fetched_at);
});
