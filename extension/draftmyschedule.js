// Copyright (c) 2026 Taras Koval. All rights reserved. See LICENSE.
//
// Runs on DraftMySchedule. On the page that lists your classes (the one
// Slotted's guide tells you to save), it adds one button: "Send to Slotted".
// Clicking it opens Slotted with this page already read in. Nothing to save.
//
// Thanks to eq's ClassMySchedule (public domain) for showing that an
// extension can read the schedule straight from the open page.
(() => {
  if (window.top !== window) return;

  const clean = text => text.replace(/\s+/g, ' ').trim();
  // The class list: the table with a "Days/Times/Location" column. The same
  // check Slotted itself uses to read a saved page.
  const hasClassList = () => [...document.querySelectorAll('table')].some(table =>
    table.rows[0] && [...table.rows[0].cells].some(cell => !cell.querySelector('table') && clean(cell.textContent).includes('Days/Times/Location')));

  const ICON = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="5" width="26" height="24" rx="6" fill="#FF6B4A"/><rect x="8" y="12" width="7" height="5" rx="1.5" fill="#fff"/><rect x="17" y="12" width="7" height="5" rx="1.5" fill="#fff" opacity=".6"/><rect x="8" y="20" width="7" height="5" rx="1.5" fill="#fff" opacity=".6"/></svg>';
  const STYLE = `
    :host { all: initial; }
    .card {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
      display: flex; align-items: center; gap: 12px; padding: 12px 12px 12px 14px; max-width: calc(100vw - 40px);
      background: #fffaf0; color: #2a2420; border: 1.5px solid #e4d8c3; border-radius: 14px;
      box-shadow: 0 1px 1px rgb(60 40 20 / 7%), 0 12px 32px rgb(60 40 20 / 18%);
      font: 14px/1.35 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      animation: in .35s cubic-bezier(.2,.7,.2,1) both;
    }
    @keyframes in { from { opacity: 0; transform: translateY(12px); } }
    @media (prefers-reduced-motion: reduce) { .card { animation: none; } }
    svg { width: 30px; height: 30px; flex: none; }
    .text { display: grid; gap: 1px; min-width: 0; }
    b { font-weight: 650; }
    small { color: #74685c; font-size: 12.5px; }
    button.send {
      flex: none; border: 0; border-radius: 10px; padding: 10px 16px; cursor: pointer;
      background: #2a2420; color: #fffaf0; font: 600 14px/1 inherit; font-family: inherit;
    }
    button.send:hover { background: #c9562e; }
    button.send:disabled { opacity: .7; cursor: default; }
    button:focus-visible { outline: 3px solid #c9562e; outline-offset: 2px; }
    button.hide {
      position: absolute; top: -9px; right: -9px; width: 22px; height: 22px; border-radius: 50%; padding: 0;
      border: 1.5px solid #e4d8c3; background: #fffaf0; color: #74685c; font: 14px/1 inherit; cursor: pointer;
    }
    @media (prefers-color-scheme: dark) {
      .card { background: #1f2723; color: #e9ece8; border-color: #35423b; }
      small { color: #a8b6ae; }
      button.send { background: #e9ece8; color: #1f2723; }
      button.send:hover { background: #f08a68; }
      button.hide { background: #1f2723; border-color: #35423b; color: #a8b6ae; }
    }`;

  let host = null;
  let sendButton = null;
  let note = null;

  function addCard() {
    if (host || !hasClassList()) return;
    host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${STYLE}</style>
      <div class="card" role="region" aria-label="Slotted">
        ${ICON}
        <div class="text"><b>Put these classes in your calendar</b><small>Opens Slotted with this schedule. Nothing to save.</small></div>
        <button class="send" type="button">Send to Slotted</button>
        <button class="hide" type="button" aria-label="Hide">×</button>
      </div>`;
    sendButton = root.querySelector('.send');
    note = root.querySelector('small');
    sendButton.addEventListener('click', send);
    root.querySelector('.hide').addEventListener('click', () => { host.remove(); });
    document.documentElement.append(host);
  }

  async function send() {
    if (!hasClassList()) return;
    if (sendButton) { sendButton.disabled = true; sendButton.textContent = 'Opening Slotted…'; }
    // The page as it is right now, without this button in it.
    const attached = host?.isConnected;
    if (attached) host.remove();
    const html = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
    if (attached) document.documentElement.append(host);
    try {
      const result = await chrome.runtime.sendMessage({ type: 'send', html });
      if (!result?.ok) throw new Error('not sent');
      if (note) note.textContent = 'Sent. Slotted opened in a new tab.';
    } catch {
      if (note) note.textContent = "Couldn't open Slotted. Reload this page and try again.";
    }
    if (sendButton) { sendButton.disabled = false; sendButton.textContent = 'Send again'; }
  }

  // A small message for the toolbar icon on pages without a class list.
  function hint() {
    const tip = document.createElement('div');
    const root = tip.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${STYLE}</style><div class="card" role="status">${ICON}
      <div class="text"><b>Open your class list first</b><small>Go to <b>My Current Schedule</b>, then click the Slotted icon again.</small></div></div>`;
    document.documentElement.append(tip);
    setTimeout(() => tip.remove(), 6000);
  }

  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type !== 'icon-clicked') return false;
    if (hasClassList()) send(); else hint();
    reply(true);
    return false;
  });

  // The class list can appear after the page loads, so keep checking until it does.
  addCard();
  if (!host) {
    const watcher = new MutationObserver(() => { addCard(); if (host) watcher.disconnect(); });
    watcher.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
