(() => {
  'use strict';
  const allowed = new Set(['HELLO', 'START', 'STATUS', 'CAPTURE', 'CANCEL', 'CONSUME']);
  window.addEventListener('message', async event => {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin || data?.channel !== 'cuban-mister-panel-v1'
      || !allowed.has(data.type) || typeof data.id !== 'string' || data.id.length > 80) return;
    try {
      const result = await chrome.runtime.sendMessage({ type: data.type, input: data.input });
      // Keep the request ID separate from the capture ID returned by START.
      window.postMessage({ channel: 'cuban-mister-extension-v1', id: data.id, result }, location.origin);
    } catch {
      window.postMessage({ channel: 'cuban-mister-extension-v1', id: data.id, result: { ok: false,
        error: 'La extensión se actualizó o dejó de responder. Recarga el panel.' } }, location.origin);
    }
  });
})();
