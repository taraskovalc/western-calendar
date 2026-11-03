// report.html: the standalone "Report a problem" page, for anyone who opens
// the link directly. (Inside Slotted, the same form opens as a dialog.)
import { mountReportForm, h } from './report-form.js?v=20261109';

const step = new URLSearchParams(location.search).get('step') ?? '';
mountReportForm(document.querySelector('#report-root'), {
  step,
  // In a tab Slotted opened (see back.js), going "back" would start Slotted over.
  done: (() => { try { return sessionStorage.getItem('slotted-extra-tab') === '1'; } catch { return false; } })()
    ? h('p', { className: 'close-note' }, 'You can close this tab to go back to Slotted.')
    : h('p', {}, h('a', { href: './' }, '← Back to Slotted')),
});
