// Slotted: a four-page flow that runs in the browser.
// Rule used throughout: text from the schedule file is only ever shown with
// textContent (never innerHTML), so it can't inject anything into the page.
import { readSchedule, ScheduleReadError } from './parser.js';
import { buildCalendar, seasonsFor } from '../shared/ics.js';
import { TERM_DATES, LATEST_YEAR } from '../shared/terms.js';
import { api, ApiUnavailable } from './api.js';

const MAX_FILE_BYTES = 2 * 1024 * 1024;  // real schedule pages are ~70 KB
const VIEWS = ['cover', 'welcome', 'app', 'schedule', 'done'];
const DAY_ORDER = ['M', 'Tu', 'W', 'Th', 'F', 'Sa', 'Su'];
const DAY_NAMES = { M: 'Mon', Tu: 'Tue', W: 'Wed', Th: 'Thu', F: 'Fri', Sa: 'Sat', Su: 'Sun' };
const DAY_INDEX = { Su: 0, M: 1, Tu: 2, W: 3, Th: 4, F: 5, Sa: 6 };
const COLOURS = 8;

const $ = selector => document.querySelector(selector);
const state = {
  user: null,          // signed-in user, or null
  started: false,      // chose to sign in or continue as guest
  app: null,           // 'apple' | 'google' | 'outlook' | 'other'
  courses: [],
  academicYear: LATEST_YEAR,
  terms: [],
  tab: 'fall',
  colourOf: new Map(),
  lastDownload: null,
};

/* ================= helpers ================= */

function el(tag, { className, text, attrs } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  for (const [k, v] of Object.entries(attrs ?? {})) node.setAttribute(k, v);
  node.append(...children);
  return node;
}
const minutes = hhmm => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const plural = (n, word, many = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : many}`;
const clock = hhmm => { const h = Number(hhmm.slice(0, 2)); return `${h % 12 || 12}:${hhmm.slice(3)} ${h < 12 ? 'AM' : 'PM'}`; };
const longDate = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const courseKey = c => `${c.subject} ${c.number}`;
const chosen = name => document.querySelector(`input[name="${name}"]:checked`)?.value ?? null;

/* ================= pages ================= */

// Which page you're allowed to be on, given what you've done so far.
function allowedView(wanted) {
  if (wanted === 'app' && !state.started) return 'cover';
  if (wanted === 'schedule' && (!state.started || !state.app)) return state.started ? 'app' : 'cover';
  if (wanted === 'done' && !state.lastDownload) return allowedView('schedule');
  return VIEWS.includes(wanted) ? wanted : 'cover';
}

const VIEW_LABELS = { welcome: 'Sign in', app: 'Calendar app', schedule: 'Your schedule', done: 'Add to calendar' };
$('#page-date').textContent = new Date().toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });

function show(view, { push = true } = {}) {
  view = allowedView(view);
  const onCover = view === 'cover';
  $('#view-cover').hidden = !onCover;
  $('.notebook').hidden = onCover;
  $('#progress').hidden = onCover;
  for (const name of VIEWS.slice(1)) $(`#view-${name}`).hidden = name !== view;
  const index = VIEWS.indexOf(view) - 1;  // position among the 4 notebook pages
  if (!onCover) $('#page-step').textContent = `Step ${index + 1} of 4 · ${VIEW_LABELS[view]}`;
  document.querySelectorAll('#progress li').forEach((li, i) => {
    li.classList.toggle('current', i === index);
    li.classList.toggle('complete', i < index);
    if (i === index) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
  if (push && location.hash !== `#${view}`) history.pushState(null, '', `#${view}`);
  if (view === 'welcome') renderWelcome();
  if (view === 'done') renderDone();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  $(`#view-${view}`).focus({ preventScroll: true });
}

window.addEventListener('popstate', () => show(location.hash.slice(1), { push: false }));
document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => show(button.dataset.go)));

/* ================= cover ================= */

$('#cover-term').textContent = `Fall/Winter ${LATEST_YEAR.replace('-', '–')}`;
$('#open-notebook').addEventListener('click', () => {
  const book = $('#cover-book');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return show('welcome');
  book.classList.add('opening');  // the cover swings open
  setTimeout(() => { book.classList.remove('opening'); show('welcome'); }, 650);
});

