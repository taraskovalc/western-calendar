// "Report a problem": sends the form to the Slotted API, which emails it to Taras.
//
// The saved schedule file never leaves this page. If someone adds it, Slotted
// reads it here (the same way the main page does) and sends only what it found,
// as plain text: the classes it read, or the reason it couldn't read them, plus
// the text of the class list table. No file is attached to the email.
import { api, ApiUnavailable } from './api.js';
import { readSchedule } from './parser.js';

const form = document.querySelector('#report-form');
const status = document.querySelector('#report-status');
const send = document.querySelector('#report-send');
const preview = document.querySelector('#file-preview');
const MAX_FILE_BYTES = 2 * 1024 * 1024;  // a real saved page is about 70 KB
const MAX_TABLE_TEXT = 12000;

/* ---------- Device: filled in automatically, shown in the note under Send ---------- */
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
const device = describeDevice();
document.querySelector('#device-guess').textContent = device.short;

/* ---------- Step: report.html?step=add-to-calendar picks that step already ---------- */
const presetStep = new URLSearchParams(location.search).get('step');
const presetInput = presetStep && form.querySelector(`input[name="step"][value="${CSS.escape(presetStep)}"]`);
if (presetInput) presetInput.checked = true;

const setStatus = (text, error = false) => {
  status.textContent = text;
  status.classList.toggle('error', error);
};

/* ---------- Schedule file: read here, send only plain text ---------- */
let schedule = null;  // what gets sent, or null

const clean = text => text.replace(/\s+/g, ' ').trim();
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
  const lines = [...table.rows]
    .map(row =>[...row.cells].map(cell => {
      const inner = cell.querySelector('table');
      return inner ? [...inner.rows].map(r => [...r.cells].map(c => clean(c.textContent)).join(' ')).join(' / ') : clean(cell.textContent);
    }))
    .map(cells => {
      // drop the empty checkbox/padding cells at the ends of each row
      while (cells.length && !cells[0]) cells.shift();
      while (cells.length && !cells.at(-1)) cells.pop();
      return cells.join(' | ');
    });
  return lines.join('\n').slice(0, MAX_TABLE_TEXT);
}

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
const escapeHtml = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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

/* ---------- Send ---------- */
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (send.disabled) return;
  const message = form.elements.message.value.trim();
  if (message.length < 10) {
    setStatus('Tell me a little more about what went wrong (at least 10 characters).', true);
    form.elements.message.focus();
    return;
  }
  const step = form.querySelector('input[name="step"]:checked')?.value;
  const email = form.elements.email.value.trim();
  const body = {
    message,
    device: device.full,
    ...(step && { step }),
    ...(email && { email }),
    ...(schedule && { schedule }),
    ...(form.elements.website.value && { website: form.elements.website.value }),
  };
  send.disabled = true;
  setStatus('Sending…');
  try {
    await api('/report', { method: 'POST', body });
    form.hidden = true;
    const sent = document.querySelector('#report-sent');
    if (!email) document.querySelector('#report-sent-text').textContent = 'I read every report. You didn\'t leave an email, so I won\'t be able to reply, but I\'ll use it to fix the problem.';
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
