// The "Report a problem" form. Used in two places:
//   - inside Slotted, as a dialog (so nobody leaves the page or loses progress)
//   - on report.html, for anyone who opens the link directly
//
// It sends the form to the Slotted API, which emails it to Slotted's inbox.
// The saved schedule file never leaves the browser: Slotted reads it here (the
// same way the main page does) and sends only what it found, as plain text.
import { api, ApiUnavailable } from './api.js';
import { readSchedule } from './parser.js';

const MAX_FILE_BYTES = 2 * 1024 * 1024;  // a real saved page is about 70 KB
const MAX_TABLE_TEXT = 12000;

const STEPS = [
  ['sign-in', 'Signing in'],
  ['calendar-app', 'Choosing a calendar app'],
  ['schedule', 'Adding the schedule file'],
  ['add-to-calendar', 'Adding classes to a calendar'],
  ['calendar-link', 'The calendar link'],
  ['other', 'Something else'],
];

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = text => text.replace(/\s+/g, ' ').trim();

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
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = [...doc.querySelectorAll('table')].find(t =>
    t.rows[0] && [...t.rows[0].cells].some(c => !c.querySelector('table') && clean(c.textContent).includes('Days/Times/Location')));
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
 * @param {string} [options.doneHtml]     what to show under "Thanks, it's sent."
 * @param {() => void} [options.onDone]   called by an element marked [data-report-done]
 */
export function mountReportForm(root, { step = '', buttonClass = 'button', doneHtml = '', onDone } = {}) {
  const device = describeDevice();
  root.innerHTML = `
    <form class="report-form" novalidate>
      <label><span>What went wrong?</span>
        <span class="hint">For example: "My Tuesday lab is missing" or "The download button does nothing."</span>
        <textarea name="message" required minlength="10" maxlength="5000"></textarea>
      </label>

      <fieldset class="step-choices">
        <legend>Where did it happen? <span class="hint">(optional)</span></legend>
        <div class="pills">
          ${STEPS.map(([value, label]) => `<label class="pill"><input type="radio" name="step" value="${value}"${value === step ? ' checked' : ''}><span>${label}</span></label>`).join('')}
        </div>
      </fieldset>

      <label><span>Your email <span class="hint">(optional, only if you'd like a reply)</span></span>
        <input type="email" name="email" autocomplete="email" maxlength="254">
      </label>

      <div class="file-field">
        <label><span>Your saved schedule file <span class="hint">(optional)</span></span>
          <span class="hint">Helps the most when a class is missing or wrong. Your file never leaves this page: Slotted reads it here and sends me only the class list it found, as plain text.</span>
          <input type="file" name="file" accept=".html,.htm,text/html">
        </label>
        <div class="file-preview" hidden></div>
      </div>

      <!-- Left empty by people; bots fill it in. -->
      <div class="trap" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>

      <p class="status" role="status" aria-live="polite"></p>
      <div class="send-row">
        <button type="submit" class="${buttonClass}">Send report</button>
        <p class="hint auto-note">Your browser and device type (like ${escapeHtml(device.short)}) are added automatically, so I can try it the same way.</p>
      </div>
    </form>
    <div class="sent" hidden tabindex="-1">
      <h2>Thanks, it's sent.</h2>
      <p class="sent-text"></p>
      ${doneHtml}
    </div>`;

  const form = root.querySelector('form');
  const status = root.querySelector('.status');
  const send = form.querySelector('button[type="submit"]');
  const preview = root.querySelector('.file-preview');
  let schedule = null;  // what gets sent for the schedule file, or null

  root.querySelector('[data-report-done]')?.addEventListener('click', () => onDone?.());

  const setStatus = (text, error = false) => {
    status.textContent = text;
    status.classList.toggle('error', error);
  };

  function showPreview(html, bad = false) {
    preview.innerHTML = html;
    preview.classList.toggle('bad', bad);
    preview.hidden = false;
    preview.querySelector('[data-remove]')?.addEventListener('click', clearFile);
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
      showPreview('That file is too large to be a saved schedule page. <button type="button" data-remove>Remove it</button>', true);
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
      showPreview(`<b>Slotted read ${names.length} ${names.length === 1 ? 'class' : 'classes'} from this file.</b> This list is what I'll get, not the file: <ul>${names.slice(0, 12).map(n => `<li>${escapeHtml(n)}</li>`).join('')}${names.length > 12 ? '<li>…</li>' : ''}</ul> <button type="button" data-remove>Remove it</button>`);
    } catch (err) {
      schedule = { read: false, error: String(err.message).slice(0, 300), table };
      showPreview(`<b>Slotted couldn't read this file:</b> ${escapeHtml(err.message)} I'll get that message${table ? ' and the text of the class list' : ''}, which helps me fix it. <button type="button" data-remove>Remove it</button>`, true);
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