/* ================= theme (light / dark) ================= */
// Everyone starts in light mode. Signed-in users keep whatever they last chose:
// it's saved to their account, and cached in this browser only while signed in.
const THEME_KEY = 'slotted-theme';
const currentTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const button = $('#theme-toggle');
  button.setAttribute('aria-pressed', String(theme === 'dark'));
  button.querySelector('.tt-text').textContent = theme === 'dark' ? 'Dark' : 'Light';
  button.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
}
function cacheTheme(theme) {
  try { if (theme) localStorage.setItem(THEME_KEY, theme); else localStorage.removeItem(THEME_KEY); } catch { /* storage blocked */ }
}
$('#theme-toggle').addEventListener('click', () => {
  const theme = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(theme);
  if (state.user) {
    state.user.theme = theme;
    cacheTheme(theme);
    api('/auth/me', { method: 'PATCH', body: { theme } }).catch(() => {});
  }
});
applyTheme(currentTheme());

/* ================= 1. welcome & accounts ================= */

function renderWelcome() {
  $('#signed-in').hidden = !state.user;
  $('#account-forms').hidden = Boolean(state.user);
  if (state.user) $('#signed-in-email').textContent = state.user.email;
}

function renderAccountChip() {
  const chip = $('#account-chip');
  chip.hidden = !state.user;
  if (!state.user) return;
  const signOut = el('button', { text: 'Sign out', attrs: { type: 'button' } });
  signOut.addEventListener('click', async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* signed out locally anyway */ }
    state.user = null;
    cacheTheme(null);
    renderAccountChip();
    show('welcome');
  });
  chip.replaceChildren(el('span', { text: `Signed in as ${state.user.displayName || state.user.email}` }), signOut);
}

// Sign in / Create account tabs
for (const [tabId, formId] of [['#tab-signin', '#form-signin'], ['#tab-register', '#form-register']]) {
  $(tabId).addEventListener('click', () => {
    document.querySelectorAll('.account-tabs button').forEach(b => b.setAttribute('aria-selected', String(b === $(tabId))));
    $('#form-signin').hidden = formId !== '#form-signin';
    $('#form-register').hidden = formId !== '#form-register';
  });
}

async function submitAccount(form, path) {
  const status = form.querySelector('.form-status');
  const body = Object.fromEntries(new FormData(form));
  if (!body.displayName) delete body.displayName;
  if (path === '/auth/register') body.theme = currentTheme();
  status.className = 'form-status';
  status.textContent = path === '/auth/login' ? 'Signing in…' : 'Creating your account…';
  try {
    const { user } = await api(path, { method: 'POST', body });
    state.user = user;
    state.started = true;
    applyTheme(user.theme ?? 'light');
    cacheTheme(user.theme ?? 'light');
    form.reset();
    status.textContent = '';
    renderAccountChip();
    show('app');
  } catch (err) {
    status.textContent = err instanceof ApiUnavailable
      ? "Accounts aren't available right now. You can still continue without an account; nothing about the calendar file changes."
      : err.message;
  }
}
$('#form-signin').addEventListener('submit', event => { event.preventDefault(); submitAccount(event.currentTarget, '/auth/login'); });
$('#form-register').addEventListener('submit', event => { event.preventDefault(); submitAccount(event.currentTarget, '/auth/register'); });

$('#continue-guest').addEventListener('click', () => { state.started = true; show('app'); });
$('#continue-user').addEventListener('click', () => { state.started = true; show('app'); });

/* ================= 2. calendar app ================= */

document.querySelectorAll('input[name="app"]').forEach(radio => radio.addEventListener('change', () => {
  state.app = radio.value;
  $('#app-next').disabled = false;
  updateReminderOption();
}));
$('#app-next').addEventListener('click', () => show('schedule'));

function updateReminderOption() {
  $('#reminder-note').hidden = state.app !== 'google';
  $('#alarm').disabled = state.app === 'google';
}

/* ================= 3. schedule ================= */

// Show the save shortcut for the browser and computer being used right now.
(function personalizeSaveSteps() {
  const ua = navigator.userAgent;
  const mac = /Mac/.test(navigator.platform) || /Mac OS X/.test(ua);
  const key = mac ? '⌘' : 'Ctrl';
  const steps = $('#save-steps');
  const kbd = text => el('kbd', { text });
  if (/Firefox\//.test(ua)) {
    steps.replaceChildren('Press ', kbd(key), ' + ', kbd('S'), ', choose ', el('b', { text: 'Web Page, HTML only' }), ', then click Save.');
  } else if (/Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua)) {
    steps.replaceChildren('In the menu bar, choose ', el('b', { text: 'File → Save As…' }), ', set Format to ', el('b', { text: 'Page Source' }), ', then click Save.');
  } else {
    steps.replaceChildren('Press ', kbd(key), ' + ', kbd('S'), ', set the format to ', el('b', { text: 'Webpage, HTML Only' }), ', then click Save.');
  }
})();

