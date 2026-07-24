(() => {
  'use strict';

  const VERSION = '33-20260724';
  const config = window.CUBAN_LEAGUE_SUPABASE;
  const $ = id => document.getElementById(id);
  const state = {
    client: null,
    participants: [],
    matchday: 1,
    published: false,
    dirty: false,
    saving: false,
    messageTimer: null
  };

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
    [$('saveDraftButton'), $('publishButton')].forEach(button => {
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
    const badge = $('publicationBadge');
    badge.classList.toggle('published', state.published);
    badge.classList.toggle('draft', !state.published);
    badge.querySelector('b').textContent = state.published ? 'Publicada' : 'Borrador';
    $('saveDraftButton').querySelector('span').textContent = state.published ? 'Guardar cambios' : 'Guardar borrador';
    $('publishButton').querySelector('span').textContent = state.published ? 'Actualizar publicación' : 'Publicar jornada';
    $('dockMatchday').textContent = state.matchday;
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
      return sum + valueFor(input);
    }, 0);
    $('pointsTotal').textContent = total('points').toLocaleString();
    $('goalsTotal').textContent = total('goals').toLocaleString();
    $('cleanSheetsTotal').textContent = total('clean_sheets').toLocaleString();
  }

  function renderPlayerRows(records = []) {
    const recordMap = new Map(records.map(row => [row.participant_name, row]));
    $('playerRows').innerHTML = state.participants.map((participant, index) => {
      const row = recordMap.get(participant.name) || {};
      const name = escapeHtml(participant.name);
      const shield = escapeHtml(participant.shield);
      const playerId = Number(participant.id);
      return `
        <article class="admin-player" data-player-id="${playerId}">
          <div class="admin-player-info">
            <img src="${shield}" alt="">
            <span><b>${name}</b><small>Participante ${String(index + 1).padStart(2, '0')}</small></span>
          </div>
          <div class="stat-input-wrap">
            <label for="points-${playerId}">PTS</label>
            <input class="stat-input" id="points-${playerId}" data-stat="points" type="number" inputmode="numeric" step="1" value="${Number(row.points) || 0}" aria-label="Puntos de ${name}">
          </div>
          <div class="stat-input-wrap">
            <label for="goals-${playerId}">GOL</label>
            <input class="stat-input" id="goals-${playerId}" data-stat="goals" type="number" inputmode="numeric" min="0" step="1" value="${Number(row.goals) || 0}" aria-label="Goles de ${name}">
          </div>
          <div class="stat-input-wrap">
            <label for="clean-sheets-${playerId}">CS</label>
            <input class="stat-input" id="clean-sheets-${playerId}" data-stat="clean_sheets" type="number" inputmode="numeric" min="0" step="1" value="${Number(row.clean_sheets) || 0}" aria-label="Clean sheets de ${name}">
          </div>
        </article>`;
    }).join('');
    updateTotals();
  }

  function gatherRows(published) {
    return [...document.querySelectorAll('.admin-player')].map(node => {
      const participant = state.participants.find(item => item.id === Number(node.dataset.playerId));
      const points = valueFor(node.querySelector('[data-stat="points"]'));
      const goals = valueFor(node.querySelector('[data-stat="goals"]'));
      const cleanSheets = valueFor(node.querySelector('[data-stat="clean_sheets"]'));
      if (goals < 0 || cleanSheets < 0) {
        throw new Error(`Los goles y clean sheets de ${participant.name} no pueden ser negativos.`);
      }
      return {
        season: config.season,
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
      .eq('season', config.season)
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

  async function saveMatchday(publishRequested) {
    if (state.saving) return;
    const willPublish = state.published || publishRequested;
    if (publishRequested && !state.published) {
      const accepted = window.confirm(`¿Publicar la jornada ${state.matchday}? La clasificación pública se actualizará inmediatamente.`);
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
          ? `Jornada ${state.matchday} publicada. La clasificación ya puede actualizarse.`
          : `Borrador de la jornada ${state.matchday} guardado correctamente.`
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
      $('dockSeason').textContent = config.season;
      showOnly('panelView');
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
      state.participants = league.participants.filter(participant => participant.active !== false);
      $('entryTitle').textContent = `${state.participants.length} participantes`;
      $('matchdaySelect').innerHTML = Array.from({ length: 38 }, (_, index) => {
        const matchday = index + 1;
        return `<option value="${matchday}">Jornada ${matchday}</option>`;
      }).join('');

      state.client = window.supabase.createClient(config.url, config.publishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
      bindEvents();

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
