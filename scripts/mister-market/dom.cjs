'use strict';

// These functions execute in a dedicated browser. Read rendered fields only;
// no fetch, hidden application state, cookies, passwords, comments or other bids.
function readMarketDocument() {
  const text = e => String(e?.textContent || '').replace(/\s+/g, ' ').trim();
  const visible = e => !!e && !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  const league = document.querySelector('a.active[href*="action/change?id_community="]');
  const more = document.querySelector('.search-players-more');
  const list = document.querySelector('.search-players-list');
  return {
    leagueId: league ? new URL(league.href).searchParams.get('id_community') : null,
    ready: visible(list), search: document.querySelector('input.search-players-input')?.value ?? null,
    favorites: document.querySelector('.search-players-filter-favs')?.classList.contains('active') ?? null,
    hasMore: visible(more), popupOpen: visible(document.querySelector('#popup-content select[name="owner"]')),
    rows: list ? [...list.children].filter(e => e.matches('li')).map(li => {
      const a = li.querySelector('a.player');
      const badge = a?.querySelector('.icons img.team-logo');
      return { id: a?.getAttribute('href')?.match(/players\/(\d+)/)?.[1] || null,
        href: a?.getAttribute('href') || null, name: text(a?.querySelector('.info .name')),
        value: text(a?.querySelector('.info .underName')),
        position: a?.querySelector('[data-position]')?.getAttribute('data-position'),
        clubId: badge?.getAttribute('src')?.match(/teams\/(\d+)\.png/)?.[1] || null,
        photoUrl: a?.querySelector('.player-avatar img')?.getAttribute('src') || null,
        header: text(li.querySelector(':scope > .header')) };
    }) : []
  };
}
function readFilterDocument() {
  const box = document.querySelector('#popup-content');
  const options = name => [...(box?.querySelector(`select[name="${name}"]`)?.options || [])]
    .filter(o => /^[1-9]\d*$/.test(o.value)).map(o => ({ id: o.value, name: o.text.trim() }));
  const league = document.querySelector('a.active[href*="action/change?id_community="]');
  const ranges = ['value_from', 'value_to', 'clause_from', 'clause_to'].map(name => {
    const e = box?.querySelector(`input[name="${name}"]`);
    return { name, value: e?.value, min: e?.min, max: e?.max };
  });
  return { leagueId: league ? new URL(league.href).searchParams.get('id_community') : null,
    managers: options('owner'), clubs: options('team'),
    owner: box?.querySelector('select[name="owner"]')?.value,
    team: box?.querySelector('select[name="team"]')?.value,
    position: box?.querySelector('input[name="position"]:checked')?.value,
    injured: box?.querySelector('input[name="injured"]')?.checked,
    stealable: box?.querySelector('input[name="stealable"]')?.checked,
    ranges };
}
function readFeedDocument() {
  const text = e => String(e?.textContent || '').replace(/\s+/g, ' ').trim();
  const league = document.querySelector('a.active[href*="action/change?id_community="]');
  const cards = [...document.querySelectorAll('.feed-cards .card-transfer[id]')];
  return { leagueId: league ? new URL(league.href).searchParams.get('id_community') : null,
    ready: !!document.querySelector('.feed-cards'), cards: cards.length,
    events: cards.flatMap(card => [...card.querySelectorAll(':scope > .player-list > li')].map(li => {
      const title = li.querySelector(':scope > .item > .title');
      const names = [...(title?.querySelectorAll('em') || [])].map(text);
      const parties = [...li.querySelectorAll('.flow > .avatar')].map((p, i) => ({
        id: p.getAttribute('href')?.match(/users\/(\d+)/)?.[1] || null, name: names[i] || '' }));
      return { feedId: card.id, playerId: li.querySelector('a.player')?.getAttribute('href')?.match(/players\/(\d+)/)?.[1],
        name: text(title?.querySelector('strong')), title: text(title), from: parties[0], to: parties[1],
        amount: text(li.querySelector('.flow > .price')) };
    })) };
}
module.exports = { readMarketDocument, readFilterDocument, readFeedDocument };