function setStatus(message, kind) {
  const status = $('#read-status');
  status.className = `status ${kind}`;
  status.textContent = message;
}

async function handleFile(file) {
  if (!file) return;
  if (!/\.html?$/i.test(file.name)) {
    setStatus(`“${file.name}” isn't a saved web page (.html). Save the My Current Schedule page itself, as in step 3 above, not the PDF.`, 'error');
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    setStatus('That file is much larger than a schedule page. Check that you picked the saved DraftMySchedule page.', 'error');
    return;
  }

  let result;
  try {
    result = readSchedule(await file.text());
  } catch (err) {
    if (!(err instanceof ScheduleReadError)) console.error(err);
    const reason = err instanceof ScheduleReadError ? err.message : 'The file could not be read.';
    setStatus(`${reason} Make sure you saved the My Current Schedule page (step 2 above), not Build Future Draft, then try again.`, 'error');
    return;
  }

  const year = result.academicYear && TERM_DATES[result.academicYear] ? result.academicYear : LATEST_YEAR;
  Object.assign(state, { courses: result.courses, academicYear: year, terms: TERM_DATES[year], lastDownload: null });
  const notes = [...result.notes];
  if (result.academicYear && !TERM_DATES[result.academicYear]) {
    notes.push(`Your file is for ${result.academicYear}, but only ${LATEST_YEAR} dates are available, so ${LATEST_YEAR} dates are used.`);
  }

  // Tick off the guide: they clearly found and saved the file.
  document.querySelectorAll('#guide input').forEach(box => { box.checked = true; });
  $('#dropzone').classList.add('loaded');
  $('.drop-title').textContent = `Loaded: ${file.name}`;
  $('.drop-detail').textContent = 'Drop a different file here to replace it.';
  setStatus(`Got it. Found ${plural(state.courses.length, 'class entry', 'class entries')} for ${year}. Check them below.`, 'ok');

  renderCheck(notes);
  $('#check-part').hidden = false;
  updateDownloadDetail();
  $('#check-part').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const input = $('#file-input');
input.addEventListener('change', () => handleFile(input.files[0]));
const zone = $('#dropzone');
['dragenter', 'dragover'].forEach(type => zone.addEventListener(type, event => { event.preventDefault(); zone.classList.add('dragging'); }));
['dragleave', 'drop'].forEach(type => zone.addEventListener(type, () => zone.classList.remove('dragging')));
zone.addEventListener('drop', event => { event.preventDefault(); handleFile(event.dataTransfer.files[0]); });
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => event.preventDefault());

function meetingsFor(season) {
  const out = [];
  for (const course of state.courses) {
    if (!seasonsFor(course.number).includes(season)) continue;
    for (const meeting of course.meetings) {
      if (!meeting.start || !meeting.days.length) continue;
      for (const day of meeting.days) out.push({ course, meeting, day });
    }
  }
  return out;
}

function renderCheck(notes) {
  const hasTime = c => c.meetings.some(m => m.start && m.days.length);
  const timed = state.courses.filter(hasTime);
  const untimed = state.courses.filter(c => !hasTime(c));
  $('#found-summary').textContent =
    `${plural(new Set(state.courses.map(courseKey)).size, 'course')} and ${plural(timed.length, 'lecture, lab or tutorial', 'lectures, labs and tutorials')} with set times. Compare this week with DraftMySchedule before you download.`;
  state.tab = meetingsFor('fall').length ? 'fall' : 'winter';
  renderWeek();

  $('#not-added').replaceChildren(...untimed.map(c =>
    el('li', { text: `${courseKey(c)} ${c.component}${c.title ? ` (${c.title})` : ''}: ${c.delivery || 'no set day or time'}, so there's no time to place it at.` })));
  $('#extra-notes').hidden = untimed.length === 0;
  $('#notes-list').replaceChildren(...notes.map(n => el('li', { text: n })));
  $('#read-notes').hidden = notes.length === 0;
}

