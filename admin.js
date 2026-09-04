(() => {
  'use strict';

  const VERSION = '162-20260904-mister-import';
  const OWNER_VISIT_EXCLUSION_KEY = 'cuban-league-owner-browser';
  const LOCAL_DRAFT_PREFIX = 'cuban-admin-draft:';
  const ARCHIVED_DRAFT_PREFIX = 'cuban-admin-archived-draft:';
  const LOCAL_DRAFT_RESTORE_CUTOFF_KEY = 'cuban-admin-restore-cutoff';
  const PARTICIPANT_ENTRY_MODE_KEY = 'cuban-admin-participant-entry-mode';
  const ACTIVE_PARTICIPANT_PREFIX = 'cuban-admin-active-participant:';
  const AUTO_SAVE_DELAY = 900;
  const MISTER_HELPER_URL = 'https://ernestoperezfraga911024.github.io/Cuban-league/mister-import-helper.js?v=162';
  const MISTER_HELPER_BOOKMARKLET = "javascript:(()=>{if(window.__CUBAN_LEAGUE_MISTER_IMPORT_RUNNING__)return;const s=document.createElement('script');s.src='" + MISTER_HELPER_URL + "&t='+Date.now();document.documentElement.appendChild(s)})()";
  const config = window.CUBAN_LEAGUE_SUPABASE;
  const $ = id => document.getElementById(id);
  const state = {
    client: null,
    participants: [],
    leagueParticipants: [],
    championsGroups: [],
    championsLeagueMatchdays: [],
    championsSyncStatus: 'pending',
    championsRowsCache: new Map(),
    participantIndex: new Map(),
    competition: 'league',
    matchday: 1,
    published: false,
    publishedRows: [],
    editingPublished: false,
    hasDraft: false,
    dirty: false,
    saving: false,
    schemaReady: true,
    redCardsSchemaReady: true,
    postponedSchemaReady: true,
    lineupSchemaReady: true,
    catalogSchemaReady: true,
    achievementSchemaReady: true,
    history: [],
    previewRows: [],
    previewOpen: false,
    previewReturnFocus: null,
    messageTimer: null,
    misterImportRequest: null,
    misterImportPollTimer: null,
    misterImportBusy: false,
    deferredInstallPrompt: null,
    autoSaveTimer: null,
    autoSaveInFlight: false,
    autoSaveQueued: false,
    autoSavePromise: null,
    autoSaveRevision: 0,
    loadRequestId: 0,
    matchdayLoading: false,
    matchdayLoadBlocked: true,
    suspendAutoSave: false,
    analyticsLoading: false,
    backupSchemaReady: true,
    backupLoading: false,
    backupCreating: false,
    backupRestoring: false,
    backups: [],
    backupRestoreOpen: false,
    backupRestoreId: null,
    backupRestorePreview: null,
    backupRestoreTrigger: null,
    localDraftRestoreCutoff: '',
    localDraftArchivedOnLoad: false,
    restoreStateChecked: false,
    restoreStateAvailable: false,
    serverRestoreGeneration: '',
    serverDataRevision: 0,
    serverRestoreAt: '',
    matchdayRestoreGeneration: '',
    matchdayWriteRevision: '',
    lineups: new Map(),
    lineupParticipantName: '',
    copyingPreviousLineup: false,
    previousLineupRequestId: 0,
    previousLineupCache: new Map(),
    participantEntryMode: 'single',
    catalog: null,
    catalogSlot: null,
    catalogParticipantName: '',
    catalogReturnFocus: null,
    milestone: {
      matchdayDate: '',
      isMonthEnd: false,
      isYearEnd: false
    }
  };

  function isStandalone() {
    return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function openInstallGuide() {
    $('adminInstallModal').hidden = false;
    document.body.classList.add('install-open');
    requestAnimationFrame(() => $('closeAdminInstall').focus());
  }

  function closeInstallGuide() {
    $('adminInstallModal').hidden = true;
    document.body.classList.remove('install-open');
    $('copyAdminStatus').textContent = '';
    $('installAdmin').focus();
  }

  async function copyAdminUrl() {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    try {
      await navigator.clipboard.writeText(url.toString());
    } catch {
      const input = document.createElement('textarea');
      input.value = url.toString();
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    $('copyAdminStatus').textContent = 'Enlace copiado. Ahora abre Safari y pégalo en la barra de dirección.';
  }

  async function requestAdminInstall() {
    if (state.deferredInstallPrompt) {
      state.deferredInstallPrompt.prompt();
      await state.deferredInstallPrompt.userChoice;
      state.deferredInstallPrompt = null;
      $('installAdmin').hidden = isStandalone();
      return;
    }
    openInstallGuide();
  }

  function setupInstallableAdmin() {
    $('installAdmin').hidden = isStandalone();
    $('installAdmin').addEventListener('click', requestAdminInstall);
    $('closeAdminInstall').addEventListener('click', closeInstallGuide);
    $('copyAdminLink').addEventListener('click', copyAdminUrl);
    $('adminInstallModal').addEventListener('click', event => {
      if (event.target.id === 'adminInstallModal') closeInstallGuide();
    });

    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      state.deferredInstallPrompt = event;
    });
    window.addEventListener('appinstalled', () => {
      state.deferredInstallPrompt = null;
      $('installAdmin').hidden = true;
      if (!$('adminInstallModal').hidden) closeInstallGuide();
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register(`./sw.js?v=${VERSION}`, { scope: './' })
        .then(registration => registration.update())
        .catch(() => {});
    }
  }

  function showOnly(viewId) {
    ['loadingView', 'loginView', 'panelView'].forEach(id => {
      $(id).hidden = id !== viewId;
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function isChampionsMode() {
    return state.competition === 'champions';
  }

  function currentSeasonKey() {
    return isChampionsMode() ? `${config.season}-CHAMPIONS` : config.season;
  }

  function currentCompetitionLabel() {
    return isChampionsMode() ? 'Champions' : 'Liga';
  }


  function misterGameweekForMatchday(matchday = state.matchday) {
    const value = Number(matchday);
    if (!Number.isInteger(value) || value < 1 || value > 38) return null;
    if (config.season !== '2026/27') return null;
    return value === 1 ? 3968 : 4041 + value;
  }

  function misterManagerKey(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  function setMisterImportStatus(message, tone = '') {
    const panel = $('misterImportPanel');
    const status = $('misterImportStatus');
    if (!panel || !status) return;
    status.textContent = message;
    panel.classList.toggle('is-error', tone === 'error');
    panel.classList.toggle('is-success', tone === 'success');
  }

  function syncMisterImportUI() {
    const button = $('importMisterButton');
    if (!button) return;
    button.disabled = state.misterImportBusy
      || state.saving
      || state.matchdayLoading
      || state.matchdayLoadBlocked
      || state.copyingPreviousLineup
      || isChampionsMode()
      || !state.catalog
      || !state.lineupSchemaReady
      || !state.catalogSchemaReady
      || !misterGameweekForMatchday();
    button.querySelector('span').innerHTML = state.misterImportBusy
      ? 'Importando Jornada <b id="importMisterMatchday">' + state.matchday + '</b>…'
      : 'Importar Jornada <b id="importMisterMatchday">' + state.matchday + '</b> desde Mister';
  }

  function clearMisterImportPoll() {
    clearTimeout(state.misterImportPollTimer);
    state.misterImportPollTimer = null;
  }

  async function cancelMisterImport({ silent = false, keepPanel = false } = {}) {
    clearMisterImportPoll();
    const active = state.misterImportRequest;
    state.misterImportRequest = null;
    state.misterImportBusy = false;
    syncMisterImportUI();
    if (active?.requestId && state.client) {
      await state.client.rpc('cancel_mister_import_request', {
        p_request_id: active.requestId
      }).catch(() => null);
    }
    if (!keepPanel) $('misterImportPanel').hidden = true;
    if (!silent) setMisterImportStatus('Importación cancelada. No se guardó ni publicó nada.');
  }

  async function copyMisterHelper() {
    try {
      await navigator.clipboard.writeText(MISTER_HELPER_BOOKMARKLET);
    } catch {
      const input = document.createElement('textarea');
      input.value = MISTER_HELPER_BOOKMARKLET;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    $('misterHelperCopyStatus').textContent = 'Ayudante copiado. Crea un marcador llamado “Enviar a Cuban League” y pega el contenido como dirección.';
  }

  function validateIntegerStat(value, label, managerName) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) {
      throw new Error(label + ' no válido para ' + managerName + '.');
    }
    return number;
  }

  function normalizeMisterPayload(payload, expectedGameweekId) {
    if (!state.catalog) throw new Error('El Catálogo Maestro de jugadores no está disponible.');
    if (!payload || Number(payload.schemaVersion) !== 1
        || payload.source !== 'mister.mundodeportivo.com'
        || Number(payload.matchday) !== state.matchday
        || Number(payload.gameweekId) !== expectedGameweekId
        || !Array.isArray(payload.managers)
        || payload.managers.length !== state.participants.length) {
      throw new Error('La captura no corresponde a esta jornada o está incompleta.');
    }

    const participantByKey = new Map();
    state.participants.forEach(participant => {
      const key = misterManagerKey(participant.name);
      if (!key || participantByKey.has(key)) throw new Error('Hay participantes duplicados en Cuban League.');
      participantByKey.set(key, participant);
    });

    const managerByParticipant = new Map();
    payload.managers.forEach(manager => {
      const participant = participantByKey.get(misterManagerKey(manager?.name));
      if (!participant) throw new Error('El participante de Mister “' + String(manager?.name || 'sin nombre') + '” no existe en Cuban League.');
      if (managerByParticipant.has(participant.name)) throw new Error('Mister devolvió dos veces a ' + participant.name + '.');
      managerByParticipant.set(participant.name, manager);
    });
    const missing = state.participants.filter(participant => !managerByParticipant.has(participant.name));
    if (missing.length) throw new Error('Faltan participantes: ' + missing.map(item => item.name).join(', ') + '.');

    const misterClubMap = new Map();
    payload.managers.flatMap(manager => Array.isArray(manager?.lineup) ? manager.lineup : []).forEach(player => {
      const resolved = state.catalog.resolve({ playerName: player?.playerName });
      const misterClubId = String(player?.misterClubId || '');
      if (!resolved || !misterClubId) return;
      const previous = misterClubMap.get(misterClubId);
      if (previous && previous !== resolved.clubId) {
        throw new Error('Mister devolvió un club contradictorio para ' + String(player?.playerName || 'un jugador') + '.');
      }
      misterClubMap.set(misterClubId, resolved.clubId);
    });

    return state.participants.map(participant => {
      const manager = managerByParticipant.get(participant.name);
      if (!Array.isArray(manager?.lineup) || manager.lineup.length !== 11) {
        throw new Error('La alineación de ' + participant.name + ' no tiene exactamente 11 jugadores.');
      }
      const seenMisterPlayers = new Set();
      const lineup = manager.lineup.map((rawPlayer, index) => {
        const misterPlayerId = String(rawPlayer?.misterPlayerId || '');
        if (!misterPlayerId || seenMisterPlayers.has(misterPlayerId)) {
          throw new Error('La alineación de ' + participant.name + ' contiene un jugador repetido o sin identidad.');
        }
        seenMisterPlayers.add(misterPlayerId);
        const mappedClubId = misterClubMap.get(String(rawPlayer?.misterClubId || '')) || '';
        const catalogPlayer = state.catalog.resolve({
          playerName: rawPlayer?.playerName,
          clubId: mappedClubId
        });
        if (!catalogPlayer) {
          throw new Error('No se pudo relacionar “' + String(rawPlayer?.playerName || 'jugador sin nombre') + '” de ' + participant.name + ' con el Catálogo Maestro.');
        }
        const position = String(rawPlayer?.position || '').toUpperCase();
        if (!['PT', 'DF', 'MC', 'DL'].includes(position) || catalogPlayer.position !== position) {
          throw new Error('La posición de ' + catalogPlayer.displayName + ' no coincide entre Mister y el catálogo.');
        }
        const displayedPoints = Number(rawPlayer?.displayedPoints);
        if (!Number.isFinite(displayedPoints) || Math.abs(displayedPoints * 2 - Math.round(displayedPoints * 2)) > 0.0001) {
          throw new Error('Los puntos de ' + catalogPlayer.displayName + ' no son válidos.');
        }
        if (rawPlayer?.didPlay === false && displayedPoints !== 0) {
          throw new Error('Un jugador marcado con “—” debe tener 0 puntos.');
        }
        const isCaptain = rawPlayer?.isCaptain === true;
        const multiplier = Number(rawPlayer?.captainMultiplier);
        if (isCaptain && !validCaptainMultiplier(multiplier)) {
          throw new Error('El multiplicador del capitán de ' + participant.name + ' no es válido.');
        }
        return {
          slot_number: index + 1,
          player_id: catalogPlayer.id,
          player_name: catalogPlayer.displayName,
          club_id: catalogPlayer.clubId,
          club_name: catalogPlayer.clubName,
          position: catalogPlayer.position,
          displayed_points: displayedPoints,
          is_captain: isCaptain,
          captain_multiplier: isCaptain ? multiplier : 1
        };
      });

      const points = Number(manager.points);
      if (!Number.isInteger(points)) throw new Error('Los puntos totales de ' + participant.name + ' no son un entero válido.');
      const metrics = lineupMetrics(lineup);
      if (!metrics.complete) {
        throw new Error('Alineación no válida de ' + participant.name + ': ' + metrics.issues.join(' · ') + '.');
      }
      if (Math.abs(metrics.total - points) > 0.01) {
        throw new Error('El XI de ' + participant.name + ' suma ' + metrics.total + ' puntos, pero Mister muestra ' + points + '.');
      }

      return {
        participant,
        points,
        goals: validateIntegerStat(manager.goals, 'Total de goles', participant.name),
        cleanSheets: validateIntegerStat(manager.cleanSheets, 'Total de clean sheets', participant.name),
        redCards: validateIntegerStat(manager.redCards, 'Total de tarjetas rojas', participant.name),
        lineup
      };
    });
  }

  function applyMisterRows(rows) {
    if (state.published && !state.editingPublished) startCorrection();
    clearTimeout(state.autoSaveTimer);
    state.autoSaveRevision += 1;
    rows.forEach(imported => {
      const card = document.querySelector('.admin-player[data-player-id="' + imported.participant.id + '"]');
      if (!card) throw new Error('No se encontró el formulario de ' + imported.participant.name + '.');
      const values = {
        points: imported.points,
        goals: imported.goals,
        clean_sheets: imported.cleanSheets,
        red_cards: imported.redCards
      };
      Object.entries(values).forEach(([field, value]) => {
        const input = card.querySelector('[data-stat="' + field + '"]');
        if (!input) throw new Error('Falta el campo ' + field + ' de ' + imported.participant.name + '.');
        input.value = String(value);
        if (field === 'points') syncSignedPointsControl(input);
      });
      state.lineups.set(imported.participant.name, normalizeLineupPlayers(imported.lineup));
    });
    state.hasDraft = true;
    renderLineupEditor();
    updateTotals();
    updateLineupSummary();
    updateCompletionState();
    markDirty(true, 'Datos de Mister listos para guardar…');
  }

  async function finishMisterImport(payload, request) {
    try {
      setMisterImportStatus('Validando los 20 participantes y sus alineaciones…');
      const rows = normalizeMisterPayload(payload, request.gameweekId);
      applyMisterRows(rows);
      setMisterImportStatus('Datos verificados. Guardando el borrador en Supabase…');
      const saved = await persistDraft({ manual: true });
      if (!saved) throw new Error('Los datos se cargaron en pantalla, pero el borrador no pudo sincronizarse. Usa “Guardar ahora” para reintentarlo.');

      await state.client.rpc('consume_mister_import_request', {
        p_request_id: request.requestId
      }).catch(() => null);
      state.misterImportRequest = null;
      state.misterImportBusy = false;
      clearMisterImportPoll();
      syncMisterImportUI();
      $('cancelMisterImportButton').textContent = 'Cerrar';
      setMisterImportStatus(
        'Jornada ' + state.matchday + ' importada y guardada como borrador: ' + rows.length + ' participantes. La web pública no cambió.',
        'success'
      );
      flashMessage('Importación completada. La Jornada ' + state.matchday + ' quedó en borrador; tú decides cuándo publicarla.');
    } catch (error) {
      state.misterImportBusy = false;
      clearMisterImportPoll();
      syncMisterImportUI();
      $('cancelMisterImportButton').textContent = 'Cerrar';
      setMisterImportStatus(String(error?.message || error || 'No se pudo guardar la importación.'), 'error');
      flashMessage(String(error?.message || error || 'No se pudo guardar la importación.'), 'error');
    }
  }

  async function pollMisterImport(request) {
    if (!state.misterImportRequest || state.misterImportRequest.requestId !== request.requestId) return;
    const { data, error } = await state.client.rpc('get_mister_import_request', {
      p_request_id: request.requestId
    });
    if (!state.misterImportRequest || state.misterImportRequest.requestId !== request.requestId) return;
    if (error) {
      state.misterImportBusy = false;
      syncMisterImportUI();
      setMisterImportStatus(friendlyError(error), 'error');
      return;
    }
    if (data?.status === 'ready' && data.payload) {
      await finishMisterImport(data.payload, request);
      return;
    }
    if (['failed', 'expired', 'cancelled'].includes(data?.status)) {
      state.misterImportRequest = null;
      state.misterImportBusy = false;
      syncMisterImportUI();
      $('cancelMisterImportButton').textContent = 'Cerrar';
      setMisterImportStatus(data?.error || 'La importación no pudo completarse.', 'error');
      return;
    }
    setMisterImportStatus('Esperando la captura de Mister para la Jornada ' + state.matchday + '…');
    state.misterImportPollTimer = setTimeout(() => pollMisterImport(request), 2000);
  }

  async function startMisterImport() {
    if (state.misterImportBusy || state.saving || state.matchdayLoading || state.matchdayLoadBlocked || isChampionsMode()) return;
    const gameweekId = misterGameweekForMatchday();
    if (!gameweekId) {
      flashMessage('Todavía no está configurado el calendario de Mister para esta temporada.', 'error');
      return;
    }
    if (!state.catalog || !state.lineupSchemaReady || !state.catalogSchemaReady) {
      flashMessage('La importación necesita el Catálogo Maestro y el guardado de alineaciones activos.', 'error');
      return;
    }
    if (state.dirty && !window.confirm('Esta importación sustituirá los datos todavía no guardados de la Jornada ' + state.matchday + '. ¿Continuar?')) return;

    await cancelMisterImport({ silent: true, keepPanel: true });
    state.misterImportBusy = true;
    syncMisterImportUI();
    $('misterImportPanel').hidden = false;
    $('cancelMisterImportButton').textContent = 'Cancelar';
    $('misterHelperCopyStatus').textContent = '';
    setMisterImportStatus('Creando un enlace seguro de un solo uso…');
    $('misterImportPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });

    const { data, error } = await state.client.rpc('start_mister_import', {
      p_season: currentSeasonKey(),
      p_matchday: state.matchday,
      p_gameweek_id: gameweekId
    });
    if (error || !data?.requestId || !data?.token) {
      state.misterImportBusy = false;
      syncMisterImportUI();
      setMisterImportStatus(friendlyError(error || new Error('No se pudo iniciar la importación.')), 'error');
      return;
    }

    const misterUrl = new URL('https://mister.mundodeportivo.com/standings');
    misterUrl.searchParams.set('gw', String(gameweekId));
    misterUrl.searchParams.set('cuban_request', String(data.requestId));
    misterUrl.searchParams.set('cuban_token', String(data.token));
    misterUrl.searchParams.set('cuban_matchday', String(state.matchday));
    const request = {
      requestId: String(data.requestId),
      gameweekId,
      matchday: state.matchday,
      expiresAt: String(data.expiresAt || '')
    };
    state.misterImportRequest = request;
    $('openMisterImportLink').href = misterUrl.toString();
    setMisterImportStatus('Enlace listo. Abre Mister y pulsa allí el marcador “Enviar a Cuban League”.');
    window.open(misterUrl.toString(), '_blank', 'noopener,noreferrer');
    pollMisterImport(request);
  }

  function setupMisterImportControls() {
    $('misterHelperBookmark').href = MISTER_HELPER_BOOKMARKLET;
    syncMisterImportUI();
  }

  function currentMatchdayCount() {
    return isChampionsMode() ? state.championsLeagueMatchdays.length || 8 : 38;
  }

  function championsSourceMatchday(championsMatchday = state.matchday) {
    const value = Number(state.championsLeagueMatchdays[Number(championsMatchday) - 1]);
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  function championsMatchdayForLeague(leagueMatchday = state.matchday) {
    const index = state.championsLeagueMatchdays.indexOf(Number(leagueMatchday));
    return index >= 0 ? index + 1 : null;
  }

  function championsSyncDetails(rows = state.publishedRows) {
    const sourceMatchday = championsSourceMatchday();
    const sourceRows = Array.isArray(rows) ? rows : [];
    const availableNames = new Set(sourceRows.map(row => row?.participant_name).filter(Boolean));
    const completeRows = sourceRows.filter(row =>
      ['points', 'goals', 'clean_sheets', 'red_cards'].every(field =>
        row?.[field] !== null
        && row?.[field] !== undefined
        && row?.[field] !== ''
        && Number.isInteger(Number(row[field]))
      )
    );
    const uniqueNames = new Set(completeRows.map(row => row?.participant_name).filter(Boolean));
    const synchronized = state.participants.filter(participant => uniqueNames.has(participant.name)).length;
    const available = state.participants.filter(participant => availableNames.has(participant.name)).length;
    const postponed = sourceRows.some(row => row?.has_postponed_matches === true);
    const status = available === 0
      ? 'pending'
      : postponed || synchronized < state.participants.length
        ? 'provisional'
        : 'synced';
    return { sourceMatchday, available, synchronized, total: state.participants.length, postponed, status };
  }

  function localDraftKey() {
    return `${LOCAL_DRAFT_PREFIX}${currentSeasonKey()}:${state.matchday}`;
  }

  function isUpgradeError(error) {
    const message = String(error?.message || error || '');
    return /matchday_drafts|matchday_change_log|save_matchday_draft|publish_matchday_revision|undo_last_matchday_publication|schema cache|could not find the function|does not exist/i.test(message);
  }

  function isAnalyticsUpgradeError(error) {
    const message = String(error?.message || error || '');
    return /site_visits|get_site_analytics|track_site_visit|visitor analytics/i.test(message);
  }

  function isBackupUpgradeError(error) {
    const message = String(error?.message || error || '');
    return /league_backups|league_backup_state|matchday_write_state|matchday_milestone_drafts|league backup|list_league_backups|create_league_backup|download_league_backup|preview_league_restore|restore_league_backup|get_league_backup_schema_version|get_league_restore_state|get_matchday_write_state|get_matchday_milestone_draft|save_matchday_draft_v124|publish_matchday_revision_v124|undo_last_matchday_publication_v124|SUPABASE-V124/i.test(message);
  }

  function isAchievementUpgradeError(error) {
    const message = String(error?.message || error || '');
    return /matchday_milestones|save_matchday_milestone|achievement milestone/i.test(message);
  }

  function isPostponedUpgradeError(error) {
    const message = String(error?.message || error || '');
    return /has_postponed_matches|partidos aplazados|postponed matches/i.test(message);
  }

  function isLineupUpgradeError(error) {
    const message = String(error?.message || error || '');
    return /column[^\n]*lineup[^\n]*does not exist|could not find[^\n]*lineup|schema cache[^\n]*lineup|matchday lineup schema|get_player_catalog_schema_version|SUPABASE-V11[56]/i.test(message);
  }

  function isRedCardsUpgradeError(error) {
    const message = String(error?.message || error || '');
    return /red_cards|tarjetas rojas|tarjeta roja/i.test(message);
  }

  function isRestoreGenerationError(error) {
    const message = String(error?.message || error || '');
    return /restore generation changed|restauraci[oó]n.*otro dispositivo/i.test(message);
  }

  function isDraftConflictError(error) {
    const message = String(error?.message || error || '');
    return /matchday revision changed|draft revision changed|publication revision changed|borrador.*otro dispositivo/i.test(message);
  }

  function isRestorePreviewStaleError(error) {
    const message = String(error?.message || error || '');
    return /league data changed|reopen the restore preview/i.test(message);
  }

  function friendlyError(error) {
    const message = String(error?.message || error || '');
    if (/invalid login credentials/i.test(message)) return 'El correo o la contraseña no son correctos.';
    if (/email not confirmed/i.test(message)) return 'Primero debes confirmar el correo en Supabase.';
    if (/failed to fetch|networkerror|load failed/i.test(message)) return 'No se pudo conectar. Comprueba tu conexión a internet e inténtalo otra vez.';
    if (isRestoreGenerationError(error)) return 'Los datos cambiaron por una restauración desde otro dispositivo. La jornada se recargó para evitar sobrescribirlos.';
    if (isDraftConflictError(error)) return 'Otro dispositivo guardó una versión más reciente. Conservamos tu borrador local en cuarentena y cargamos la versión de Supabase.';
    if (isRestorePreviewStaleError(error)) return 'Los datos cambiaron después de abrir esta comparación. Vuelve a abrir el respaldo y revísalo antes de restaurar.';
    if (isBackupUpgradeError(error)) return 'Falta activar los respaldos. Ejecuta “SUPABASE-V124-RESPALDOS-COPIAR-Y-PEGAR.txt” una sola vez en Supabase.';
    if (isLineupUpgradeError(error)) return 'Falta activar las alineaciones con catálogo. Ejecuta “SUPABASE-V116-CATALOGO-ALINEACIONES-COPIAR-Y-PEGAR.txt” una sola vez en Supabase.';
    if (isPostponedUpgradeError(error)) return 'Falta activar los partidos aplazados. Ejecuta “SUPABASE-V114-APLAZADOS-COPIAR-Y-PEGAR.txt” una sola vez en Supabase.';
    if (isRedCardsUpgradeError(error)) return 'Falta activar las tarjetas rojas. Ejecuta “SUPABASE-V65-TARJETAS-ROJAS-COPIAR-Y-PEGAR.txt” una sola vez en Supabase.';
    if (isAchievementUpgradeError(error)) return 'Falta activar las insignias. Ejecuta “SUPABASE-V59-INSIGNIAS-COPIAR-Y-PEGAR.txt” una sola vez en Supabase.';
    if (isAnalyticsUpgradeError(error)) return 'Falta activar el contador de visitas. Ejecuta “SUPABASE-V58-VISITAS-COPIAR-Y-PEGAR.txt” una sola vez en Supabase.';
    if (isUpgradeError(error)) return 'Falta activar las nuevas funciones del panel. Ejecuta “SUPABASE-V57-COPIAR-Y-PEGAR.txt” una sola vez en Supabase.';
    if (/is_league_admin|404/i.test(message)) return 'Falta configurar la base de datos. Ejecuta primero el archivo SQL en Supabase.';
    if (/row-level security|permission denied|not authorized|jwt/i.test(message)) return 'Tu sesión no tiene permiso para realizar esta acción.';
    return message || 'Ocurrió un error inesperado. Inténtalo nuevamente.';
  }

  function setLoginMessage(message = '') {
    const node = $('loginMessage');
    node.textContent = message;
    node.hidden = !message;
  }

  function setRecoveryMessage(message = '') {
    const node = $('recoveryMessage');
    node.textContent = message;
    node.hidden = !message;
  }

  function showRecoveryForm(show) {
    $('loginForm').hidden = show;
    $('recoveryForm').hidden = !show;
    if (!show) {
      $('recoveryPassword').value = '';
      $('recoveryPasswordConfirm').value = '';
      setRecoveryMessage();
    }
  }

  function flashMessage(message, type = 'success') {
    const node = $('panelMessage');
    clearTimeout(state.messageTimer);
    node.textContent = message;
    node.classList.toggle('error', type === 'error');
    node.hidden = false;
    state.messageTimer = setTimeout(() => {
      node.hidden = true;
    }, 6200);
  }

  function formatDate(value, prefix = '') {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return prefix ? `${prefix} ahora` : 'Ahora';
    return `${prefix}${new Intl.DateTimeFormat('es', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date)}`;
  }

  function localDateInputValue() {
    const now = new Date();
    const local = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
    return local.toISOString().slice(0, 10);
  }

  function gatherMilestone() {
    return {
      matchdayDate: $('matchdayDate').value || '',
      isMonthEnd: $('monthEndToggle').checked,
      isYearEnd: $('yearEndToggle').checked
    };
  }

  function hasPostponedMatches() {
    return !isChampionsMode() && $('postponedToggle')?.checked === true;
  }

  function publishedWasPostponed() {
    return state.publishedRows.some(row => row?.has_postponed_matches === true);
  }

  function milestoneValidation({ required = true, milestoneOverride = null } = {}) {
    if (isChampionsMode()) return { valid: true, milestone: null, message: '' };
    const milestone = milestoneOverride || gatherMilestone();
    if (required && !milestone.matchdayDate) {
      return { valid: false, milestone, message: 'Selecciona la fecha de esta jornada antes de continuar.' };
    }
    if (milestone.isYearEnd && milestone.matchdayDate && !/-12-\d{2}$/.test(milestone.matchdayDate)) {
      return { valid: false, milestone, message: 'El Campeón de Invierno solo puede entregarse en la última jornada de diciembre.' };
    }
    return { valid: true, milestone, message: '' };
  }

  function updateAchievementSettingsMessage() {
    if (isChampionsMode()) return;
    const node = $('achievementSettingsMessage');
    const result = milestoneValidation({ required: false });
    const postponed = hasPostponedMatches();
    node.classList.toggle('warning', !result.valid || !state.achievementSchemaReady || !state.postponedSchemaReady || postponed);
    node.classList.toggle('success', result.valid && state.achievementSchemaReady && state.postponedSchemaReady && !postponed && (result.milestone?.isMonthEnd || result.milestone?.isYearEnd));

    if (!state.achievementSchemaReady) {
      node.textContent = 'Activa V59 en Supabase para guardar fechas y entregar las nuevas insignias.';
    } else if (!state.postponedSchemaReady) {
      node.textContent = postponed
        ? 'Activa V114 en Supabase antes de publicar esta jornada como pendiente.'
        : 'Activa V114 en Supabase para poder marcar jornadas con partidos aplazados.';
    } else if (!result.valid) {
      node.textContent = result.message;
    } else if (postponed) {
      node.textContent = 'La Liga podrá continuar, pero la Copa mantendrá esta eliminación y las siguientes como provisionales.';
    } else if (result.milestone?.isYearEnd) {
      node.textContent = 'Al publicar la última jornada de diciembre se entregarán Jugador del Mes y Campeón de Invierno.';
    } else if (result.milestone?.isMonthEnd) {
      node.textContent = 'Al publicar se calculará y entregará el Jugador del Mes.';
    } else {
      node.textContent = 'La fecha se guarda con el borrador de esta jornada.';
    }
  }

  function setMilestoneForm(milestone = {}) {
    const matchdayDate = milestone.matchday_date || milestone.matchdayDate || localDateInputValue();
    $('matchdayDate').value = matchdayDate;
    $('monthEndToggle').checked = milestone.is_month_end === true || milestone.isMonthEnd === true;
    $('yearEndToggle').checked = milestone.is_year_end === true || milestone.isYearEnd === true;
    if ($('yearEndToggle').checked) $('monthEndToggle').checked = true;
    state.milestone = gatherMilestone();
    updateAchievementSettingsMessage();
  }

  function setPostponedForm(...rowSources) {
    const rows = rowSources.find(source =>
      Array.isArray(source)
      && source.some(row => Object.prototype.hasOwnProperty.call(row || {}, 'has_postponed_matches'))
    ) || [];
    $('postponedToggle').checked = !isChampionsMode() && rows.some(row => row?.has_postponed_matches === true);
    updateAchievementSettingsMessage();
  }

  const LINEUP_DEFAULT_POSITIONS = ['DL', 'DL', 'DL', 'MC', 'MC', 'MC', 'MC', 'DF', 'DF', 'DF', 'PT'];
  const LINEUP_POSITION_LABELS = {
    PT: 'Portero',
    DF: 'Defensa',
    MC: 'Medio',
    DL: 'Delantero'
  };
  const LINEUP_CAPTAIN_MULTIPLIERS = [1.5, 2, 3];
  const LINEUP_EMPTY_PLAYER_ID_PREFIX = 'empty-slot-';
  const LINEUP_EMPTY_PLAYER_NAME = 'Posición vacía';
  const LINEUP_EMPTY_CLUB_NAME = 'Penalización automática';
  const LINEUP_EMPTY_POINTS = -4;

  function lineupEmptyPlayerId(slot) {
    const safeSlot = Number.isInteger(Number(slot)) ? Number(slot) : 0;
    return `${LINEUP_EMPTY_PLAYER_ID_PREFIX}${String(safeSlot).padStart(2, '0')}`;
  }

  function isLineupEmptyPlayer(player) {
    const playerId = String(player?.player_id || '').trim().toLowerCase();
    const playerName = String(player?.player_name || '').trim().toLocaleLowerCase('es');
    return playerId.startsWith(LINEUP_EMPTY_PLAYER_ID_PREFIX)
      || playerName === LINEUP_EMPTY_PLAYER_NAME.toLocaleLowerCase('es');
  }

  function lineupNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function signedDecimalNumber(value) {
    const normalized = String(value ?? '').trim().replace(/−/g, '-').replace(',', '.');
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  }

  function lineupEditorPoints(player, captain, multiplier) {
    const finalPoints = lineupNumber(player?.displayed_points);
    if (finalPoints === null) return null;
    return captain && validCaptainMultiplier(multiplier) ? finalPoints / multiplier : finalPoints;
  }

  function lineupFinalPoints(basePoints, captain, multiplier) {
    if (basePoints === null) return null;
    const finalPoints = captain && validCaptainMultiplier(multiplier)
      ? basePoints * multiplier
      : basePoints;
    return Number(finalPoints.toFixed(6));
  }

  function validCaptainMultiplier(value) {
    return LINEUP_CAPTAIN_MULTIPLIERS.includes(lineupNumber(value));
  }

  function normalizeLineupPlayers(value) {
    if (!Array.isArray(value)) return value === null ? null : [];
    const seenSlots = new Set();
    return value.map((player, index) => {
      const slot = Number(player?.slot_number ?? index + 1);
      const normalizedSlot = Number.isInteger(slot) && slot >= 1 && slot <= 11 ? slot : index + 1;
      const emptyPosition = isLineupEmptyPlayer(player);
      const captain = !emptyPosition && player?.is_captain === true;
      const multiplier = lineupNumber(player?.captain_multiplier);
      const catalogPlayer = emptyPosition ? null : state.catalog?.resolve({
        playerId: player?.player_id,
        playerName: player?.player_name,
        clubId: player?.club_id,
        clubName: player?.club_name
      });
      return {
        slot_number: normalizedSlot,
        player_id: emptyPosition ? lineupEmptyPlayerId(normalizedSlot) : String(player?.player_id || catalogPlayer?.id || '').trim(),
        player_name: emptyPosition ? LINEUP_EMPTY_PLAYER_NAME : String(player?.player_name || catalogPlayer?.displayName || '').trim(),
        club_id: emptyPosition ? '' : String(player?.club_id || catalogPlayer?.clubId || '').trim(),
        club_name: emptyPosition ? LINEUP_EMPTY_CLUB_NAME : String(player?.club_name || catalogPlayer?.clubName || '').trim(),
        position: ['PT', 'DF', 'MC', 'DL'].includes(player?.position)
          ? player.position
          : catalogPlayer?.position || LINEUP_DEFAULT_POSITIONS[index] || 'MC',
        displayed_points: emptyPosition ? LINEUP_EMPTY_POINTS : lineupNumber(player?.displayed_points),
        is_captain: captain,
        captain_multiplier: captain ? (validCaptainMultiplier(multiplier) ? multiplier : 2) : 1
      };
    }).filter(player => {
      if (seenSlots.has(player.slot_number)) return false;
      seenSlots.add(player.slot_number);
      return true;
    }).sort((a, b) => a.slot_number - b.slot_number).slice(0, 11);
  }

  function lineupMetrics(players) {
    const lineup = Array.isArray(players) ? players : [];
    const validPositions = new Set(['PT', 'DF', 'MC', 'DL']);
    const identities = lineup.map(player => {
      const playerId = String(player.player_id || '').trim().toLowerCase();
      if (playerId) return `id:${playerId}`;
      const name = String(player.player_name || '').trim().toLowerCase();
      const club = String(player.club_name || '').trim().toLowerCase();
      return name ? `legacy:${name}|${club}` : '';
    }).filter(Boolean);
    const slots = lineup.map(player => Number(player.slot_number));
    const captains = lineup.filter(player => !isLineupEmptyPlayer(player) && player.is_captain === true);
    const emptyCount = lineup.filter(isLineupEmptyPlayer).length;
    const filled = lineup.filter(player => String(player.player_name || '').trim()).length;
    const pointsComplete = lineup.every(player => lineupNumber(player.displayed_points) !== null);
    const counts = { PT: 0, DF: 0, MC: 0, DL: 0 };
    lineup.forEach(player => {
      if (Object.prototype.hasOwnProperty.call(counts, player.position)) counts[player.position] += 1;
    });
    const duplicatePlayers = identities.length !== new Set(identities).size;
    const validFormation = counts.PT === 1
      && counts.DF >= 3
      && counts.DF <= 5
      && counts.MC >= 2
      && counts.MC <= 6
      && counts.DL >= 0
      && counts.DL <= 4;
    const captainMultiplierValid = captains.length === 0
      || (captains.length === 1 && validCaptainMultiplier(captains[0]?.captain_multiplier));
    const issues = [];
    if (lineup.length !== 11) issues.push(`hay ${lineup.length}/11 jugadores iniciados`);
    if (filled !== lineup.length || (lineup.length === 11 && filled !== 11)) issues.push('faltan nombres');
    if (duplicatePlayers) issues.push('hay jugadores repetidos');
    if (!pointsComplete) issues.push('faltan puntos');
    if (new Set(slots).size !== lineup.length) issues.push('hay puestos repetidos');
    if (!lineup.every(player => validPositions.has(player.position))) issues.push('hay posiciones no válidas');
    if (counts.PT !== 1) issues.push(counts.PT ? 'debe haber un solo portero' : 'falta el portero');
    if (lineup.length === 11 && !validFormation) issues.push('formación no permitida (DF 3–5, MC 2–6, DL 0–4)');
    if (captains.length > 1) issues.push('debe haber como máximo un capitán');
    else if (captains.length === 1 && !captainMultiplierValid) issues.push('el capitán debe usar x1,5, x2 o x3');
    const complete = lineup.length === 11
      && filled === 11
      && pointsComplete
      && new Set(slots).size === 11
      && !duplicatePlayers
      && lineup.every(player => validPositions.has(player.position))
      && validFormation
      && captains.length <= 1
      && captainMultiplierValid;
    const totals = { PT: 0, DF: 0, MC: 0, DL: 0 };
    lineup.forEach(player => {
      if (Object.prototype.hasOwnProperty.call(totals, player.position)) {
        totals[player.position] += lineupNumber(player.displayed_points) || 0;
      }
    });
    return {
      lineup,
      hasContent: lineup.length > 0,
      complete,
      filled,
      captain: captains[0] || null,
      captainCount: captains.length,
      emptyCount,
      totals,
      total: Object.values(totals).reduce((sum, value) => sum + value, 0),
      formation: lineup.length === 11 ? `${counts.DF}-${counts.MC}-${counts.DL}` : '—',
      issues
    };
  }

  function lineupForParticipant(name) {
    return state.lineups.has(name) ? state.lineups.get(name) : null;
  }

  function previousLineupCacheKey({ season = currentSeasonKey(), matchday = state.matchday, name = state.lineupParticipantName } = {}) {
    return `${season}:${matchday}:${name}`;
  }

  function copyablePreviousLineupFromCache() {
    return state.previousLineupCache.get(previousLineupCacheKey()) || null;
  }

  function lineupRosterForNewMatchday(players) {
    return normalizeLineupPlayers(players).map(player => {
      const emptyPosition = isLineupEmptyPlayer(player);
      return {
        ...player,
        displayed_points: emptyPosition ? LINEUP_EMPTY_POINTS : null,
        is_captain: emptyPosition ? false : player.is_captain === true,
        captain_multiplier: emptyPosition
          ? 1
          : player.is_captain === true && validCaptainMultiplier(player.captain_multiplier)
            ? lineupNumber(player.captain_multiplier)
            : 1
      };
    });
  }

  function updateCopyPreviousLineupControl() {
    const button = $('copyPreviousLineupButton');
    const hint = $('copyPreviousLineupHint');
    if (!button || !hint) return;

    const champions = isChampionsMode();
    const locked = state.saving
      || state.matchdayLoading
      || state.matchdayLoadBlocked
      || state.previewOpen
      || state.suspendAutoSave
      || state.backupRestoreOpen
      || state.backupCreating
      || state.backupRestoring
      || (state.published && !state.editingPublished);
    const cached = copyablePreviousLineupFromCache();
    const unavailable = champions
      || state.matchday <= 1
      || !state.lineupParticipantName
      || !state.lineupSchemaReady
      || !state.catalogSchemaReady;

    button.hidden = champions;
    button.disabled = locked || unavailable || state.copyingPreviousLineup;
    button.classList.toggle('loading', state.copyingPreviousLineup);
    button.querySelector('span').textContent = state.copyingPreviousLineup
      ? 'Buscando alineación…'
      : cached
        ? `Copiar alineación de J${cached.matchday}`
        : 'Copiar alineación anterior';

    if (champions) {
      hint.textContent = '';
    } else if (state.matchday <= 1) {
      hint.textContent = 'La Jornada 1 no tiene una alineación anterior.';
    } else if (!state.lineupSchemaReady || !state.catalogSchemaReady) {
      hint.textContent = 'Activa la actualización V116 para copiar alineaciones entre jornadas.';
    } else if (state.published && !state.editingPublished) {
      hint.textContent = 'Pulsa “Corregir jornada” antes de reemplazar esta alineación.';
    } else if (cached) {
      hint.textContent = `Fuente disponible: Jornada ${cached.matchday}. Se copiarán jugadores, posiciones y capitán; los PTS quedarán vacíos.`;
    } else {
      hint.textContent = 'Busca la última alineación completa y publicada; copia jugadores y capitán, pero nunca sus puntos.';
    }
  }

  async function findPreviousPublishedLineup({ season, matchday, name }) {
    const cacheKey = previousLineupCacheKey({ season, matchday, name });
    const cached = state.previousLineupCache.get(cacheKey);
    if (cached) return cached;

    const { data, error } = await state.client
      .from('matchday_stats')
      .select('matchday,lineup')
      .eq('season', season)
      .eq('participant_name', name)
      .eq('published', true)
      .lt('matchday', matchday)
      .order('matchday', { ascending: false });
    if (error) throw error;

    const sourceRow = (Array.isArray(data) ? data : []).find(row => {
      const normalized = normalizeLineupPlayers(row?.lineup);
      return lineupMetrics(normalized).complete;
    });
    if (!sourceRow) return null;

    const source = {
      matchday: Number(sourceRow.matchday),
      lineup: normalizeLineupPlayers(sourceRow.lineup)
    };
    state.previousLineupCache.set(cacheKey, source);
    return source;
  }

  async function copyPreviousPublishedLineup() {
    if (state.copyingPreviousLineup
      || isChampionsMode()
      || state.matchday <= 1
      || !state.lineupParticipantName
      || state.saving
      || state.matchdayLoading
      || state.matchdayLoadBlocked
      || state.previewOpen
      || state.suspendAutoSave
      || state.backupRestoreOpen
      || state.backupCreating
      || state.backupRestoring
      || (state.published && !state.editingPublished)) return;

    updateLineupFromEditor();
    const context = {
      season: currentSeasonKey(),
      matchday: state.matchday,
      name: state.lineupParticipantName,
      loadRequestId: state.loadRequestId,
      copyRequestId: ++state.previousLineupRequestId
    };
    state.copyingPreviousLineup = true;
    syncPublicationUI();
    const contextChanged = () => context.copyRequestId !== state.previousLineupRequestId
      || !state.copyingPreviousLineup
      || context.loadRequestId !== state.loadRequestId
      || context.season !== currentSeasonKey()
      || context.matchday !== state.matchday
      || context.name !== state.lineupParticipantName
      || state.matchdayLoading
      || state.matchdayLoadBlocked
      || state.previewOpen
      || state.suspendAutoSave
      || state.backupRestoreOpen
      || state.backupCreating
      || state.backupRestoring
      || (state.published && !state.editingPublished);

    try {
      const source = await findPreviousPublishedLineup(context);
      if (contextChanged()) return;

      if (!source) {
        const message = `No hay una alineación completa y publicada anterior a la Jornada ${context.matchday} para ${context.name}.`;
        setLineupEditorMessage(message, 'error');
        flashMessage(message, 'error');
        return;
      }

      updateLineupFromEditor();
      const current = lineupMetrics(lineupForParticipant(context.name));
      if (current.hasContent && !window.confirm(
        `¿Reemplazar la alineación actual de ${context.name} por la publicada en la Jornada ${source.matchday}? `
        + 'Los puntos que ya escribiste en este XI se borrarán.'
      )) return;

      const copiedLineup = lineupRosterForNewMatchday(source.lineup);
      state.lineups.set(context.name, copiedLineup);
      renderLineupEditor();
      updateCompletionState();
      scheduleAutoSave();
      const captain = copiedLineup.find(player => player.is_captain === true);
      const captainCopy = captain
        ? ` Capitán: ${captain.player_name} · x${formatLineupNumber(captain.captain_multiplier)}.`
        : '';
      setLineupEditorMessage(
        `Alineación copiada desde la Jornada ${source.matchday}.${captainCopy} Escribe los PTS de esta jornada.`,
        'success'
      );
      flashMessage(`Alineación de ${context.name} copiada desde la Jornada ${source.matchday}. Los puntos anteriores no se copiaron.`);
    } catch (error) {
      if (contextChanged()) return;
      if (isLineupUpgradeError(error)) {
        state.lineupSchemaReady = false;
        renderLineupManagement();
      }
      const message = `No se pudo copiar la alineación anterior. ${friendlyError(error)}`;
      setLineupEditorMessage(message, 'error');
      flashMessage(message, 'error');
    } finally {
      if (context.copyRequestId === state.previousLineupRequestId) {
        state.copyingPreviousLineup = false;
        syncPublicationUI();
      }
    }
  }

  function setLineupData(...rowSources) {
    const next = new Map();
    state.participants.forEach(participant => {
      let resolved = null;
      let found = false;
      for (const source of rowSources) {
        if (!Array.isArray(source)) continue;
        const row = source.find(item => item?.participant_name === participant.name);
        if (!row || !Object.prototype.hasOwnProperty.call(row, 'lineup')) continue;
        // Igual que las RPC: null/ausente conserva la fuente anterior;
        // solo [] significa borrar la alineación de forma explícita.
        if (row.lineup === null || row.lineup === undefined) continue;
        resolved = normalizeLineupPlayers(row.lineup);
        found = true;
        break;
      }
      next.set(participant.name, found ? resolved : null);
    });
    state.lineups = next;
    if (!state.participants.some(participant => participant.name === state.lineupParticipantName)) {
      state.lineupParticipantName = state.participants[0]?.name || '';
    }
  }

  function lineupRowsForEditor(players) {
    const bySlot = new Map((Array.isArray(players) ? players : []).map(player => [Number(player.slot_number), player]));
    return Array.from({ length: 11 }, (_, index) => {
      const slot = index + 1;
      return bySlot.get(slot) || {
        slot_number: slot,
        player_id: '',
        player_name: '',
        club_id: '',
        club_name: '',
        position: LINEUP_DEFAULT_POSITIONS[index],
        displayed_points: null,
        is_captain: false,
        captain_multiplier: 2
      };
    });
  }

  function formatLineupNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return number.toLocaleString('es', { maximumFractionDigits: 2 });
  }

  function currentOfficialPoints() {
    const participant = state.participantIndex.get(state.lineupParticipantName);
    const row = participant
      ? document.querySelector(`.admin-player[data-player-id="${participant.id}"]`)
      : null;
    return inputNumberOrNull(row?.querySelector('[data-stat="points"]'));
  }

  function setLineupEditorMessage(message, type = '') {
    const node = $('lineupEditorMessage');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('error', type === 'error');
    node.classList.toggle('success', type === 'success');
  }

  function updateLineupSummary() {
    if (!$('lineupEditorSummary')) return;
    const metrics = lineupMetrics(lineupForParticipant(state.lineupParticipantName));
    const official = currentOfficialPoints();
    const captainLabel = metrics.captain?.player_name
      ? `${metrics.captain.player_name} · x${formatLineupNumber(metrics.captain.captain_multiplier)}`
      : 'Sin capitán';
    const statusLabel = metrics.complete
      ? `Lista${metrics.emptyCount ? ` · ${metrics.emptyCount} vacía${metrics.emptyCount === 1 ? '' : 's'}` : ''}`
      : metrics.hasContent ? `${metrics.filled}/11` : 'Sin cargar';
    const totalTone = official !== null && metrics.hasContent && Math.abs(metrics.total - official) > 0.01 ? ' is-warning' : '';
    $('lineupEditorSummary').innerHTML = `
      <span class="${metrics.complete ? 'is-ready' : 'is-warning'}"><small>Estado</small><b>${statusLabel}</b></span>
      <span><small>Formación</small><b>${metrics.formation}</b></span>
      <span class="${totalTone.trim()}"><small>Total del XI</small><b>${metrics.hasContent ? formatLineupNumber(metrics.total) : '—'} pts</b></span>
      <span><small>Capitán</small><b>${escapeHtml(captainLabel)}</b></span>`;

    if (metrics.complete && official !== null && Math.abs(metrics.total - official) > 0.01) {
      setLineupEditorMessage(`Revisa la suma: el XI da ${formatLineupNumber(metrics.total)} puntos y el resultado oficial tiene ${formatLineupNumber(official)}. Puedes guardarlo, pero conviene comprobar la captura.`, 'error');
    } else if (metrics.complete) {
      setLineupEditorMessage('Alineación completa. Se guardará y publicará junto con esta jornada.', 'success');
    } else if (metrics.hasContent) {
      setLineupEditorMessage(`Alineación incompleta: ${metrics.issues.join(' · ')}. Puedes guardarla como borrador, pero complétala o vacíala antes de publicar.`, '');
    } else {
      setLineupEditorMessage('La alineación se guardará junto con el borrador de la jornada.', '');
    }
  }

  function updateLineupProgress() {
    if (!$('lineupPublishedCount')) return;
    const complete = state.participants.filter(participant => lineupMetrics(lineupForParticipant(participant.name)).complete).length;
    const partial = state.participants.filter(participant => {
      const metrics = lineupMetrics(lineupForParticipant(participant.name));
      return metrics.hasContent && !metrics.complete;
    }).length;
    $('lineupPublishedCount').textContent = `${complete}/${state.participants.length} completas${partial ? ` · ${partial} parcial${partial === 1 ? '' : 'es'}` : ''}`;
    $('lineupPublishedCount').classList.toggle('complete', complete === state.participants.length);
    const select = $('lineupParticipantSelect');
    if (select) {
      const selected = state.lineupParticipantName;
      select.innerHTML = state.participants.map(participant => {
        const metrics = lineupMetrics(lineupForParticipant(participant.name));
        const status = metrics.complete ? '✓' : metrics.hasContent ? '…' : '○';
        return `<option value="${escapeHtml(participant.name)}">${status} ${escapeHtml(participant.name)}</option>`;
      }).join('');
      select.value = selected;
    }
  }

  function lineupPlayerInitials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return (parts.slice(0, 2).map(part => part.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]/g, '')[0] || '').join('') || 'CL').toUpperCase();
  }

  function lineupCatalogPlayer(player) {
    if (isLineupEmptyPlayer(player)) return null;
    return state.catalog?.resolve({
      playerId: player?.player_id,
      playerName: player?.player_name,
      clubId: player?.club_id,
      clubName: player?.club_name
    }) || null;
  }

  function lineupPlayerPickerMarkup(player, slot) {
    const emptyPosition = isLineupEmptyPlayer(player);
    const catalogPlayer = lineupCatalogPlayer(player);
    const playerId = emptyPosition ? lineupEmptyPlayerId(slot) : String(player?.player_id || catalogPlayer?.id || '').trim();
    const playerName = emptyPosition ? LINEUP_EMPTY_PLAYER_NAME : String(player?.player_name || catalogPlayer?.displayName || '').trim();
    const clubId = emptyPosition ? '' : String(player?.club_id || catalogPlayer?.clubId || '').trim();
    const clubName = emptyPosition ? LINEUP_EMPTY_CLUB_NAME : String(player?.club_name || catalogPlayer?.clubName || '').trim();
    const selected = Boolean(playerName);
    const initials = escapeHtml(lineupPlayerInitials(playerName));
    const portrait = emptyPosition
      ? '<span class="lineup-selected-face is-empty-position" aria-hidden="true">−4</span>'
      : catalogPlayer?.photo
      ? `<span class="lineup-selected-face" aria-hidden="true"><span>${initials}</span><img data-player-catalog-image src="${escapeHtml(catalogPlayer.photo)}" alt="" loading="lazy"></span>`
      : `<span class="lineup-selected-face is-initials" aria-hidden="true"><span>${initials}</span></span>`;
    const crest = catalogPlayer?.crest
      ? `<img data-player-catalog-image src="${escapeHtml(catalogPlayer.crest)}" alt="" loading="lazy">`
      : '';
    return `<span class="lineup-player-fields${selected ? ' has-player' : ''}${emptyPosition ? ' is-empty-position' : ''}">
      <input data-lineup-field="player_id" type="hidden" value="${escapeHtml(playerId)}">
      <input data-lineup-field="player_name" type="hidden" value="${escapeHtml(playerName)}">
      <input data-lineup-field="club_id" type="hidden" value="${escapeHtml(clubId)}">
      <input data-lineup-field="club_name" type="hidden" value="${escapeHtml(clubName)}">
      <button class="lineup-player-picker" data-open-player-catalog type="button" aria-label="${selected ? `Cambiar a ${escapeHtml(playerName)}` : `Buscar jugador para la posición ${slot}`}">
        ${selected ? portrait : '<span class="lineup-picker-plus" aria-hidden="true">＋</span>'}
        <span class="lineup-player-picker-copy">
          <b>${selected ? escapeHtml(playerName) : state.catalog ? 'Buscar jugador' : 'Catálogo no disponible'}</b>
          <small>${selected ? `${crest}<span>${escapeHtml(clubName || 'Club no registrado')}</span>` : state.catalog ? `Catálogo Maestro · ${state.catalog.recordCount} disponibles` : 'Recarga el panel para intentarlo de nuevo'}</small>
        </span>
        <em>${selected ? 'Cambiar' : 'Elegir'}</em>
      </button>
      ${selected ? `<button class="lineup-player-clear" data-clear-lineup-player type="button" aria-label="Quitar a ${escapeHtml(playerName)}">✕</button>` : ''}
    </span>`;
  }

  function renderPlayerCatalogResults() {
    if (!$('playerCatalogResults') || !state.catalog || !state.catalogSlot) return;
    const query = $('playerCatalogSearch').value;
    const position = $('playerCatalogPosition').value;
    const clubId = $('playerCatalogClub').value;
    const excludedIds = gatherLineupEditor()
      .filter(player => player.slot_number !== state.catalogSlot)
      .map(player => player.player_id)
      .filter(Boolean);
    const matches = state.catalog.search(query, { position, clubId, excludeIds: excludedIds, limit: state.catalog.recordCount });
    const visible = matches.slice(0, 60);
    $('playerCatalogResultCount').textContent = matches.length === 1
      ? '1 resultado'
      : `${matches.length} resultados${matches.length > visible.length ? ` · mostrando ${visible.length}` : ''}`;
    $('playerCatalogResults').innerHTML = visible.length
      ? visible.map(player => `<button class="player-catalog-result" type="button" data-catalog-player-id="${escapeHtml(player.id)}">
          <span class="player-catalog-face" aria-hidden="true"><span>${escapeHtml(lineupPlayerInitials(player.displayName))}</span><img data-player-catalog-image src="${escapeHtml(player.photo)}" alt="" loading="lazy"></span>
          <span class="player-catalog-result-copy">
            <b>${escapeHtml(player.displayName)}</b>
            <small>${player.crest ? `<img data-player-catalog-image src="${escapeHtml(player.crest)}" alt="" loading="lazy">` : ''}<span>${escapeHtml(player.clubName)}</span></small>
          </span>
          <em class="position-${player.position.toLowerCase()}">${player.position}</em>
        </button>`).join('')
      : `<div class="player-catalog-empty"><b>No encontramos ese jugador</b><span>Prueba con parte del nombre, cambia la posición o selecciona otro club.</span></div>`;
  }

  function openPlayerCatalog(slot, returnFocus) {
    if (!state.catalog || state.saving || state.matchdayLoading || state.matchdayLoadBlocked || state.copyingPreviousLineup || (state.published && !state.editingPublished)) return;
    updateLineupFromEditor();
    state.catalogSlot = Number(slot);
    state.catalogParticipantName = state.lineupParticipantName;
    state.catalogReturnFocus = returnFocus || null;
    const row = document.querySelector(`.lineup-player-row[data-lineup-slot="${state.catalogSlot}"]`);
    $('playerCatalogSearch').value = '';
    $('playerCatalogPosition').value = row?.querySelector('[data-lineup-field="position"]')?.value || '';
    $('playerCatalogClub').value = '';
    $('playerCatalogSlotLabel').textContent = `Posición ${String(state.catalogSlot).padStart(2, '0')} · ${LINEUP_POSITION_LABELS[$('playerCatalogPosition').value] || 'elige cualquier posición'}`;
    if ($('emptyLineupPositionLabel')) {
      $('emptyLineupPositionLabel').textContent = `${LINEUP_POSITION_LABELS[$('playerCatalogPosition').value] || 'Puesto'} sin futbolista · −4 pts`;
    }
    $('playerCatalogModal').hidden = false;
    document.body.classList.add('catalog-open');
    document.querySelectorAll('.admin-topbar,.admin-main').forEach(node => { node.inert = true; });
    renderPlayerCatalogResults();
    requestAnimationFrame(() => $('playerCatalogSearch').focus());
  }

  function closePlayerCatalog(returnFocus = true) {
    if (!$('playerCatalogModal') || $('playerCatalogModal').hidden) return;
    $('playerCatalogModal').hidden = true;
    document.body.classList.remove('catalog-open');
    document.querySelectorAll('.admin-topbar,.admin-main').forEach(node => { node.inert = false; });
    const focus = state.catalogReturnFocus;
    state.catalogSlot = null;
    state.catalogParticipantName = '';
    state.catalogReturnFocus = null;
    if (returnFocus) focus?.focus?.();
  }

  function trapPlayerCatalogFocus(event) {
    if (event.key !== 'Tab' || $('playerCatalogModal')?.hidden) return;
    const focusable = [...$('playerCatalogModal').querySelectorAll('button,input,select,[tabindex]:not([tabindex="-1"])')]
      .filter(node => !node.disabled && !node.hidden);
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function chooseCatalogPlayer(playerId) {
    const player = state.catalog?.playersById.get(String(playerId || ''));
    const slot = state.catalogSlot;
    if (!player || !slot || state.catalogParticipantName !== state.lineupParticipantName) {
      closePlayerCatalog();
      return;
    }
    const current = gatherLineupEditor();
    const existing = current.find(item => item.slot_number === slot) || {
      slot_number: slot,
      displayed_points: null,
      is_captain: false,
      captain_multiplier: 1
    };
    const replacingEmptyPosition = isLineupEmptyPlayer(existing);
    const next = current.filter(item => item.slot_number !== slot);
    next.push({
      ...existing,
      player_id: player.id,
      player_name: player.displayName,
      club_id: player.clubId,
      club_name: player.clubName,
      position: player.position,
      displayed_points: replacingEmptyPosition ? null : existing.displayed_points,
      is_captain: replacingEmptyPosition ? false : existing.is_captain,
      captain_multiplier: replacingEmptyPosition ? 1 : existing.captain_multiplier
    });
    state.lineups.set(state.lineupParticipantName, normalizeLineupPlayers(next));
    closePlayerCatalog(false);
    renderLineupEditor();
    updateCompletionState();
    scheduleAutoSave();
    requestAnimationFrame(() => document.querySelector(`.lineup-player-row[data-lineup-slot="${slot}"] [data-open-player-catalog]`)?.focus());
  }

  function chooseEmptyLineupSlot() {
    const slot = state.catalogSlot;
    const locked = state.saving || state.matchdayLoading || state.matchdayLoadBlocked || state.copyingPreviousLineup || (state.published && !state.editingPublished);
    if (locked || !slot || state.catalogParticipantName !== state.lineupParticipantName) {
      closePlayerCatalog();
      return;
    }
    const current = gatherLineupEditor();
    const row = document.querySelector(`.lineup-player-row[data-lineup-slot="${slot}"]`);
    const existing = current.find(item => item.slot_number === slot) || {};
    const position = row?.querySelector('[data-lineup-field="position"]')?.value
      || existing.position
      || LINEUP_DEFAULT_POSITIONS[slot - 1]
      || 'MC';
    const next = current.filter(item => item.slot_number !== slot);
    next.push({
      slot_number: slot,
      player_id: lineupEmptyPlayerId(slot),
      player_name: LINEUP_EMPTY_PLAYER_NAME,
      club_id: '',
      club_name: LINEUP_EMPTY_CLUB_NAME,
      position,
      displayed_points: LINEUP_EMPTY_POINTS,
      is_captain: false,
      captain_multiplier: 1
    });
    state.lineups.set(state.lineupParticipantName, normalizeLineupPlayers(next));
    closePlayerCatalog(false);
    renderLineupEditor();
    updateCompletionState();
    scheduleAutoSave();
    requestAnimationFrame(() => document.querySelector(`.lineup-player-row[data-lineup-slot="${slot}"] [data-open-player-catalog]`)?.focus());
  }

  function clearLineupPlayer(slot) {
    updateLineupFromEditor();
    const next = (lineupForParticipant(state.lineupParticipantName) || [])
      .filter(player => Number(player.slot_number) !== Number(slot));
    state.lineups.set(state.lineupParticipantName, normalizeLineupPlayers(next));
    renderLineupEditor();
    updateCompletionState();
    scheduleAutoSave();
  }

  function renderLineupEditor() {
    if (!$('lineupPlayerRows')) return;
    const players = lineupRowsForEditor(lineupForParticipant(state.lineupParticipantName));
    $('lineupPlayerRows').innerHTML = players.map(player => {
      const slot = Number(player.slot_number);
      const emptyPosition = isLineupEmptyPlayer(player);
      const captain = !emptyPosition && player.is_captain === true;
      const multiplier = captain && validCaptainMultiplier(player.captain_multiplier)
        ? lineupNumber(player.captain_multiplier)
        : 2;
      const points = lineupEditorPoints(player, captain, multiplier);
      return `<article class="lineup-player-row${captain ? ' has-captain' : ''}${emptyPosition ? ' is-empty-position' : ''}" data-lineup-slot="${slot}">
        <span class="lineup-slot-number">${String(slot).padStart(2, '0')}</span>
        <select class="lineup-position-select" data-lineup-field="position" aria-label="Posición del jugador ${slot}">
          ${Object.entries(LINEUP_POSITION_LABELS).map(([value, label]) => `<option value="${value}"${player.position === value ? ' selected' : ''}>${value} · ${label}</option>`).join('')}
        </select>
        ${lineupPlayerPickerMarkup(player, slot)}
        <div class="lineup-points-control${points !== null && points < 0 ? ' is-negative' : ''}" data-signed-points-control>
          <input class="lineup-points-input" data-lineup-field="displayed_points" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="${points === null ? '' : points}" placeholder="—" aria-label="${emptyPosition ? `Penalización automática de la posición vacía ${slot}` : `Puntos base del jugador ${slot}; admite negativos`}"${emptyPosition ? ' disabled' : ''}>
          <button class="points-sign-toggle" data-toggle-points-sign type="button" aria-label="Cambiar el signo de los puntos del jugador ${slot}" aria-pressed="${points !== null && points < 0}" title="${emptyPosition ? 'La posición vacía siempre vale −4' : 'Cambiar entre positivo y negativo'}"${emptyPosition ? ' disabled' : ''}>±</button>
        </div>
        <label class="lineup-captain-choice"><input data-lineup-field="is_captain" type="checkbox" name="lineupCaptain" value="${slot}" aria-label="Marcar o quitar capitán en la posición ${slot}"${captain ? ' checked' : ''}${emptyPosition ? ' disabled' : ''}><span>C</span></label>
        <select class="lineup-position-select lineup-multiplier-input" data-lineup-field="captain_multiplier"${captain && !emptyPosition ? '' : ' disabled'} aria-label="Multiplicador del capitán en la posición ${slot}">
          ${LINEUP_CAPTAIN_MULTIPLIERS.map(value => `<option value="${value}"${multiplier === value ? ' selected' : ''}>x${String(value).replace('.', ',')}</option>`).join('')}
        </select>
      </article>`;
    }).join('');
    updateLineupProgress();
    updateLineupSummary();
    syncInputLock();
  }

  function gatherLineupEditor() {
    const players = [...document.querySelectorAll('.lineup-player-row')].map(row => {
      const slot = Number(row.dataset.lineupSlot);
      const playerId = row.querySelector('[data-lineup-field="player_id"]')?.value.trim() || '';
      const playerName = row.querySelector('[data-lineup-field="player_name"]').value.trim();
      const clubId = row.querySelector('[data-lineup-field="club_id"]')?.value.trim() || '';
      const clubName = row.querySelector('[data-lineup-field="club_name"]').value.trim();
      const pointsInput = row.querySelector('[data-lineup-field="displayed_points"]');
      const basePoints = signedDecimalNumber(pointsInput.value);
      const captain = row.querySelector('[data-lineup-field="is_captain"]').checked;
      const multiplierInput = row.querySelector('[data-lineup-field="captain_multiplier"]');
      const multiplier = Number(multiplierInput.value);
      const emptyPosition = isLineupEmptyPlayer({ player_id: playerId, player_name: playerName });
      const position = row.querySelector('[data-lineup-field="position"]').value;
      if (emptyPosition) {
        return {
          slot_number: slot,
          player_id: lineupEmptyPlayerId(slot),
          player_name: LINEUP_EMPTY_PLAYER_NAME,
          club_id: '',
          club_name: LINEUP_EMPTY_CLUB_NAME,
          position,
          displayed_points: LINEUP_EMPTY_POINTS,
          is_captain: false,
          captain_multiplier: 1
        };
      }
      const hasContent = Boolean(playerId || playerName || clubId || clubName || pointsInput.value.trim() || captain);
      if (!hasContent) return null;
      return {
        slot_number: slot,
        player_id: playerId,
        player_name: playerName,
        club_id: clubId,
        club_name: clubName,
        position,
        displayed_points: lineupFinalPoints(basePoints, captain, multiplier),
        is_captain: captain,
        captain_multiplier: captain && Number.isFinite(multiplier) ? multiplier : 1
      };
    }).filter(Boolean);
    return normalizeLineupPlayers(players);
  }

  function updateLineupFromEditor() {
    if (!state.lineupParticipantName) return;
    const previous = lineupForParticipant(state.lineupParticipantName);
    const next = gatherLineupEditor();
    // Abrir o recorrer una alineación intacta no debe convertir null en [].
    // [] se reserva para un vaciado explícito o para una alineación ya editada.
    state.lineups.set(
      state.lineupParticipantName,
      (next.length > 0 || Array.isArray(previous)) ? next : null
    );
    document.querySelectorAll('.lineup-player-row').forEach(row => {
      const name = row.querySelector('[data-lineup-field="player_name"]').value.trim();
      const points = row.querySelector('[data-lineup-field="displayed_points"]').value.trim();
      const captain = row.querySelector('[data-lineup-field="is_captain"]').checked;
      const emptyPosition = row.classList.contains('is-empty-position');
      const hasAny = Boolean(name || points || row.querySelector('[data-lineup-field="club_name"]').value.trim() || captain);
      row.classList.toggle('has-captain', captain);
      row.classList.toggle('is-incomplete', hasAny && !emptyPosition && (!name || signedDecimalNumber(points) === null));
      const multiplier = row.querySelector('[data-lineup-field="captain_multiplier"]');
      multiplier.disabled = emptyPosition || !captain || state.saving || state.matchdayLoading || state.matchdayLoadBlocked || (state.published && !state.editingPublished);
      syncSignedPointsControl(row.querySelector('[data-lineup-field="displayed_points"]'));
    });
    updateLineupProgress();
    updateLineupSummary();
  }

  function renderLineupManagement() {
    if (!$('lineupManagement')) return;
    $('lineupSchemaNotice').hidden = state.lineupSchemaReady && state.catalogSchemaReady;
    $('playerCatalogAvailabilityNotice').hidden = Boolean(state.catalog);
    updateLineupProgress();
    renderLineupEditor();
  }

  function lineupPublicationValidation() {
    const details = state.participants.map(participant => {
      const metrics = lineupMetrics(lineupForParticipant(participant.name));
      return { name: participant.name, metrics };
    }).filter(item => item.metrics.hasContent && !item.metrics.complete);
    return { valid: details.length === 0, partial: details.map(item => item.name), details };
  }

  function hasAnyLineupChange() {
    return [...state.lineups.values()].some(value => Array.isArray(value));
  }

  function restoreParticipantEntryMode() {
    try {
      state.participantEntryMode = localStorage.getItem(PARTICIPANT_ENTRY_MODE_KEY) === 'all' ? 'all' : 'single';
    } catch {
      state.participantEntryMode = 'single';
    }
  }

  function activeParticipantStorageKey() {
    return `${ACTIVE_PARTICIPANT_PREFIX}${currentSeasonKey()}:${state.matchday}`;
  }

  function restoreWorkParticipantSelection() {
    const names = state.participants.map(participant => participant.name);
    if (!names.length) {
      state.lineupParticipantName = '';
      return;
    }
    let stored = '';
    try {
      stored = localStorage.getItem(activeParticipantStorageKey()) || '';
    } catch {}
    if (names.includes(stored)) state.lineupParticipantName = stored;
    else if (!names.includes(state.lineupParticipantName)) state.lineupParticipantName = names[0];
  }

  function rememberWorkParticipantSelection() {
    if (!state.lineupParticipantName) return;
    try {
      localStorage.setItem(activeParticipantStorageKey(), state.lineupParticipantName);
    } catch {}
  }

  function participantStatMetrics(participant) {
    const row = participant
      ? document.querySelector(`.admin-player[data-player-id="${participant.id}"]`)
      : null;
    const inputs = row ? [...row.querySelectorAll('.stat-input')] : [];
    const values = inputs.map(input => inputNumberOrNull(input));
    return {
      row,
      started: values.some(value => value !== null),
      complete: inputs.length === 4 && values.every(value => value !== null)
    };
  }

  function participantWorkMetrics(participant) {
    const stats = participantStatMetrics(participant);
    const lineup = isChampionsMode()
      ? { hasContent: false, complete: true }
      : lineupMetrics(lineupForParticipant(participant?.name));
    const ready = stats.complete && (isChampionsMode() || lineup.complete);
    let tone = 'pending';
    let label = 'Sin comenzar';
    if (ready) {
      tone = 'complete';
      label = isChampionsMode() ? 'Estadísticas completas' : 'Estadísticas y XI completos';
    } else if (!stats.complete) {
      tone = stats.started || lineup.hasContent ? 'partial' : 'pending';
      label = stats.started ? 'Faltan estadísticas' : lineup.hasContent ? 'Faltan estadísticas' : 'Sin comenzar';
    } else if (lineup.hasContent) {
      tone = 'partial';
      label = 'XI incompleto';
    } else {
      tone = 'stats-ready';
      label = 'Estadísticas listas · XI sin cargar';
    }
    return { stats, lineup, ready, tone, label };
  }

  function nextParticipantName({ pendingOnly = false } = {}) {
    const names = state.participants.map(participant => participant.name);
    if (names.length < 2) return '';
    const currentIndex = Math.max(0, names.indexOf(state.lineupParticipantName));
    for (let offset = 1; offset < names.length; offset += 1) {
      const name = names[(currentIndex + offset) % names.length];
      const participant = state.participantIndex.get(name);
      if (!pendingOnly || !participantWorkMetrics(participant).ready) return name;
    }
    return '';
  }

  function updateParticipantWorkflow() {
    if (!$('participantWorkflow')) return;
    restoreWorkParticipantSelection();
    const single = !isChampionsMode() && state.participantEntryMode === 'single';
    const panel = $('panelView');
    panel.classList.toggle('participant-single-mode', single);
    panel.classList.toggle('participant-general-mode', !single);
    $('singleParticipantModeButton').classList.toggle('active', single);
    $('allParticipantsModeButton').classList.toggle('active', !single);
    $('singleParticipantModeButton').setAttribute('aria-pressed', String(single));
    $('allParticipantsModeButton').setAttribute('aria-pressed', String(!single));
    $('participantWorkflowTitle').textContent = single ? 'Completar uno por uno' : 'Vista general';
    $('participantWorkflowDescription').textContent = single
      ? 'Trabaja las estadísticas y la alineación del mismo participante, guarda y continúa sin volver a buscarlo.'
      : 'Revisa todos los participantes juntos y elige manualmente la alineación que deseas editar.';

    const participants = state.participants;
    const metrics = participants.map(participant => ({
      participant,
      work: participantWorkMetrics(participant)
    }));
    const statsComplete = metrics.filter(item => item.work.stats.complete).length;
    const lineupsComplete = isChampionsMode()
      ? participants.length
      : metrics.filter(item => item.work.lineup.complete).length;
    const total = participants.length;
    $('participantStatsProgress').textContent = `${statsComplete}/${total}`;
    $('participantLineupsProgress').textContent = `${lineupsComplete}/${total}`;
    $('participantStatsProgressBar').style.width = `${total ? (statsComplete / total) * 100 : 0}%`;
    $('participantLineupsProgressBar').style.width = `${total ? (lineupsComplete / total) * 100 : 0}%`;
    $('participantStatsProgressBar').setAttribute('aria-valuemax', String(total));
    $('participantStatsProgressBar').setAttribute('aria-valuenow', String(statsComplete));
    $('participantLineupsProgressBar').setAttribute('aria-valuemax', String(total));
    $('participantLineupsProgressBar').setAttribute('aria-valuenow', String(lineupsComplete));

    const selectedName = state.lineupParticipantName;
    const selectedIndex = participants.findIndex(participant => participant.name === selectedName);
    const selectedItem = metrics.find(item => item.participant.name === selectedName) || null;
    const select = $('singleParticipantSelect');
    select.innerHTML = metrics.map(item => {
      const prefix = item.work.ready
        ? '✓'
        : item.work.stats.complete
          ? '•'
          : item.work.stats.started || item.work.lineup.hasContent
            ? '…'
            : '○';
      return `<option value="${escapeHtml(item.participant.name)}">${prefix} ${escapeHtml(item.participant.name)}</option>`;
    }).join('');
    select.value = selectedName;

    document.querySelectorAll('.admin-player').forEach(row => {
      const participant = state.participants.find(item => item.id === Number(row.dataset.playerId));
      row.classList.toggle('is-current', participant?.name === selectedName);
    });
    document.querySelectorAll('.champions-admin-group').forEach(group => {
      group.classList.toggle('has-current', Boolean(group.querySelector('.admin-player.is-current')));
    });

    $('entryTitle').textContent = single && selectedName
      ? `Estadísticas de ${selectedName}`
      : isChampionsMode()
        ? `${total} competidores · 4 grupos`
        : `${total} participantes`;
    $('lineupManagementTitle').textContent = single && selectedName
      ? `El once de ${selectedName}`
      : 'El once de cada participante';

    const status = selectedItem?.work || { tone: 'pending', label: 'Sin comenzar', ready: false };
    const statusNode = $('activeParticipantStatus');
    statusNode.className = `participant-status-badge ${status.tone}`;
    statusNode.innerHTML = `<i></i> ${escapeHtml(status.label)}`;
    $('activeParticipantPosition').textContent = total
      ? `Participante ${Math.max(0, selectedIndex) + 1} de ${total}`
      : 'Sin participantes';

    const busy = state.saving || state.matchdayLoading || state.matchdayLoadBlocked || state.copyingPreviousLineup;
    const nextPending = nextParticipantName({ pendingOnly: true });
    $('previousParticipantButton').disabled = busy || total < 2;
    $('nextParticipantButton').disabled = busy || total < 2;
    select.disabled = busy || total === 0;
    $('singleParticipantModeButton').disabled = state.saving || state.matchdayLoading || state.copyingPreviousLineup;
    $('allParticipantsModeButton').disabled = state.saving || state.matchdayLoading || state.copyingPreviousLineup;
    $('nextPendingParticipantButton').disabled = busy || !nextPending;
    $('nextPendingParticipantButton').textContent = nextPending
      ? 'Ir al próximo pendiente'
      : status.ready ? 'Todo listo' : 'Último pendiente';
  }

  function setParticipantEntryMode(mode) {
    const normalized = mode === 'all' ? 'all' : 'single';
    if (normalized === state.participantEntryMode) return;
    state.participantEntryMode = normalized;
    try {
      localStorage.setItem(PARTICIPANT_ENTRY_MODE_KEY, normalized);
    } catch {}
    syncPublicationUI();
  }

  function selectWorkParticipant(name, { scroll = false } = {}) {
    if (state.copyingPreviousLineup) return false;
    if (!state.participants.some(participant => participant.name === name)) return false;
    const changed = name !== state.lineupParticipantName;
    if (changed && !isChampionsMode() && document.querySelector('.lineup-player-row')) {
      updateLineupFromEditor();
    }
    state.lineupParticipantName = name;
    rememberWorkParticipantSelection();
    if (!isChampionsMode() && changed) renderLineupEditor();
    updateParticipantWorkflow();
    if (scroll) {
      requestAnimationFrame(() => $('participantWorkflow').scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
    return true;
  }

  function moveWorkParticipant(direction, { scroll = false } = {}) {
    const participants = state.participants;
    if (participants.length < 2) return false;
    const currentIndex = Math.max(0, participants.findIndex(participant => participant.name === state.lineupParticipantName));
    const nextIndex = (currentIndex + direction + participants.length) % participants.length;
    return selectWorkParticipant(participants[nextIndex].name, { scroll });
  }

  function moveToNextPendingParticipant() {
    const name = nextParticipantName({ pendingOnly: true });
    if (!name) return false;
    return selectWorkParticipant(name);
  }

  async function saveDraftAndContinue() {
    if (isChampionsMode() || state.copyingPreviousLineup) return;
    const selectedBeforeSave = state.lineupParticipantName;
    const loadRequestBeforeSave = state.loadRequestId;
    if (state.participantEntryMode === 'single' && !isChampionsMode()) updateLineupFromEditor();
    const waitingForAutoSave = Boolean(state.autoSavePromise);
    if (waitingForAutoSave) setButtonsBusy(true);
    try {
      // Si el autoguardado anterior sigue en curso, espera y vuelve a guardar
      // la versión más reciente antes de cambiar de participante.
      if (state.autoSavePromise) {
        const autoSaved = await state.autoSavePromise;
        if (autoSaved === false
          || loadRequestBeforeSave !== state.loadRequestId
          || selectedBeforeSave !== state.lineupParticipantName) return;
      }
      const saved = await persistDraft({ manual: true });
      if (!saved
        || loadRequestBeforeSave !== state.loadRequestId
        || selectedBeforeSave !== state.lineupParticipantName) return;
      moveWorkParticipant(1, { scroll: true });
    } finally {
      if (waitingForAutoSave && state.saving) {
        setButtonsBusy(false);
        syncPublicationUI();
      }
    }
  }

  function setButtonsBusy(busy) {
    state.saving = busy;
    [
      $('saveDraftButton'),
      $('publishButton'),
      $('leagueModeButton'),
      $('championsModeButton'),
      $('editPublishedButton'),
      $('undoPublicationButton'),
      $('confirmPublishButton'),
      $('singleParticipantModeButton'),
      $('allParticipantsModeButton'),
      $('previousParticipantButton'),
      $('nextParticipantButton'),
      $('nextPendingParticipantButton'),
      $('copyPreviousLineupButton'),
      $('importMisterButton')
    ].filter(Boolean).forEach(button => {
      button.disabled = busy;
    });
    $('matchdaySelect').disabled = busy || state.matchdayLoading;
    if ($('lineupParticipantSelect')) $('lineupParticipantSelect').disabled = busy;
    if ($('singleParticipantSelect')) $('singleParticipantSelect').disabled = busy;
    if ($('clearLineupButton')) $('clearLineupButton').disabled = busy;
    ['matchdayDate', 'monthEndToggle', 'yearEndToggle', 'postponedToggle'].forEach(id => {
      $(id).disabled = busy || state.matchdayLoading;
    });
    if (busy) {
      $('saveDraftButton').querySelector('span').textContent = 'Guardando…';
      $('publishButton').querySelector('span').textContent = 'Procesando…';
      $('confirmPublishButton').querySelector('span').textContent = 'Publicando…';
    }
    syncPublicationUI();
    if ($('backupContent')) setBackupControlsBusy(state.backupLoading);
  }

  function markDirty(dirty = true, label = '') {
    state.dirty = dirty;
    const node = $('changeState');
    node.classList.toggle('dirty', dirty);
    node.innerHTML = dirty
      ? `<i></i> ${label || 'Guardando borrador automáticamente…'}`
      : `<i></i> ${label || (state.hasDraft ? 'Borrador guardado automáticamente' : 'Todos los cambios guardados')}`;
  }

  function setWorkflowStep(step) {
    const order = ['draft', 'review', 'published'];
    const activeIndex = order.indexOf(step);
    document.querySelectorAll('[data-workflow-step]').forEach((item, index) => {
      item.classList.toggle('active', index === activeIndex);
      item.classList.toggle('complete', index < activeIndex);
    });
    document.querySelectorAll('.admin-workflow>i').forEach((line, index) => {
      line.classList.toggle('complete', index < activeIndex);
    });
  }

  function inputNumberOrNull(input) {
    if (!input || input.value.trim() === '') return null;
    const value = signedDecimalNumber(input.value);
    return Number.isInteger(value) ? value : null;
  }

  function syncSignedPointsControl(input) {
    if (!input) return;
    const raw = input.value.trim().replace(/−/g, '-');
    const negative = raw.startsWith('-');
    const control = input.closest('[data-signed-points-control]');
    control?.classList.toggle('is-negative', negative);
    const button = control?.querySelector('[data-toggle-points-sign]');
    if (button) button.setAttribute('aria-pressed', String(negative));
  }

  function togglePointsSign(button) {
    const input = button?.closest('[data-signed-points-control]')?.querySelector('input');
    if (!input || input.disabled || button.disabled) return;
    const raw = input.value.trim().replace(/−/g, '-');
    const value = signedDecimalNumber(raw);
    if (raw.startsWith('-')) input.value = raw.slice(1);
    else if (value !== null) input.value = String(-value);
    else input.value = '-';
    syncSignedPointsControl(input);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    requestAnimationFrame(() => {
      try { input.setSelectionRange(input.value.length, input.value.length); } catch {}
    });
  }

  function valueFor(input) {
    return inputNumberOrNull(input) ?? 0;
  }

  function updateTotals() {
    const rows = [...document.querySelectorAll('.admin-player')];
    const total = stat => rows.reduce((sum, row) => {
      const input = row.querySelector(`[data-stat="${stat}"]`);
      return sum + (input ? valueFor(input) : 0);
    }, 0);
    $('pointsTotal').textContent = total('points').toLocaleString();
    $('goalsTotal').textContent = total('goals').toLocaleString();
    $('cleanSheetsTotal').textContent = total('clean_sheets').toLocaleString();
    $('redCardsTotal').textContent = total('red_cards').toLocaleString();
  }

  function validationState() {
    const missing = [];
    const complete = [];
    const automatic = isChampionsMode();
    document.querySelectorAll('.admin-player').forEach(node => {
      const participant = state.participants.find(item => item.id === Number(node.dataset.playerId));
      const inputs = [...node.querySelectorAll('.stat-input')];
      const rowComplete = inputs.length === 4 && inputs.every(input => inputNumberOrNull(input) !== null);
      node.classList.toggle('is-incomplete', !automatic && !rowComplete);
      inputs.forEach(input => input.classList.toggle('is-missing', !automatic && inputNumberOrNull(input) === null));
      if (rowComplete) complete.push(participant?.name);
      else if (participant) missing.push(participant.name);
    });
    return { missing, complete, total: state.participants.length };
  }

  function updateCompletionState() {
    const result = validationState();
    const locked = state.published && !state.editingPublished;
    const card = $('completionCard');

    if (isChampionsMode()) {
      const details = championsSyncDetails();
      const championsLabel = `Champions J${state.matchday}`;
      const sourceLabel = `Liga J${details.sourceMatchday || '—'}`;
      card.classList.toggle('warning', details.status !== 'synced');
      card.classList.toggle('complete', details.status === 'synced');
      card.classList.toggle('published-locked', details.status !== 'pending');
      card.classList.add('champions-automatic-state');
      $('completionProgress').style.width = `${details.total ? (details.synchronized / details.total) * 100 : 0}%`;
      $('editPublishedButton').hidden = true;
      if (details.status === 'synced') {
        $('completionTitle').textContent = `${championsLabel} sincronizada`;
        $('completionMessage').textContent = `${championsLabel} se alimenta de ${sourceLabel}. Los datos publicados están protegidos y no se vuelven a introducir aquí.`;
        $('missingParticipants').textContent = `${details.synchronized}/${details.total} participantes · 4 grupos actualizados`;
      } else if (details.status === 'provisional') {
        $('completionTitle').textContent = `${championsLabel} provisional`;
        $('completionMessage').textContent = details.postponed
          ? `${championsLabel} se alimenta de ${sourceLabel}. La jornada fuente tiene partidos aplazados y seguirá provisional hasta corregirla en Liga.`
          : `${championsLabel} se alimenta de ${sourceLabel}. Solo hay ${details.synchronized} de ${details.total} participantes con estadísticas completas.`;
        $('missingParticipants').textContent = details.postponed
          ? `${details.synchronized}/${details.total} participantes · partidos aplazados`
          : `${details.synchronized}/${details.total} participantes sincronizados`;
      } else {
        $('completionTitle').textContent = `${championsLabel} pendiente`;
        $('completionMessage').textContent = `${championsLabel} se alimenta de ${sourceLabel}. Publica esa jornada de Liga para llenar automáticamente los cuatro grupos.`;
        $('missingParticipants').textContent = `Esperando ${sourceLabel} · no se creó ningún borrador de Champions`;
      }
      $('publishButton').disabled = true;
      updateParticipantWorkflow();
      return result;
    }

    card.classList.remove('champions-automatic-state');
    const percent = result.total ? Math.round((result.complete.length / result.total) * 100) : 0;
    card.classList.toggle('warning', result.missing.length > 0 && !locked);
    card.classList.toggle('complete', result.missing.length === 0 && !locked);
    card.classList.toggle('published-locked', locked);
    $('completionProgress').style.width = `${locked ? 100 : percent}%`;
    $('editPublishedButton').hidden = !locked;

    if (locked) {
      const postponed = hasPostponedMatches();
      $('completionTitle').textContent = postponed ? 'Jornada publicada y pendiente' : 'Jornada publicada y protegida';
      $('completionMessage').textContent = postponed
        ? 'La Liga sigue visible y la Copa está en pausa. Cuando se juegue el partido, pulsa “Corregir jornada”, completa los datos y desmarca la opción.'
        : 'La web pública no cambiará por accidente. Pulsa “Corregir jornada” para preparar una nueva versión.';
      $('missingParticipants').textContent = postponed
        ? 'Partido aplazado · eliminación de Copa sin confirmar'
        : 'Publicación activa · edición bloqueada';
    } else if (result.missing.length) {
      $('completionTitle').textContent = `Faltan ${result.missing.length} de ${result.total} participantes`;
      $('completionMessage').textContent = 'Completa PTS, GOL, CS y TR de todos. PTS admite negativos con el botón ±; los demás valores deben ser 0 o más.';
      const visible = result.missing.slice(0, 6);
      $('missingParticipants').textContent = `Pendientes: ${visible.join(', ')}${result.missing.length > visible.length ? ` y ${result.missing.length - visible.length} más` : ''}`;
    } else {
      const postponed = hasPostponedMatches();
      $('completionTitle').textContent = postponed
        ? `Datos de los ${result.total} participantes cargados`
        : `Los ${result.total} participantes están completos`;
      $('completionMessage').textContent = postponed
        ? 'Puedes publicar los datos actuales. La jornada seguirá pendiente y la Copa no confirmará eliminados.'
        : 'Todo está listo. Abre la vista previa y revisa los datos antes de publicarlos.';
      $('missingParticipants').textContent = postponed
        ? 'Datos cargados · jornada pendiente por partido aplazado'
        : 'Validación completa · sin participantes pendientes';
    }

    if (!state.redCardsSchemaReady && !locked) {
      $('completionTitle').textContent = 'Falta activar tarjetas rojas en Supabase';
      $('completionMessage').textContent = 'Ejecuta el archivo V65 una sola vez. El borrador permanecerá guardado en este dispositivo.';
      $('missingParticipants').textContent = 'Actualización V65 pendiente';
    }

    const lineupCheck = isChampionsMode() ? { valid: true } : lineupPublicationValidation();
    const canPreview = !locked
      && result.missing.length === 0
      && state.schemaReady
      && state.redCardsSchemaReady
      && (!hasPostponedMatches() || state.postponedSchemaReady)
      && lineupCheck.valid
      && (!hasAnyLineupChange() || (state.lineupSchemaReady && state.catalogSchemaReady))
      && !state.saving
      && !state.matchdayLoading
      && !state.matchdayLoadBlocked
      && !state.copyingPreviousLineup;
    $('publishButton').disabled = !canPreview;
    updateParticipantWorkflow();
    return result;
  }

  function syncInputLock() {
    const locked = state.saving
      || state.matchdayLoading
      || state.matchdayLoadBlocked
      || state.copyingPreviousLineup
      || isChampionsMode()
      || (state.published && !state.editingPublished);
    document.querySelectorAll('.stat-input').forEach(input => {
      input.disabled = locked;
    });
    ['matchdayDate', 'monthEndToggle', 'yearEndToggle', 'postponedToggle'].forEach(id => {
      $(id).disabled = locked || isChampionsMode();
    });
    $('entryTitle').closest('.entry-card').classList.toggle('is-locked', isChampionsMode() || (locked && state.published));
    $('achievementSettings').classList.toggle('is-locked', locked && state.published);
    document.querySelectorAll('[data-lineup-field]').forEach(input => {
      const captainMultiplier = input.dataset.lineupField === 'captain_multiplier';
      const row = input.closest('.lineup-player-row');
      const emptyPosition = row?.classList.contains('is-empty-position') === true;
      const captainChecked = row?.querySelector('[data-lineup-field="is_captain"]')?.checked === true;
      const catalogPosition = input.dataset.lineupField === 'position'
        && Boolean(row?.querySelector('[data-lineup-field="player_id"]')?.value.trim())
        && !emptyPosition;
      const emptyLockedField = emptyPosition && ['displayed_points', 'is_captain', 'captain_multiplier'].includes(input.dataset.lineupField);
      input.disabled = locked || catalogPosition || emptyLockedField || (captainMultiplier && !captainChecked);
    });
    document.querySelectorAll('[data-open-player-catalog],[data-clear-lineup-player]').forEach(button => {
      button.disabled = locked || !state.catalog;
    });
    document.querySelectorAll('[data-toggle-points-sign]').forEach(button => {
      button.disabled = locked || button.closest('.lineup-player-row')?.classList.contains('is-empty-position');
    });
    if ($('selectEmptyLineupSlot')) $('selectEmptyLineupSlot').disabled = locked;
    if ($('lineupParticipantSelect')) {
      $('lineupParticipantSelect').disabled = state.saving
        || state.matchdayLoading
        || state.matchdayLoadBlocked
        || state.copyingPreviousLineup;
    }
    if ($('clearLineupButton')) $('clearLineupButton').disabled = locked;
    updateCopyPreviousLineupControl();
    $('lineupManagement')?.classList.toggle('is-locked', locked && state.published);
  }

  function syncPublicationUI() {
    const locked = state.published && !state.editingPublished;
    syncMisterImportUI();
    const badge = $('publicationBadge');

    if (isChampionsMode()) {
      const details = championsSyncDetails();
      const label = details.status === 'synced'
        ? 'Sincronizada'
        : details.status === 'provisional'
          ? 'Provisional'
          : 'Pendiente';
      state.championsSyncStatus = details.status;
      badge.classList.toggle('published', details.status === 'synced');
      badge.classList.toggle('draft', details.status === 'pending');
      badge.classList.remove('editing');
      badge.classList.toggle('pending', details.status === 'provisional');
      badge.classList.add('automatic');
      badge.querySelector('b').textContent = label;
      $('dockMatchday').textContent = state.matchday;
      $('dockSeason').textContent = `Champions · fuente Liga J${details.sourceMatchday || '—'}`;
      $('saveDraftButton').querySelector('span').textContent = 'Automática';
      $('publishButton').querySelector('span').textContent = 'Se publica desde Liga';
      $('saveDraftButton').disabled = true;
      $('publishButton').disabled = true;
      $('editPublishedButton').hidden = true;
      $('editPublishedButton').disabled = true;
      $('undoPublicationButton').disabled = true;
      $('confirmPublishButton').disabled = true;
      $('matchdaySelect').disabled = state.saving || state.matchdayLoading;
      $('leagueModeButton').disabled = state.saving || state.matchdayLoading;
      $('championsModeButton').disabled = state.saving || state.matchdayLoading;
      $('logoutButton').disabled = state.copyingPreviousLineup;
      syncInputLock();
      updateCompletionState();
      setWorkflowStep(details.status === 'pending' ? 'draft' : 'published');
      markDirty(false, details.status === 'pending' ? 'Esperando la jornada de Liga' : 'Sincronización automática protegida');
      updateChampionsAutomationNotice();
      if ($('backupContent')) setBackupControlsBusy(state.backupLoading);
      return;
    }

    badge.classList.remove('automatic');
    badge.classList.toggle('published', state.published);
    badge.classList.toggle('draft', !state.published || state.editingPublished);
    badge.classList.toggle('editing', state.editingPublished);
    badge.classList.toggle('pending', state.published && hasPostponedMatches());
    badge.querySelector('b').textContent = state.editingPublished
      ? 'Corrección en borrador'
      : state.published
        ? hasPostponedMatches() ? 'Publicada · pendiente' : 'Publicada · completa'
        : 'Borrador';

    $('saveDraftButton').querySelector('span').textContent = state.saving
      ? 'Guardando…'
      : state.participantEntryMode === 'single'
        ? 'Guardar y siguiente'
        : 'Guardar ahora';
    $('publishButton').querySelector('span').textContent = state.saving
      ? 'Procesando…'
      : state.editingPublished
        ? 'Revisar corrección'
        : state.published
          ? 'Publicada'
          : 'Vista previa';
    $('confirmPublishButton').querySelector('span').textContent = state.saving
      ? 'Publicando…'
      : state.published
        ? hasPostponedMatches()
          ? 'Guardar como pendiente'
          : publishedWasPostponed()
            ? 'Completar jornada'
            : 'Confirmar corrección'
        : hasPostponedMatches() ? 'Publicar como pendiente' : 'Confirmar publicación';
    $('confirmPublishButton').disabled = state.saving || state.matchdayLoading || state.matchdayLoadBlocked;

    $('dockMatchday').textContent = state.matchday;
    $('dockSeason').textContent = isChampionsMode() ? 'Champions · fase de grupos' : config.season;
    $('saveDraftButton').disabled = state.saving || state.matchdayLoading || state.matchdayLoadBlocked || state.copyingPreviousLineup || locked;
    $('matchdaySelect').disabled = state.saving || state.matchdayLoading || state.copyingPreviousLineup;
    $('leagueModeButton').disabled = state.saving || state.matchdayLoading || state.copyingPreviousLineup;
    $('championsModeButton').disabled = state.saving || state.matchdayLoading || state.copyingPreviousLineup;
    $('editPublishedButton').disabled = state.saving || state.matchdayLoading || state.matchdayLoadBlocked || state.copyingPreviousLineup || !state.published;
    $('logoutButton').disabled = state.copyingPreviousLineup;
    syncInputLock();
    updateCompletionState();

    const activeRevision = state.history.find(item => !item.undone);
    $('undoPublicationButton').disabled = state.saving || state.matchdayLoading || state.matchdayLoadBlocked || state.copyingPreviousLineup || !activeRevision || state.editingPublished || !state.schemaReady;
    setWorkflowStep(state.previewOpen ? 'review' : locked ? 'published' : 'draft');

    if (locked && !state.saving) {
      markDirty(false, 'Publicación protegida');
    }
    updateChampionsAutomationNotice();
    if ($('backupContent')) setBackupControlsBusy(state.backupLoading);
  }

  function formatSavedAt(rows) {
    if (!rows.length) return 'Todavía no guardada';
    const latest = rows.reduce((result, row) => {
      const date = new Date(row.updated_at || row.saved_at || row.created_at);
      return !result || date > result ? date : result;
    }, null);
    if (!latest || Number.isNaN(latest.getTime())) return 'Guardada';
    return formatDate(latest, 'Guardada ');
  }

  function fieldValue(row, field) {
    if (!row || !Object.prototype.hasOwnProperty.call(row, field) || row[field] === null || row[field] === undefined) return '';
    const value = Number(row[field]);
    return Number.isFinite(value) ? value : '';
  }

  function renderAdminPlayer(participant, row, subtitle) {
    const champions = isChampionsMode();
    const name = escapeHtml(participant.name);
    const shield = escapeHtml(participant.shield);
    const playerId = Number(participant.id);
    const inputPrefix = champions ? 'champions' : 'league';
    const protectedAttributes = champions ? ' disabled aria-readonly="true"' : '';
    return `
      <article class="admin-player${champions ? ' champions-admin-player' : ''}" data-player-id="${playerId}">
        <div class="admin-player-info">
          <img src="${shield}" alt="">
          <span><b>${name}</b><small>${escapeHtml(subtitle)}</small></span>
        </div>
        <div class="stat-input-wrap has-sign-toggle${Number(fieldValue(row, 'points')) < 0 ? ' is-negative' : ''}" data-signed-points-control>
          <label for="${inputPrefix}-points-${playerId}">PTS</label>
          <input class="stat-input" id="${inputPrefix}-points-${playerId}" data-stat="points" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" value="${fieldValue(row, 'points')}" placeholder="—" aria-label="Puntos de ${name}; admite negativos"${protectedAttributes}>
          <button class="points-sign-toggle" data-toggle-points-sign type="button" aria-label="Cambiar el signo de los puntos de ${name}" aria-pressed="${Number(fieldValue(row, 'points')) < 0}" title="Cambiar entre positivo y negativo"${champions ? ' disabled' : ''}>±</button>
        </div>
        <div class="stat-input-wrap">
          <label for="${inputPrefix}-goals-${playerId}">GOL</label>
          <input class="stat-input" id="${inputPrefix}-goals-${playerId}" data-stat="goals" type="number" inputmode="numeric" min="0" step="1" value="${fieldValue(row, 'goals')}" placeholder="—" aria-label="Goles de ${name}"${protectedAttributes}>
        </div>
        <div class="stat-input-wrap">
          <label for="${inputPrefix}-clean-sheets-${playerId}">CS</label>
          <input class="stat-input" id="${inputPrefix}-clean-sheets-${playerId}" data-stat="clean_sheets" type="number" inputmode="numeric" min="0" step="1" value="${fieldValue(row, 'clean_sheets')}" placeholder="—" aria-label="Clean sheets de ${name}"${protectedAttributes}>
        </div>
        <div class="stat-input-wrap">
          <label for="${inputPrefix}-red-cards-${playerId}">TR</label>
          <input class="stat-input" id="${inputPrefix}-red-cards-${playerId}" data-stat="red_cards" type="number" inputmode="numeric" min="0" step="1" value="${fieldValue(row, 'red_cards')}" placeholder="—" aria-label="Tarjetas rojas de ${name}"${protectedAttributes}>
        </div>
      </article>`;
  }

  function renderPlayerRows(records = []) {
    const recordMap = new Map(records.map(row => [row.participant_name, row]));
    if (isChampionsMode()) {
      $('playerRows').innerHTML = state.championsGroups.map(group => {
        const groupPlayers = group.teams
          .map(name => state.participantIndex.get(name))
          .filter(Boolean);
        return `<section class="champions-admin-group">
          <header>
            <span class="champions-admin-shield">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4.5 6v5.5c0 4.8 3 7.9 7.5 9.5 4.5-1.6 7.5-4.7 7.5-9.5V6L12 3Z"/></svg>
            </span>
            <span><b>${escapeHtml(group.name)}</b><small>5 competidores · Champions J${state.matchday} · fuente Liga J${championsSourceMatchday() || '—'}</small></span>
          </header>
          <div>${groupPlayers.map(participant =>
            renderAdminPlayer(participant, recordMap.get(participant.name) || {}, group.name)
          ).join('')}</div>
        </section>`;
      }).join('');
    } else {
      $('playerRows').innerHTML = state.participants.map((participant, index) =>
        renderAdminPlayer(
          participant,
          recordMap.get(participant.name) || {},
          `Participante ${String(index + 1).padStart(2, '0')}`
        )
      ).join('');
    }
    updateTotals();
    syncPublicationUI();
  }

  function gatherRows(published, allowIncomplete = false) {
    return [...document.querySelectorAll('.admin-player')].map(node => {
      const participant = state.participants.find(item => item.id === Number(node.dataset.playerId));
      const points = inputNumberOrNull(node.querySelector('[data-stat="points"]'));
      const goals = inputNumberOrNull(node.querySelector('[data-stat="goals"]'));
      const cleanSheets = inputNumberOrNull(node.querySelector('[data-stat="clean_sheets"]'));
      const redCards = inputNumberOrNull(node.querySelector('[data-stat="red_cards"]'));
      if (!participant) throw new Error('No se pudo identificar uno de los participantes.');
      if (!allowIncomplete && (points === null || goals === null || cleanSheets === null || redCards === null)) {
        throw new Error(`Faltan datos de ${participant.name}.`);
      }
      if ((goals !== null && goals < 0) || (cleanSheets !== null && cleanSheets < 0) || (redCards !== null && redCards < 0)) {
        throw new Error(`Los goles, clean sheets y tarjetas rojas de ${participant.name} no pueden ser negativos.`);
      }
      return {
        season: currentSeasonKey(),
        matchday: state.matchday,
        participant_name: participant.name,
        points,
        goals,
        clean_sheets: cleanSheets,
        red_cards: redCards,
        has_postponed_matches: hasPostponedMatches(),
        lineup: state.lineups.has(participant.name) ? state.lineups.get(participant.name) : null,
        published
      };
    });
  }

  function saveLocalDraft(rows, {
    cloudSynced = false,
    milestone = null,
    cloudWriteRevision = state.matchdayWriteRevision
  } = {}) {
    if (isChampionsMode()) return;
    try {
      localStorage.setItem(localDraftKey(), JSON.stringify({
        savedAt: new Date().toISOString(),
        restoreGeneration: state.matchdayRestoreGeneration || state.serverRestoreGeneration || '',
        cloudSynced,
        cloudWriteRevision: cloudWriteRevision || '',
        rows,
        milestone: isChampionsMode() ? null : milestone || gatherMilestone()
      }));
    } catch {
      // El guardado en Supabase sigue funcionando aunque el navegador bloquee localStorage.
    }
  }

  function readLocalDraft() {
    try {
      const raw = localStorage.getItem(localDraftKey());
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed?.rows)) return null;
      const persistedCutoff = localStorage.getItem(LOCAL_DRAFT_RESTORE_CUTOFF_KEY) || '';
      const cutoffTime = Math.max(
        Number.isFinite(Date.parse(state.localDraftRestoreCutoff)) ? Date.parse(state.localDraftRestoreCutoff) : 0,
        Number.isFinite(Date.parse(persistedCutoff)) ? Date.parse(persistedCutoff) : 0
      );
      const savedTime = Date.parse(parsed.savedAt || '');
      if (cutoffTime > 0 && (!Number.isFinite(savedTime) || savedTime <= cutoffTime)) return null;
      if (!state.restoreStateChecked) return null;
      let restoreGenerationCurrent = true;
      if (state.restoreStateAvailable) {
        const draftGeneration = String(parsed.restoreGeneration || '');
        if (!draftGeneration || draftGeneration !== state.serverRestoreGeneration) {
          archiveCurrentLocalDraft();
          state.localDraftArchivedOnLoad = true;
          return null;
        }
        restoreGenerationCurrent = draftGeneration === state.serverRestoreGeneration;
      }
      const expected = new Set(state.participants.map(participant => participant.name));
      const rows = parsed.rows.filter(row => expected.has(row.participant_name));
      return rows.length ? {
        rows,
        savedAt: parsed.savedAt,
        milestone: parsed.milestone || null,
        cloudSynced: parsed.cloudSynced === true && restoreGenerationCurrent,
        cloudWriteRevision: String(parsed.cloudWriteRevision || '')
      } : null;
    } catch {
      return null;
    }
  }

  function clearLocalDraft() {
    try {
      localStorage.removeItem(localDraftKey());
    } catch {
      // Sin acción adicional.
    }
  }

  function archiveCurrentLocalDraft() {
    try {
      const key = localDraftKey();
      const raw = localStorage.getItem(key);
      if (raw === null) return false;
      const suffix = new Date().toISOString().replace(/[^0-9]/g, '');
      const archivedKey = `${ARCHIVED_DRAFT_PREFIX}${suffix}:conflict:${key.slice(LOCAL_DRAFT_PREFIX.length)}`;
      localStorage.setItem(archivedKey, raw);
      localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  function scheduleAutoSave() {
    if (isChampionsMode() || state.suspendAutoSave || (state.published && !state.editingPublished)) return;
    const rows = gatherRows(false, true);
    saveLocalDraft(rows);
    state.hasDraft = true;
    state.autoSaveRevision += 1;
    markDirty(true);
    clearTimeout(state.autoSaveTimer);
    state.autoSaveTimer = setTimeout(() => persistDraft({ manual: false }), AUTO_SAVE_DELAY);
    syncPublicationUI();
  }

  async function persistMatchdayMilestone({
    required = false,
    milestone = null,
    season = currentSeasonKey(),
    matchday = state.matchday,
    restoreGeneration = state.matchdayRestoreGeneration
  } = {}) {
    if (isChampionsMode()) return true;
    const validation = milestoneValidation({ required, milestoneOverride: milestone });
    if (!validation.valid) {
      updateAchievementSettingsMessage();
      if (required) throw new Error(validation.message);
      return false;
    }
    if (!validation.milestone?.matchdayDate) return false;
    if (!state.achievementSchemaReady) {
      if (required) throw new Error('matchday_milestones is not configured');
      return false;
    }

    const params = {
      p_season: season,
      p_matchday: matchday,
      p_matchday_date: validation.milestone.matchdayDate || null,
      p_is_month_end: validation.milestone.isMonthEnd,
      p_is_year_end: validation.milestone.isYearEnd
    };
    if (state.restoreStateAvailable) params.p_restore_generation = restoreGeneration;
    const { error } = await state.client.rpc('save_matchday_milestone', params);
    if (error) {
      if (isRestoreGenerationError(error)) throw error;
      if (isAchievementUpgradeError(error)) state.achievementSchemaReady = false;
      updateAchievementSettingsMessage();
      if (required) throw error;
      return false;
    }

    if (season === currentSeasonKey() && matchday === state.matchday) {
      state.milestone = validation.milestone;
    }
    updateAchievementSettingsMessage();
    return true;
  }

  async function refreshRestoreState() {
    if (!state.client) return false;
    state.restoreStateChecked = false;
    const { data, error } = await state.client.rpc('get_league_restore_state');
    if (error) {
      if (isBackupUpgradeError(error)) {
        state.restoreStateChecked = true;
        state.restoreStateAvailable = false;
        state.serverRestoreGeneration = '';
        state.serverDataRevision = 0;
        state.serverRestoreAt = '';
        return false;
      }
      throw error;
    }

    state.restoreStateChecked = true;
    state.restoreStateAvailable = Boolean(data?.restoreGeneration);
    state.serverRestoreGeneration = String(data?.restoreGeneration || '');
    state.serverDataRevision = Math.max(0, Number(data?.dataRevision) || 0);
    state.serverRestoreAt = String(data?.lastRestoreAt || '');
    return state.restoreStateAvailable;
  }

  async function persistDraft({ manual = false } = {}) {
    if (isChampionsMode()) return false;
    if (manual && state.copyingPreviousLineup) return false;
    if (state.matchdayLoading || state.matchdayLoadBlocked || (state.published && !state.editingPublished)) return false;
    if (state.autoSaveInFlight) {
      state.autoSaveQueued = true;
      return state.autoSavePromise || false;
    }

    clearTimeout(state.autoSaveTimer);
    const revision = state.autoSaveRevision;
    const season = currentSeasonKey();
    const matchday = state.matchday;
    const champions = isChampionsMode();
    const wasPublished = state.published;
    const milestone = champions ? null : gatherMilestone();
    const rows = gatherRows(false, true);
    const postponed = hasPostponedMatches();
    const hasLineupChange = rows.some(row => Array.isArray(row.lineup));
    const loadedRestoreGeneration = state.matchdayRestoreGeneration;
    const expectedWriteRevision = state.matchdayWriteRevision;
    if (rows.length !== state.participants.length) {
      if (manual) flashMessage('Espera a que termine de cargar la jornada antes de guardar.', 'error');
      return false;
    }
    saveLocalDraft(rows, { cloudSynced: false, milestone });
    state.hasDraft = true;
    state.autoSaveInFlight = true;
    if (manual) setButtonsBusy(true);
    const run = async () => {
      try {
        const restoreStateAvailable = await refreshRestoreState();
        const restoreChanged = restoreStateAvailable && (
          (loadedRestoreGeneration && loadedRestoreGeneration !== state.serverRestoreGeneration)
          || (!loadedRestoreGeneration && Boolean(state.serverRestoreAt))
        );
        if (restoreChanged) {
          archiveCurrentLocalDraft();
          await loadMatchday();
          flashMessage('Se detectó una restauración hecha desde otro dispositivo. Archivamos el borrador anterior y recargamos la jornada restaurada.', 'error');
          return false;
        }

        const restoreGeneration = restoreStateAvailable ? state.serverRestoreGeneration : '';
        if (restoreStateAvailable) {
          state.matchdayRestoreGeneration = restoreGeneration;
          if (revision === state.autoSaveRevision) {
            saveLocalDraft(rows, { cloudSynced: false, milestone });
          }
        }

        if (!state.schemaReady
          || !state.redCardsSchemaReady
          || (postponed && !state.postponedSchemaReady)
          || ((!state.lineupSchemaReady || !state.catalogSchemaReady) && hasLineupChange)) {
          const upgradeMessage = !state.schemaReady
            ? 'Borrador guardado en este dispositivo. Activa la actualización V57 de Supabase para sincronizarlo.'
            : !state.redCardsSchemaReady
              ? 'Borrador guardado en este dispositivo. Activa la actualización V65 de Supabase para guardar tarjetas rojas.'
              : postponed && !state.postponedSchemaReady
                ? 'Borrador guardado en este dispositivo. Activa la actualización V114 de Supabase para guardar el estado aplazado.'
                : 'Borrador guardado en este dispositivo. Activa la actualización V116 de Supabase para guardar las alineaciones con identidad de catálogo.';
          markDirty(true, 'Guardado localmente · pendiente de sincronizar');
          $('savedAt').textContent = formatDate(new Date(), 'Guardado localmente ');
          if (manual) flashMessage(upgradeMessage, 'error');
          return false;
        }

        let savedRows = [];
        let savedWriteRevision = expectedWriteRevision;
        if (restoreStateAvailable) {
          const { data, error } = await state.client.rpc('save_matchday_draft_v124', {
            p_season: season,
            p_matchday: matchday,
            p_rows: rows,
            p_include_milestone: !champions,
            p_matchday_date: milestone?.matchdayDate || null,
            p_is_month_end: milestone?.isMonthEnd === true,
            p_is_year_end: milestone?.isYearEnd === true,
            p_restore_generation: restoreGeneration,
            p_expected_write_revision: expectedWriteRevision || null
          });
          if (error) throw error;
          savedRows = Array.isArray(data?.rows) ? data.rows : [];
          savedWriteRevision = String(data?.writeRevision || '');
        } else {
          const { data, error } = await state.client.rpc('save_matchday_draft', {
            p_season: season,
            p_matchday: matchday,
            p_rows: rows
          });
          if (error) throw error;
          savedRows = Array.isArray(data) ? data : [];
        }

        if (!restoreStateAvailable && !champions && !wasPublished) {
          const hasMilestoneInput = Boolean(milestone.matchdayDate || milestone.isMonthEnd || milestone.isYearEnd);
          if (hasMilestoneInput && !(await persistMatchdayMilestone({
            required: false,
            milestone,
            season,
            matchday
          }))) {
            throw new Error('No se pudo sincronizar la fecha o los premios de esta jornada.');
          }
        }

        if (season === currentSeasonKey() && matchday === state.matchday) {
          state.matchdayWriteRevision = savedWriteRevision;
        }
        if (!savedRows.length) throw new Error('Supabase no devolvió el borrador guardado.');

        $('savedAt').textContent = formatDate(new Date(), 'Guardada ');
        if (revision === state.autoSaveRevision) {
          saveLocalDraft(rows, {
            cloudSynced: true,
            milestone,
            cloudWriteRevision: savedWriteRevision
          });
          markDirty(false, 'Borrador guardado automáticamente');
        } else {
          state.autoSaveQueued = true;
        }
        if (manual) flashMessage(`Borrador de la jornada ${matchday} guardado correctamente.`);
        return true;
      } catch (error) {
        if (isRestoreGenerationError(error)) {
          archiveCurrentLocalDraft();
          await loadMatchday();
          flashMessage(friendlyError(error), 'error');
          return false;
        }
        if (isDraftConflictError(error)) {
          archiveCurrentLocalDraft();
          await loadMatchday();
          flashMessage(friendlyError(error), 'error');
          return false;
        }
        if (isUpgradeError(error)) state.schemaReady = false;
        if (isLineupUpgradeError(error)) state.lineupSchemaReady = false;
        renderLineupManagement();
        markDirty(true, 'Guardado localmente · pendiente de sincronizar');
        $('savedAt').textContent = formatDate(new Date(), 'Guardado localmente ');
        if (manual || isUpgradeError(error) || isBackupUpgradeError(error)) flashMessage(friendlyError(error), 'error');
        return false;
      } finally {
        state.autoSaveInFlight = false;
        state.autoSavePromise = null;
        if (manual) setButtonsBusy(false);
        const shouldRepeat = state.autoSaveQueued && !state.suspendAutoSave;
        state.autoSaveQueued = false;
        if (shouldRepeat) {
          state.autoSaveTimer = setTimeout(() => persistDraft({ manual: false }), 0);
        }
        syncPublicationUI();
      }
    };
    state.autoSavePromise = run();
    return state.autoSavePromise;
  }

  async function flushAutoSave({ force = false } = {}) {
    let synchronized = true;
    clearTimeout(state.autoSaveTimer);
    if (state.autoSavePromise) synchronized = (await state.autoSavePromise) !== false && synchronized;
    const canPersistDraft = !state.published || state.editingPublished;
    const shouldPersist = state.dirty || (force && state.hasDraft);
    if (shouldPersist && canPersistDraft && !state.suspendAutoSave) {
      // Un reintento forzado exitoso es el estado definitivo aunque el
      // autoguardado anterior haya fallado por una interrupción momentánea.
      synchronized = (await persistDraft({ manual: false })) !== false;
    }
    if (state.autoSavePromise) synchronized = (await state.autoSavePromise) !== false && synchronized;
    return synchronized;
  }

  function snapshotMap(snapshot) {
    const rows = Array.isArray(snapshot) ? snapshot : [];
    return new Map(rows.map(row => [row.participant_name, row]));
  }

  function countSnapshotChanges(beforeSnapshot, afterSnapshot) {
    const before = snapshotMap(beforeSnapshot);
    const after = snapshotMap(afterSnapshot);
    const names = new Set([...before.keys(), ...after.keys()]);
    let count = 0;
    names.forEach(name => {
      const a = before.get(name);
      const b = after.get(name);
      const lineupChanged = JSON.stringify(a?.lineup ?? null) !== JSON.stringify(b?.lineup ?? null);
      if (!a || !b || lineupChanged || ['points', 'goals', 'clean_sheets', 'red_cards', 'published'].some(key => a[key] !== b[key])) count += 1;
    });
    return count;
  }

  function snapshotHasPostponedMatches(snapshot) {
    return (Array.isArray(snapshot) ? snapshot : []).some(row => row?.has_postponed_matches === true);
  }

  function renderHistory(records = []) {
    state.history = Array.isArray(records) ? records : [];
    const list = $('revisionList');
    if (!state.history.length) {
      list.innerHTML = '<div class="revision-empty"><b>Sin modificaciones publicadas</b><small>La primera publicación aparecerá aquí.</small></div>';
      syncPublicationUI();
      return;
    }

    list.innerHTML = state.history.map((record, index) => {
      const correction = record.action === 'correction';
      const undone = record.undone === true;
      const changes = countSnapshotChanges(record.before_snapshot, record.after_snapshot);
      const postponedChanged = snapshotHasPostponedMatches(record.before_snapshot) !== snapshotHasPostponedMatches(record.after_snapshot);
      const title = correction ? 'Corrección publicada' : 'Publicación inicial';
      const badge = undone ? 'Deshecha' : correction ? 'Corrección' : 'Publicada';
      const correctionDetails = [
        changes ? `${changes} participante${changes === 1 ? '' : 's'} modificado${changes === 1 ? '' : 's'}` : '',
        postponedChanged ? 'estado de jornada actualizado' : ''
      ].filter(Boolean).join(' · ');
      const detail = correction
        ? correctionDetails || 'Publicación revisada sin cambios estadísticos'
        : `${Array.isArray(record.after_snapshot) ? record.after_snapshot.length : changes} participantes publicados`;
      return `<article class="revision-item${correction ? ' correction' : ''}${undone ? ' undone' : ''}">
        <span class="revision-number">V${state.history.length - index}</span>
        <span class="revision-copy"><b>${title}</b><small>${detail} · ${formatDate(record.created_at)}${record.changed_by_email ? ` · ${escapeHtml(record.changed_by_email)}` : ''}</small></span>
        <span class="revision-badge">${badge}</span>
      </article>`;
    }).join('');
    syncPublicationUI();
  }

  async function loadAutomaticChampionsMatchday(isStaleRequest) {
    const sourceMatchday = championsSourceMatchday();
    if (!sourceMatchday) {
      state.schemaReady = false;
      state.publishedRows = [];
      state.published = false;
      state.hasDraft = false;
      state.editingPublished = false;
      state.matchdayLoadBlocked = false;
      renderPlayerRows();
      flashMessage('No se encontró la jornada de Liga vinculada con esta jornada de Champions.', 'error');
      return;
    }

    let includeRedCards = true;
    let includePostponed = true;
    let result = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const fields = [
        'participant_name',
        'points',
        'goals',
        'clean_sheets',
        ...(includeRedCards ? ['red_cards'] : []),
        ...(includePostponed ? ['has_postponed_matches'] : []),
        'updated_at'
      ].join(',');
      result = await state.client
        .from('matchday_stats')
        .select(fields)
        .eq('season', config.season)
        .eq('matchday', sourceMatchday)
        .eq('published', true);
      if (!result.error) break;
      if (includePostponed && isPostponedUpgradeError(result.error)) {
        includePostponed = false;
        state.postponedSchemaReady = false;
        continue;
      }
      if (includeRedCards && isRedCardsUpgradeError(result.error)) {
        includeRedCards = false;
        state.redCardsSchemaReady = false;
        continue;
      }
      break;
    }

    if (isStaleRequest()) return;
    if (result?.error) {
      const cachedRows = state.championsRowsCache.get(state.matchday) || [];
      state.schemaReady = false;
      state.publishedRows = cachedRows;
      state.published = cachedRows.length > 0;
      state.hasDraft = false;
      state.editingPublished = false;
      state.matchdayLoadBlocked = false;
      $('savedAt').textContent = cachedRows.length
        ? 'Mostrando la última sincronización disponible'
        : `Sin conexión con Liga J${sourceMatchday}`;
      renderPlayerRows(cachedRows);
      flashMessage(friendlyError(result.error), 'error');
      return;
    }

    const allowedNames = new Set(state.participants.map(participant => participant.name));
    const rowsByName = new Map();
    (Array.isArray(result?.data) ? result.data : []).forEach(row => {
      if (allowedNames.has(row?.participant_name)) rowsByName.set(row.participant_name, row);
    });
    const publishedRows = [...rowsByName.values()];
    state.championsRowsCache.set(state.matchday, publishedRows.map(row => ({ ...row })));
    state.schemaReady = true;
    state.publishedRows = publishedRows;
    state.published = publishedRows.length > 0;
    state.hasDraft = false;
    state.editingPublished = false;
    state.history = [];
    state.matchdayWriteRevision = '';
    setLineupData();
    restoreWorkParticipantSelection();
    state.matchdayLoadBlocked = false;
    $('savedAt').textContent = publishedRows.length
      ? formatSavedAt(publishedRows).replace(/^Guardada/, 'Fuente publicada')
      : `Esperando Liga J${sourceMatchday}`;
    renderPlayerRows(publishedRows);
    renderHistory([]);
    markDirty(false, publishedRows.length ? 'Sincronización automática protegida' : 'Esperando la jornada de Liga');
    syncPublicationUI();
  }

  async function loadMatchday() {
    if (!state.client) return;
    const requestId = ++state.loadRequestId;
    const season = currentSeasonKey();
    const matchday = state.matchday;
    const champions = isChampionsMode();
    const isStaleRequest = () => requestId !== state.loadRequestId
      || season !== currentSeasonKey()
      || matchday !== state.matchday;
    state.matchdayLoading = true;
    state.matchdayLoadBlocked = true;
    state.localDraftArchivedOnLoad = false;
    state.history = [];
    state.previousLineupCache.clear();
    state.previousLineupRequestId += 1;
    state.copyingPreviousLineup = false;
    state.matchdayWriteRevision = '';
    clearTimeout(state.autoSaveTimer);
    state.autoSaveQueued = false;
    state.previewOpen = false;
    closePreview(false);
    $('playerRows').innerHTML = '<div class="state-card"><span class="loader" aria-hidden="true"></span><div><b>Cargando jornada</b><small>Un momento…</small></div></div>';

    state.redCardsSchemaReady = true;
    state.postponedSchemaReady = true;
    state.lineupSchemaReady = true;
    syncPublicationUI();

    try {
    if (champions) {
      await loadAutomaticChampionsMatchday(isStaleRequest);
      return;
    }
    try {
      const restoreStateAvailable = await refreshRestoreState();
      state.matchdayRestoreGeneration = restoreStateAvailable ? state.serverRestoreGeneration : '';
    } catch {
      // Si no se puede verificar el estado de restauración, no se reutiliza
      // ningún borrador local. Las consultas de Supabase deciden si se continúa.
      state.restoreStateChecked = false;
    }
    if (isStaleRequest()) return;

    const initialWriteStateResult = state.restoreStateAvailable
      ? await state.client.rpc('get_matchday_write_state', {
        p_season: season,
        p_matchday: matchday
      })
      : { data: { writeRevision: null }, error: null };
    if (isStaleRequest()) return;
    if (initialWriteStateResult.error) {
      state.backupSchemaReady = false;
      state.schemaReady = false;
      renderPlayerRows();
      flashMessage(friendlyError(initialWriteStateResult.error), 'error');
      return;
    }
    const initialWriteRevision = String(initialWriteStateResult.data?.writeRevision || '');

    const queryMatchdayRows = async (table, { includePublished = false } = {}) => {
      let includeRedCards = state.redCardsSchemaReady;
      let includePostponed = state.postponedSchemaReady;
      let includeLineup = !champions && state.lineupSchemaReady;
      let result = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const fields = [
          'participant_name',
          'points',
          'goals',
          'clean_sheets',
          ...(includeRedCards ? ['red_cards'] : []),
          ...(includePostponed ? ['has_postponed_matches'] : []),
          ...(includeLineup ? ['lineup'] : []),
          ...(includePublished ? ['published'] : []),
          'updated_at'
        ].join(',');
        result = await state.client
          .from(table)
          .select(fields)
          .eq('season', season)
          .eq('matchday', matchday);
        if (!result.error) break;

        let retry = false;
        if (includeLineup && isLineupUpgradeError(result.error)) {
          includeLineup = false;
          state.lineupSchemaReady = false;
          retry = true;
        }
        if (includePostponed && isPostponedUpgradeError(result.error)) {
          includePostponed = false;
          state.postponedSchemaReady = false;
          retry = true;
        }
        if (includeRedCards && isRedCardsUpgradeError(result.error)) {
          includeRedCards = false;
          state.redCardsSchemaReady = false;
          retry = true;
        }
        if (!retry) break;
      }
      return result;
    };

    const statsResult = await queryMatchdayRows('matchday_stats', { includePublished: true });

    if (isStaleRequest()) return;
    if (statsResult.error) {
      state.schemaReady = false;
      renderPlayerRows();
      flashMessage(friendlyError(statsResult.error), 'error');
      return;
    }

    let [draftResult, historyResult, milestoneResult, milestoneDraftResult] = await Promise.all([
      queryMatchdayRows('matchday_drafts'),
      state.client
        .from('matchday_change_log')
        .select('id,action,before_snapshot,after_snapshot,changed_by_email,created_at,undone,undone_at')
        .eq('season', season)
        .eq('matchday', matchday)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(20),
      champions
        ? Promise.resolve({ data: [], error: null })
        : state.client
          .from('matchday_milestones')
          .select('matchday_date,is_month_end,is_year_end,updated_at')
          .eq('season', season)
          .eq('matchday', matchday)
          .limit(1),
      champions || !state.restoreStateAvailable
        ? Promise.resolve({ data: { exists: false }, error: null })
        : state.client.rpc('get_matchday_milestone_draft', {
          p_season: season,
          p_matchday: matchday
        })
    ]);

    if (isStaleRequest()) return;
    if (milestoneDraftResult.error) {
      state.backupSchemaReady = false;
      state.schemaReady = false;
      state.achievementSchemaReady = false;
      $('playerRows').innerHTML = '<div class="state-card"><div><b>No pudimos cargar la jornada completa</b><small>Los datos permanecen bloqueados para evitar sobrescribir el borrador de fecha o premios. Cambia de jornada y vuelve, o recarga el panel.</small></div></div>';
      flashMessage(friendlyError(milestoneDraftResult.error), 'error');
      return;
    }

    const [finalWriteStateResult, finalRestoreStateResult] = state.restoreStateAvailable
      ? await Promise.all([
        state.client.rpc('get_matchday_write_state', {
          p_season: season,
          p_matchday: matchday
        }),
        state.client.rpc('get_league_restore_state')
      ])
      : [
        { data: { writeRevision: null }, error: null },
        { data: { restoreGeneration: null, dataRevision: 0 }, error: null }
      ];
    if (isStaleRequest()) return;
    if (finalWriteStateResult.error || finalRestoreStateResult.error) {
      state.backupSchemaReady = false;
      state.schemaReady = false;
      renderPlayerRows();
      flashMessage(friendlyError(finalWriteStateResult.error || finalRestoreStateResult.error), 'error');
      return;
    }
    const finalWriteRevision = String(finalWriteStateResult.data?.writeRevision || '');
    const finalRestoreGeneration = String(finalRestoreStateResult.data?.restoreGeneration || '');
    if (initialWriteRevision !== finalWriteRevision
      || (state.restoreStateAvailable && state.matchdayRestoreGeneration !== finalRestoreGeneration)) {
      return loadMatchday();
    }
    state.matchdayWriteRevision = finalWriteRevision;
    if (state.restoreStateAvailable) {
      state.serverRestoreGeneration = finalRestoreGeneration;
      state.serverDataRevision = Math.max(0, Number(finalRestoreStateResult.data?.dataRevision) || 0);
      state.serverRestoreAt = String(finalRestoreStateResult.data?.lastRestoreAt || '');
      state.matchdayRestoreGeneration = finalRestoreGeneration;
    }

    state.schemaReady = !draftResult.error && !historyResult.error;
    state.achievementSchemaReady = champions || !milestoneResult.error;
    if (!state.schemaReady && (isUpgradeError(draftResult.error) || isUpgradeError(historyResult.error))) {
      flashMessage(friendlyError(draftResult.error || historyResult.error), 'error');
    }
    if (!state.redCardsSchemaReady) {
      flashMessage('Activa la actualización V65 de Supabase para guardar y publicar tarjetas rojas.', 'error');
    }

    const allStats = Array.isArray(statsResult.data) ? statsResult.data : [];
    const publishedRows = allStats.filter(row => row.published === true);
    const legacyDraftRows = allStats.filter(row => row.published !== true);
    const cloudDraftRows = !draftResult.error && Array.isArray(draftResult.data) ? draftResult.data : [];
    const localDraftCandidate = readLocalDraft();
    const localDraftConflict = Boolean(
      localDraftCandidate
      && state.restoreStateAvailable
      && localDraftCandidate.cloudWriteRevision !== finalWriteRevision
    );
    if (localDraftConflict) archiveCurrentLocalDraft();
    const localDraft = localDraftConflict ? null : localDraftCandidate;
    const cloudMilestone = !milestoneResult.error && Array.isArray(milestoneResult.data)
      ? milestoneResult.data[0] || null
      : null;
    const cloudMilestoneDraft = !milestoneDraftResult.error && milestoneDraftResult.data?.exists
      ? {
        matchdayDate: milestoneDraftResult.data.matchdayDate || '',
        isMonthEnd: milestoneDraftResult.data.isMonthEnd === true,
        isYearEnd: milestoneDraftResult.data.isYearEnd === true,
        updated_at: milestoneDraftResult.data.updatedAt || ''
      }
      : null;
    const draftRows = localDraft?.rows?.length
      ? localDraft.rows
      : cloudDraftRows.length
        ? cloudDraftRows
        : legacyDraftRows;

    state.publishedRows = publishedRows;
    state.published = publishedRows.length > 0;
    state.hasDraft = draftRows.length > 0 || Boolean(cloudMilestoneDraft);
    state.editingPublished = state.published && state.hasDraft;
    const rowsToRender = draftRows.length ? draftRows : publishedRows;
    setMilestoneForm(localDraft?.milestone || cloudMilestoneDraft || cloudMilestone || {});
    setPostponedForm(rowsToRender, cloudDraftRows, publishedRows);
    setLineupData(rowsToRender, cloudDraftRows, publishedRows);
    restoreWorkParticipantSelection();

    $('savedAt').textContent = localDraft?.savedAt
      ? formatDate(localDraft.savedAt, 'Guardada ')
      : formatSavedAt(draftRows.length ? draftRows : publishedRows);
    renderPlayerRows(rowsToRender);
    renderLineupManagement();
    updateParticipantWorkflow();
    renderHistory(!historyResult.error && Array.isArray(historyResult.data) ? historyResult.data : []);
    state.matchdayLoadBlocked = false;
    const localDraftNeedsSync = Boolean(localDraft && !localDraft.cloudSynced);
    markDirty(
      localDraftNeedsSync,
      localDraftNeedsSync
        ? 'Borrador recuperado · sincronización pendiente'
        : state.hasDraft
          ? 'Borrador recuperado y protegido'
          : state.published ? 'Publicación protegida' : 'Lista para comenzar'
    );
    syncPublicationUI();
    if (localDraftNeedsSync && !state.suspendAutoSave) {
      state.autoSaveRevision += 1;
      state.autoSaveTimer = setTimeout(() => persistDraft({ manual: false }), 0);
    }
    if (localDraftConflict) {
      flashMessage('Otro dispositivo guardó una versión más reciente. El borrador local anterior quedó en cuarentena y cargamos la copia de Supabase.', 'error');
    } else if (state.localDraftArchivedOnLoad) {
      flashMessage('Había un borrador local anterior a la última restauración. Lo dejamos en cuarentena y cargamos los datos recuperados.', 'error');
    }
    } finally {
      if (!isStaleRequest()) {
        state.matchdayLoading = false;
        syncPublicationUI();
      }
    }
  }

  function updateChampionsAutomationNotice() {
    const notice = $('championsAutomationNotice');
    if (!notice) return;
    const title = $('championsAutomationTitle');
    const message = $('championsAutomationMessage');
    const status = $('championsAutomationStatus');
    const sourceButton = $('goToChampionsSourceButton');
    let tone = 'pending';
    let label = 'Pendiente';

    if (isChampionsMode()) {
      const details = championsSyncDetails();
      tone = details.status;
      label = details.status === 'synced'
        ? 'Sincronizada'
        : details.status === 'provisional'
          ? 'Provisional'
          : 'Pendiente';
      notice.hidden = false;
      notice.classList.add('is-champions-view');
      title.textContent = `Champions J${state.matchday} se alimenta de Liga J${details.sourceMatchday || '—'}`;
      message.textContent = details.status === 'synced'
        ? `Los ${details.total} participantes publicados se distribuyen automáticamente en los 4 grupos. Para cambiar un dato, corrige Liga J${details.sourceMatchday}.`
        : details.status === 'provisional'
          ? details.postponed
            ? `Los 4 grupos muestran los datos publicados, pero seguirán provisionales porque Liga J${details.sourceMatchday} tiene partidos aplazados.`
            : `Hay ${details.synchronized} de ${details.total} participantes con estadísticas completas. Completa y publica Liga J${details.sourceMatchday}.`
          : `Todavía no hay datos publicados. Completa y publica Liga J${details.sourceMatchday} para llenar automáticamente los 4 grupos.`;
      sourceButton.hidden = false;
      sourceButton.querySelector('span').textContent = `Ir a Liga J${details.sourceMatchday || '—'}`;
    } else {
      const championsMatchday = championsMatchdayForLeague();
      if (!championsMatchday) {
        notice.hidden = true;
        return;
      }
      const postponed = publishedWasPostponed() || hasPostponedMatches();
      tone = state.published && !postponed ? 'synced' : postponed ? 'provisional' : 'pending';
      label = state.published && !postponed ? 'Vinculada' : postponed ? 'Provisional' : 'Automática';
      notice.hidden = false;
      notice.classList.remove('is-champions-view');
      title.textContent = `Liga J${state.matchday} también cuenta para Champions J${championsMatchday}`;
      message.textContent = postponed
        ? `Al publicar o corregir esta jornada, PTS, GOL, CS y TR actualizarán automáticamente los 4 grupos de Champions J${championsMatchday}, que permanecerá provisional por los partidos aplazados.`
        : `Al publicar o corregir esta jornada, PTS, GOL, CS y TR actualizarán automáticamente los 4 grupos de Champions J${championsMatchday}. No tendrás que introducirlos otra vez.`;
      sourceButton.hidden = true;
    }

    status.className = `champions-automation-status ${tone}`;
    status.innerHTML = `<i></i> ${label}`;
  }

  function updateCompetitionUI() {
    const champions = isChampionsMode();
    const matchdayCount = currentMatchdayCount();
    const championNames = state.championsGroups.flatMap(group => group.teams);
    state.participants = champions
      ? championNames.map(name => state.participantIndex.get(name)).filter(Boolean)
      : [...state.leagueParticipants];

    if (state.matchday > matchdayCount) state.matchday = 1;
    $('panelView').classList.toggle('competition-champions', champions);
    if (champions) $('postponedToggle').checked = false;
    $('leagueModeButton').classList.toggle('active', !champions);
    $('championsModeButton').classList.toggle('active', champions);
    $('leagueModeButton').setAttribute('aria-pressed', String(!champions));
    $('championsModeButton').setAttribute('aria-pressed', String(champions));
    $('panelTitle').textContent = champions ? 'Champions automática' : 'Administrar jornadas';
    $('panelDescription').textContent = champions
      ? 'Consulta los datos publicados de Liga ya distribuidos en sus cuatro grupos. Para corregirlos, vuelve a la jornada fuente.'
      : 'Prepara, revisa y publica cada jornada sin riesgo de perder datos ni modificar la web por accidente.';
    $('entryTitle').textContent = champions
      ? `${state.participants.length} competidores · 4 grupos`
      : `${state.participants.length} participantes`;
    $('matchdaySelect').innerHTML = Array.from({ length: matchdayCount }, (_, index) => {
      const matchday = index + 1;
      const sourceMatchday = championsSourceMatchday(matchday);
      return `<option value="${matchday}">${champions ? `Champions J${matchday} · Liga J${sourceMatchday || '—'}` : `Jornada ${matchday}`}</option>`;
    }).join('');
    $('matchdaySelect').value = String(state.matchday);
    $('savedAt').textContent = 'Todavía no guardada';
    if (!champions && !$('matchdayDate').value) setMilestoneForm({});
    else updateAchievementSettingsMessage();
    syncPublicationUI();
  }

  async function goToChampionsSourceMatchday() {
    if (!isChampionsMode() || state.saving || state.matchdayLoading) return;
    const sourceMatchday = championsSourceMatchday();
    if (!sourceMatchday) return;
    state.competition = 'league';
    state.matchday = sourceMatchday;
    state.published = false;
    state.publishedRows = [];
    state.editingPublished = false;
    state.hasDraft = false;
    markDirty(false);
    updateCompetitionUI();
    await loadMatchday();
    requestAnimationFrame(() => $('championsAutomationNotice').scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }

  async function prepareNavigation() {
    if (state.misterImportRequest) await cancelMisterImport({ silent: true });
    if (!state.dirty) return;
    await flushAutoSave();
  }

  async function switchCompetition(competition) {
    if (competition === state.competition || state.saving || state.matchdayLoading || state.copyingPreviousLineup) return;
    await prepareNavigation();
    state.competition = competition;
    state.matchday = 1;
    state.published = false;
    state.publishedRows = [];
    state.editingPublished = false;
    state.hasDraft = false;
    markDirty(false);
    updateCompetitionUI();
    await loadMatchday();
  }

  function startCorrection() {
    if (isChampionsMode() || !state.published || state.saving || state.matchdayLoading || state.matchdayLoadBlocked || state.copyingPreviousLineup) return;
    state.editingPublished = true;
    state.hasDraft = true;
    state.autoSaveRevision += 1;
    saveLocalDraft(gatherRows(false, true));
    syncPublicationUI();
    scheduleAutoSave();
    flashMessage('Modo corrección activado. La web pública seguirá mostrando la versión anterior hasta que confirmes la nueva.');
    if (window.matchMedia?.('(pointer:fine)').matches) {
      requestAnimationFrame(() => document.querySelector('.admin-player.is-current .stat-input, .stat-input')?.focus());
    }
  }

  function openPreview() {
    if (isChampionsMode() || state.saving || state.matchdayLoading || state.matchdayLoadBlocked || state.copyingPreviousLineup) return;
    const validation = updateCompletionState();
    if (validation.missing.length) {
      flashMessage(`Faltan ${validation.missing.length} participantes. Completa todos los campos antes de revisar.`, 'error');
      $('completionCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const lineupCheck = isChampionsMode() ? { valid: true, partial: [] } : lineupPublicationValidation();
    if (!lineupCheck.valid) {
      const first = lineupCheck.details[0];
      const reason = first?.metrics?.issues?.join(' · ') || 'revisa sus datos';
      flashMessage(`Alineación incompleta de ${first?.name || lineupCheck.partial[0]}: ${reason}${lineupCheck.partial.length > 1 ? ` · y ${lineupCheck.partial.length - 1} más` : ''}. Complétala o vacíala antes de publicar.`, 'error');
      $('lineupManagement').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (!isChampionsMode() && hasAnyLineupChange() && (!state.lineupSchemaReady || !state.catalogSchemaReady)) {
      flashMessage('Primero activa la actualización V116 de Supabase para publicar las alineaciones con el Catálogo Maestro.', 'error');
      $('lineupManagement').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (!state.schemaReady) {
      flashMessage('Primero activa la actualización V57 de Supabase para publicar con historial y deshacer.', 'error');
      return;
    }
    if (!state.redCardsSchemaReady) {
      flashMessage('Primero activa la actualización V65 de Supabase para publicar tarjetas rojas.', 'error');
      $('completionCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (hasPostponedMatches() && !state.postponedSchemaReady) {
      flashMessage('Primero activa la actualización V114 de Supabase para publicar una jornada con partidos aplazados.', 'error');
      $('achievementSettings').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const milestoneCheck = milestoneValidation({ required: !isChampionsMode() });
    if (!milestoneCheck.valid) {
      flashMessage(milestoneCheck.message, 'error');
      $('achievementSettings').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (!isChampionsMode() && !state.achievementSchemaReady) {
      flashMessage('Primero activa la actualización V59 de Supabase para publicar fechas e insignias.', 'error');
      $('achievementSettings').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const rows = gatherRows(true, false);
    state.previewRows = [...rows].sort((a, b) =>
      b.points - a.points ||
      b.goals - a.goals ||
      b.clean_sheets - a.clean_sheets ||
      a.participant_name.localeCompare(b.participant_name, 'es')
    );
    const total = key => rows.reduce((sum, row) => sum + row[key], 0);
    const lineupCount = rows.filter(row => lineupMetrics(row.lineup).complete).length;
    $('previewTitle').textContent = state.published ? 'Revisar corrección' : 'Vista previa de la jornada';
    const milestone = milestoneCheck.milestone;
    const matchdayDateLabel = milestone?.matchdayDate
      ? new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(new Date(`${milestone.matchdayDate}T12:00:00`))
      : '';
    const prizeLabel = milestone?.isYearEnd
      ? ' · cierre mensual e invernal'
      : milestone?.isMonthEnd
        ? ' · cierre mensual'
        : '';
    const postponedLabel = hasPostponedMatches() ? ' · partidos aplazados · Copa pendiente' : ' · jornada completa';
    const linkedChampionsMatchday = championsMatchdayForLeague();
    $('previewSubtitle').textContent = `Jornada ${state.matchday} · ${currentCompetitionLabel()} · ${rows.length} participantes${isChampionsMode() ? '' : ` · ${lineupCount} alineaciones`}${matchdayDateLabel ? ` · ${matchdayDateLabel}` : ''}${prizeLabel}${isChampionsMode() ? '' : postponedLabel}${linkedChampionsMatchday ? ` · actualizará Champions J${linkedChampionsMatchday}` : ''}`;
    $('previewChampionsAutomation').hidden = !linkedChampionsMatchday;
    $('previewChampionsAutomation').textContent = linkedChampionsMatchday
      ? `Esta publicación actualizará automáticamente PTS, GOL, CS y TR de los 4 grupos de Champions J${linkedChampionsMatchday}.`
      : '';
    $('previewSummary').innerHTML = `
      <article><small>Participantes</small><b>${rows.length}</b></article>
      <article><small>Puntos</small><b>${total('points').toLocaleString()}</b></article>
      <article><small>Goles</small><b>${total('goals').toLocaleString()}</b></article>
      <article><small>Clean sheets</small><b>${total('clean_sheets').toLocaleString()}</b></article>
      <article><small>Tarjetas rojas</small><b>${total('red_cards').toLocaleString()}</b></article>
      ${isChampionsMode() ? '' : `<article><small>Alineaciones</small><b>${lineupCount}/${rows.length}</b></article>`}`;
    $('previewRows').innerHTML = state.previewRows.map((row, index) => {
      const participant = state.participantIndex.get(row.participant_name);
      return `<div class="preview-row">
        <span>${index + 1}</span>
        <span class="preview-player"><img src="${escapeHtml(participant?.shield || '')}" alt=""><span><b>${escapeHtml(row.participant_name)}</b>${isChampionsMode() ? '' : `<small>${lineupMetrics(row.lineup).complete ? 'XI completo' : 'Sin alineación'}</small>`}</span></span>
        <span>${row.points}</span><span>${row.goals}</span><span>${row.clean_sheets}</span><span>${row.red_cards}</span>
      </div>`;
    }).join('');
    $('confirmPublishButton').querySelector('span').textContent = state.published
      ? hasPostponedMatches()
        ? 'Guardar como pendiente'
        : publishedWasPostponed()
          ? 'Completar jornada'
          : 'Confirmar corrección'
      : hasPostponedMatches() ? 'Publicar como pendiente' : 'Confirmar publicación';
    state.previewReturnFocus = document.activeElement;
    $('previewModal').hidden = false;
    document.body.classList.add('preview-open');
    document.querySelectorAll('.admin-topbar,.admin-main').forEach(node => { node.inert = true; });
    state.previewOpen = true;
    syncPublicationUI();
    requestAnimationFrame(() => $('closePreview').focus());
  }

  function closePreview(returnFocus = true) {
    if (!$('previewModal')) return;
    if (state.saving && returnFocus) return;
    $('previewModal').hidden = true;
    document.body.classList.remove('preview-open');
    document.querySelectorAll('.admin-topbar,.admin-main').forEach(node => { node.inert = false; });
    const focus = state.previewReturnFocus;
    state.previewReturnFocus = null;
    state.previewOpen = false;
    syncPublicationUI();
    if (returnFocus) (focus || $('publishButton'))?.focus?.();
  }

  function trapPreviewFocus(event) {
    if (event.key !== 'Tab' || !state.previewOpen || $('previewModal')?.hidden) return;
    const focusable = [...$('previewModal').querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')]
      .filter(node => !node.hidden);
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function publishPreview() {
    if (isChampionsMode() || state.saving || state.matchdayLoading || state.matchdayLoadBlocked || state.copyingPreviousLineup || !state.previewRows.length) return;
    const season = currentSeasonKey();
    const matchday = state.matchday;
    const competition = state.competition;
    const champions = isChampionsMode();
    const linkedChampionsMatchday = champions ? null : championsMatchdayForLeague(matchday);
    const previewRows = state.previewRows.map(row => ({ ...row }));
    const milestoneCheck = champions ? { valid: true, milestone: null } : milestoneValidation({ required: true });
    if (!milestoneCheck.valid || previewRows.length !== state.participants.length) {
      flashMessage(milestoneCheck.message || 'La vista previa ya no coincide con la jornada cargada. Vuelve a revisarla.', 'error');
      return;
    }
    const milestone = milestoneCheck.milestone;
    const wasCorrection = state.published;
    const wasPostponed = state.publishedRows.some(row => row?.has_postponed_matches === true);
    const remainsPostponed = previewRows.some(row => row?.has_postponed_matches === true);
    state.suspendAutoSave = true;
    state.autoSaveQueued = false;
    clearTimeout(state.autoSaveTimer);
    setButtonsBusy(true);

    try {
      if (state.autoSavePromise && (await state.autoSavePromise) === false) {
        flashMessage('No se publicó porque el borrador no pudo sincronizarse de forma segura. Revisa la jornada recargada.', 'error');
        return;
      }
      if (season !== currentSeasonKey() || matchday !== state.matchday || competition !== state.competition) {
        flashMessage('La jornada cambió mientras se preparaba la publicación. Vuelve a abrir la vista previa.', 'error');
        return;
      }
      const publishParams = {
        p_season: season,
        p_matchday: matchday,
        p_rows: previewRows
      };
      let functionName = 'publish_matchday_revision';
      if (state.restoreStateAvailable) {
        functionName = 'publish_matchday_revision_v124';
        publishParams.p_include_milestone = !champions;
        publishParams.p_matchday_date = milestone?.matchdayDate || null;
        publishParams.p_is_month_end = milestone?.isMonthEnd === true;
        publishParams.p_is_year_end = milestone?.isYearEnd === true;
        publishParams.p_restore_generation = state.matchdayRestoreGeneration;
        publishParams.p_expected_write_revision = state.matchdayWriteRevision || null;
      } else {
        await persistMatchdayMilestone({ required: !champions });
      }
      const { data, error } = await state.client.rpc(functionName, publishParams);
      if (error) throw error;
      const publishedRows = state.restoreStateAvailable
        ? (Array.isArray(data?.rows) ? data.rows : [])
        : (Array.isArray(data) ? data : []);
      if (state.restoreStateAvailable) state.matchdayWriteRevision = String(data?.writeRevision || '');
      clearLocalDraft();
      state.hasDraft = false;
      state.dirty = false;
      state.editingPublished = false;
      state.published = publishedRows.length > 0;
      closePreview(false);
      await loadMatchday();
      const publicationMessage = wasCorrection
          ? remainsPostponed
            ? `Corrección publicada. La jornada ${matchday} sigue pendiente y la Copa no confirmará eliminados.`
            : wasPostponed
              ? `Jornada ${matchday} completada. La Copa se recalculó desde esta ronda y la versión anterior quedó en el historial.`
              : `Corrección de la jornada ${matchday} publicada. La versión anterior quedó guardada en el historial.`
          : remainsPostponed
            ? `Jornada ${matchday} publicada como pendiente. La Liga continúa y la Copa espera el partido aplazado.`
            : `Jornada ${matchday} publicada correctamente. Ya está visible en la web.`;
      const championsMessage = linkedChampionsMatchday
        ? remainsPostponed
          ? ` Champions J${linkedChampionsMatchday} actualizó automáticamente sus 4 grupos y quedó provisional.`
          : ` Champions J${linkedChampionsMatchday} actualizó automáticamente sus 4 grupos.`
        : '';
      flashMessage(`${publicationMessage}${championsMessage}`);
    } catch (error) {
      if (isRestoreGenerationError(error)) {
        closePreview(false);
        await loadMatchday();
      }
      if (isDraftConflictError(error)) {
        closePreview(false);
        archiveCurrentLocalDraft();
        await loadMatchday();
      }
      if (isUpgradeError(error)) state.schemaReady = false;
      if (isLineupUpgradeError(error)) state.lineupSchemaReady = false;
      flashMessage(friendlyError(error), 'error');
    } finally {
      state.suspendAutoSave = false;
      setButtonsBusy(false);
    }
  }

  async function undoLastPublication() {
    if (isChampionsMode()) return;
    const latest = state.history.find(item => !item.undone);
    if (!latest || state.saving || state.matchdayLoading || state.matchdayLoadBlocked || state.copyingPreviousLineup) return;
    const accepted = window.confirm(
      `¿Deshacer la última publicación de la jornada ${state.matchday}? ` +
      'La tabla pública volverá inmediatamente a la versión anterior.'
    );
    if (!accepted) return;

    const linkedChampionsMatchday = championsMatchdayForLeague();
    try {
      state.suspendAutoSave = true;
      setButtonsBusy(true);
      const undoParams = {
        p_season: currentSeasonKey(),
        p_matchday: state.matchday
      };
      let functionName = 'undo_last_matchday_publication';
      if (state.restoreStateAvailable) {
        functionName = 'undo_last_matchday_publication_v124';
        undoParams.p_restore_generation = state.matchdayRestoreGeneration;
        undoParams.p_expected_write_revision = state.matchdayWriteRevision || null;
        undoParams.p_expected_change_id = latest.id;
      }
      const { data, error } = await state.client.rpc(functionName, undoParams);
      if (error) throw error;
      const restoredRows = state.restoreStateAvailable
        ? (Array.isArray(data?.rows) ? data.rows : [])
        : (Array.isArray(data) ? data : []);
      if (state.restoreStateAvailable) state.matchdayWriteRevision = String(data?.writeRevision || '');
      clearLocalDraft();
      state.hasDraft = false;
      state.dirty = false;
      state.editingPublished = false;
      await loadMatchday();
      const undoMessage = restoredRows.length
          ? `Última modificación deshecha. La jornada ${state.matchday} volvió a su versión anterior.`
          : `Publicación deshecha. La jornada ${state.matchday} dejó de estar visible en la web.`;
      flashMessage(`${undoMessage}${linkedChampionsMatchday ? ` Champions J${linkedChampionsMatchday} se sincronizó automáticamente con ese cambio.` : ''}`);
    } catch (error) {
      if (isRestoreGenerationError(error)) {
        archiveCurrentLocalDraft();
        await loadMatchday();
      }
      if (isDraftConflictError(error) || /publication revision changed/i.test(String(error?.message || ''))) {
        archiveCurrentLocalDraft();
        await loadMatchday();
      }
      if (isUpgradeError(error)) state.schemaReady = false;
      if (isLineupUpgradeError(error)) state.lineupSchemaReady = false;
      flashMessage(friendlyError(error), 'error');
    } finally {
      state.suspendAutoSave = false;
      setButtonsBusy(false);
    }
  }

  function analyticsNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
  }

  function analyticsDayLabel(dateValue) {
    const date = new Date(`${dateValue}T12:00:00`);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('es', { weekday: 'short' })
      .format(date)
      .replace('.', '')
      .slice(0, 3);
  }

  function analyticsLongDayLabel(dateValue) {
    const date = new Date(`${dateValue}T12:00:00`);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' })
      .format(date)
      .replace('.', '');
  }

  function renderVisitorAnalytics(payload) {
    const daily = Array.isArray(payload?.daily) ? payload.daily.map(day => ({
      date: String(day.date || ''),
      visits: analyticsNumber(day.visits),
      visitors: analyticsNumber(day.visitors)
    })) : [];
    const maxVisits = Math.max(1, ...daily.map(day => day.visits));
    const peak = daily.reduce((best, day) => day.visits > (best?.visits ?? -1) ? day : best, null);

    $('analyticsUniqueVisitors').textContent = analyticsNumber(payload?.uniqueVisitors).toLocaleString('es');
    $('analyticsTotalVisits').textContent = analyticsNumber(payload?.totalVisits).toLocaleString('es');
    $('analyticsTodayVisits').textContent = analyticsNumber(payload?.todayVisits).toLocaleString('es');
    $('analyticsTodayVisitors').textContent = `${analyticsNumber(payload?.todayVisitors).toLocaleString('es')} ${analyticsNumber(payload?.todayVisitors) === 1 ? 'persona' : 'personas'}`;
    $('analyticsWeekVisits').textContent = analyticsNumber(payload?.last7Visits).toLocaleString('es');
    $('analyticsWeekVisitors').textContent = `${analyticsNumber(payload?.last7Visitors).toLocaleString('es')} ${analyticsNumber(payload?.last7Visitors) === 1 ? 'persona' : 'personas'}`;
    $('analyticsPeakDay').textContent = peak && peak.visits
      ? `${analyticsLongDayLabel(peak.date)} · ${peak.visits.toLocaleString('es')}`
      : 'Sin visitas';

    $('analyticsDailyChart').innerHTML = daily.map((day, index) => {
      const height = day.visits ? Math.max(8, Math.round((day.visits / maxVisits) * 100)) : 5;
      const isToday = index === daily.length - 1;
      const label = `${analyticsLongDayLabel(day.date)}: ${day.visits} ${day.visits === 1 ? 'visita' : 'visitas'} de ${day.visitors} ${day.visitors === 1 ? 'persona' : 'personas'}`;
      return `<div class="analytics-day${isToday ? ' is-today' : ''}" title="${escapeHtml(label)}">
        <strong>${day.visits.toLocaleString('es')}</strong>
        <span style="--bar-height:${height}%"></span>
        <small>${analyticsDayLabel(day.date)}</small>
      </div>`;
    }).join('');
    $('analyticsDailyChart').setAttribute(
      'aria-label',
      daily.length
        ? `Visitas de los últimos siete días. ${daily.map(day => `${analyticsLongDayLabel(day.date)}: ${day.visits}`).join(', ')}.`
        : 'Todavía no hay visitas registradas.'
    );
    $('analyticsUpdatedAt').textContent = formatDate(new Date(), 'Actualizado ');
    $('analyticsUnavailable').hidden = true;
    $('analyticsContent').hidden = false;
  }

  async function loadVisitorAnalytics({ manual = false } = {}) {
    if (!state.client || state.analyticsLoading) return false;
    const button = $('refreshAnalyticsButton');
    state.analyticsLoading = true;
    button.disabled = true;
    button.classList.add('loading');
    button.querySelector('span').textContent = 'Actualizando…';
    $('analyticsUpdatedAt').textContent = 'Actualizando estadísticas…';

    try {
      const { data, error } = await state.client.rpc('get_site_analytics', { p_days: 7 });
      if (error) throw error;
      renderVisitorAnalytics(data || {});
      if (manual) flashMessage('Estadísticas de visitas actualizadas.');
      return true;
    } catch (error) {
      if (isAnalyticsUpgradeError(error)) {
        $('analyticsContent').hidden = true;
        $('analyticsUnavailable').hidden = false;
        $('analyticsUpdatedAt').textContent = 'Contador pendiente de activar';
      } else {
        $('analyticsUpdatedAt').textContent = 'No se pudieron actualizar las visitas';
        if (manual) flashMessage(friendlyError(error), 'error');
      }
      return false;
    } finally {
      state.analyticsLoading = false;
      button.disabled = false;
      button.classList.remove('loading');
      button.querySelector('span').textContent = 'Actualizar';
    }
  }

  const BACKUP_KIND_LABELS = {
    daily: 'Diario',
    weekly: 'Semanal',
    manual: 'Manual',
    pre_restore: 'Antes de restaurar'
  };

  const BACKUP_TABLE_LABELS = {
    matchday_stats: 'Datos publicados',
    matchday_drafts: 'Borradores',
    matchday_milestone_drafts: 'Fechas en borrador',
    matchday_change_log: 'Versiones del historial',
    matchday_milestones: 'Fechas y premios'
  };

  function normalizeBackup(row = {}) {
    return {
      id: String(row.id || ''),
      kind: String(row.backup_kind || row.backupKind || 'manual'),
      schemaVersion: Number(row.schema_version ?? row.schemaVersion ?? 0),
      rowCounts: row.row_counts || row.rowCounts || {},
      checksum: String(row.checksum || ''),
      sizeBytes: Number(row.size_bytes ?? row.sizeBytes ?? 0),
      createdAt: row.created_at || row.createdAt || '',
      restoredAt: row.restored_at || row.restoredAt || null
    };
  }

  function backupKindLabel(kind) {
    return BACKUP_KIND_LABELS[kind] || 'Respaldo';
  }

  function backupTotalRows(counts = {}) {
    return Object.keys(BACKUP_TABLE_LABELS).reduce((total, key) => total + Math.max(0, Number(counts?.[key]) || 0), 0);
  }

  function backupSizeLabel(bytes) {
    const number = Math.max(0, Number(bytes) || 0);
    if (number < 1024) return `${number.toLocaleString('es')} B`;
    if (number < 1048576) return `${(number / 1024).toLocaleString('es', { maximumFractionDigits: 1 })} KB`;
    return `${(number / 1048576).toLocaleString('es', { maximumFractionDigits: 1 })} MB`;
  }

  function backupIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14v12H5Z"/><path d="M8 8V5h8v3M9 14h6"/></svg>';
  }

  function setBackupControlsBusy(busy) {
    state.backupLoading = busy;
    const refresh = $('refreshBackupsButton');
    const create = $('createBackupButton');
    if (refresh) {
      refresh.disabled = busy || state.backupCreating || state.backupRestoring || state.saving || state.matchdayLoading || state.copyingPreviousLineup;
      refresh.classList.toggle('loading', busy);
      refresh.querySelector('span').textContent = busy ? 'Actualizando…' : 'Actualizar';
    }
    if (create) create.disabled = busy || state.backupCreating || state.backupRestoring || state.saving || state.matchdayLoading || state.copyingPreviousLineup || !state.backupSchemaReady;
    document.querySelectorAll('.backup-item-action').forEach(button => {
      button.disabled = busy || state.backupCreating || state.backupRestoring || state.saving || state.matchdayLoading || state.copyingPreviousLineup;
    });
  }

  function renderBackupHealth(backups = []) {
    const badge = $('backupAutomaticBadge');
    if (!badge) return;
    const latestDaily = backups.find(backup => backup.kind === 'daily');
    const age = latestDaily?.createdAt ? Date.now() - Date.parse(latestDaily.createdAt) : Number.POSITIVE_INFINITY;
    const healthy = Number.isFinite(age) && age >= 0 && age <= 36 * 60 * 60 * 1000;
    badge.classList.toggle('is-stale', !healthy);
    badge.innerHTML = healthy ? '<i></i> AUTOMÁTICO AL DÍA' : '<i></i> REVISAR AUTOMÁTICO';
    badge.title = healthy
      ? `Última copia diaria: ${formatDate(latestDaily.createdAt)}`
      : 'No existe una copia diaria de las últimas 36 horas';
  }

  function renderBackupList() {
    const list = $('backupList');
    const status = $('backupListStatus');
    if (!list || !status) return;

    const backups = state.backups;
    renderBackupHealth(backups);
    status.textContent = backups.length
      ? `${backups.length} ${backups.length === 1 ? 'copia disponible' : 'copias disponibles'}`
      : 'Todavía no hay copias';

    if (!backups.length) {
      $('backupLatestAt').textContent = 'Sin copias todavía';
      $('backupLatestKind').textContent = 'Crea el primer respaldo ahora';
      list.innerHTML = '<div class="backup-empty"><b>No existe ningún respaldo</b><small>Usa “Crear respaldo ahora” para guardar la primera copia.</small></div>';
      return;
    }

    const latest = backups[0];
    $('backupLatestAt').textContent = formatDate(latest.createdAt);
    $('backupLatestKind').textContent = `${backupKindLabel(latest.kind)} · ${backupTotalRows(latest.rowCounts).toLocaleString('es')} registros`;

    list.innerHTML = backups.map(backup => {
      const shortChecksum = backup.checksum ? backup.checksum.slice(0, 10) : 'sin huella';
      const restored = backup.restoredAt ? '<em>Restaurado</em>' : '';
      return `<article class="backup-list-item kind-${escapeHtml(backup.kind)}${backup.restoredAt ? ' is-restored' : ''}">
        <span class="backup-kind-icon" aria-hidden="true">${backupIcon()}</span>
        <span class="backup-item-copy">
          <span><b>${escapeHtml(backupKindLabel(backup.kind))} · ${escapeHtml(formatDate(backup.createdAt))}</b>${restored}</span>
          <small>${backupTotalRows(backup.rowCounts).toLocaleString('es')} registros · ${escapeHtml(backupSizeLabel(backup.sizeBytes))} · huella ${escapeHtml(shortChecksum)}</small>
        </span>
        <span class="backup-item-actions">
          <button class="backup-item-action download" type="button" data-backup-download="${escapeHtml(backup.id)}" aria-label="Descargar respaldo del ${escapeHtml(formatDate(backup.createdAt))}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m-4-4 4 4 4-4"/><path d="M5 19h14"/></svg>
          </button>
          <button class="backup-item-action restore" type="button" data-backup-restore="${escapeHtml(backup.id)}" aria-label="Restaurar respaldo del ${escapeHtml(formatDate(backup.createdAt))}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 8 4 13l5 5"/><path d="M5 13h8a6 6 0 0 1 6 6"/></svg>
          </button>
        </span>
      </article>`;
    }).join('');
  }

  async function loadBackups({ manual = false } = {}) {
    if (!state.client || state.backupLoading || state.backupCreating || state.copyingPreviousLineup) return false;
    setBackupControlsBusy(true);
    if ($('backupListStatus')) $('backupListStatus').textContent = 'Actualizando historial…';

    try {
      const { data: version, error: versionError } = await state.client.rpc('get_league_backup_schema_version');
      if (versionError || Number(version) < 124) throw versionError || new Error('SUPABASE-V124 backup schema is required');
      const { data, error } = await state.client.rpc('list_league_backups');
      if (error) throw error;
      state.backupSchemaReady = true;
      state.backups = (Array.isArray(data) ? data : []).map(normalizeBackup);
      $('backupUnavailable').hidden = true;
      $('backupContent').hidden = false;
      renderBackupList();
      if (manual) flashMessage('Historial de respaldos actualizado.');
      return true;
    } catch (error) {
      if (isBackupUpgradeError(error)) {
        state.backupSchemaReady = false;
        state.backups = [];
        $('backupContent').hidden = true;
        $('backupUnavailable').hidden = false;
      } else {
        $('backupListStatus').textContent = 'No se pudieron actualizar las copias';
        if (manual) flashMessage(friendlyError(error), 'error');
      }
      return false;
    } finally {
      setBackupControlsBusy(false);
    }
  }

  async function createBackup() {
    if (!state.client || state.saving || state.matchdayLoading || state.backupLoading || state.backupCreating || state.backupRestoring || state.copyingPreviousLineup || !state.backupSchemaReady) return;
    state.backupCreating = true;
    setButtonsBusy(true);
    setBackupControlsBusy(false);
    const button = $('createBackupButton');
    button.disabled = true;
    button.querySelector('span').textContent = 'Creando copia…';

    try {
      clearTimeout(state.autoSaveTimer);
      const synchronized = await flushAutoSave({ force: true });
      if (!synchronized) {
        throw new Error('No se pudo sincronizar el borrador actual. El respaldo no se creó para evitar guardar una copia incompleta.');
      }
      const { data, error } = await state.client.rpc('create_league_backup');
      if (error) throw error;
      flashMessage(`Respaldo creado correctamente · ${backupTotalRows(data?.rowCounts || {}).toLocaleString('es')} registros protegidos.`);
      state.backupCreating = false;
      await loadBackups();
    } catch (error) {
      if (isBackupUpgradeError(error)) {
        state.backupSchemaReady = false;
        $('backupContent').hidden = true;
        $('backupUnavailable').hidden = false;
      }
      flashMessage(friendlyError(error), 'error');
    } finally {
      state.backupCreating = false;
      button.querySelector('span').textContent = 'Crear respaldo ahora';
      setButtonsBusy(false);
      setBackupControlsBusy(false);
    }
  }

  async function downloadBackup(backupId) {
    if (!backupId || state.saving || state.matchdayLoading || state.backupLoading || state.backupCreating || state.backupRestoring || state.copyingPreviousLineup) return;
    const backup = state.backups.find(item => item.id === backupId);
    setBackupControlsBusy(true);
    try {
      const { data, error } = await state.client.rpc('download_league_backup', { p_backup_id: backupId });
      if (error) throw error;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const date = backup?.createdAt ? new Date(backup.createdAt).toISOString().slice(0, 10) : localDateInputValue();
      link.href = url;
      link.download = `Cuban-League-Backup-${date}-${backup?.kind || 'manual'}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      flashMessage('Respaldo descargado. Guárdalo en Archivos o iCloud como copia adicional.');
    } catch (error) {
      flashMessage(friendlyError(error), 'error');
    } finally {
      setBackupControlsBusy(false);
    }
  }

  function backupRestoreMetric(key, currentCounts = {}, backupCounts = {}) {
    const current = Math.max(0, Number(currentCounts?.[key]) || 0);
    const saved = Math.max(0, Number(backupCounts?.[key]) || 0);
    return `<article class="backup-restore-metric">
      <span><small>${escapeHtml(BACKUP_TABLE_LABELS[key])}</small><b>Actual: ${current.toLocaleString('es')}</b></span>
      <em aria-hidden="true">→</em>
      <strong><small>Respaldo</small><span>${saved.toLocaleString('es')}</span></strong>
    </article>`;
  }

  async function openBackupRestore(backupId, trigger = null) {
    if (!backupId || state.saving || state.matchdayLoading || state.backupLoading || state.backupCreating || state.backupRestoring || state.copyingPreviousLineup) return;
    setButtonsBusy(true);
    setBackupControlsBusy(true);
    try {
      clearTimeout(state.autoSaveTimer);
      const synchronized = await flushAutoSave({ force: true });
      if (!synchronized) {
        throw new Error('No se pudo sincronizar el borrador actual. La comparación no se abrió para evitar perder cambios.');
      }
      state.suspendAutoSave = true;
      const { data, error } = await state.client.rpc('preview_league_restore', { p_backup_id: backupId });
      if (error) throw error;
      const backup = state.backups.find(item => item.id === backupId);
      state.backupRestoreId = backupId;
      state.backupRestorePreview = data || {};
      state.backupRestoreTrigger = trigger || document.activeElement;
      $('backupRestoreSubtitle').textContent = `${backupKindLabel(backup?.kind)} · ${formatDate(backup?.createdAt || data?.createdAt)} · integridad verificada`;
      $('backupRestoreComparison').innerHTML = Object.keys(BACKUP_TABLE_LABELS)
        .map(key => backupRestoreMetric(key, data?.currentCounts, data?.backupCounts))
        .join('');
      $('backupRestoreConfirmation').value = '';
      $('confirmBackupRestore').disabled = true;
      $('backupRestoreModal').hidden = false;
      document.body.classList.add('backup-restore-open');
      document.querySelectorAll('.admin-topbar,.admin-main').forEach(node => { node.inert = true; });
      state.backupRestoreOpen = true;
      requestAnimationFrame(() => $('backupRestoreConfirmation').focus());
    } catch (error) {
      state.suspendAutoSave = false;
      flashMessage(friendlyError(error), 'error');
    } finally {
      setButtonsBusy(false);
      setBackupControlsBusy(false);
    }
  }

  function closeBackupRestore(returnFocus = true, force = false) {
    if (!$('backupRestoreModal') || !state.backupRestoreOpen) return;
    if (state.backupRestoring && !force) return;
    $('backupRestoreModal').hidden = true;
    document.body.classList.remove('backup-restore-open');
    document.querySelectorAll('.admin-topbar,.admin-main').forEach(node => { node.inert = false; });
    const focus = state.backupRestoreTrigger;
    state.backupRestoreOpen = false;
    state.backupRestoreId = null;
    state.backupRestorePreview = null;
    state.backupRestoreTrigger = null;
    state.suspendAutoSave = false;
    $('backupRestoreConfirmation').value = '';
    $('confirmBackupRestore').disabled = true;
    if (returnFocus) focus?.focus?.();
  }

  function trapBackupRestoreFocus(event) {
    if (event.key !== 'Tab' || !state.backupRestoreOpen) return;
    const focusable = [...$('backupRestoreModal').querySelectorAll('button:not([disabled]),input:not([disabled])')];
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function archiveAllLocalDrafts() {
    const cutoff = new Date().toISOString();
    state.localDraftRestoreCutoff = cutoff;
    let cutoffSaved = false;
    let archived = 0;
    let preserved = 0;

    try {
      localStorage.setItem(LOCAL_DRAFT_RESTORE_CUTOFF_KEY, cutoff);
      cutoffSaved = true;
      const suffix = cutoff.replace(/[^0-9]/g, '');
      Object.keys(localStorage)
        .filter(key => key.startsWith(LOCAL_DRAFT_PREFIX))
        .forEach(key => {
          const raw = localStorage.getItem(key);
          if (raw === null) return;
          try {
            const archivedKey = `${ARCHIVED_DRAFT_PREFIX}${suffix}:${key.slice(LOCAL_DRAFT_PREFIX.length)}`;
            localStorage.setItem(archivedKey, raw);
            localStorage.removeItem(key);
            archived += 1;
          } catch {
            preserved += 1;
          }
        });
    } catch {
      preserved += 1;
    }

    return { archived, preserved, cutoffSaved };
  }

  async function confirmBackupRestore() {
    const backupId = state.backupRestoreId;
    const confirmation = $('backupRestoreConfirmation').value.trim();
    if (!backupId || confirmation !== 'RESTAURAR' || state.saving || state.backupRestoring || state.copyingPreviousLineup) return;

    state.backupRestoring = true;
    clearTimeout(state.autoSaveTimer);
    const button = $('confirmBackupRestore');
    button.disabled = true;
    button.querySelector('span').textContent = 'Restaurando…';
    $('backupRestoreConfirmation').disabled = true;
    $('closeBackupRestore').disabled = true;
    $('cancelBackupRestore').disabled = true;
    $('backupRestoreModal').setAttribute('aria-busy', 'true');

    try {
      if (state.autoSavePromise || state.dirty) {
        throw new Error('Los datos locales cambiaron después de abrir la comparación. Ciérrala, guarda y vuelve a revisar el respaldo.');
      }
      setButtonsBusy(true);
      setBackupControlsBusy(true);
      const { data, error } = await state.client.rpc('restore_league_backup', {
        p_backup_id: backupId,
        p_confirmation: confirmation,
        p_expected_restore_generation: state.backupRestorePreview?.restoreGeneration || null,
        p_expected_data_revision: Number(state.backupRestorePreview?.dataRevision) || 0
      });
      if (error) throw error;
      state.restoreStateChecked = true;
      state.restoreStateAvailable = Boolean(data?.restoreGeneration);
      state.serverRestoreGeneration = String(data?.restoreGeneration || '');
      state.serverDataRevision = Math.max(0, Number(data?.dataRevision) || 0);
      state.serverRestoreAt = String(data?.restoredAt || '');
      const localDraftArchive = archiveAllLocalDrafts();
      state.hasDraft = false;
      state.dirty = false;
      state.editingPublished = false;
      closeBackupRestore(false, true);
      await loadMatchday();
      setBackupControlsBusy(false);
      await loadBackups();
      const restored = backupTotalRows(data?.restoredCounts || {});
      const localDraftNotice = localDraftArchive.archived
        ? ` · ${localDraftArchive.archived} ${localDraftArchive.archived === 1 ? 'borrador local quedó archivado' : 'borradores locales quedaron archivados'}.`
        : '';
      const preservedWarning = localDraftArchive.preserved
        ? ' Revisa los borradores locales antes de volver a editar.'
        : '';
      flashMessage(`Restauración completada · ${restored.toLocaleString('es')} registros recuperados. También se creó una copia preventiva.${localDraftNotice}${preservedWarning}`);
    } catch (error) {
      if (isRestoreGenerationError(error) || isRestorePreviewStaleError(error)) {
        closeBackupRestore(false, true);
        await loadMatchday();
        await loadBackups();
      }
      flashMessage(friendlyError(error), 'error');
    } finally {
      state.suspendAutoSave = false;
      state.backupRestoring = false;
      setButtonsBusy(false);
      setBackupControlsBusy(false);
      $('backupRestoreModal').removeAttribute('aria-busy');
      $('backupRestoreConfirmation').disabled = false;
      $('closeBackupRestore').disabled = false;
      $('cancelBackupRestore').disabled = false;
      button.querySelector('span').textContent = 'Restaurar este respaldo';
      button.disabled = !state.backupRestoreOpen || $('backupRestoreConfirmation').value.trim() !== 'RESTAURAR';
    }
  }

  async function verifyAdministrator() {
    const { data, error } = await state.client.rpc('is_league_admin');
    if (error) throw error;
    return data === true;
  }

  async function detectCatalogLineupSchema() {
    const { data, error } = await state.client.rpc('get_player_catalog_schema_version');
    state.catalogSchemaReady = !error && Number(data) >= 116;
    return state.catalogSchemaReady;
  }

  function excludeOwnerVisitsOnThisBrowser() {
    try {
      localStorage.setItem(OWNER_VISIT_EXCLUSION_KEY, '1');
    } catch {}
  }

  async function openPanel(session) {
    try {
      const authorized = await verifyAdministrator();
      if (!authorized) {
        await state.client.auth.signOut();
        setLoginMessage('Esta cuenta no está autorizada para administrar Cuban League.');
        showOnly('loginView');
        return;
      }

      excludeOwnerVisitsOnThisBrowser();
      await detectCatalogLineupSchema();
      $('sessionEmail').textContent = session.user.email || '';
      $('seasonLabel').textContent = config.season;
      showOnly('panelView');
      updateCompetitionUI();
      await loadMatchday();
      loadVisitorAnalytics();
      loadBackups();
    } catch (error) {
      setLoginMessage(friendlyError(error));
      showOnly('loginView');
    }
  }

  async function requestPasswordReset() {
    setLoginMessage();
    const email = $('adminEmail').value.trim();
    if (!email || !$('adminEmail').checkValidity()) {
      setLoginMessage('Escribe el correo administrador válido antes de solicitar el enlace.');
      $('adminEmail').focus();
      return;
    }

    const button = $('forgotPasswordButton');
    button.disabled = true;
    button.textContent = 'Enviando enlace…';
    try {
      const redirectTo = new URL('admin.html?recovery=1', location.href).href;
      const { error } = await state.client.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      setLoginMessage('Revisa tu correo. Supabase envió un enlace seguro para crear una contraseña nueva.');
    } catch (error) {
      setLoginMessage(friendlyError(error));
    } finally {
      button.disabled = false;
      button.textContent = 'Olvidé mi contraseña';
    }
  }

  async function saveRecoveredPassword(event) {
    event.preventDefault();
    setRecoveryMessage();
    const password = $('recoveryPassword').value;
    const confirmation = $('recoveryPasswordConfirm').value;
    if (password.length < 8) {
      setRecoveryMessage('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== confirmation) {
      setRecoveryMessage('Las contraseñas no coinciden.');
      return;
    }

    const button = $('saveRecoveredPassword');
    button.disabled = true;
    button.querySelector('span').textContent = 'Guardando…';
    try {
      const { error } = await state.client.auth.updateUser({ password });
      if (error) throw error;
      history.replaceState({}, '', 'admin.html');
      const { data, error: sessionError } = await state.client.auth.getSession();
      if (sessionError) throw sessionError;
      showRecoveryForm(false);
      if (data.session) await openPanel(data.session);
      else showOnly('loginView');
    } catch (error) {
      setRecoveryMessage(friendlyError(error));
      showOnly('loginView');
      showRecoveryForm(true);
    } finally {
      button.disabled = false;
      button.querySelector('span').textContent = 'Guardar contraseña nueva';
    }
  }

  async function login(event) {
    event.preventDefault();
    setLoginMessage();
    const button = $('loginButton');
    button.disabled = true;
    button.querySelector('span').textContent = 'Comprobando…';
    const email = $('adminEmail').value.trim();
    const password = $('adminPassword').value;

    try {
      const { data, error } = await state.client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await openPanel(data.session);
      $('adminPassword').value = '';
    } catch (error) {
      setLoginMessage(friendlyError(error));
      showOnly('loginView');
    } finally {
      button.disabled = false;
      button.querySelector('span').textContent = 'Entrar al panel';
    }
  }

  async function logout() {
    if (state.copyingPreviousLineup) return;
    await prepareNavigation();
    closeBackupRestore(false);
    await state.client.auth.signOut();
    state.dirty = false;
    $('adminPassword').value = '';
    showOnly('loginView');
  }

  function bindEvents() {
    $('loginForm').addEventListener('submit', login);
    $('forgotPasswordButton').addEventListener('click', requestPasswordReset);
    $('recoveryForm').addEventListener('submit', saveRecoveredPassword);
    $('cancelRecovery').addEventListener('click', () => {
      history.replaceState({}, '', 'admin.html');
      showRecoveryForm(false);
      showOnly('loginView');
    });
    $('togglePassword').addEventListener('click', () => {
      const input = $('adminPassword');
      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      $('togglePassword').textContent = visible ? 'Ver' : 'Ocultar';
      $('togglePassword').setAttribute('aria-label', visible ? 'Mostrar contraseña' : 'Ocultar contraseña');
    });

    $('logoutButton').addEventListener('click', logout);
    $('refreshAnalyticsButton').addEventListener('click', () => loadVisitorAnalytics({ manual: true }));
    $('refreshBackupsButton').addEventListener('click', () => loadBackups({ manual: true }));
    $('createBackupButton').addEventListener('click', createBackup);
    $('backupList').addEventListener('click', event => {
      const download = event.target.closest('[data-backup-download]');
      if (download) {
        downloadBackup(download.dataset.backupDownload);
        return;
      }
      const restore = event.target.closest('[data-backup-restore]');
      if (restore) openBackupRestore(restore.dataset.backupRestore, restore);
    });
    $('closeBackupRestore').addEventListener('click', () => closeBackupRestore());
    $('cancelBackupRestore').addEventListener('click', () => closeBackupRestore());
    $('backupRestoreModal').addEventListener('click', event => {
      if (event.target.id === 'backupRestoreModal') closeBackupRestore();
    });
    $('backupRestoreConfirmation').addEventListener('input', event => {
      $('confirmBackupRestore').disabled = event.target.value.trim() !== 'RESTAURAR';
    });
    $('confirmBackupRestore').addEventListener('click', confirmBackupRestore);
    $('leagueModeButton').addEventListener('click', () => switchCompetition('league'));
    $('championsModeButton').addEventListener('click', () => switchCompetition('champions'));
    $('goToChampionsSourceButton').addEventListener('click', goToChampionsSourceMatchday);
    $('importMisterButton').addEventListener('click', startMisterImport);
    $('copyMisterHelperButton').addEventListener('click', copyMisterHelper);
    $('cancelMisterImportButton').addEventListener('click', () => cancelMisterImport());
    $('saveDraftButton').addEventListener('click', () => {
      if (state.participantEntryMode === 'single') saveDraftAndContinue();
      else persistDraft({ manual: true });
    });
    $('singleParticipantModeButton').addEventListener('click', () => setParticipantEntryMode('single'));
    $('allParticipantsModeButton').addEventListener('click', () => setParticipantEntryMode('all'));
    $('previousParticipantButton').addEventListener('click', () => moveWorkParticipant(-1));
    $('nextParticipantButton').addEventListener('click', () => moveWorkParticipant(1));
    $('nextPendingParticipantButton').addEventListener('click', moveToNextPendingParticipant);
    $('singleParticipantSelect').addEventListener('change', event => selectWorkParticipant(event.target.value));
    $('publishButton').addEventListener('click', openPreview);
    $('editPublishedButton').addEventListener('click', startCorrection);
    $('undoPublicationButton').addEventListener('click', undoLastPublication);
    $('closePreview').addEventListener('click', () => closePreview());
    $('cancelPreview').addEventListener('click', () => closePreview());
    $('confirmPublishButton').addEventListener('click', publishPreview);
    $('previewModal').addEventListener('click', event => {
      if (event.target.id === 'previewModal') closePreview();
    });

    $('matchdaySelect').addEventListener('change', async event => {
      if (state.copyingPreviousLineup) {
        event.target.value = String(state.matchday);
        return;
      }
      const nextMatchday = Number(event.target.value);
      await prepareNavigation();
      state.matchday = nextMatchday;
      state.published = false;
      state.publishedRows = [];
      state.editingPublished = false;
      state.hasDraft = false;
      syncPublicationUI();
      await loadMatchday();
    });

    $('matchdayDate').addEventListener('change', () => {
      state.milestone = gatherMilestone();
      updateAchievementSettingsMessage();
      scheduleAutoSave();
    });

    $('monthEndToggle').addEventListener('change', () => {
      state.milestone = gatherMilestone();
      updateAchievementSettingsMessage();
      scheduleAutoSave();
    });

    $('yearEndToggle').addEventListener('change', event => {
      if (event.target.checked) $('monthEndToggle').checked = true;
      state.milestone = gatherMilestone();
      updateAchievementSettingsMessage();
      scheduleAutoSave();
    });

    $('postponedToggle').addEventListener('change', () => {
      updateAchievementSettingsMessage();
      updateCompletionState();
      syncPublicationUI();
      scheduleAutoSave();
    });

    $('lineupParticipantSelect').addEventListener('change', event => {
      selectWorkParticipant(event.target.value);
    });

    const handleLineupInput = () => {
      updateLineupFromEditor();
      updateCompletionState();
      scheduleAutoSave();
    };
    $('lineupPlayerRows').addEventListener('input', event => {
      if (!event.target.matches('[data-lineup-field]')) return;
      if (event.target.matches('select, [data-lineup-field="is_captain"]')) return;
      handleLineupInput();
    });
    $('lineupPlayerRows').addEventListener('change', event => {
      const captainInput = event.target.matches('[data-lineup-field="is_captain"]')
        ? event.target
        : null;
      if (captainInput?.checked) {
        document.querySelectorAll('[data-lineup-field="is_captain"]').forEach(input => {
          if (input !== captainInput) input.checked = false;
        });
      }
      if (!captainInput && !event.target.matches('select[data-lineup-field]')) return;
      handleLineupInput();
    });
    $('lineupPlayerRows').addEventListener('click', event => {
      const row = event.target.closest('.lineup-player-row');
      if (!row) return;
      const signToggle = event.target.closest('[data-toggle-points-sign]');
      if (signToggle) {
        togglePointsSign(signToggle);
        return;
      }
      const openButton = event.target.closest('[data-open-player-catalog]');
      if (openButton) {
        openPlayerCatalog(Number(row.dataset.lineupSlot), openButton);
        return;
      }
      if (event.target.closest('[data-clear-lineup-player]')) {
        clearLineupPlayer(Number(row.dataset.lineupSlot));
      }
    });
    $('closePlayerCatalog').addEventListener('click', () => closePlayerCatalog());
    $('playerCatalogModal').addEventListener('click', event => {
      if (event.target.id === 'playerCatalogModal') closePlayerCatalog();
    });
    $('playerCatalogSearch').addEventListener('input', renderPlayerCatalogResults);
    $('playerCatalogPosition').addEventListener('change', () => {
      $('playerCatalogSlotLabel').textContent = `Posición ${String(state.catalogSlot || '').padStart(2, '0')} · ${LINEUP_POSITION_LABELS[$('playerCatalogPosition').value] || 'todas las posiciones'}`;
      renderPlayerCatalogResults();
    });
    $('playerCatalogClub').addEventListener('change', renderPlayerCatalogResults);
    $('playerCatalogResults').addEventListener('click', event => {
      const result = event.target.closest('[data-catalog-player-id]');
      if (result) chooseCatalogPlayer(result.dataset.catalogPlayerId);
    });
    $('selectEmptyLineupSlot').addEventListener('click', chooseEmptyLineupSlot);
    $('copyPreviousLineupButton').addEventListener('click', copyPreviousPublishedLineup);
    $('clearLineupButton').addEventListener('click', () => {
      if (!state.lineupParticipantName) return;
      const current = lineupMetrics(lineupForParticipant(state.lineupParticipantName));
      if (current.hasContent && !window.confirm(`¿Vaciar la alineación de ${state.lineupParticipantName}? El cambio quedará en el borrador hasta publicar.`)) return;
      state.lineups.set(state.lineupParticipantName, []);
      renderLineupEditor();
      updateCompletionState();
      scheduleAutoSave();
    });

    $('playerRows').addEventListener('input', event => {
      if (!event.target.matches('.stat-input')) return;
      if (event.target.dataset.stat !== 'points' && valueFor(event.target) < 0) event.target.value = 0;
      if (event.target.dataset.stat === 'points') syncSignedPointsControl(event.target);
      updateTotals();
      updateLineupSummary();
      updateCompletionState();
      scheduleAutoSave();
    });
    $('playerRows').addEventListener('click', event => {
      const signToggle = event.target.closest('[data-toggle-points-sign]');
      if (signToggle) togglePointsSign(signToggle);
    });

    document.addEventListener('keydown', event => {
      trapBackupRestoreFocus(event);
      trapPlayerCatalogFocus(event);
      trapPreviewFocus(event);
      if (event.key === 'Escape' && !$('backupRestoreModal').hidden) closeBackupRestore();
      else if (event.key === 'Escape' && !$('playerCatalogModal').hidden) closePlayerCatalog();
      else if (event.key === 'Escape' && !$('previewModal').hidden) closePreview();
      else if (event.key === 'Escape' && !$('adminInstallModal').hidden) closeInstallGuide();
      else if (event.key === 'Escape' && !$('misterImportPanel').hidden) cancelMisterImport();
    });

    window.addEventListener('beforeunload', event => {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  async function boot() {
    try {
      if (!config?.url || !config?.publishableKey) throw new Error('Falta la configuración de Supabase.');
      if (!window.supabase?.createClient) throw new Error('No se pudo cargar la conexión segura.');

      const catalogPromise = window.CubanLeaguePlayerCatalog
        ? window.CubanLeaguePlayerCatalog.load(VERSION).catch(() => null)
        : Promise.resolve(null);
      const [response, loadedCatalog] = await Promise.all([
        fetch(`data.json?v=${VERSION}`, { cache: 'no-store' }),
        catalogPromise
      ]);
      if (!response.ok) throw new Error('No se pudo cargar la lista de participantes.');
      const league = await response.json();
      state.catalog = loadedCatalog
        && loadedCatalog.declaredRecordCount > 0
        && loadedCatalog.recordCount === loadedCatalog.declaredRecordCount
        ? loadedCatalog
        : null;
      if (state.catalog) {
        $('playerCatalogKicker').textContent = `CATÁLOGO MAESTRO · ${state.catalog.recordCount} JUGADORES`;
        $('playerCatalogClub').innerHTML = '<option value="">Todos los clubes</option>' + state.catalog.clubs
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name, 'es'))
          .map(club => `<option value="${escapeHtml(club.id)}">${escapeHtml(club.name)}</option>`)
          .join('');
      }
      state.leagueParticipants = league.participants.filter(participant => participant.active !== false);
      state.participantIndex = new Map(league.participants.map(participant => [participant.name, participant]));
      state.championsGroups = Array.isArray(league.champions?.groups) ? league.champions.groups : [];
      state.championsLeagueMatchdays = Array.isArray(league.champions?.format?.leagueMatchdays)
        ? league.champions.format.leagueMatchdays.map(Number)
        : [];
      if (state.championsLeagueMatchdays.length !== 8
        || state.championsLeagueMatchdays.some(matchday => !Number.isInteger(matchday) || matchday < 1 || matchday > 38)
        || new Set(state.championsLeagueMatchdays).size !== state.championsLeagueMatchdays.length) {
        throw new Error('El calendario automático de Champions no está configurado correctamente.');
      }
      restoreParticipantEntryMode();
      const validChampionsGroups = state.championsGroups.length === 4
        && state.championsGroups.every(group =>
          group
          && typeof group.name === 'string'
          && Array.isArray(group.teams)
          && group.teams.length === 5
        );
      const championsNames = validChampionsGroups
        ? state.championsGroups.flatMap(group => group.teams.map(name => String(name || '').trim()))
        : [];
      const uniqueChampionsNames = new Set(championsNames);
      const activeLeagueNames = new Set(state.leagueParticipants.map(participant => participant.name));
      if (!validChampionsGroups
        || uniqueChampionsNames.size !== 20
        || uniqueChampionsNames.size !== championsNames.length
        || championsNames.some(name => !name || !activeLeagueNames.has(name))
        || activeLeagueNames.size !== uniqueChampionsNames.size
        || [...activeLeagueNames].some(name => !uniqueChampionsNames.has(name))) {
        throw new Error('Los cuatro grupos de Champions deben contener exactamente una vez a los 20 participantes activos.');
      }
      state.participants = [...state.leagueParticipants];
      updateCompetitionUI();

      state.client = window.supabase.createClient(config.url, config.publishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
      bindEvents();
      setupInstallableAdmin();
      setupMisterImportControls();

      state.client.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY' && session) {
          showOnly('loginView');
          showRecoveryForm(true);
          setRecoveryMessage('Enlace verificado. Crea ahora tu contraseña nueva.');
          return;
        }
        if (event === 'SIGNED_OUT' || !session) {
          showRecoveryForm(false);
          showOnly('loginView');
        }
      });

      const { data, error } = await state.client.auth.getSession();
      if (error) throw error;
      const recoveryRequested = new URLSearchParams(location.search).get('recovery') === '1'
        || new URLSearchParams(location.hash.replace(/^#/, '')).get('type') === 'recovery';
      if (data.session && recoveryRequested) {
        showOnly('loginView');
        showRecoveryForm(true);
        setRecoveryMessage('Enlace verificado. Crea ahora tu contraseña nueva.');
      } else if (data.session) {
        await openPanel(data.session);
      } else {
        showRecoveryForm(false);
        showOnly('loginView');
      }
    } catch (error) {
      setLoginMessage(friendlyError(error));
      showOnly('loginView');
    }
  }

  boot();
})();
