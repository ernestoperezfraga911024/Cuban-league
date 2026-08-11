(() => {
  'use strict';

  const BASE_PATH = 'catalog/';
  let catalogPromise = null;

  function fold(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function assetUrl(path) {
    const value = String(path || '').replace(/^\.\//, '');
    return value ? `${BASE_PATH}${value}` : '';
  }

  function prepare(raw) {
    const clubs = (Array.isArray(raw?.clubs) ? raw.clubs : []).map(club => ({
      id: String(club?.id || '').trim(),
      name: String(club?.name || '').trim(),
      crest: assetUrl(club?.crest)
    })).filter(club => club.id && club.name);
    const clubsById = new Map(clubs.map(club => [club.id, club]));
    const players = (Array.isArray(raw?.players) ? raw.players : []).map(player => {
      const clubId = String(player?.club_id || '').trim();
      const club = clubsById.get(clubId) || null;
      const prepared = {
        id: String(player?.id || '').trim(),
        displayName: String(player?.display_name || '').trim(),
        position: String(player?.position || '').trim().toUpperCase(),
        clubId,
        clubName: String(player?.club_name || club?.name || '').trim(),
        photo: assetUrl(player?.photo),
        crest: club?.crest || ''
      };
      prepared.searchText = fold(`${prepared.displayName} ${prepared.clubName} ${prepared.position}`);
      return prepared;
    }).filter(player => player.id && player.displayName && ['PT', 'DF', 'MC', 'DL'].includes(player.position));
    const playersById = new Map(players.map(player => [player.id, player]));
    const playersByLegacyKey = new Map();
    players.forEach(player => {
      const key = `${fold(player.displayName)}|${fold(player.clubName)}`;
      if (!playersByLegacyKey.has(key)) playersByLegacyKey.set(key, player);
    });

    return {
      schemaVersion: Number(raw?.schema_version) || 1,
      declaredRecordCount: Number(raw?.record_count) || players.length,
      recordCount: players.length,
      clubs,
      clubsById,
      players,
      playersById,
      resolve({ playerId = '', playerName = '', clubId = '', clubName = '' } = {}) {
        const byId = playersById.get(String(playerId || '').trim());
        if (byId) return byId;
        const exactLegacy = playersByLegacyKey.get(`${fold(playerName)}|${fold(clubName)}`);
        if (exactLegacy) return exactLegacy;
        const normalizedName = fold(playerName);
        const normalizedClubId = String(clubId || '').trim();
        if (!normalizedName) return null;
        const candidates = players.filter(player => fold(player.displayName) === normalizedName);
        if (normalizedClubId) {
          const matchingClub = candidates.find(player => player.clubId === normalizedClubId);
          if (matchingClub) return matchingClub;
        }
        return candidates.length === 1 ? candidates[0] : null;
      },
      search(query = '', { position = '', clubId = '', excludeIds = [], limit = 40 } = {}) {
        const terms = fold(query).split(' ').filter(Boolean);
        const excluded = new Set(excludeIds);
        const wantedPosition = String(position || '').toUpperCase();
        return players.filter(player => {
          if (excluded.has(player.id)) return false;
          if (wantedPosition && player.position !== wantedPosition) return false;
          if (clubId && player.clubId !== clubId) return false;
          return terms.every(term => player.searchText.includes(term));
        }).slice(0, limit);
      }
    };
  }

  async function load(version = '') {
    if (!catalogPromise) {
      const suffix = version ? `?v=${encodeURIComponent(version)}` : '';
      catalogPromise = fetch(`${BASE_PATH}players.json${suffix}`, { cache: 'no-store' })
        .then(response => {
          if (!response.ok) throw new Error('No se pudo cargar el catálogo de jugadores.');
          return response.json();
        })
        .then(prepare)
        .catch(error => {
          catalogPromise = null;
          throw error;
        });
    }
    return catalogPromise;
  }

  document.addEventListener('error', event => {
    const image = event.target;
    if (image?.matches?.('img[data-player-catalog-image]')) {
      image.hidden = true;
      image.parentElement?.classList.add('catalog-image-failed');
    }
  }, true);

  window.CubanLeaguePlayerCatalog = { load, fold, assetUrl };
})();