function renderWeek() {
  document.querySelectorAll('.term-tab').forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.term === state.tab)));
  const term = state.terms.find(t => t.season === state.tab);
  const items = meetingsFor(state.tab);
  const week = $('#week');
  $('#term-range').textContent = term ? `${longDate(term.starts_on)} → ${longDate(term.ends_on)}` : '';

  if (!items.length) {
    const empty = `No classes with set times in the ${state.tab} term.`;
    week.style.setProperty('--days', 1);
    week.replaceChildren(el('div', { className: 'week-empty', text: empty }));
    $('#day-list').replaceChildren(el('p', { className: 'week-empty', text: empty }));
    return;
  }
  // Colours per term, so courses shown together never share one.
  state.colourOf = new Map([...new Set(items.map(i => courseKey(i.course)))].map((key, n) => [key, n % COLOURS]));
  const days = DAY_ORDER.filter(d => ['M', 'Tu', 'W', 'Th', 'F'].includes(d) || items.some(i => i.day === d));
  const startHour = Math.floor(Math.min(...items.map(i => minutes(i.meeting.start))) / 60);
  const endHour = Math.ceil(Math.max(...items.map(i => minutes(i.meeting.end))) / 60);
  const span = (endHour - startHour) * 60;
  week.style.setProperty('--days', days.length);
  week.style.setProperty('--hours', endHour - startHour);

  const byDay = day => items.filter(i => i.day === day).sort((a, b) => minutes(a.meeting.start) - minutes(b.meeting.start));
  const header = [el('div', { className: 'week-corner' }), ...days.map(d => el('div', { className: 'week-day', text: DAY_NAMES[d] }))];
  const times = el('div', { className: 'week-times' }, Array.from({ length: endHour - startHour - 1 }, (_, i) => {
    const hour = startHour + i + 1;
    const label = el('span', { className: 'week-time', text: `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}` });
    label.style.top = `${((i + 1) * 60 / span) * 100}%`;
    return label;
  }));

  let order = 0;
  const colour = (node, course) => {
    const c = state.colourOf.get(courseKey(course));
    node.style.setProperty('--bg-c', `var(--c${c})`);
    node.style.setProperty('--edge-c', `var(--e${c})`);
    return node;
  };
  const columns = days.map(day => el('div', { className: 'week-col' }, byDay(day).map(({ course, meeting }) => {
    const block = colour(el('div', { className: 'block', attrs: { title: `${courseKey(course)} ${course.component} · ${clock(meeting.start)}–${clock(meeting.end)} · ${meeting.room}` } }, [
      el('span', { className: 'block-code', text: `${courseKey(course)} ${course.component}` }),
      el('span', { className: 'block-meta', text: `${clock(meeting.start)} · ${meeting.room || 'No room'}` }),
    ]), course);
    block.style.top = `${((minutes(meeting.start) - startHour * 60) / span) * 100}%`;
    block.style.height = `calc(${((minutes(meeting.end) - minutes(meeting.start)) / span) * 100}% - 4px)`;
    block.style.setProperty('--tilt', `${((order * 37) % 5 - 2) * 0.35}deg`);  // a slight, varied tilt like real sticky notes
    block.style.animationDelay = `${Math.min(order++ * 35, 600)}ms`;
    return block;
  })));
  week.replaceChildren(...header, times, ...columns);
  week.setAttribute('aria-label', `${state.tab} term timetable: ${items.length} weekly class times`);

  // Phones: the same classes as a list per day.
  $('#day-list').replaceChildren(...days.filter(d => byDay(d).length).map(day => el('section', { className: 'day' }, [
    el('h4', { className: 'day-name', text: DAY_NAMES[day] }),
    el('ul', {}, byDay(day).map(({ course, meeting }) => colour(el('li', { className: 'day-item' }, [
      el('span', { className: 'day-time', text: `${clock(meeting.start)} – ${clock(meeting.end)}` }),
      el('span', { className: 'day-course', text: `${courseKey(course)} ${course.component}` }),
      el('span', { className: 'day-room', text: meeting.room || 'No room listed' }),
    ]), course))),
  ])));
}
document.querySelectorAll('.term-tab').forEach(tab => tab.addEventListener('click', () => { state.tab = tab.dataset.term; renderWeek(); }));

// Counts every individual class, the days off skipped, and the next class from today.
function summarize(include) {
  let total = 0;
  let skipped = 0;
  let next = null;
  const todayIso = new Date().toISOString().slice(0, 10);
  for (const course of state.courses) {
    for (const season of seasonsFor(course.number).filter(s => include === 'both' || include === s)) {
      const term = state.terms.find(t => t.season === season);
      if (!term) continue;
      for (const meeting of course.meetings) {
        if (!meeting.start || !meeting.days.length) continue;
        const weekdays = meeting.days.map(d => DAY_INDEX[d]);
        for (let d = new Date(`${term.starts_on}T00:00:00Z`); d.toISOString().slice(0, 10) <= term.ends_on; d.setUTCDate(d.getUTCDate() + 1)) {
          if (!weekdays.includes(d.getUTCDay())) continue;
          const iso = d.toISOString().slice(0, 10);
          if (term.no_class_dates.includes(iso)) { skipped++; continue; }
          total++;
          const key = `${iso} ${meeting.start}`;
          if (iso >= todayIso && (!next || key < next.key)) next = { key, iso, course, meeting };
        }
      }
    }
  }
  return { total, skipped, next };
}

