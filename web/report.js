// report.html: the standalone "Report a problem" page, for anyone who opens
// the link directly. (Inside Slotted, the same form opens as a dialog.)
import { mountReportForm } from './report-form.js?v=20261018';

const step = new URLSearchParams(location.search).get('step') ?? '';
mountReportForm(document.querySelector('#report-root'), {
  step,
  // In a tab Slotted opened (see back.js), going "back" would start Slotted over.
  doneHtml: (() => { try { return sessionStorage.getItem('slotted-extra-tab') === '1'; } catch { return false; } })()
    ? '<p class="close-note">You can close this tab to go back to Slotted.</p>'
    : '<p><a href="./">← Back to Slotted</a></p>',
});
