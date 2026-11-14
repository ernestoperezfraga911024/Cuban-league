'use strict';
// Source collection only: no Supabase client, scores, drafts or delivery calls.
const {JSDOM, VirtualConsole} = require('jsdom');
const {performance} = require('node:perf_hooks');
const text = node => node?.textContent.replace(/\s+/g, ' ').trim() || '';
const direct = node => [...(node?.childNodes || [])].filter(n => n.nodeType === 3).map(text).join(' ').trim();
const percentage = value => /^\d+%?$/.test(value) ? Number(value.replace('%', '')) : null;
function document(body, fn) {
  const dom = new JSDOM(body, {virtualConsole: new VirtualConsole()}); // Never execute/load scripts or resources.
  try { return fn(dom.window.document); } finally { dom.window.close(); }
}
function windowNumber(body, name) {
  const match = body.match(new RegExp('window\\.' + name + '\\s*=\\s*(\\d+)\\s*;'));
  if (!match) throw Error('Public profile missing ' + name);
  return match[1];
}
function starters(body, source, side) {
  return document(body, d => {
    if (source === 'futbolfantasy') {
      return [...d.querySelectorAll(`.match-p11-side.row-${side} [data-onceff="titular"]`)].map(n => ({
        name: text(n.querySelector('.truncate-name')),
        probability: percentage(n.querySelector('a[data-probabilidad]')?.getAttribute('data-probabilidad') || ''),
      }));
    }
    if (source === 'jornadaperfecta') {
      const field = d.querySelectorAll('.campo-futbol')[side === 'local' ? 0 : 1];
      return [...(field?.querySelectorAll('.campo-fila') || [])].map(n => ({
        name: text(n.querySelector('.player-name-pintar > a')),
        probability: percentage(text(n.querySelector(':scope > a .percent-budget'))),
      })).filter(n => n.name);
    }
    return [...d.querySelectorAll('.cuerpo_campo .jugador_campo')].map(n => ({
      name: direct(n.querySelector('.nombre_jugador')),
      probability: percentage(text(n.querySelector(':scope > .cara_jugador .icono_porcentaje'))),
    })).filter(n => n.name);
  });
}
function layout(body, source, side) {
  return document(body, d => {
    const points = [];
    if (source === 'futbolfantasy') {
      for (const n of d.querySelectorAll(`.match-p11-side.row-${side} [data-onceff="titular"]`)) {
        const coordinate = value => /^\d+(?:\.\d+)?%$/.test(value || '') ? Number(value.slice(0,-1)) : NaN;
        const x=coordinate(n.dataset.onceffX),y=coordinate(n.dataset.onceffY);
        [...n.querySelectorAll('.truncate-name')].forEach((name,i)=>points.push({name:text(name),kind:i?'alternative':'starter',x,y}));
      }
    } else if (source === 'jornadaperfecta') {
      const field = d.querySelectorAll('.campo-futbol')[side === 'local' ? 0 : 1];
      [...(field?.querySelectorAll('table') || [])].forEach((table,y)=> {
        const cells=[...table.querySelectorAll('.campo-fila')];
        cells.forEach((cell,i)=> {
          const x=100*(i+0.5)/cells.length;
          points.push({name:text(cell.querySelector('.player-name-pintar > a')),kind:'starter',x,y});
          for(const alternative of cell.querySelectorAll('.alternatives-container .alternative')) {
            const name=(text(alternative.querySelector('.player-name-pintar > a')) || text(alternative.querySelector('a[title]')) || text(alternative)).replace(/\s+\d{1,3}%\s*$/,'');
            if(name) points.push({name,kind:'alternative',x,y});
          }
        });
      });
    }
    return points;
  });
}
function ranking(page, kind) {
  const authors = document(page.body, d => [...d.querySelectorAll('a.ranking-link-block')].slice(0, 7).map((n, i) => ({
    id: n.querySelector('[data-user-id]')?.getAttribute('data-user-id'), rank: i + 1,
    url: new URL(n.getAttribute('href'), page.url).href,
  })));
  if (authors.length !== 7 || new Set(authors.map(a => a.id)).size !== 7 ||
      authors.some(a => !/^\d+$/.test(a.id) || !/^https:\/\/www\.predicted11\.com\/es\/usuario\/[^/?]+(?:\?campeonato=laliga)?$/.test(a.url))) {
    throw Error('Ranking does not expose seven distinct public authors');
  }
  return {kind, url: page.url, fetched_at: page.fetched_at, authors};
}
function eligible(rankings) {
  const authors = new Map();
  for (const rank of rankings) for (const author of rank.authors) {
    const name = decodeURIComponent(new URL(author.url).pathname.split('/').pop());
    if (name.toLowerCase() !== 'futbolfantasy' && !authors.has(author.id)) authors.set(author.id, author);
  }
  return [...authors.values()];
}
function classifyBallot(data, {teamId, seasonId, matchday}) {
  // The public endpoint returns [] when the author has not created this team's
  // prediction. Only an actual successful JSON response reaches this function.
  if (Array.isArray(data) && data.length === 0) return 'not_created';
  if (!data || !Array.isArray(data.participacion)) return 'unavailable';
  if (String(data.temporada) !== String(seasonId) || String(data.jornada) !== String(matchday) ||
      String(data.info_respuesta) !== String(teamId)) return 'mismatch';
  if (data.participacion.length === 0) return 'not_created';
  const names = data.participacion.map(p => p.nombre?.trim());
  return names.length === 11 && names.every(Boolean) && new Set(names).size === 11 ? 'complete_unvalidated' : 'incomplete';
}

