// "Back to Slotted" on the privacy and report pages.
//
// Slotted opens these pages in a new tab, so nobody loses the schedule they're
// working on. If that's how this tab was opened, going "back" closes it, and
// the person lands on their original Slotted tab exactly as they left it.
// Otherwise (a bookmark, a shared link, a refresh) the links work normally.
const openedFromSlotted =
  history.length === 1 &&
  document.referrer.startsWith(location.origin) &&
  !/\/(report|privacy)\.html/.test(new URL(document.referrer).pathname);

if (openedFromSlotted) {
  for (const link of document.querySelectorAll('a[href="./"]')) {
    link.addEventListener('click', event => {
      event.preventDefault();
      window.close();
      // If the browser didn't allow closing the tab, go back the normal way.
      setTimeout(() => { location.href = link.href; }, 250);
    });
  }
}
