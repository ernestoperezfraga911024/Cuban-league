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
    if (/^https?:/i.test(value)) {
      return /^https:\/\/cdn-mister\.mundodeportivo\.com\/file\/cdn-common\/players\/\d+\.png(?:\?version=\d+)?$/.test(value) ? value : '';
    }
    return value ? `${BASE_PATH}${value}` : '';
  }

  function prepare(raw) {
    const clubs = (Array.isArray(raw?.clubs) ? raw.clubs : []).map(club => ({
      id: String(club?.id || '').trim(),
      misterId: String(club?.mister_id || '').trim(),
      name: String(club?.name || '').trim(),
      crest: assetUrl(club?.crest)
    })).filter(club => club.id && club.name);
    const clubsById = new Map(clubs.map(club => [club.id, club]));
    const clubsByMisterId = new Map();
    clubs.forEach(club => {
      if (!club.misterId) return;
      if (!/^\d+$/.test(club.misterId) || clubsByMisterId.has(club.misterId)) throw new Error('El catálogo contiene un club de Mister no válido o duplicado.');
      clubsByMisterId.set(club.misterId, club);
    });
    const players = (Array.isArray(raw?.players) ? raw.players : []).map(player => {
      const clubId = String(player?.club_id || '').trim();
      const club = clubsById.get(clubId) || null;
      const prepared = {
        id: String(player?.id || '').trim(),
        misterId: String(player?.mister_id || '').trim(),
        fullName: String(player?.full_name || '').trim(),
        displayName: String(player?.display_name || '').trim(),
        position: String(player?.position || '').trim().toUpperCase(),
        clubId,
        clubName: String(player?.club_name || club?.name || '').trim(),
        photo: assetUrl(player?.photo),
        crest: club?.crest || '',
        active: player?.active !== false
      };
      prepared.searchText = fold(`${prepared.displayName} ${prepared.fullName} ${prepared.clubName} ${prepared.position}`);
      return prepared;
    }).filter(player => player.id && player.displayName && ['PT', 'DF', 'MC', 'DL'].includes(player.position));
    const activePlayers = players.filter(player => player.active);
    const playersById = new Map(players.map(player => [player.id, player]));
    const playersByMisterId = new Map();
    players.forEach(player => {
      if (!player.misterId) return;
      if (!/^\d+$/.test(player.misterId) || playersByMisterId.has(player.misterId)) throw new Error('El catálogo contiene una identidad de Mister no válida o duplicada.');
      playersByMisterId.set(player.misterId, player);
    });
    const playersByLegacyKey = new Map();
    players.forEach(player => {
      const key = `${fold(player.displayName)}|${fold(player.clubName)}`;
      if (!playersByLegacyKey.has(key)) playersByLegacyKey.set(key, player);
    });

    return {
      schemaVersion: Number(raw?.schema_version) || 1,
      declaredRecordCount: Number(raw?.record_count) || activePlayers.length,
      recordCount: activePlayers.length,
      clubs,
      clubsById,
      clubsByMisterId,
      players,
      playersById,
      resolveMister({ misterPlayerId = '', playerName = '', fullName = '', clubId = '', position = '' } = {}) {
        const providerId = String(misterPlayerId || '').trim();
        if (!/^\d+$/.test(providerId) || !clubsById.has(clubId)) return null;
        const byMisterId = playersByMisterId.get(providerId);
        if (byMisterId) return byMisterId;
        // Only an unambiguous name within the explicitly identified club may
        // establish an identity. Never take the first homonym or infer a club.
        const names = [fold(playerName), fold(fullName)].filter(Boolean);
        const candidates = players.filter(player => player.active && !player.misterId
          && player.clubId === clubId && (!position || player.position === position));
        const exact = candidates.filter(player => names.includes(fold(player.displayName))
          || (player.fullName && names.includes(fold(player.fullName))));
        if (exact.length) return exact.length === 1 ? exact[0] : null;
        const abbreviated = value => {
          const parts = fold(value).split(' ');
          return parts.length > 1 ? parts[0][0] + ' ' + parts.slice(1).join(' ') : '';
        };
        const shortName = fold(playerName);
        if (!/^[a-z] /.test(shortName)) return null;
        const matches = candidates.filter(player => [player.displayName, player.fullName]
          .some(name => name && abbreviated(name) === shortName));
        return matches.length === 1 ? matches[0] : null;
      },
      resolve({ playerId = '', misterPlayerId = '', playerName = '', fullName = '', clubId = '', clubName = '' } = {}) {
        const byId = playersById.get(String(playerId || '').trim());
        if (byId) return byId;
        const providerId = String(misterPlayerId || '').trim();
        const byMisterId = playersByMisterId.get(providerId);
        if (byMisterId) return byMisterId;
        const eligible = player => !providerId || !player.misterId || player.misterId === providerId;
        const exactLegacy = playersByLegacyKey.get(`${fold(playerName)}|${fold(clubName)}`);
        if (exactLegacy && eligible(exactLegacy)) return exactLegacy;
        const normalizedName = fold(playerName);
        const normalizedFullName = fold(fullName);
        const normalizedClubId = String(clubId || '').trim();
        if (!normalizedName && !normalizedFullName) return null;
        const candidates = players.filter(player => eligible(player) && (fold(player.displayName) === normalizedName
          || (normalizedFullName && fold(player.fullName) === normalizedFullName)));
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
        return activePlayers.filter(player => {
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
