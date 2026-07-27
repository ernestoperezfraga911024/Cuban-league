(() => {
  'use strict';

  const VERSION = '40-20260725';
  const config = window.CUBAN_LEAGUE_SUPABASE;
  const $ = id => document.getElementById(id);
  const state = {
    client: null,
    participants: [],
    leagueParticipants: [],
    championsGroups: [],
    participantIndex: new Map(),
    competition: 'league',
    matchday: 1,
    published: false,
    dirty: false,
    saving: false,
    messageTimer: null,
    deferredInstallPrompt: null
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
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !$('adminInstallModal').hidden) closeInstallGuide();
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

  function currentMatchdayCount() {
    return isChampionsMode() ? 8 : 38;
  }

  function friendlyError(error) {
    const message = String(error?.message || error || '');
    if (/invalid login credentials/i.test(message)) return 'El correo o la contraseña no son correctos.';
    if (/email not confirmed/i.test(message)) return 'Primero debes confirmar el correo en Supabase.';
    if (/failed to fetch|networkerror|load failed/i.test(message)) return 'No se pudo conectar. Comprueba tu conexión a internet e inténtalo otra vez.';
    if (/is_league_admin|could not find the function|404/i.test(message)) return 'Falta configurar la base de datos. Ejecuta primero el archivo SQL en Supabase.';
    if (/row-level security|permission denied|not authorized|jwt/i.test(message)) return 'Tu sesión no tiene permiso para realizar esta acción.';
    return message || 'Ocurrió un error inesperado. Inténtalo nuevamente.';
  }

  function setLoginMessage(message = '') {
    const node = $('loginMessage');
    node.textContent = message;
    node.hidden = !message;
  }

  function flashMessage(message, type = 'success') {
    const node = $('panelMessage');
    clearTimeout(state.messageTimer);
    node.textContent = message;
    node.classList.toggle('error', type === 'error');
    node.hidden = false;
    state.messageTimer = setTimeout(() => {
      node.hidden = true;
    }, 5200);
  }

  function setButtonsBusy(busy) {
    state.saving = busy;
    [$('saveDraftButton'), $('publishButton'), $('leagueModeButton'), $('championsModeButton')].forEach(button => {
      button.disabled = busy;
    });
    $('matchdaySelect').disabled = busy;
    document.querySelectorAll('.stat-input').forEach(input => {
      input.disabled = busy;
    });
    if (busy) {
      $('saveDraftButton').querySelector('span').textContent = 'Guardando…';
      $('publishButton').querySelector('span').textContent = 'Guardando…';
    } else {
      syncPublicationUI();
    }
  }

  function markDirty(dirty = true) {
    state.dirty = dirty;
    const node = $('changeState');
    node.classList.toggle('dirty', dirty);
    node.innerHTML = dirty
      ? '<i></i> Hay cambios sin guardar'
      : '<i></i> Todos los cambios guardados';
  }

  function syncPublicationUI() {
    const champions = isChampionsMode();
    const badge = $('publicationBadge');
    badge.classList.toggle('published', state.published);
    badge.classList.toggle('draft', !state.published);
    badge.querySelector('b').textContent = state.published ? 'Publicada' : 'Borrador';
    $('saveDraftButton').querySelector('span').textContent = state.published ? 'Guardar cambios' : 'Guardar borrador';
    $('publishButton').querySelector('span').textContent = state.published
      ? 'Actualizar publicación'
      : champions
        ? 'Publicar en Champions'
        : 'Publicar jornada';
    $('dockMatchday').textContent = state.matchday;
    $('dockSeason').textContent = champions ? 'Champions · fase de grupos' : config.season;
  }

  function formatSavedAt(rows) {
    if (!rows.length) return 'Todavía no guardada';
    const latest = rows.reduce((result, row) => {
      const date = new Date(row.updated_at);
      return !result || date > result ? date : result;
    }, null);
    if (!latest || Number.isNaN(latest.getTime())) return 'Guardada';
    return `Guardada ${new Intl.DateTimeFormat('es', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(latest)}`;
  }

  function valueFor(input) {
    const value = Number.parseInt(input.value, 10);
    return Number.isFinite(value) ? value : 0;
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
  }

  function renderAdminPlayer(participant, row, subtitle) {
    const champions = isChampionsMode();
    const name = escapeHtml(participant.name);
    const shield = escapeHtml(participant.shield);
    const playerId = Number(participant.id);
    const inputPrefix = champions ? 'champions' : 'league';
    return `
      <article class="admin-player${champions ? ' champions-admin-player' : ''}" data-player-id="${playerId}">
        <div class="admin-player-info">
          <img src="${shield}" alt="">
          <span><b>${name}</b><small>${escapeHtml(subtitle)}</small></span>
        </div>
        <div class="stat-input-wrap">
          <label for="${inputPrefix}-points-${playerId}">PTS</label>
          <input class="stat-input" id="${inputPrefix}-points-${playerId}" data-stat="points" type="number" inputmode="numeric" step="1" value="${Number(row.points) || 0}" aria-label="Puntos de ${name}">
        </div>
        <div class="stat-input-wrap">
          <label for="${inputPrefix}-goals-${playerId}">GOL</label>
          <input class="stat-input" id="${inputPrefix}-goals-${playerId}" data-stat="goals" type="number" inputmode="numeric" min="0" step="1" value="${Number(row.goals) || 0}" aria-label="Goles de ${name}">
        </div>
        <div class="stat-input-wrap">
          <label for="${inputPrefix}-clean-sheets-${playerId}">CS</label>
          <input class="stat-input" id="${inputPrefix}-clean-sheets-${playerId}" data-stat="clean_sheets" type="number" inputmode="numeric" min="0" step="1" value="${Number(row.clean_sheets) || 0}" aria-label="Clean sheets de ${name}">
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
            <span><b>${escapeHtml(group.name)}</b><small>5 competidores · jornada ${state.matchday} de 8</small></span>
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
  }

  function gatherRows(published) {
    return [...document.querySelectorAll('.admin-player')].map(node => {
      const participant = state.participants.find(item => item.id === Number(node.dataset.playerId));
      const points = valueFor(node.querySelector('[data-stat="points"]'));
      const goalsInput = node.querySelector('[data-stat="goals"]');
      const cleanSheetsInput = node.querySelector('[data-stat="clean_sheets"]');
      const goals = goalsInput ? valueFor(goalsInput) : 0;
      const cleanSheets = cleanSheetsInput ? valueFor(cleanSheetsInput) : 0;
      if (goals < 0 || cleanSheets < 0) {
        throw new Error(`Los goles y clean sheets de ${participant.name} no pueden ser negativos.`);
      }
      return {
        season: currentSeasonKey(),
        matchday: state.matchday,
        participant_name: participant.name,
        points,
        goals,
        clean_sheets: cleanSheets,
        published
      };
    });
  }

  async function loadMatchday() {
    if (!state.client) return;
    $('playerRows').innerHTML = '<div class="state-card"><span class="loader" aria-hidden="true"></span><div><b>Cargando jornada</b><small>Un momento…</small></div></div>';
    const { data, error } = await state.client
      .from('matchday_stats')
      .select('participant_name,points,goals,clean_sheets,published,updated_at')
      .eq('season', currentSeasonKey())
      .eq('matchday', state.matchday);

    if (error) {
      renderPlayerRows();
      flashMessage(friendlyError(error), 'error');
      return;
    }

    const rows = Array.isArray(data) ? data : [];
    state.published = rows.some(row => row.published === true);
    $('savedAt').textContent = formatSavedAt(rows);
    renderPlayerRows(rows);
    syncPublicationUI();
    markDirty(false);
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
    $('leagueModeButton').classList.toggle('active', !champions);
    $('championsModeButton').classList.toggle('active', champions);
    $('leagueModeButton').setAttribute('aria-pressed', String(!champions));
    $('championsModeButton').setAttribute('aria-pressed', String(champions));
    $('panelTitle').textContent = champions ? 'Registrar Champions' : 'Registrar jornada';
    $('panelDescription').textContent = champions
      ? 'Escribe los puntos, goles y clean sheets de cada competidor en J1–J8. Los totales del grupo se calculan automáticamente.'
      : 'Los cambios se ven en la clasificación pública únicamente después de publicarlos.';
    $('entryTitle').textContent = champions
      ? `${state.participants.length} competidores · 4 grupos`
      : `${state.participants.length} participantes`;
    $('matchdaySelect').innerHTML = Array.from({ length: matchdayCount }, (_, index) => {
      const matchday = index + 1;
      return `<option value="${matchday}">Jornada ${matchday}</option>`;
    }).join('');
    $('matchdaySelect').value = String(state.matchday);
    $('savedAt').textContent = 'Todavía no guardada';
    syncPublicationUI();
  }

  async function switchCompetition(competition) {
    if (competition === state.competition || state.saving) return;
    if (state.dirty && !window.confirm('Hay cambios sin guardar. ¿Quieres cambiar de competición y descartarlos?')) return;
    state.competition = competition;
    state.matchday = 1;
    state.published = false;
    markDirty(false);
    updateCompetitionUI();
    await loadMatchday();
  }

  async function saveMatchday(publishRequested) {
    if (state.saving) return;
    const willPublish = state.published || publishRequested;
    if (publishRequested && !state.published) {
      const competition = currentCompetitionLabel();
      const accepted = window.confirm(`¿Publicar la jornada ${state.matchday} de ${competition}? La tabla pública se actualizará inmediatamente.`);
      if (!accepted) return;
    }

    try {
      const rows = gatherRows(willPublish);
      setButtonsBusy(true);
      const { data, error } = await state.client
        .from('matchday_stats')
        .upsert(rows, { onConflict: 'season,matchday,participant_name' })
        .select('participant_name,points,goals,clean_sheets,published,updated_at');
      if (error) throw error;

      state.published = willPublish;
      markDirty(false);
      $('savedAt').textContent = formatSavedAt(data || []);
      flashMessage(
        willPublish
          ? `Jornada ${state.matchday} de ${currentCompetitionLabel()} publicada. La tabla ya puede actualizarse.`
          : `Borrador de la jornada ${state.matchday} de ${currentCompetitionLabel()} guardado correctamente.`
      );
    } catch (error) {
      flashMessage(friendlyError(error), 'error');
    } finally {
      setButtonsBusy(false);
    }
  }

  async function verifyAdministrator() {
    const { data, error } = await state.client.rpc('is_league_admin');
    if (error) throw error;
    return data === true;
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

      $('sessionEmail').textContent = session.user.email || '';
      $('seasonLabel').textContent = config.season;
      showOnly('panelView');
      updateCompetitionUI();
      await loadMatchday();
    } catch (error) {
      setLoginMessage(friendlyError(error));
      showOnly('loginView');
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
    if (state.dirty && !window.confirm('Hay cambios sin guardar. ¿Quieres cerrar la sesión de todos modos?')) return;
    await state.client.auth.signOut();
    state.dirty = false;
    $('adminPassword').value = '';
    showOnly('loginView');
  }

  function bindEvents() {
    $('loginForm').addEventListener('submit', login);
    $('togglePassword').addEventListener('click', () => {
      const input = $('adminPassword');
      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      $('togglePassword').textContent = visible ? 'Ver' : 'Ocultar';
      $('togglePassword').setAttribute('aria-label', visible ? 'Mostrar contraseña' : 'Ocultar contraseña');
    });

    $('logoutButton').addEventListener('click', logout);
    $('leagueModeButton').addEventListener('click', () => switchCompetition('league'));
    $('championsModeButton').addEventListener('click', () => switchCompetition('champions'));
    $('saveDraftButton').addEventListener('click', () => saveMatchday(false));
    $('publishButton').addEventListener('click', () => saveMatchday(true));

    $('matchdaySelect').addEventListener('change', async event => {
      const nextMatchday = Number(event.target.value);
      if (state.dirty && !window.confirm('Hay cambios sin guardar. ¿Quieres cambiar de jornada y descartarlos?')) {
        event.target.value = String(state.matchday);
        return;
      }
      state.matchday = nextMatchday;
      syncPublicationUI();
      await loadMatchday();
    });

    $('playerRows').addEventListener('input', event => {
      if (!event.target.matches('.stat-input')) return;
      if (event.target.dataset.stat !== 'points' && valueFor(event.target) < 0) event.target.value = 0;
      markDirty(true);
      updateTotals();
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

      const response = await fetch(`data.json?v=${VERSION}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('No se pudo cargar la lista de participantes.');
      const league = await response.json();
      state.leagueParticipants = league.participants.filter(participant => participant.active !== false);
      state.participantIndex = new Map(league.participants.map(participant => [participant.name, participant]));
      state.championsGroups = Array.isArray(league.champions?.groups) ? league.champions.groups : [];
      const missingChampionsPlayers = state.championsGroups
        .flatMap(group => group.teams)
        .filter(name => !state.participantIndex.has(name));
      if (missingChampionsPlayers.length) {
        throw new Error(`Faltan participantes de Champions: ${missingChampionsPlayers.join(', ')}.`);
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

      const { data, error } = await state.client.auth.getSession();
      if (error) throw error;
      if (data.session) {
        await openPanel(data.session);
      } else {
        showOnly('loginView');
      }

      state.client.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT' || !session) showOnly('loginView');
      });
    } catch (error) {
      setLoginMessage(friendlyError(error));
      showOnly('loginView');
    }
  }

  boot();
})();
