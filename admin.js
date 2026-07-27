(() => {
  'use strict';

  const VERSION = '60-20260727';
  const AUTO_SAVE_DELAY = 900;
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
    publishedRows: [],
    editingPublished: false,
    hasDraft: false,
    dirty: false,
    saving: false,
    schemaReady: true,
    achievementSchemaReady: true,
    history: [],
    previewRows: [],
    previewOpen: false,
    messageTimer: null,
    deferredInstallPrompt: null,
    autoSaveTimer: null,
    autoSaveInFlight: false,
    autoSaveQueued: false,
    autoSavePromise: null,
    autoSaveRevision: 0,
    suspendAutoSave: false,
    analyticsLoading: false,
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

  function currentMatchdayCount() {
    return isChampionsMode() ? 8 : 38;
  }

  function localDraftKey() {
    return `cuban-admin-draft:${currentSeasonKey()}:${state.matchday}`;
  }

  function isUpgradeError(error) {
    const message = String(error?.message || error || '');
    return /matchday_drafts|matchday_change_log|save_matchday_draft|publish_matchday_revision|undo_last_matchday_publication|schema cache|could not find the function|does not exist/i.test(message);
  }

  function isAnalyticsUpgradeError(error) {
    const message = String(error?.message || error || '');
    return /site_visits|get_site_analytics|track_site_visit|visitor analytics/i.test(message);
  }

  function isAchievementUpgradeError(error) {
    const message = String(error?.message || error || '');
    return /matchday_milestones|save_matchday_milestone|achievement milestone/i.test(message);
  }

  function friendlyError(error) {
    const message = String(error?.message || error || '');
    if (/invalid login credentials/i.test(message)) return 'El correo o la contraseña no son correctos.';
    if (/email not confirmed/i.test(message)) return 'Primero debes confirmar el correo en Supabase.';
    if (/failed to fetch|networkerror|load failed/i.test(message)) return 'No se pudo conectar. Comprueba tu conexión a internet e inténtalo otra vez.';
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

  function milestoneValidation({ required = true } = {}) {
    if (isChampionsMode()) return { valid: true, milestone: null, message: '' };
    const milestone = gatherMilestone();
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
    node.classList.toggle('warning', !result.valid || !state.achievementSchemaReady);
    node.classList.toggle('success', result.valid && state.achievementSchemaReady && (result.milestone?.isMonthEnd || result.milestone?.isYearEnd));

    if (!state.achievementSchemaReady) {
      node.textContent = 'Activa V59 en Supabase para guardar fechas y entregar las nuevas insignias.';
    } else if (!result.valid) {
      node.textContent = result.message;
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

  function setButtonsBusy(busy) {
    state.saving = busy;
    [
      $('saveDraftButton'),
      $('publishButton'),
      $('leagueModeButton'),
      $('championsModeButton'),
      $('editPublishedButton'),
      $('undoPublicationButton'),
      $('confirmPublishButton')
    ].filter(Boolean).forEach(button => {
      button.disabled = busy;
    });
    $('matchdaySelect').disabled = busy;
    ['matchdayDate', 'monthEndToggle', 'yearEndToggle'].forEach(id => {
      $(id).disabled = busy;
    });
    if (busy) {
      $('saveDraftButton').querySelector('span').textContent = 'Guardando…';
      $('publishButton').querySelector('span').textContent = 'Procesando…';
      $('confirmPublishButton').querySelector('span').textContent = 'Publicando…';
    }
    syncPublicationUI();
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
    const value = Number.parseInt(input.value, 10);
    return Number.isFinite(value) ? value : null;
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
  }

  function validationState() {
    const missing = [];
    const complete = [];
    document.querySelectorAll('.admin-player').forEach(node => {
      const participant = state.participants.find(item => item.id === Number(node.dataset.playerId));
      const inputs = [...node.querySelectorAll('.stat-input')];
      const rowComplete = inputs.length === 3 && inputs.every(input => inputNumberOrNull(input) !== null);
      node.classList.toggle('is-incomplete', !rowComplete);
      inputs.forEach(input => input.classList.toggle('is-missing', inputNumberOrNull(input) === null));
      if (rowComplete) complete.push(participant?.name);
      else if (participant) missing.push(participant.name);
    });
    return { missing, complete, total: state.participants.length };
  }

  function updateCompletionState() {
    const result = validationState();
    const locked = state.published && !state.editingPublished;
    const card = $('completionCard');
    const percent = result.total ? Math.round((result.complete.length / result.total) * 100) : 0;
    card.classList.toggle('warning', result.missing.length > 0 && !locked);
    card.classList.toggle('complete', result.missing.length === 0 && !locked);
    card.classList.toggle('published-locked', locked);
    $('completionProgress').style.width = `${locked ? 100 : percent}%`;
    $('editPublishedButton').hidden = !locked;

    if (locked) {
      $('completionTitle').textContent = 'Jornada publicada y protegida';
      $('completionMessage').textContent = 'La web pública no cambiará por accidente. Pulsa “Corregir jornada” para preparar una nueva versión.';
      $('missingParticipants').textContent = 'Publicación activa · edición bloqueada';
    } else if (result.missing.length) {
      $('completionTitle').textContent = `Faltan ${result.missing.length} de ${result.total} participantes`;
      $('completionMessage').textContent = 'Completa PTS, GOL y CS de todos. Cuando no haya datos, escribe 0.';
      const visible = result.missing.slice(0, 6);
      $('missingParticipants').textContent = `Pendientes: ${visible.join(', ')}${result.missing.length > visible.length ? ` y ${result.missing.length - visible.length} más` : ''}`;
    } else {
      $('completionTitle').textContent = `Los ${result.total} participantes están completos`;
      $('completionMessage').textContent = 'Todo está listo. Abre la vista previa y revisa los datos antes de publicarlos.';
      $('missingParticipants').textContent = 'Validación completa · sin participantes pendientes';
    }

    const canPreview = !locked && result.missing.length === 0 && state.schemaReady && !state.saving;
    $('publishButton').disabled = !canPreview;
    return result;
  }

  function syncInputLock() {
    const locked = state.saving || (state.published && !state.editingPublished);
    document.querySelectorAll('.stat-input').forEach(input => {
      input.disabled = locked;
    });
    ['matchdayDate', 'monthEndToggle', 'yearEndToggle'].forEach(id => {
      $(id).disabled = locked || isChampionsMode();
    });
    $('entryTitle').closest('.entry-card').classList.toggle('is-locked', locked && state.published);
    $('achievementSettings').classList.toggle('is-locked', locked && state.published);
  }

  function syncPublicationUI() {
    const locked = state.published && !state.editingPublished;
    const badge = $('publicationBadge');
    badge.classList.toggle('published', state.published);
    badge.classList.toggle('draft', !state.published || state.editingPublished);
    badge.classList.toggle('editing', state.editingPublished);
    badge.querySelector('b').textContent = state.editingPublished
      ? 'Corrección en borrador'
      : state.published
        ? 'Publicada'
        : 'Borrador';

    $('saveDraftButton').querySelector('span').textContent = state.saving
      ? 'Guardando…'
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
        ? 'Confirmar corrección'
        : 'Confirmar publicación';

    $('dockMatchday').textContent = state.matchday;
    $('dockSeason').textContent = isChampionsMode() ? 'Champions · fase de grupos' : config.season;
    $('saveDraftButton').disabled = state.saving || locked;
    syncInputLock();
    updateCompletionState();

    const activeRevision = state.history.find(item => !item.undone);
    $('undoPublicationButton').disabled = state.saving || !activeRevision || state.editingPublished || !state.schemaReady;
    setWorkflowStep(state.previewOpen ? 'review' : locked ? 'published' : 'draft');

    if (locked && !state.saving) {
      markDirty(false, 'Publicación protegida');
    }
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
    return `
      <article class="admin-player${champions ? ' champions-admin-player' : ''}" data-player-id="${playerId}">
        <div class="admin-player-info">
          <img src="${shield}" alt="">
          <span><b>${name}</b><small>${escapeHtml(subtitle)}</small></span>
        </div>
        <div class="stat-input-wrap">
          <label for="${inputPrefix}-points-${playerId}">PTS</label>
          <input class="stat-input" id="${inputPrefix}-points-${playerId}" data-stat="points" type="number" inputmode="numeric" step="1" value="${fieldValue(row, 'points')}" placeholder="—" aria-label="Puntos de ${name}">
        </div>
        <div class="stat-input-wrap">
          <label for="${inputPrefix}-goals-${playerId}">GOL</label>
          <input class="stat-input" id="${inputPrefix}-goals-${playerId}" data-stat="goals" type="number" inputmode="numeric" min="0" step="1" value="${fieldValue(row, 'goals')}" placeholder="—" aria-label="Goles de ${name}">
        </div>
        <div class="stat-input-wrap">
          <label for="${inputPrefix}-clean-sheets-${playerId}">CS</label>
          <input class="stat-input" id="${inputPrefix}-clean-sheets-${playerId}" data-stat="clean_sheets" type="number" inputmode="numeric" min="0" step="1" value="${fieldValue(row, 'clean_sheets')}" placeholder="—" aria-label="Clean sheets de ${name}">
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
    syncPublicationUI();
  }

  function gatherRows(published, allowIncomplete = false) {
    return [...document.querySelectorAll('.admin-player')].map(node => {
      const participant = state.participants.find(item => item.id === Number(node.dataset.playerId));
      const points = inputNumberOrNull(node.querySelector('[data-stat="points"]'));
      const goals = inputNumberOrNull(node.querySelector('[data-stat="goals"]'));
      const cleanSheets = inputNumberOrNull(node.querySelector('[data-stat="clean_sheets"]'));
      if (!participant) throw new Error('No se pudo identificar uno de los participantes.');
      if (!allowIncomplete && (points === null || goals === null || cleanSheets === null)) {
        throw new Error(`Faltan datos de ${participant.name}.`);
      }
      if ((goals !== null && goals < 0) || (cleanSheets !== null && cleanSheets < 0)) {
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

  function saveLocalDraft(rows) {
    try {
      localStorage.setItem(localDraftKey(), JSON.stringify({
        savedAt: new Date().toISOString(),
        rows,
        milestone: isChampionsMode() ? null : gatherMilestone()
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
      const expected = new Set(state.participants.map(participant => participant.name));
      const rows = parsed.rows.filter(row => expected.has(row.participant_name));
      return rows.length ? { rows, savedAt: parsed.savedAt, milestone: parsed.milestone || null } : null;
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

  function scheduleAutoSave() {
    if (state.suspendAutoSave || (state.published && !state.editingPublished)) return;
    const rows = gatherRows(false, true);
    saveLocalDraft(rows);
    state.hasDraft = true;
    state.autoSaveRevision += 1;
    markDirty(true);
    clearTimeout(state.autoSaveTimer);
    state.autoSaveTimer = setTimeout(() => persistDraft({ manual: false }), AUTO_SAVE_DELAY);
    syncPublicationUI();
  }

  async function persistMatchdayMilestone({ required = false } = {}) {
    if (isChampionsMode()) return true;
    const validation = milestoneValidation({ required });
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

    const { error } = await state.client.rpc('save_matchday_milestone', {
      p_season: currentSeasonKey(),
      p_matchday: state.matchday,
      p_matchday_date: validation.milestone.matchdayDate,
      p_is_month_end: validation.milestone.isMonthEnd,
      p_is_year_end: validation.milestone.isYearEnd
    });
    if (error) {
      if (isAchievementUpgradeError(error)) state.achievementSchemaReady = false;
      updateAchievementSettingsMessage();
      if (required) throw error;
      return false;
    }

    state.milestone = validation.milestone;
    updateAchievementSettingsMessage();
    return true;
  }

  async function persistDraft({ manual = false } = {}) {
    if (state.published && !state.editingPublished) return false;
    if (state.autoSaveInFlight) {
      state.autoSaveQueued = true;
      return state.autoSavePromise || false;
    }

    clearTimeout(state.autoSaveTimer);
    const revision = state.autoSaveRevision;
    const rows = gatherRows(false, true);
    saveLocalDraft(rows);
    state.hasDraft = true;

    if (!state.schemaReady) {
      markDirty(false, 'Borrador guardado en este dispositivo');
      $('savedAt').textContent = formatDate(new Date(), 'Guardado localmente ');
      if (manual) flashMessage('Borrador guardado en este dispositivo. Activa la actualización V57 de Supabase para sincronizarlo.', 'error');
      return true;
    }

    state.autoSaveInFlight = true;
    if (manual) setButtonsBusy(true);
    const run = async () => {
      try {
        const { error } = await state.client.rpc('save_matchday_draft', {
          p_season: currentSeasonKey(),
          p_matchday: state.matchday,
          p_rows: rows
        });
        if (error) throw error;
        // En una corrección, la fecha nueva permanece en el borrador local
        // hasta confirmar la publicación para no alterar premios públicos antes de tiempo.
        if (!state.published) await persistMatchdayMilestone({ required: false });
        $('savedAt').textContent = formatDate(new Date(), 'Guardada ');
        if (revision === state.autoSaveRevision) {
          markDirty(false, 'Borrador guardado automáticamente');
        } else {
          state.autoSaveQueued = true;
        }
        if (manual) flashMessage(`Borrador de la jornada ${state.matchday} guardado correctamente.`);
        return true;
      } catch (error) {
        if (isUpgradeError(error)) state.schemaReady = false;
        markDirty(false, 'Borrador guardado en este dispositivo');
        $('savedAt').textContent = formatDate(new Date(), 'Guardado localmente ');
        if (manual || isUpgradeError(error)) flashMessage(friendlyError(error), 'error');
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

  async function flushAutoSave() {
    clearTimeout(state.autoSaveTimer);
    if (state.autoSavePromise) await state.autoSavePromise;
    if (state.dirty && !state.suspendAutoSave) await persistDraft({ manual: false });
    if (state.autoSavePromise) await state.autoSavePromise;
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
      if (!a || !b || ['points', 'goals', 'clean_sheets', 'published'].some(key => a[key] !== b[key])) count += 1;
    });
    return count;
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
      const title = correction ? 'Corrección publicada' : 'Publicación inicial';
      const badge = undone ? 'Deshecha' : correction ? 'Corrección' : 'Publicada';
      const detail = correction
        ? `${changes} participante${changes === 1 ? '' : 's'} modificado${changes === 1 ? '' : 's'}`
        : `${Array.isArray(record.after_snapshot) ? record.after_snapshot.length : changes} participantes publicados`;
      return `<article class="revision-item${correction ? ' correction' : ''}${undone ? ' undone' : ''}">
        <span class="revision-number">V${state.history.length - index}</span>
        <span class="revision-copy"><b>${title}</b><small>${detail} · ${formatDate(record.created_at)}${record.changed_by_email ? ` · ${escapeHtml(record.changed_by_email)}` : ''}</small></span>
        <span class="revision-badge">${badge}</span>
      </article>`;
    }).join('');
    syncPublicationUI();
  }

  async function loadMatchday() {
    if (!state.client) return;
    clearTimeout(state.autoSaveTimer);
    state.autoSaveQueued = false;
    state.previewOpen = false;
    closePreview(false);
    $('playerRows').innerHTML = '<div class="state-card"><span class="loader" aria-hidden="true"></span><div><b>Cargando jornada</b><small>Un momento…</small></div></div>';

    const season = currentSeasonKey();
    const statsResult = await state.client
      .from('matchday_stats')
      .select('participant_name,points,goals,clean_sheets,published,updated_at')
      .eq('season', season)
      .eq('matchday', state.matchday);

    if (statsResult.error) {
      renderPlayerRows();
      flashMessage(friendlyError(statsResult.error), 'error');
      return;
    }

    const [draftResult, historyResult, milestoneResult] = await Promise.all([
      state.client
        .from('matchday_drafts')
        .select('participant_name,points,goals,clean_sheets,updated_at')
        .eq('season', season)
        .eq('matchday', state.matchday),
      state.client
        .from('matchday_change_log')
        .select('id,action,before_snapshot,after_snapshot,changed_by_email,created_at,undone,undone_at')
        .eq('season', season)
        .eq('matchday', state.matchday)
        .order('created_at', { ascending: false })
        .limit(20),
      isChampionsMode()
        ? Promise.resolve({ data: [], error: null })
        : state.client
          .from('matchday_milestones')
          .select('matchday_date,is_month_end,is_year_end,updated_at')
          .eq('season', season)
          .eq('matchday', state.matchday)
          .limit(1)
    ]);

    state.schemaReady = !draftResult.error && !historyResult.error;
    state.achievementSchemaReady = isChampionsMode() || !milestoneResult.error;
    if (!state.schemaReady && (isUpgradeError(draftResult.error) || isUpgradeError(historyResult.error))) {
      flashMessage(friendlyError(draftResult.error || historyResult.error), 'error');
    }

    const allStats = Array.isArray(statsResult.data) ? statsResult.data : [];
    const publishedRows = allStats.filter(row => row.published === true);
    const legacyDraftRows = allStats.filter(row => row.published !== true);
    const cloudDraftRows = !draftResult.error && Array.isArray(draftResult.data) ? draftResult.data : [];
    const localDraft = readLocalDraft();
    const cloudMilestone = !milestoneResult.error && Array.isArray(milestoneResult.data)
      ? milestoneResult.data[0] || null
      : null;
    const draftRows = localDraft?.rows?.length
      ? localDraft.rows
      : cloudDraftRows.length
        ? cloudDraftRows
        : legacyDraftRows;

    state.publishedRows = publishedRows;
    state.published = publishedRows.length > 0;
    state.hasDraft = draftRows.length > 0;
    state.editingPublished = state.published && state.hasDraft;
    const rowsToRender = draftRows.length ? draftRows : publishedRows;
    setMilestoneForm(localDraft?.milestone || cloudMilestone || {});

    $('savedAt').textContent = localDraft?.savedAt
      ? formatDate(localDraft.savedAt, 'Guardada ')
      : formatSavedAt(draftRows.length ? draftRows : publishedRows);
    renderPlayerRows(rowsToRender);
    renderHistory(!historyResult.error && Array.isArray(historyResult.data) ? historyResult.data : []);
    markDirty(false, state.hasDraft ? 'Borrador recuperado y protegido' : state.published ? 'Publicación protegida' : 'Lista para comenzar');
    syncPublicationUI();
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
    $('panelTitle').textContent = champions ? 'Administrar Champions' : 'Administrar jornadas';
    $('panelDescription').textContent = champions
      ? 'Registra cada fecha con guardado automático, revisión previa y un historial seguro de correcciones.'
      : 'Prepara, revisa y publica cada jornada sin riesgo de perder datos ni modificar la web por accidente.';
    $('entryTitle').textContent = champions
      ? `${state.participants.length} competidores · 4 grupos`
      : `${state.participants.length} participantes`;
    $('matchdaySelect').innerHTML = Array.from({ length: matchdayCount }, (_, index) => {
      const matchday = index + 1;
      return `<option value="${matchday}">Jornada ${matchday}</option>`;
    }).join('');
    $('matchdaySelect').value = String(state.matchday);
    $('savedAt').textContent = 'Todavía no guardada';
    if (!champions && !$('matchdayDate').value) setMilestoneForm({});
    else updateAchievementSettingsMessage();
    syncPublicationUI();
  }

  async function prepareNavigation() {
    if (!state.dirty) return;
    await flushAutoSave();
  }

  async function switchCompetition(competition) {
    if (competition === state.competition || state.saving) return;
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
    if (!state.published || state.saving) return;
    state.editingPublished = true;
    state.hasDraft = true;
    state.autoSaveRevision += 1;
    saveLocalDraft(gatherRows(false, true));
    syncPublicationUI();
    scheduleAutoSave();
    flashMessage('Modo corrección activado. La web pública seguirá mostrando la versión anterior hasta que confirmes la nueva.');
    requestAnimationFrame(() => document.querySelector('.stat-input')?.focus());
  }

  function openPreview() {
    const validation = updateCompletionState();
    if (validation.missing.length) {
      flashMessage(`Faltan ${validation.missing.length} participantes. Completa todos los campos antes de revisar.`, 'error');
      $('completionCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (!state.schemaReady) {
      flashMessage('Primero activa la actualización V57 de Supabase para publicar con historial y deshacer.', 'error');
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
    $('previewSubtitle').textContent = `Jornada ${state.matchday} · ${currentCompetitionLabel()} · ${rows.length} participantes${matchdayDateLabel ? ` · ${matchdayDateLabel}` : ''}${prizeLabel}`;
    $('previewSummary').innerHTML = `
      <article><small>Participantes</small><b>${rows.length}</b></article>
      <article><small>Puntos</small><b>${total('points').toLocaleString()}</b></article>
      <article><small>Goles</small><b>${total('goals').toLocaleString()}</b></article>
      <article><small>Clean sheets</small><b>${total('clean_sheets').toLocaleString()}</b></article>`;
    $('previewRows').innerHTML = state.previewRows.map((row, index) => {
      const participant = state.participantIndex.get(row.participant_name);
      return `<div class="preview-row">
        <span>${index + 1}</span>
        <span class="preview-player"><img src="${escapeHtml(participant?.shield || '')}" alt=""><b>${escapeHtml(row.participant_name)}</b></span>
        <span>${row.points}</span><span>${row.goals}</span><span>${row.clean_sheets}</span>
      </div>`;
    }).join('');
    $('confirmPublishButton').querySelector('span').textContent = state.published ? 'Confirmar corrección' : 'Confirmar publicación';
    $('previewModal').hidden = false;
    document.body.classList.add('preview-open');
    state.previewOpen = true;
    syncPublicationUI();
    requestAnimationFrame(() => $('closePreview').focus());
  }

  function closePreview(returnFocus = true) {
    if (!$('previewModal')) return;
    $('previewModal').hidden = true;
    document.body.classList.remove('preview-open');
    state.previewOpen = false;
    syncPublicationUI();
    if (returnFocus) $('publishButton').focus();
  }

  async function publishPreview() {
    if (state.saving || !state.previewRows.length) return;
    state.suspendAutoSave = true;
    state.autoSaveQueued = false;
    clearTimeout(state.autoSaveTimer);
    if (state.autoSavePromise) await state.autoSavePromise;

    try {
      setButtonsBusy(true);
      const wasCorrection = state.published;
      await persistMatchdayMilestone({ required: !isChampionsMode() });
      const { data, error } = await state.client.rpc('publish_matchday_revision', {
        p_season: currentSeasonKey(),
        p_matchday: state.matchday,
        p_rows: state.previewRows
      });
      if (error) throw error;
      clearLocalDraft();
      state.hasDraft = false;
      state.dirty = false;
      state.editingPublished = false;
      state.published = Array.isArray(data) ? data.length > 0 : true;
      closePreview(false);
      await loadMatchday();
      flashMessage(
        wasCorrection
          ? `Corrección de la jornada ${state.matchday} publicada. La versión anterior quedó guardada en el historial.`
          : `Jornada ${state.matchday} publicada correctamente. Ya está visible en la web.`
      );
    } catch (error) {
      if (isUpgradeError(error)) state.schemaReady = false;
      flashMessage(friendlyError(error), 'error');
    } finally {
      state.suspendAutoSave = false;
      setButtonsBusy(false);
    }
  }

  async function undoLastPublication() {
    const latest = state.history.find(item => !item.undone);
    if (!latest || state.saving) return;
    const accepted = window.confirm(
      `¿Deshacer la última publicación de la jornada ${state.matchday}? ` +
      'La tabla pública volverá inmediatamente a la versión anterior.'
    );
    if (!accepted) return;

    try {
      state.suspendAutoSave = true;
      setButtonsBusy(true);
      const { data, error } = await state.client.rpc('undo_last_matchday_publication', {
        p_season: currentSeasonKey(),
        p_matchday: state.matchday
      });
      if (error) throw error;
      clearLocalDraft();
      state.hasDraft = false;
      state.dirty = false;
      state.editingPublished = false;
      await loadMatchday();
      flashMessage(
        Array.isArray(data) && data.length
          ? `Última modificación deshecha. La jornada ${state.matchday} volvió a su versión anterior.`
          : `Publicación deshecha. La jornada ${state.matchday} dejó de estar visible en la web.`
      );
    } catch (error) {
      if (isUpgradeError(error)) state.schemaReady = false;
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
      loadVisitorAnalytics();
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
    await prepareNavigation();
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
    $('refreshAnalyticsButton').addEventListener('click', () => loadVisitorAnalytics({ manual: true }));
    $('leagueModeButton').addEventListener('click', () => switchCompetition('league'));
    $('championsModeButton').addEventListener('click', () => switchCompetition('champions'));
    $('saveDraftButton').addEventListener('click', () => persistDraft({ manual: true }));
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

    $('playerRows').addEventListener('input', event => {
      if (!event.target.matches('.stat-input')) return;
      if (event.target.dataset.stat !== 'points' && valueFor(event.target) < 0) event.target.value = 0;
      updateTotals();
      updateCompletionState();
      scheduleAutoSave();
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !$('previewModal').hidden) closePreview();
      else if (event.key === 'Escape' && !$('adminInstallModal').hidden) closeInstallGuide();
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