function updateDownloadDetail() {
  $('#download-detail').textContent = `${plural(summarize(chosen('include')).total, 'class', 'classes')} will go into your calendar`;
}
document.querySelectorAll('input[name="include"]').forEach(r => r.addEventListener('change', updateDownloadDetail));

function downloadCalendar() {
  const include = chosen('include');
  const alarmMinutes = state.app === 'google' ? 0 : Number($('#alarm').value);
  const { ics } = buildCalendar({ courses: state.courses, terms: state.terms, include, alarmMinutes, calendarName: 'Western Classes' });
  const filename = `Western Classes ${state.academicYear}.ics`;
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const link = el('a', { attrs: { href: url, download: filename } });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  state.lastDownload = { include, alarmMinutes, filename };
}
$('#download').addEventListener('click', () => { downloadCalendar(); show('done'); });
$('#download-again').addEventListener('click', downloadCalendar);

/* ================= 4. done ================= */

const APP_NAMES = { apple: 'Apple Calendar', google: 'Google Calendar', outlook: 'Outlook', other: 'your calendar app' };

function renderDone() {
  const { include, alarmMinutes, filename } = state.lastDownload;
  const { total, skipped, next } = summarize(include);
  $('#done-file').textContent = `“${filename}” is in your Downloads folder. Here's what's inside, and how to add it to ${APP_NAMES[state.app]}.`;

  // The results, as sticky notes.
  const termText = { both: 'fall + winter', fall: 'fall term', winter: 'winter term' }[include];
  const notes = [
    [total.toLocaleString(), `classes added (${termText})`],
    [String(skipped), 'skipped for reading weeks & holidays'],
    state.app === 'google'
      ? ['Later', 'reminders: turn them on in Google (step 4 below)']
      : [alarmMinutes ? `${alarmMinutes} min` : 'None', alarmMinutes ? 'reminder before each class' : 'no reminders in the file'],
  ];
  $('#stickies').replaceChildren(...notes.map(([number, label], i) => {
    const note = el('div', { className: 'sticky' }, [
      el('span', { className: 'sticky-number', text: number }),
      el('span', { className: 'sticky-label', text: label }),
    ]);
    const colour = [0, 2, 3][i];
    note.style.setProperty('--bg-c', `var(--c${colour})`);
    note.style.setProperty('--edge-c', `var(--e${colour})`);
    note.style.setProperty('--tilt', `${[-1.5, 1, -0.5][i]}deg`);
    note.style.setProperty('--delay', `${150 + i * 120}ms`);
    return note;
  }));

  $('#next-class').hidden = !next;
  if (next) {
    $('#next-when').textContent = `${longDate(next.iso)} · ${clock(next.meeting.start)}`;
    $('#next-what').textContent = `${courseKey(next.course)} ${next.course.component}${next.course.title ? `, ${next.course.title}` : ''}${next.meeting.room ? ` · ${next.meeting.room}` : ''}`;
  }

  $('#howto-title').textContent = `Add it to ${APP_NAMES[state.app]}`;
  for (const name of ['apple', 'google', 'outlook', 'other']) $(`#howto-${name}`).hidden = name !== state.app;
  throwConfetti();
}

// A short burst of paper confetti in the sticky-note colours.
function throwConfetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = $('#confetti');
  box.replaceChildren(...Array.from({ length: 36 }, (_, i) => {
    const piece = el('i');
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.setProperty('--c', `var(--e${i % COLOURS})`);
    piece.style.setProperty('--x', `${(Math.random() - 0.5) * 160}px`);
    piece.style.setProperty('--r', `${(Math.random() - 0.5) * 720}deg`);
    piece.style.setProperty('--d', `${1.6 + Math.random() * 1.2}s`);
    piece.style.setProperty('--delay', `${Math.random() * 0.4}s`);
    return piece;
  }));
  setTimeout(() => box.replaceChildren(), 3500);
}

/* ================= start ================= */

// Already signed in from an earlier visit? (Fails quietly if accounts are offline.)
api('/auth/me').then(({ user }) => {
  state.user = user;
  if (user) { applyTheme(user.theme ?? 'light'); cacheTheme(user.theme ?? 'light'); }
  else { cacheTheme(null); applyTheme('light'); }
  renderAccountChip();
  renderWelcome();
}).catch(() => {});

show(location.hash.slice(1) || 'cover', { push: false });
