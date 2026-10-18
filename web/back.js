// The privacy and report pages, when Slotted opened them in a new tab.
//
// Slotted opens the full privacy policy in its own tab, so nobody loses the
// schedule they're working on. In that tab, a "Back to Slotted" link would
// start Slotted over from the beginning, so instead it says to close the tab.
// (Browsers don't reliably let a page close its own tab.)
// sessionStorage belongs to this one tab, so the note stays if the person
// moves between the privacy and report pages inside it.
const KEY = 'slotted-extra-tab';
let extraTab = false;
try {
  if (history.length === 1 && document.referrer.startsWith(location.origin) &&
      !/\/(report|privacy)\.html/.test(new URL(document.referrer).pathname)) {
    sessionStorage.setItem(KEY, '1');
  }
  extraTab = sessionStorage.getItem(KEY) === '1';
} catch { /* storage blocked: links stay as they are */ }

if (extraTab) {
  for (const link of document.querySelectorAll('a[href="./"]')) {
    if (link.classList.contains('brand')) continue;  // the logo can stay a link
    const note = document.createElement('span');
    note.className = link.className ? `${link.className} close-note` : 'close-note';
    note.textContent = 'Close this tab to go back to Slotted';
    link.replaceWith(note);
  }
}
