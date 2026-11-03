// The "Report a problem" form. Used in two places:
//   - inside Slotted, as a dialog (so nobody leaves the page or loses progress)
//   - on report.html, for anyone who opens the link directly
//
// It sends the form to the Slotted API, which emails it to Slotted's inbox.
// The saved schedule file never leaves the browser: Slotted reads it here (the
// same way the main page does) and sends only what it found, as plain text.
import { api, ApiUnavailable } from './api.js';
import { readSchedule, findClassTable, clean, parseHtml, MAX_FILE_BYTES } from './parser.js?v=20261109';

const MAX_TABLE_TEXT = 12000;

const STEPS = [
  ['sign-in', 'Signing in'],
  ['calendar-app', 'Choosing a calendar app'],
  ['schedule', 'Adding the schedule file'],
  ['add-to-calendar', 'Adding classes to a calendar'],
  ['calendar-link', 'The calendar link'],
  ['other', 'Something else'],
];

// Builds an element without HTML text (the site's CSP forbids innerHTML).
// Keys that are element properties (className, checked…) are set as properties,
// the rest (aria-*) as attributes. Strings among the children become plain text.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key in el) el[key] = value; else el.setAttribute(key, value);
  }
  el.append(...children);
  return el;
}

/* ---------- Device: added automatically, shown in the note under Send ---------- */
function describeDevice() {
  const ua = navigator.userAgent;
  const version = re => (re.exec(ua)?.[1] ?? '').split('.').slice(0, 2).join('.');
  const browser = /Edg\//.test(ua) ? `Edge ${version(/Edg\/([\d.]+)/)}`
    : /Firefox\/|FxiOS\//.test(ua) ? `Firefox ${version(/(?:Firefox|FxiOS)\/([\d.]+)/)}`
    : /Chrome\/|CriOS\//.test(ua) ? `Chrome ${version(/(?:Chrome|CriOS)\/([\d.]+)/)}`
    : /Safari\//.test(ua) ? `Safari ${version(/Version\/([\d.]+)/)}` : 'Unknown browser';
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Mac OS X|Macintosh/.test(ua) ? (navigator.maxTouchPoints > 1 ? 'iPad' : 'Mac')
    : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : 'unknown device';
  return { short: `${browser.split(' ')[0]} on ${device}`, full: `${browser.trim()} on ${device}, window ${innerWidth}×${innerHeight}` };
}

/* ---------- Schedule file helpers ---------- */
const fmt = t => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${(h % 12) || 12}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
};

// The text of the class list table, one row per line, cells separated by " | ".
// Only the table: not the rest of the page.
function classTableText(html) {
  const table = findClassTable(parseHtml(html));
  if (!table) return '';
  // table.rows only holds this table's own rows; a cell's inner table (a class
  // that meets more than once) is joined into that one cell with " / ".
  return [...table.rows]
    .map(row => [...row.cells].map(cell => {
      const inner = cell.querySelector('table');
      return inner ? [...inner.rows].map(r => [...r.cells].map(c => clean(c.textContent)).join(' ')).join(' / ') : clean(cell.textContent);
    }))
    .map(cells => {
      // drop the empty checkbox/padding cells at the ends of each row
      while (cells.length && !cells[0]) cells.shift();
      while (cells.length && !cells.at(-1)) cells.pop();
      return cells.join(' | ');
    })
    .join('\n')
    .slice(0, MAX_TABLE_TEXT);
}

/**
 * Puts a fresh report form inside `root`.
 * @param {HTMLElement} root
 * @param {object} options
 * @param {string} [options.step]         pre-pick "Where did it happen?"
 * @param {string} [options.buttonClass]  class for the Send button
 * @param {Node|string} [options.done]   what to show under "Thanks, it's sent."
 */
