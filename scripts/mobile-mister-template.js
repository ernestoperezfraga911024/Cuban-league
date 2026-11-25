void (() => {
  'use strict';
  if (location.hostname !== 'mister.mundodeportivo.com') return alert('Abre la clasificación de tu liga en Mister y ejecuta este marcador allí.');
  if (window.__cubanMobileReading) return alert('Ya hay una lectura en curso. Mantén Mister abierto.');
  const selected = document.querySelector('a.active[href*="action/change?id_community="]');
  const leagueId = selected && new URL(selected.href).searchParams.get('id_community');
  if (!['649733', '978196'].includes(leagueId)) return alert('Selecciona Primera o Segunda de Cuban League en Mister.');
  const second = leagueId === '978196';
  const rawDay = prompt(second ? 'Jornada de Segunda (1–38), o 0 para General:' : 'Jornada de Primera (1–38):', '');
  if (rawDay === null) return;
  const matchday = Number(rawDay);
  if (!/^\d{1,2}$/.test(rawDay.trim()) || matchday < (second ? 0 : 1) || matchday > 38) return alert('Jornada inválida.');
  const date = new Date(), year = date.getFullYear() - (date.getMonth() < 6 ? 1 : 0);
  const season = prompt('Temporada (igual que en administración):', year + '/' + String(year + 1).slice(-2));
  if (season === null) return;
  if (!/^20\d{2}\/\d{2}$/.test(season)) return alert('Temporada inválida.');
  let excludedManagerId = '';
  if (second && matchday) {
    const links = [...document.querySelectorAll('a.btn.btn-sw-link.user[href^="users/"]')];
    const adminName = prompt('Nombre exacto de tu cuenta de administrador en Segunda (la que no compite):', 'Ernesto');
    if (adminName === null) return;
    const candidates = links.filter(link => link.querySelector('.info .name')?.textContent.trim() === adminName.trim());
    if (candidates.length !== 1) return alert('No se identificó una cuenta única de administrador. Abre la clasificación completa y comprueba el nombre.');
    excludedManagerId = candidates[0].getAttribute('href').match(/^users\/(\d+)/)?.[1];
    if (!excludedManagerId) return alert('No se pudo identificar tu cuenta.');
  }
  // Lexical scope: never replace Mister's globals or a real extension runtime.
  const globalThis = {}, module = undefined;
  /* BUNDLE_CORE */
  /* BUNDLE_SECOND_CORE */
  const job = {id:crypto.randomUUID(),matchday,season,excludedManagerId,readOfficialXi:true};
  let listener;
  window.__cubanMobileReading = true;
  document.getElementById('cuban-mobile-result')?.remove();
  function complete(payload) {
    window.__cubanMobileReading = false;
    const box = document.createElement('section');
    box.id = 'cuban-mobile-result'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Captura de Cuban League');
    Object.assign(box.style, {position:'fixed',zIndex:'2147483647',inset:'10px',maxHeight:'90vh',overflow:'auto',padding:'20px',background:'#071b33',color:'white',borderRadius:'16px',font:'16px/1.5 system-ui'});
    const title = document.createElement('h2'); title.textContent = 'Captura lista · ' + (second ? 'Segunda' : 'Primera') + ' · ' + (matchday ? 'J' + matchday : 'General');
    const help = document.createElement('p'); help.textContent = 'Guarda el archivo y vuelve a administración → Cargar captura del celular. Todavía no se ha guardado ni publicado la jornada.';
    const data = JSON.stringify(payload), filename = 'cuban-' + (second ? 'segunda' : 'primera') + '-j' + matchday + '.json';
    const file = new File([data], filename, {type:'application/json'});
    const url = URL.createObjectURL(file);
    const download = document.createElement('a'); download.textContent = 'Guardar archivo de captura'; download.href = url; download.download = filename;
    Object.assign(download.style, {display:'block',padding:'16px',background:'#23c781',color:'#071b33',borderRadius:'10px',marginBottom:'12px'});
    box.append(title, help, download);
    if (navigator.canShare?.({files:[file]})) {
      const share = document.createElement('button'); share.textContent = 'Compartir / Guardar en Archivos';
      share.style.cssText = 'padding:16px;font:inherit;display:block;margin:12px 0';
      share.onclick = async () => { try { await navigator.share({files:[file]}); } catch (error) { if (error.name !== 'AbortError') help.textContent = 'Usa Guardar archivo de captura.'; } };
      box.append(share);
    }
    const close = document.createElement('button'); close.textContent = 'Cerrar'; close.style.cssText = 'padding:16px;font:inherit';
    close.onclick = () => { URL.revokeObjectURL(url); box.remove(); };
    box.append(close); document.documentElement.append(box);
  }
  const chrome = {runtime:{id:'cuban-mobile-local',onMessage:{addListener(fn){listener = fn;}},sendMessage:async ({type,input}) => {
    if (type === 'MISTER_READY') return {ok:true,job:second ? null : job};
    if (type === 'SECOND_READY') return {ok:true,job:second ? job : null};
    if (input.id !== job.id) return {ok:false,error:'La captura no corresponde a esta lectura.'};
    if (type === 'DISCOVERED') {
      if (input.discovery.league.id !== leagueId) return {ok:false,error:'Cambió la liga activa.'};
      job.discovery = input.discovery;
      setTimeout(() => listener({type:'RUN',job},{id:'cuban-mobile-local'},()=>{}),0);
    }
    if (type === 'RESULT' || type === 'SECOND_RESULT') complete(input.payload);
    if (type === 'FAIL' || type === 'SECOND_FAIL') window.__cubanMobileReading = false;
    return {ok:true};
  }}};
  try {
    if (second) { /* BUNDLE_SECOND */ }
    else { /* BUNDLE_FIRST */ }
  } catch (error) { window.__cubanMobileReading = false; alert(error.message); }
})();