class TeamCollector {
  constructor(reader, capture) { this.reader = reader; this.capture = capture; }

  async follow(packet, from, url) {
    const parent = packet.docs[from];
    if (!parent) throw Error('Follow requires a page already read in this execution');
    const page = await this.reader.read(parent.url);
    const linked = document(page.body, d => [...d.querySelectorAll('a[href]')].some(a => {
      try { return new URL(a.getAttribute('href'),page.url).href === url; } catch { return false; }
    }));
    if (!linked) throw Error('URL is not linked on the cited public page');
    const next = await this.reader.read(url);
    const key = 'extra_' + Object.keys(packet.docs).length;
    packet.docs[key] = await this.capture(next);
    return key;
  }

  async collect(team) {
    const started = performance.now();
    const result = {team: team.team, publication_ready: false, fixture_verified: false,
      expected_fixture: team.fixture, docs: {}, observations: {}, layouts: {}, errors: [], rankings: [], predictions: []};
    const side = team.fixture.home === team.team ? 'local' : 'visitante';
    const urls = {...team.fixture.source_urls, comuniate_team: team.comuniate_team_url};
    const bodies = {};
    await Promise.all(Object.entries(urls).map(async ([key, url]) => {
      const attemptedAt = new Date().toISOString();
      try {
        const page = await this.reader.read(url);
        result.docs[key] = await this.capture(page);
        bodies[key] = page;
      } catch (error) { result.errors.push({source: key, attempted_at: attemptedAt, message: error.message}); }
    }));
    for (const source of ['futbolfantasy', 'jornadaperfecta', 'comuniate']) {
      const page = bodies[source === 'comuniate' ? 'comuniate_team' : source];
      if (page) result.observations[source] = starters(page.body, source, side);
      if (page && source !== 'comuniate') result.layouts[source] = {
        ...result.docs[source],points:layout(page.body,source,side),
      };
    }
    // A base-source failure does not become a fabricated lineup or a DB block.
    if (bodies.futbolfantasy) {
      try { await this.predicted11(team, side, bodies.futbolfantasy, result); }
      catch (error) { result.errors.push({source: 'predicted11', message: error.message}); }
    }
    result.elapsed_ms = Math.round(performance.now() - started);
    return result;
  }