export function mountReportForm(root, { step = '', buttonClass = 'button', done = '' } = {}) {
  const device = describeDevice();
  const hint = text => h('span', { className: 'hint' }, text);
  const form = h('form', { className: 'report-form', noValidate: true },
    h('label', {}, h('span', {}, 'What went wrong?'),
      hint('For example: "My Tuesday lab is missing" or "The download button does nothing."'),
      h('textarea', { name: 'message', required: true, minLength: 10, maxLength: 5000 })),
    h('fieldset', { className: 'step-choices' },
      h('legend', {}, 'Where did it happen? ', hint('(optional)')),
      h('div', { className: 'pills' }, ...STEPS.map(([value, label]) =>
        h('label', { className: 'pill' }, h('input', { type: 'radio', name: 'step', value, checked: value === step }), h('span', {}, label))))),
    h('label', {}, h('span', {}, 'Your email ', hint("(optional, only if you'd like a reply)")),
      h('input', { type: 'email', name: 'email', autocomplete: 'email', maxLength: 254 })),
    h('div', { className: 'file-field' },
      h('label', {}, h('span', {}, 'Your saved schedule file ', hint('(optional)')),
        hint('Helps the most when a class is missing or wrong. Your file never leaves this page: Slotted reads it here and sends me only the class list it found, as plain text.'),
        h('input', { type: 'file', name: 'file', accept: '.html,.htm,text/html' })),
      h('div', { className: 'file-preview', hidden: true })),
    // Left empty by people; bots fill it in.
    h('div', { className: 'trap', 'aria-hidden': 'true' },
      h('label', {}, 'Website ', h('input', { type: 'text', name: 'website', tabIndex: -1, autocomplete: 'off' }))),
    h('p', { className: 'status', role: 'status', 'aria-live': 'polite' }),
    h('div', { className: 'send-row' },
      h('button', { type: 'submit', className: buttonClass }, 'Send report'),
      h('p', { className: 'hint auto-note' }, `Your browser and device type (like ${device.short}) are added automatically, so I can try it the same way.`)));
  root.replaceChildren(form,
    h('div', { className: 'sent', hidden: true, tabIndex: -1 }, h('h2', {}, "Thanks, it's sent."), h('p', { className: 'sent-text' }), done));

  const status = root.querySelector('.status');
  const send = form.querySelector('button[type="submit"]');
  const preview = root.querySelector('.file-preview');
  let schedule = null;  // what gets sent for the schedule file, or null

  const setStatus = (text, error = false) => {
    status.textContent = text;
    status.classList.toggle('error', error);
  };

  function showPreview(content, bad = false) {
    const remove = h('button', { type: 'button' }, 'Remove it');
    remove.addEventListener('click', clearFile);
    preview.replaceChildren(...content, ' ', remove);
    preview.classList.toggle('bad', bad);
    preview.hidden = false;
  }
  function clearFile() {
    form.elements.file.value = '';
    schedule = null;
    preview.hidden = true;
  }

  form.elements.file.addEventListener('change', async () => {
    const file = form.elements.file.files[0];
    schedule = null;
    if (!file) { preview.hidden = true; return; }
    if (file.size > MAX_FILE_BYTES) {
      showPreview(['That file is too large to be a saved schedule page.'], true);
      return;
    }
    const html = await file.text();
    const table = classTableText(html);
    try {
      const { courses, academicYear, notes } = readSchedule(html);
      const rows = courses.flatMap(c => c.meetings.map(m => ({
        course: `${c.subject} ${c.number}`,
        type: c.component,
        section: c.section,
        days: m.days.join(' '),
        time: m.start ? `${fmt(m.start)}–${fmt(m.end)}` : '',
        room: m.room,
      }))).slice(0, 60);
      schedule = { read: true, year: academicYear ?? '', notes: notes.slice(0, 10), rows, table };
      const names = [...new Set(rows.map(r => `${r.course} ${r.type}`))];
      showPreview([
        h('b', {}, `Slotted read ${names.length} ${names.length === 1 ? 'class' : 'classes'} from this file.`),
        " This list is what I'll get, not the file: ",
        h('ul', {}, ...names.slice(0, 12).map(n => h('li', {}, n)), ...(names.length > 12 ? [h('li', {}, '…')] : [])),
      ]);
    } catch (err) {
      schedule = { read: false, error: String(err.message).slice(0, 300), table };
      showPreview([
        h('b', {}, "Slotted couldn't read this file:"),
        ` ${err.message} I'll get that message${table ? ' and the text of the class list' : ''}, which helps me fix it.`,
      ], true);
    }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (send.disabled) return;
    const message = form.elements.message.value.trim();
    if (message.length < 10) {
      setStatus('Tell me a little more about what went wrong (at least 10 characters).', true);
      form.elements.message.focus();
      return;
    }
    const chosen = form.querySelector('input[name="step"]:checked')?.value;
    const email = form.elements.email.value.trim();
    const body = {
      message,
      device: device.full,
      ...(chosen && { step: chosen }),
      ...(email && { email }),
      ...(schedule && { schedule }),
      ...(form.elements.website.value && { website: form.elements.website.value }),
    };
    send.disabled = true;
    setStatus('Sending…');
    try {
      await api('/report', { method: 'POST', body });
      form.hidden = true;
      const sent = root.querySelector('.sent');
      root.querySelector('.sent-text').textContent = email
        ? "I read every report, and I'll reply to your email."
        : "I read every report. You didn't leave an email, so I won't be able to reply, but I'll use it to fix the problem.";
      sent.hidden = false;
      sent.focus();
    } catch (err) {
      setStatus(err instanceof ApiUnavailable
        ? "Your report couldn't be sent because Slotted's server isn't reachable right now. Please try again later."
        : err.message, true);
    } finally {
      send.disabled = false;
    }
  });

  return form;
}
