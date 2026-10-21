// Copyright (c) 2026 Taras Koval. All rights reserved. See LICENSE.
//
// Runs on Slotted. If this tab was opened by the extension, it fetches the
// schedule (once) and hands it to Slotted's page as soon as the page is ready.
(() => {
  const params = new URLSearchParams(location.search);
  const key = params.get('key');
  if (params.get('from') !== 'draftmyschedule' || !key) return;

  let html = null;
  let pageReady = false;
  const deliver = () => {
    if (html === null || !pageReady) return;
    window.postMessage({ source: 'slotted-extension', type: 'schedule', html }, location.origin);
    html = null;
  };

  // Slotted says "ready" once it's listening.
  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.source !== 'slotted-page' || event.data.type !== 'ready') return;
    pageReady = true;
    deliver();
  });

  chrome.runtime.sendMessage({ type: 'collect', key }, found => {
    if (typeof found === 'string') { html = found; deliver(); return; }
    // Already used, or too old: tell the page so it can explain.
    const tell = () => window.postMessage({ source: 'slotted-extension', type: 'expired' }, location.origin);
    if (pageReady) tell(); else window.addEventListener('message', event => {
      if (event.source === window && event.data?.source === 'slotted-page' && event.data.type === 'ready') tell();
    });
  });
})();
