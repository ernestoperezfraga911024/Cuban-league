/* File transport only. Sporting validation stays in the existing admin readers. */
(() => {
  'use strict';
  async function readFile(file) {
    if (!file || file.size > 2 * 1024 * 1024 || file.size === 0) throw new Error('Selecciona una captura JSON de hasta 2 MB.');
    let payload;
    try { payload = JSON.parse(await file.text()); }
    catch { throw new Error('El archivo no es una captura JSON válida. Vuelve a guardarlo desde Mister.'); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Captura inválida.');
    return payload;
  }
  window.CubanMobileImport = {readFile};
  const copy = document.getElementById('copyMobileBookmark');
  if (!copy) return;
  const code = document.getElementById('mobileBookmarkCode'), status = document.getElementById('mobileBookmarkStatus');
  fetch('./mister-mobile-bookmarklet.txt', {cache:'no-store'}).then(response => {
    if (!response.ok) throw new Error('No se pudo cargar el ayudante. Recarga esta página con conexión.');
    return response.text();
  }).then(value => {
    if (!value.startsWith('javascript:')) throw new Error('El ayudante no es válido.');
    code.value = value; copy.disabled = false;
  }).catch(error => { status.textContent = error.message; });
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(code.value); status.textContent = 'Copiado. Pégalo como dirección del marcador, incluyendo javascript:.'; }
    catch { code.focus(); code.select(); code.setSelectionRange(0,code.value.length); status.textContent = 'Mantén pulsado el código seleccionado y elige Copiar.'; }
  };
})();