  async predicted11(team, side, ff, result) {
    result.p11_attempted_at = new Date().toISOString();
    const read = async (key, url) => {
      const page = await this.reader.read(url);
      result.docs[key] = await this.capture(page);
      return page;
    };
    const meta = document(ff.body, d => ({
      teamId: d.querySelector(`.match-p11-side.row-${side}`)?.getAttribute('data-match-p11-team'),
      teamUrl: d.querySelectorAll('a[href*="predicted11.com/es/laliga/equipo/"]')[side === 'local' ? 0 : 1]?.href,
    }));
    if (!/^\d+$/.test(meta.teamId) || !meta.teamUrl) throw Error('Missing public P11 team link/identity');
    const home = await read('p11home', 'https://www.predicted11.com/es/laliga/');
    const matchId = new URL(ff.url).pathname.split('/').pop().split('-')[0];
    const matchUrl = document(home.body, d => [...d.querySelectorAll('a[href]')].map(n => n.getAttribute('href'))
      .find(url => url.includes('/partido/' + matchId + '-')));
    if (!matchUrl) throw Error('Next match not linked on public P11 LaLiga page');
    const match = await read('p11match', new URL(matchUrl, home.url).href);
    const matchday = document(match.body, d => Number(text(d.body).match(/para la jornada\s+(\d+)\s+de LaLiga/i)?.[1]));
    if (matchday !== team.fixture.matchday) throw Error('P11 match page does not expose the expected matchday');
    const slug = new URL(meta.teamUrl).pathname.split('/').pop();
    const clubUrl = document(match.body, d => [...d.querySelectorAll('a[href]')].map(n => n.getAttribute('href'))
      .find(url => url.includes('/ranking-equipo/') && url.endsWith('/' + slug)));
    if (!clubUrl) throw Error('Club ranking not linked on match page');
    const ranks = await Promise.all([
      read('p11club', new URL(clubUrl, match.url).href),
      read('p11global', 'https://www.predicted11.com/es/laliga/ranking-global'),
    ]);
    result.rankings = [ranking(ranks[0], 'club'), ranking(ranks[1], 'global')];
    const authors = eligible(result.rankings);
    // Process a bounded group at a time; the transport caps all network requests at four.
    for (let offset = 0; offset < authors.length; offset += 4) {
      const group = await Promise.all(authors.slice(offset, offset + 4).map(async author => {
        let profile, ballot;
        const attemptedAt = new Date().toISOString();
        try {
          profile = await this.reader.read(author.url);
          const profileRef = await this.capture(profile);
          const seasonId = windowNumber(profile.body, 'currentTemporadaId');
          const groupId = windowNumber(profile.body, 'grupoId');
          if (windowNumber(profile.body, 'profileUserId') !== author.id) throw Error('Public profile author does not match');
          const seasonLabel = document(profile.body, d => text(d.querySelector(`#ligaFilter option[value="${seasonId}"]`)));
          const shortSeason = team.fixture.season.slice(2).replace('-', '/');
          if (seasonLabel !== 'LaLiga ' + shortSeason) throw Error('Public profile season does not match');
          // A profile may default to the author's last published round. Query the
          // next matchday observed on the MATCH page, never silently reuse that old XI.
          const api = profile.body.match(/window\.API_URL\s*=\s*"([^"]+)"/)?.[1];
          if (api !== 'https://frpg.predicted11.com/api') throw Error('Unknown public P11 API origin');
          const scriptUrl = document(profile.body, d => [...d.querySelectorAll('script[src]')]
            .map(n => n.getAttribute('src')).find(url => /\/js\/profile-show\.js(?:\?|$)/.test(url)));
          if (!scriptUrl) throw Error('Public profile script unavailable');
          const script = await this.reader.readScript(new URL(scriptUrl, profile.url).href);
          // Read only the anonymous account embedded by the public page. Never load login
          // storage, environment credentials or a personal token. Do not persist its URL.
          const guest = script.body.match(/\w+=\{username:"Invitado",id:"(\d+)",apiToken:"([A-Za-z0-9]+)"/);
          if (!guest || !script.body.includes('/juegos/participacion-criterios/')) throw Error('Anonymous page reader unavailable');
          ballot = await this.reader.readBallot(`${api}/juegos/participacion-criterios/${author.id}/${meta.teamId}/${groupId}/${matchday}/get/${guest[1]}-${guest[2]}`);
          const data = JSON.parse(ballot.body);
          return {author_id: author.id, url: author.url, attempted_at: attemptedAt, fetched_at: profile.fetched_at,
            profile: profileRef, ballot_fetched_at: ballot.fetched_at,
            requested_fixture: {team_id: meta.teamId, season_id: seasonId, matchday},
            status: classifyBallot(data, {teamId: meta.teamId, seasonId, matchday}), data};
        } catch (error) {
          return {author_id: author.id, url: author.url, attempted_at: attemptedAt, fetched_at: profile?.fetched_at || null,
            ballot_fetched_at: ballot?.fetched_at || null, status: 'unavailable', data: null, reason: error.message};
        }
      }));
      result.predictions.push(...group);
    }
  }
}

module.exports = {TeamCollector, starters, layout, ranking, eligible, classifyBallot};
