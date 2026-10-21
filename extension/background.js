// Copyright (c) 2026 Taras Koval. All rights reserved. See LICENSE.
//
// The middle step: DraftMySchedule's page hands its HTML here, this opens
// Slotted in a new tab, and Slotted's tab picks the HTML up once.
//
// The schedule only ever moves between tabs in this browser. It is kept in
// the browser's short-term extension storage (cleared when the browser
// closes), deleted as soon as Slotted takes it, and never sent to a server.

const SLOTTED = 'https://slotted.taraskoval.ca/';
const MAX_AGE = 5 * 60 * 1000;  // an unclaimed schedule is thrown away after 5 minutes

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type === 'send' && typeof message.html === 'string') {
    send(message.html, sender.tab).then(reply, () => reply({ ok: false }));
    return true;  // reply comes later
  }
  if (message?.type === 'collect' && typeof message.key === 'string') {
    collect(message.key).then(reply, () => reply(null));
    return true;
  }
  return false;
});

async function send(html, fromTab) {
  await forgetOld();
  // A random key in the link, so only the tab opened for it can claim it.
  const key = crypto.randomUUID();
  await chrome.storage.session.set({ [key]: { html, at: Date.now() } });
  await chrome.tabs.create({ url: `${SLOTTED}?from=draftmyschedule&key=${key}`, index: (fromTab?.index ?? 0) + 1 });
  return { ok: true };
}

async function collect(key) {
  const { [key]: item } = await chrome.storage.session.get(key);
  await chrome.storage.session.remove(key);
  return item && Date.now() - item.at < MAX_AGE ? item.html : null;
}

async function forgetOld() {
  const all = await chrome.storage.session.get(null);
  const old = Object.keys(all).filter(key => !(Date.now() - all[key]?.at < MAX_AGE));
  if (old.length) await chrome.storage.session.remove(old);
}

// Clicking the toolbar icon: on the schedule page, send it. Anywhere else,
// open DraftMySchedule.
chrome.action.onClicked.addListener(async tab => {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'icon-clicked' });
  } catch {
    // Not a DraftMySchedule tab (this extension isn't running there).
    chrome.tabs.create({ url: 'https://draftmyschedule.uwo.ca/', index: tab.index + 1 });
  }
});
