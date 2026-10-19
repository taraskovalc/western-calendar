// Slotted: a four-page flow that runs in the browser.
// Rule used throughout: text from the schedule file is only ever shown with
// textContent (never innerHTML), so it can't inject anything into the page.
import { readSchedule, ScheduleReadError } from './parser.js';
import { buildCalendar, seasonsFor, periodsFor, whyNotPlaced, isLabPart, partIncluded, meetingDays } from '../shared/ics.js?v=20261021';
import { TERM_DATES, LATEST_YEAR } from '../shared/terms.js';
import { api, API_URL, ApiUnavailable } from './api.js';
import { mountReportForm } from './report-form.js?v=20261018';

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
  lastDownload: null,  // what the last "finish" was: { mode: 'file' | 'link', include, alarmMinutes, ... }
  scheduleId: null,    // the saved schedule being worked on (signed-in users)
  scheduleName: null,
  saveResult: null,    // { ok, message } after saving to the account
  feed: null,          // { url, webcalUrl } once a calendar link exists
  myNames: [],         // names of the saved schedules, so a new one gets its own name
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
// Today's date on this computer as YYYY-MM-DD (not UTC, which is a day ahead in the evening).
const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const shortDate = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
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

/* ================= phones ================= */
// Step 3 needs a computer, and Google Calendar and Outlook can only add a
// calendar file or link from a computer. Tell phone visitors right away.
const isPhone = /iPhone|iPod|Android.+Mobile|Windows Phone/i.test(navigator.userAgent)
  || matchMedia('(max-width: 600px) and (pointer: coarse)').matches;
if (isPhone) {
  document.querySelectorAll('[data-phone-note]').forEach(note => {
    note.hidden = false;
    note.textContent = "On a phone? You can start here, but saving your DraftMySchedule page (step 3) needs a computer. "
      + 'Google Calendar and Outlook also only let you add your classes from a computer (they then show up on your phone). '
      + 'Apple Calendar can add them right on an iPhone.';
  });
}

/* ================= cover ================= */

$('#cover-term').textContent = `Fall/Winter ${LATEST_YEAR.replace('-', '–')}`;
$('#open-notebook').addEventListener('click', () => {
  const book = $('#cover-book');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return show('welcome');
  book.classList.add('opening');  // the cover swings open
  setTimeout(() => { book.classList.remove('opening'); show('welcome'); }, 650);
});

/* ================= theme (auto / light / dark) ================= */
// "Auto" (the default) follows the device's own light/dark setting, live.
// A choice is remembered in this browser; signed-in users also keep it in
// their account, so it follows them to other devices.
const THEME_KEY = 'slotted-theme';
const THEMES = ['auto', 'light', 'dark'];
const systemDark = matchMedia('(prefers-color-scheme: dark)');
function cachedTheme() {
  try { return localStorage.getItem(THEME_KEY); } catch { return null; }  // storage blocked
}
let themeChoice = THEMES.includes(cachedTheme()) ? cachedTheme() : 'auto';
const currentTheme = () => themeChoice;

function applyTheme(choice) {
  themeChoice = THEMES.includes(choice) ? choice : 'auto';
  const dark = themeChoice === 'dark' || (themeChoice === 'auto' && systemDark.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelectorAll('[data-theme-choice]').forEach(button => {
    button.setAttribute('aria-checked', String(button.dataset.themeChoice === themeChoice));
    button.tabIndex = button.dataset.themeChoice === themeChoice ? 0 : -1;
  });
}
function cacheTheme(choice) {
  try { if (choice) localStorage.setItem(THEME_KEY, choice); else localStorage.removeItem(THEME_KEY); } catch { /* storage blocked */ }
}
function chooseTheme(choice) {
  applyTheme(choice);
  cacheTheme(themeChoice);
  if (state.user) {
    state.user.theme = themeChoice;
    api('/auth/me', { method: 'PATCH', body: { theme: themeChoice } }).catch(() => {});
  }
}
const themeButtons = [...document.querySelectorAll('[data-theme-choice]')];
themeButtons.forEach((button, i) => {
  button.addEventListener('click', () => chooseTheme(button.dataset.themeChoice));
  // Arrow keys move between the three choices, like any radio group.
  button.addEventListener('keydown', event => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = themeButtons[(i + step + themeButtons.length) % themeButtons.length];
    chooseTheme(next.dataset.themeChoice);
    next.focus();
  });
});
// In Auto, switch the moment the device does (for example at sunset).
systemDark.addEventListener('change', () => { if (themeChoice === 'auto') applyTheme('auto'); });
applyTheme(themeChoice);

/* ================= 1. welcome & accounts ================= */

function renderWelcome() {
  const signedIn = Boolean(state.user);
  $('#signed-in').hidden = !signedIn;
  $('#account-forms').hidden = signedIn;
  $('#welcome-intro').hidden = signedIn;   // returning users don't need the explanation again
  $('#welcome-title').textContent = signedIn ? 'Welcome back' : 'Sign in, or jump straight in';
  $('#welcome-lede').textContent = signedIn
    ? 'Open a saved schedule to update it, or start a new one.'
    : 'An account is optional. You can make your calendar file either way.';
  if (signedIn) {
    $('#signed-in-email').textContent = state.user.email;
    loadMySchedules();
  }
}

// "Sign in or create account" opens the sign-in forms in place of the two choices.
function showSignInForms(open) {
  $('#choices').hidden = open;
  $('#signin-panel').hidden = !open;
  $('#show-signin').setAttribute('aria-expanded', String(open));
  if (open) $('#form-signin').hidden ? $('#form-register [name=email]').focus() : $('#form-signin [name=email]').focus();
}
$('#show-signin').addEventListener('click', () => showSignInForms(true));

// Clears everything about the current user (after signing out or deleting the account).
function signedOut() {
  Object.assign(state, { user: null, scheduleId: null, scheduleName: null, saveResult: null, feed: null, myNames: [] });
  resetSchedulePage();  // the next person on this computer starts with an empty schedule
  cacheTheme(null);
  applyTheme('auto');
  renderAccountChip();
  updateFinishButtons();
  $('#tab-signin')?.click(); // next visit to the welcome page starts on "Sign in"
}

function welcomeMessage(text) {
  $('#oauth-error').textContent = text;
}

function renderAccountChip() {
  const chip = $('#account-chip');
  chip.hidden = !state.user;
  if (!state.user) return;
  const account = el('button', { className: 'chip-link', text: 'Account', attrs: { type: 'button' } });
  account.addEventListener('click', openAccountDialog);
  const signOutButton = el('button', { className: 'chip-link', text: 'Sign out', attrs: { type: 'button' } });
  signOutButton.addEventListener('click', signOut);
  chip.replaceChildren(el('span', { text: `Signed in as ${state.user.displayName || state.user.email}` }), account, signOutButton);
}

async function signOut() {
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* signed out locally anyway */ }
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  signedOut();
  showSignInForms(false);
  show('welcome');
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
  const submit = form.querySelector('[type="submit"]');
  if (submit.disabled) return;  // already sending (double click)
  submit.disabled = true;
  status.className = 'form-status';
  status.textContent = path === '/auth/login' ? 'Signing in…' : 'Creating your account…';
  try {
    const { user } = await api(path, { method: 'POST', body });
    signedIn(user);
    form.reset();
    status.textContent = '';
    // Returning users see their saved schedules first; new accounts go straight on.
    show(path === '/auth/login' ? 'welcome' : 'app');
  } catch (err) {
    status.textContent = err instanceof ApiUnavailable
      ? "Accounts aren't available right now. You can still continue without an account; nothing about the calendar file changes."
      : err.message;
  } finally {
    submit.disabled = false;
  }
}
$('#form-signin').addEventListener('submit', event => { event.preventDefault(); submitAccount(event.currentTarget, '/auth/login'); });
$('#form-register').addEventListener('submit', event => { event.preventDefault(); submitAccount(event.currentTarget, '/auth/register'); });

function signedIn(user) {
  state.user = user;
  state.started = true;
  // A file downloaded before signing in wasn't saved; download again to save it.
  Object.assign(state, { lastDownload: null, saveResult: null });
  applyTheme(user.theme ?? 'auto');
  cacheTheme(currentTheme());
  welcomeMessage('');
  renderAccountChip();
  updateFinishButtons();
}

for (const id of ['#continue-guest', '#continue-guest-2']) $(id).addEventListener('click', () => { state.started = true; show('app'); });
$('#continue-user').addEventListener('click', () => {
  state.started = true;
  resetSchedulePage();
  show(state.app ? 'schedule' : 'app');
});

/* ================= 2. calendar app ================= */

document.querySelectorAll('input[name="app"]').forEach(radio => radio.addEventListener('change', () => {
  state.app = radio.value;
  $('#app-next').disabled = false;
  updateReminderOption();
}));
$('#app-next').addEventListener('click', () => show('schedule'));
// Browsers can restore a ticked option after Back or reload; pick it up.
if (chosen('app')) {
  state.app = chosen('app');
  $('#app-next').disabled = false;
}

// Only Apple Calendar can take a colour from Slotted, and only through the
// calendar link (which needs an account). Everyone else gets short steps for
// choosing the colour in their own app.
function updateColourOption() {
  const apple = state.app === 'apple';
  const link = apple && Boolean(state.user);
  $('#swatches').hidden = !link;
  $('#color-note-apple-link').hidden = !link;
  $('#color-note-apple-file').hidden = !(apple && !state.user);
  for (const name of ['apple', 'google', 'outlook', 'other']) $(`#color-howto-${name}`).hidden = name !== state.app;
}
// The colour Slotted should send: only for Apple, and only with an account.
const pickedColour = () => (state.app === 'apple' && state.user ? chosen('calcolor') || null : null);

function updateReminderOption() {
  updateColourOption();
  // Google ignores reminders in files and links, so don't offer a choice that does nothing.
  $('#reminder-note').hidden = state.app !== 'google';
  $('#alarm').hidden = state.app === 'google';
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

// Back to an empty schedule page (for "Start a new schedule").
// Ticks the matching calendar-colour swatch ("App chooses" if none).
function pickColour(colour) {
  const box = document.querySelector(`input[name="calcolor"][value="${colour ?? ''}"]`)
    ?? document.querySelector('input[name="calcolor"][value=""]');
  box.checked = true;
}

function resetSchedulePage() {
  Object.assign(state, { courses: [], scheduleId: null, scheduleName: null, lastDownload: null, feed: null, saveResult: null });
  pickColour(null);
  document.querySelector('input[name="parts"][value="all"]').checked = true;
  $('#check-part').hidden = true;
  $('#dropzone').classList.remove('loaded');
  $('.drop-title').replaceChildren('Drag the file here, or ', el('u', { text: 'click to choose it' }));
  $('.drop-detail').textContent = 'The University of Western Ontario.html';
  document.querySelectorAll('#guide input').forEach(box => { box.checked = false; });
  $('#file-input').value = '';
  showGuide();
  setStatus('', '');
}

// Once a file is in, the four steps fold into one line (they can be opened again).
function collapseGuide(text) {
  document.querySelectorAll('#guide input').forEach(box => { box.checked = true; });
  $('#guide').hidden = true;
  $('#guide-done').hidden = false;
  $('#guide-done-text').textContent = `✓ ${text}`;
}
function showGuide() {
  $('#guide').hidden = false;
  $('#guide-done').hidden = true;
}
$('#guide-show').addEventListener('click', showGuide);

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
    // Some messages already say exactly what to do; the rest get the usual tip.
    setStatus(err.complete ? reason : `${reason} Make sure you saved the My Current Schedule page (step 2 above), not Build Draft, then try again.`, 'error');
    return;
  }

  if (result.academicYear && !TERM_DATES[result.academicYear]) {
    setStatus(`This schedule is for the ${result.academicYear} school year. Slotted doesn't have that year's term dates yet (they're added once Western publishes them), so it can't make a calendar for it yet. Slotted currently has ${LATEST_YEAR}.`, 'error');
    return;
  }
  const year = result.academicYear ?? LATEST_YEAR;
  // Updating a saved schedule: keep each lab's every-other-week / date
  // settings for the same lab section.
  const kept = new Map(state.courses.filter(c => c.repeat).map(c => [labKey(c), c.repeat]));
  for (const c of result.courses) if (kept.has(labKey(c))) c.repeat = kept.get(labKey(c));
  Object.assign(state, { courses: result.courses, academicYear: year, terms: TERM_DATES[year], lastDownload: null, saveResult: null });
  const notes = [...result.notes];

  // They clearly found and saved the file: fold the four steps away.
  collapseGuide(`Schedule loaded: ${file.name}`);
  $('#dropzone').classList.add('loaded');
  $('.drop-title').textContent = `Loaded: ${file.name}`;
  $('.drop-detail').textContent = 'Drop a different file here to replace it.';
  const found = `${plural(courseCount(), 'course')} (${plural(timedCount(), 'lecture, lab or tutorial', 'lectures, labs and tutorials')} with set times)`;
  setStatus(state.scheduleId
    ? `Got it. Found ${found}. These will replace the classes in “${state.scheduleName}” when you save.`
    : `Got it. Found ${found} for ${year}. Check them below.`, 'ok');

  renderCheck(notes);
  $('#check-part').hidden = false;
  updateDownloadDetail();
  $('#check-part').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const input = $('#file-input');
input.addEventListener('change', () => {
  handleFile(input.files[0]);
  input.value = '';  // so choosing the same file again still works
});
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

const hasTime = c => c.meetings.some(m => m.start && m.days.length);
const courseCount = () => new Set(state.courses.map(courseKey)).size;
const timedCount = () => state.courses.filter(hasTime).length;

function renderCheck(notes) {
  const timed = state.courses.filter(hasTime);
  const untimed = state.courses.filter(c => !hasTime(c));
  const unplaced = timed.filter(c => whyNotPlaced(c.number));
  $('#found-summary').textContent = 'Compare this week with DraftMySchedule before you continue.';
  // Open the term that's next: winter once fall classes are over.
  const fallOver = localDate(new Date()) > (state.terms.find(t => t.season === 'fall')?.ends_on ?? '');
  state.tab = (fallOver && meetingsFor('winter').length) || !meetingsFor('fall').length ? 'winter' : 'fall';
  renderWeek();

  $('#not-added').replaceChildren(
    ...untimed.map(c =>
      el('li', { text: `${courseKey(c)} ${c.component}${c.title ? ` (${c.title})` : ''} has no set day or time${c.delivery ? ` (${c.delivery})` : ''}, so it isn't in the calendar.` })),
    ...unplaced.map(c =>
      el('li', { text: `${courseKey(c)} ${c.component}${c.title ? ` (${c.title})` : ''} ${whyNotPlaced(c.number)}. Add it to your calendar yourself.` })));
  $('#extra-notes').hidden = untimed.length + unplaced.length === 0;

  const allNotes = [...notes];
  // Quarter courses only run for six weeks; say which weeks.
  const quarterCodes = new Map();
  for (const c of timed) {
    const [period] = periodsFor(c.number, state.terms);
    if (period?.quarter) quarterCodes.set(courseKey(c), period);
  }
  for (const [code, period] of quarterCodes) {
    allNotes.push(`${code} is a six-week course, so it's only added from ${longDate(period.starts_on)} to ${longDate(period.ends_on)}.`);
  }
  renderLabOptions();
  $('#notes-list').replaceChildren(...allNotes.map(n => el('li', { text: n })));
  $('#read-notes').hidden = allNotes.length === 0;
}

function renderWeek() {
  document.querySelectorAll('.term-tab').forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.term === state.tab)));
  const term = state.terms.find(t => t.season === state.tab);
  const items = meetingsFor(state.tab);
  const week = $('#week');
  $('#term-range').textContent = term ? `${longDate(term.starts_on)} → ${longDate(term.ends_on)}` : '';
  const off = term ? daysOff(term) : [];
  $('#days-off').replaceChildren(...(off.length
    ? ['No classes on ', ...off.flatMap((part, i) => [...(i ? [' · '] : []), el('span', { text: part })])]
    : []));

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
  // An hour label on every line, including the first (so 8:30 doesn't look like 9:00).
  const times = el('div', { className: 'week-times' }, Array.from({ length: endHour - startHour }, (_, i) => {
    const hour = startHour + i;
    const label = el('span', { className: `week-time${i === 0 ? ' first' : ''}`, text: `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}` });
    label.style.top = `${(i * 60 / span) * 100}%`;
    return label;
  }));

  let order = 0;
  const colour = (node, course) => {
    const c = state.colourOf.get(courseKey(course));
    node.style.setProperty('--bg-c', `var(--c${c})`);
    node.style.setProperty('--edge-c', `var(--e${c})`);
    return node;
  };
  // Six-week courses (Q/R/S/T) say which weeks, e.g. "Sep 9–Oct 28".
  const weeksOf = course => {
    const [period] = periodsFor(course.number, state.terms);
    return period?.quarter ? `${shortDate(period.starts_on)}–${shortDate(period.ends_on)}` : '';
  };
  // Classes that overlap in time (like two six-week courses in the same slot)
  // sit side by side instead of on top of each other.
  const lanesFor = list => {
    const laneEnds = [];
    const placed = list.map(item => {
      const start = minutes(item.meeting.start);
      let lane = laneEnds.findIndex(end => end <= start);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = minutes(item.meeting.end);
      return { ...item, lane };
    });
    return placed.map(item => ({
      ...item,
      lanes: 1 + Math.max(...placed.filter(o => minutes(o.meeting.start) < minutes(item.meeting.end)
        && minutes(item.meeting.start) < minutes(o.meeting.end)).map(o => o.lane)),
    }));
  };
  const columns = days.map(day => el('div', { className: 'week-col' }, lanesFor(byDay(day)).map(({ course, meeting, lane, lanes }) => {
    const weeks = weeksOf(course);
    const block = colour(el('div', { className: 'block', attrs: { title: `${courseKey(course)} ${course.component} · ${clock(meeting.start)}–${clock(meeting.end)} · ${meeting.room}${weeks ? ` · ${weeks} only` : ''}` } }, [
      // Line 1: the course. Line 2: lecture/lab/tutorial and room (the time is
      // where the block sits). Six-week courses add which weeks.
      el('span', { className: 'block-code', text: courseKey(course) }),
      el('span', { className: 'block-meta', text: `${course.component} · ${meeting.room || 'No room'}` }),
      ...(weeks ? [el('span', { className: 'block-meta', text: `${weeks} only` })] : []),
    ]), course);
    block.style.top = `${((minutes(meeting.start) - startHour * 60) / span) * 100}%`;
    block.style.height = `calc(${((minutes(meeting.end) - minutes(meeting.start)) / span) * 100}% - 4px)`;
    if (lanes > 1) {
      block.classList.add('narrow');
      block.style.left = `calc(${(lane / lanes) * 100}% + 3px)`;
      block.style.right = `calc(${((lanes - lane - 1) / lanes) * 100}% + 3px)`;
    }
    block.style.setProperty('--tilt', `${((order * 37) % 5 - 2) * 0.35}deg`);  // a slight, varied tilt like real sticky notes
    block.style.animationDelay = `${Math.min(order++ * 35, 600)}ms`;
    return block;
  })));
  week.replaceChildren(...header, times, ...columns);

  // The same classes as a list per day: shown on phones, and read out by
  // screen readers on every screen size (the timetable above is visual only).
  $('#day-list').replaceChildren(...days.filter(d => byDay(d).length).map(day => el('section', { className: 'day' }, [
    el('h4', { className: 'day-name', text: DAY_NAMES[day] }),
    el('ul', {}, byDay(day).map(({ course, meeting }) => colour(el('li', { className: 'day-item' }, [
      el('span', { className: 'day-time', text: `${clock(meeting.start)} – ${clock(meeting.end)}${weeksOf(course) ? ` (${weeksOf(course)} only)` : ''}` }),
      el('span', { className: 'day-course', text: `${courseKey(course)} ${course.component}` }),
      el('span', { className: 'day-room', text: meeting.room || 'No room listed' }),
    ]), course))),
  ])));
}
document.querySelectorAll('.term-tab').forEach(tab => tab.addEventListener('click', () => { state.tab = tab.dataset.term; renderWeek(); }));

// ["Wed, Sep 30 (National Day for Truth and Reconciliation)", "Oct 12–16 (Fall reading week)"]
function daysOff(term) {
  const days = [...(term.no_class_dates ?? [])].sort();
  if (!days.length) return [];
  const nextDay = iso => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
  const groups = [];
  for (const day of days) {
    const last = groups.at(-1);
    if (last && nextDay(last.end) === day) last.end = day; else groups.push({ start: day, end: day });
  }
  const parts = groups.map(({ start, end }) => {
    const when = start === end ? longDate(start)
      : start.slice(0, 7) === end.slice(0, 7) ? `${shortDate(start)}–${Number(end.slice(8))}` : `${shortDate(start)}–${shortDate(end)}`;
    const why = term.labels?.[start];
    return why ? `${when} (${why})` : when;
  });
  return parts;
}

// Counts every individual class, the days off skipped, and the next class from today.
function summarize(include, parts = 'all') {
  let total = 0;
  let skipped = 0;
  let next = null;
  const now = new Date();
  const nowKey = `${localDate(now)} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  for (const course of state.courses) {
    if (!partIncluded(course.component, parts)) continue;
    for (const term of periodsFor(course.number, state.terms, include)) {
      for (const meeting of course.meetings) {
        if (!meeting.start || !meeting.days.length) continue;
        // The same days the calendar file uses (every other week, first/last dates).
        for (const { iso, off } of meetingDays(course, meeting, term)) {
          if (off) { skipped++; continue; }
          total++;
          const key = `${iso} ${meeting.start}`;
          if (key > nowKey && (!next || key < next.key)) next = { key, iso, course, meeting };
        }
      }
    }
  }
  return { total, skipped, next };
}

/* ---------- labs and tutorials: every week or every other week, and when ---------- */

const labKey = c => [c.subject, c.number, c.component, c.section].join(' ');
// Which term(s) the person picked in "Which term". Labs, their dates and their
// counts only cover those terms.
const chosenTerms = () => chosen('include') ?? 'both';
const labTerms = course => periodsFor(course.number, state.terms, chosenTerms());
const labCourses = () => state.courses.filter(c =>
  isLabPart(c.component) && hasTime(c) && !whyNotPlaced(c.number) && labTerms(c).length > 0);

// The first and last day a lab would meet with no settings: the defaults.
function labBounds(course) {
  const plain = { ...course, repeat: undefined };
  const days = labTerms(course).flatMap(term =>
    course.meetings.filter(m => m.start && m.days.length).flatMap(m => meetingDays(plain, m, term)));
  const sorted = days.map(d => d.iso).sort();
  return { first: sorted[0], last: sorted.at(-1) };
}
function labCount(course) {
  return labTerms(course).reduce((n, term) =>
    n + course.meetings.filter(m => m.start && m.days.length)
      .reduce((k, m) => k + meetingDays(course, m, term).filter(d => !d.off).length, 0), 0);
}

function renderLabOptions() {
  const labs = labCourses();
  $('#parts-option').hidden = labs.length === 0;
  if (!labs.length) document.querySelector('input[name="parts"][value="all"]').checked = true;
  $('#labs-option').hidden = labs.length === 0 || chosen('parts') === 'lectures';
  const include = chosenTerms();
  $('#labs-term').textContent = include === 'fall' ? 'Showing your Fall term labs and tutorials.'
    : include === 'winter' ? 'Showing your Winter term labs and tutorials.'
    : 'Showing your labs and tutorials for both terms.';
  $('#labs-list').replaceChildren(...labs.map(course => {
    const bounds = labBounds(course);
    const repeat = course.repeat ?? {};
    const when = course.meetings.filter(m => m.start && m.days.length)
      .map(m => `${m.days.map(d => DAY_NAMES[d]).join(', ')} ${clock(m.start)}–${clock(m.end)}`).join(' · ');
    const every = el('select', { attrs: { 'aria-label': `How often ${courseKey(course)} ${course.component} meets` } }, [
      el('option', { text: 'Every week', attrs: { value: '1' } }),
      el('option', { text: 'Every other week', attrs: { value: '2' } }),
    ]);
    every.value = String(repeat.every ?? 1);
    const dateInput = (value, label) => el('input', { attrs: {
      type: 'date', min: bounds.first, max: bounds.last, value: value ?? '', 'aria-label': `${label} ${courseKey(course)} ${course.component}`,
    } });
    const inside = d => d && d >= bounds.first && d <= bounds.last ? d : null;
    const first = dateInput(inside(repeat.first) ?? bounds.first, 'First');
    const last = dateInput(inside(repeat.last) ?? bounds.last, 'Last');
    const count = el('p', { className: 'lab-count' });
    const row = el('li', { className: 'lab-row' }, [
      el('div', { className: 'lab-name' }, [
        el('b', { text: `${courseKey(course)} ${course.component} ${course.section}` }),
        el('span', { text: when }),
      ]),
      el('div', { className: 'lab-fields' }, [
        el('label', {}, [el('span', { text: 'How often' }), every]),
        el('label', {}, [el('span', { text: 'First one' }), first]),
        el('label', {}, [el('span', { text: 'Last one' }), last]),
      ]),
      count,
    ]);
    const showCount = () => {
      const n = labCount(course);
      count.classList.remove('warn');
      count.textContent = `${plural(n, course.component === 'TUT' ? 'tutorial' : 'lab')} in your calendar`
        + (every.value === '2' ? ', counting every other week from the first one' : '');
    };
    const update = () => {
      const f = first.value || bounds.first;
      const l = last.value || bounds.last;
      if (f > l) {
        count.textContent = 'The last one has to be on or after the first one.';
        count.classList.add('warn');
        return;
      }
      // A date left at the default stays "default", except a saved date from the
      // other term (hidden while only this term is picked), which is kept.
      const keep = (value, bound, old) => value !== bound ? value : old && !inside(old) ? old : null;
      const next = { every: Number(every.value), first: keep(f, bounds.first, course.repeat?.first), last: keep(l, bounds.last, course.repeat?.last) };
      if (next.every === 1 && !next.first && !next.last) delete course.repeat;
      else course.repeat = next;
      showCount();
      updateDownloadDetail();
    };
    for (const input of [every, first, last]) input.addEventListener('change', update);
    showCount();
    return row;
  }));
}
document.querySelectorAll('input[name="parts"]').forEach(r => r.addEventListener('change', () => {
  $('#labs-option').hidden = labCourses().length === 0 || chosen('parts') === 'lectures';
  updateDownloadDetail();
}));

function updateDownloadDetail() {
  const total = summarize(chosen('include'), chosen('parts') ?? 'all').total;
  updateFinishButtons();
  // Nothing to add (for example every course is online): say so instead of
  // offering an empty calendar file.
  $('#download').disabled = total === 0;
  $('#save-link').disabled = total === 0;
  $('#download-detail').textContent = total
    ? `${plural(total, 'class', 'classes')} will go into your calendar`
    : chosen('parts') !== 'all' && summarize(chosen('include')).total
      ? 'Nothing to add with this choice. Try "Everything" in What to add.'
    : chosen('include') === 'both'
      ? 'None of your classes have a set day and time, so there\'s nothing to add to a calendar.'
      : 'No classes with set times in this term. Try "Both" or the other term.';
}
document.querySelectorAll('input[name="include"]').forEach(r => r.addEventListener('change', () => {
  renderLabOptions();
  updateDownloadDetail();
}));

// Signed in: the main choice is a calendar link (saved, no file); a file is the
// second option. Guests just get the file.
function updateFinishButtons() {
  const signedIn = Boolean(state.user);
  const updating = signedIn && state.scheduleId && state.feed;
  $('#save-link').hidden = !signedIn;
  $('#link-explain').hidden = !signedIn;
  updateColourOption();
  $('#save-link-text').textContent = updating ? 'Update my schedule' : 'Save and get my calendar link';
  $('#link-explain').textContent = updating
    ? 'Your calendar link stays the same, so your calendar picks up the changes by itself.'
    : 'Add the link to your calendar app once. When your classes change, update them here and your calendar follows by itself.';
  $('#download').className = `${signedIn ? 'button-plain' : 'button-ink button-big'}`;
  $('#download-text').textContent = signedIn ? 'Download a calendar file instead' : 'Download calendar file';
}

function downloadCalendar() {
  const include = chosen('include');
  const alarmMinutes = state.app === 'google' ? 0 : Number($('#alarm').value);
  const parts = chosen('parts') ?? 'all';
  const { ics } = buildCalendar({ courses: state.courses, terms: state.terms, include, parts, alarmMinutes, calendarName: 'Western Classes' });
  const filename = `Western Classes ${state.academicYear}.ics`;
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const link = el('a', { attrs: { href: url, download: filename } });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  state.lastDownload = { mode: 'file', include, parts, alarmMinutes, filename, calendarColor: pickedColour() };
}
$('#download').addEventListener('click', () => {
  downloadCalendar();
  show('done');
  if (state.user) saveToAccount();
});
$('#save-link').addEventListener('click', () => {
  if (!state.user) return;
  const include = chosen('include');
  const alarmMinutes = state.app === 'google' ? 0 : Number($('#alarm').value);
  state.lastDownload = { mode: 'link', include, parts: chosen('parts') ?? 'all', alarmMinutes, calendarColor: pickedColour(), hadFeed: Boolean(state.scheduleId && state.feed) };
  state.saveResult = null;
  show('done');
  saveToAccount();
});
$('#download-again').addEventListener('click', downloadCalendar);

/* ================= 4. done ================= */

const APP_NAMES = { apple: 'Apple Calendar', google: 'Google Calendar', outlook: 'Outlook', other: 'your calendar app' };

function renderDone() {
  const { mode, include, parts, alarmMinutes, filename, hadFeed } = state.lastDownload;
  const linkMode = mode === 'link';
  const { total, skipped, next } = summarize(include, parts);
  $('#done-title').textContent = !linkMode ? 'Your calendar file is ready'
    : hadFeed ? 'Your schedule is updated' : 'Your calendar link is ready';
  $('#done-file').textContent = !linkMode
    ? `“${filename}” is in your downloads. Here's what's inside, and how to add it to ${APP_NAMES[state.app]}.`
    : hadFeed
      ? 'Your calendar picks up the changes by itself within a few hours (Google can take up to a day). There\'s nothing else to do.'
      : `Add the link below to ${APP_NAMES[state.app]} once. After that, your calendar keeps itself up to date.`;
  $('#howto').hidden = linkMode;
  $('#download-again').hidden = linkMode;

  // The results, as sticky notes.
  const termText = { both: 'fall + winter', fall: 'fall term', winter: 'winter term' }[include];
  const notes = [
    [total.toLocaleString(), `classes added (${termText})`],
    [String(skipped), 'skipped for reading weeks & holidays'],
    state.app === 'google'
      ? ['Off', 'add reminders in Google (step 4 below)']
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
    $('#next-what').replaceChildren(
      `${courseKey(next.course)} ${next.course.component}${next.course.title ? `, ${next.course.title}` : ''}`,
      ...(next.meeting.room ? [' · ', el('span', { className: 'nowrap', text: next.meeting.room })] : []));
  }

  renderAccountDone();
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

/* ================= accounts: saved schedules ================= */

const fmtDate = iso => new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });

async function loadMySchedules() {
  const status = $('#my-status');
  status.textContent = '';
  let schedules;
  try {
    ({ schedules } = await api('/schedules'));
  } catch {
    $('#my-schedules').hidden = true;
    return;
  }
  state.myNames = schedules.map(s => s.name);
  $('#my-schedules').hidden = schedules.length === 0;
  $('#welcome-lede').textContent = schedules.length
    ? 'Open a saved schedule to update it, or start a new one.'
    : 'Start a new schedule. It will be saved here so you can update it later.';
  $('#my-list').replaceChildren(...schedules.map(schedule => {
    const open = el('button', { className: 'button-plain my-open', text: 'Open', attrs: { type: 'button' } });
    open.addEventListener('click', () => openSavedSchedule(schedule.id));
    const remove = el('button', { className: 'link-button my-delete', text: 'Delete', attrs: { type: 'button' } });
    remove.addEventListener('click', () => confirmThen(remove, 'Click again to delete', async () => {
      try {
        await api(`/schedules/${schedule.id}`, { method: 'DELETE' });
        if (state.scheduleId === schedule.id) resetSchedulePage();
        loadMySchedules();
      } catch (err) {
        status.textContent = err.message;
      }
    }));
    const rename = el('button', { className: 'link-button my-delete', text: 'Rename', attrs: { type: 'button' } });
    const name = el('span', { className: 'my-name', text: schedule.name });
    rename.addEventListener('click', () => startRename(name, schedule));
    const meta = [plural(schedule.courseCount, 'course'), ...(schedule.hasFeed ? ['calendar link on'] : []), `updated ${fmtDate(schedule.updatedAt)}`];
    return el('li', { className: 'my-item' }, [
      name,
      el('span', { className: 'my-meta', text: meta.join(' · ') }),
      el('span', { className: 'my-actions' }, [open, rename, remove]),
    ]);
  }));
}

// Renaming happens right in the list: the name turns into a text box.
function startRename(nameNode, schedule) {
  const input = el('input', { attrs: { type: 'text', maxlength: '60', 'aria-label': 'New name' } });
  input.value = schedule.name;
  const save = el('button', { className: 'link-button', text: 'Save', attrs: { type: 'button' } });
  const cancel = el('button', { className: 'link-button my-delete', text: 'Cancel', attrs: { type: 'button' } });
  const form = el('span', { className: 'my-rename' }, [input, save, cancel]);
  nameNode.replaceWith(form);
  input.focus();
  input.select();
  const finish = async keep => {
    const newName = input.value.trim();
    if (!keep || !newName || newName === schedule.name) return loadMySchedules();
    try {
      await api(`/schedules/${schedule.id}`, { method: 'PATCH', body: { name: newName } });
      if (state.scheduleId === schedule.id) state.scheduleName = newName;
    } catch (err) {
      $('#my-status').textContent = err.message;
    }
    loadMySchedules();
  };
  save.addEventListener('click', () => finish(true));
  cancel.addEventListener('click', () => finish(false));
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') finish(true);
    if (event.key === 'Escape') finish(false);
  });
}

// A new schedule gets a name that isn't taken yet: "Fall/Winter 2026-27 (2)".
function newScheduleName() {
  const base = `Fall/Winter ${state.academicYear}`;
  let name = base;
  for (let n = 2; state.myNames.includes(name); n++) name = `${base} (${n})`;
  return name;
}

// A button that needs a second click to confirm (no pop-up windows).
function confirmThen(button, confirmText, action) {
  button.dataset.original ??= button.textContent;
  const original = button.dataset.original;
  if (button.dataset.armed) {
    delete button.dataset.armed;
    button.textContent = original;
    button.classList.remove('confirm');
    action();
    return;
  }
  button.dataset.armed = '1';
  button.textContent = confirmText;
  button.classList.add('confirm');
  setTimeout(() => {
    if (!button.dataset.armed) return;
    delete button.dataset.armed;
    button.textContent = original;
    button.classList.remove('confirm');
  }, 4000);
}

async function openSavedSchedule(id) {
  const status = $('#my-status');
  status.textContent = 'Opening…';
  let schedule;
  try {
    ({ schedule } = await api(`/schedules/${id}`));
  } catch (err) {
    status.textContent = err.message;
    return;
  }
  let feed = null;
  try { ({ feed } = await api(`/schedules/${id}/feed`)); } catch { /* shown as "no link" */ }
  status.textContent = '';
  const year = TERM_DATES[schedule.academicYear] ? schedule.academicYear : LATEST_YEAR;
  Object.assign(state, {
    started: true,
    courses: schedule.courses,
    academicYear: year,
    terms: TERM_DATES[year],
    scheduleId: schedule.id,
    scheduleName: schedule.name,
    lastDownload: null,
    saveResult: null,
    feed,
  });
  // Bring back the settings saved with it.
  const include = document.querySelector(`input[name="include"][value="${schedule.includeTerms}"]`);
  if (include) include.checked = true;
  if ([...$('#alarm').options].some(o => o.value === String(schedule.alarmMinutes))) $('#alarm').value = String(schedule.alarmMinutes);
  pickColour(schedule.calendarColor);
  const parts = document.querySelector(`input[name="parts"][value="${schedule.includeParts ?? 'all'}"]`);
  if (parts) parts.checked = true;
  renderLabOptions();
  if (schedule.calendarApp) {
    state.app = schedule.calendarApp;
    const radio = document.querySelector(`input[name="app"][value="${schedule.calendarApp}"]`);
    if (radio) { radio.checked = true; $('#app-next').disabled = false; }
    updateReminderOption();
  }

  collapseGuide(`Opened “${schedule.name}” from your account`);
  $('#dropzone').classList.remove('loaded');
  $('.drop-title').replaceChildren('To update these classes, drag in your new DraftMySchedule file or ', el('u', { text: 'choose it' }));
  $('.drop-detail').textContent = 'The University of Western Ontario.html';
  setStatus(feed
    ? `Opened “${schedule.name}”. Add your new file above if your classes changed, then click Update my schedule.`
    : `Opened “${schedule.name}”. Add your new file above if your classes changed, then save it below.`, 'ok');
  renderCheck([]);
  $('#check-part').hidden = false;
  updateDownloadDetail();
  show(state.app ? 'schedule' : 'app');
}

/* ================= accounts: saving + calendar link ================= */

// Saves run one after another, so a second download while the first save is
// still going updates the same schedule instead of creating a duplicate.
let savingQueue = Promise.resolve();
function saveToAccount() {
  savingQueue = savingQueue.then(saveNow, saveNow);
  return savingQueue;
}

async function saveNow() {
  if (!state.user || !state.lastDownload) return;
  const body = {
    name: state.scheduleName ?? newScheduleName(),
    academicYear: state.academicYear,
    courses: state.courses,
    includeTerms: state.lastDownload.include,
    includeParts: state.lastDownload.parts ?? 'all',
    alarmMinutes: state.lastDownload.alarmMinutes,
    calendarApp: state.app,
    calendarColor: state.lastDownload.calendarColor ?? null,
  };
  state.saveResult = { pending: true };
  renderAccountDone();
  try {
    const { schedule } = state.scheduleId
      ? await api(`/schedules/${state.scheduleId}`, { method: 'PATCH', body })
      : await api('/schedules', { method: 'POST', body });
    Object.assign(state, { scheduleId: schedule.id, scheduleName: schedule.name });
    state.saveResult = { ok: true };
  } catch (err) {
    state.saveResult = { ok: false, message: err instanceof ApiUnavailable ? "Your account isn't reachable right now, so this schedule wasn't saved. Your downloaded file still works." : err.message };
  }
  if (state.saveResult.ok) {
    try {
      // "Save and get my calendar link" makes the link if there isn't one yet
      // (asking again just returns the existing link).
      ({ feed: state.feed } = state.lastDownload.mode === 'link'
        ? await api(`/schedules/${state.scheduleId}/feed`, { method: 'POST' })
        : await api(`/schedules/${state.scheduleId}/feed`));
    } catch {
      state.feed = null;  // the schedule is saved; the link part just couldn't load
    }
  }
  renderAccountDone();
}

function renderAccountDone() {
  const signedIn = Boolean(state.user);
  const linkMode = state.lastDownload?.mode === 'link';
  const hadFeed = Boolean(state.lastDownload?.hadFeed);
  $('#account-done').hidden = !signedIn;
  $('#check-note').textContent = signedIn && linkMode
    ? 'Something not right? Compare a few classes with DraftMySchedule. When your classes change, open this schedule from page 1, add the new file and click Update my schedule.'
    : 'Something not right? Compare a few classes with DraftMySchedule. If your schedule changes later, come back and make a new file.';
  $('#file-also-link').hidden = true;
  if (!signedIn) return;

  const note = $('#saved-note');
  const result = state.saveResult;
  note.classList.toggle('warn', Boolean(result && result.ok === false));
  note.textContent = !result || result.pending ? 'Saving to your account…'
    : result.ok ? (hadFeed ? `✓ Updated “${state.scheduleName}”` : `✓ Saved to your account as “${state.scheduleName}”`)
    : result.message;
  // The link card belongs to "Save and get my calendar link". After a file
  // download, only warn if this schedule also has a link (or classes show twice).
  $('#feed-card').hidden = !(result?.ok && linkMode);
  $('#file-also-link').hidden = !(result?.ok && !linkMode && state.feed);
  $('#feed-title').textContent = hadFeed ? 'Your calendar link' : `Add your calendar link to ${APP_NAMES[state.app]}`;

  $('#feed-off').hidden = Boolean(state.feed);
  $('#feed-on').hidden = !state.feed;
  if (state.feed) {
    $('#feed-url').value = state.feed.url;
    $('#feed-apple-open').href = state.feed.webcalUrl;
    for (const name of ['apple', 'google', 'outlook', 'other']) $(`#feed-steps-${name}`).hidden = name !== state.app;
  }
}

async function feedAction(path, method, doneMessage) {
  const status = $('#feed-status');
  status.textContent = '';
  try {
    const result = await api(`/schedules/${state.scheduleId}/${path}`, { method });
    state.feed = result?.feed ?? null;
    renderAccountDone();
    status.textContent = doneMessage;
  } catch (err) {
    status.textContent = err.message;
  }
}
$('#feed-create').addEventListener('click', () => feedAction('feed', 'POST', 'Your link is ready. Copy it, then follow the steps above.'));
$('#feed-reset').addEventListener('click', event => confirmThen(event.currentTarget, 'Click again: the old link will stop working',
  () => feedAction('feed/reset', 'POST', 'New link made. The old one no longer works, so subscribe again with this one.')));
$('#feed-delete').addEventListener('click', event => confirmThen(event.currentTarget, 'Click again to turn it off',
  () => feedAction('feed', 'DELETE', 'Link turned off. Calendars subscribed to it will stop updating.')));
$('#feed-copy').addEventListener('click', async () => {
  const button = $('#feed-copy');
  try {
    await navigator.clipboard.writeText($('#feed-url').value);
    button.textContent = 'Copied ✓';
  } catch {
    $('#feed-url').select();
    button.textContent = 'Press ⌘/Ctrl + C';
  }
  setTimeout(() => { button.textContent = 'Copy'; }, 2500);
});

/* ================= dialogs: privacy, account, passwords ================= */

document.querySelectorAll('[data-open="privacy"]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  $('#dialog-privacy').showModal();
}));
// "Report a problem" opens as a dialog, so nobody leaves the page or loses
// their progress. A fresh form each time; a link can pre-pick the step.
document.querySelectorAll('[data-open="report"]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  const dialog = $('#dialog-report');
  mountReportForm($('#report-root'), {
    step: button.dataset.step ?? '',
    buttonClass: 'button-ink',
    doneHtml: '<p><button type="button" class="button-plain" data-report-done>Back to Slotted</button></p>',
    onDone: () => dialog.close(),
  });
  dialog.showModal();
  dialog.querySelector('textarea').focus();
}));
// Clicking the dark area around a dialog closes it.
document.querySelectorAll('.paper-dialog').forEach(dialog => dialog.addEventListener('click', event => {
  if (event.target === dialog) dialog.close();
}));

function formStatus(form, text) {
  form.querySelector('.form-status').textContent = text;
}

function openAccountDialog() {
  if (!state.user) return;
  $('#account-email').textContent = state.user.email;
  const form = $('#delete-form');
  form.reset();
  formStatus(form, '');
  // Accounts made with Google have no password to type.
  $('#delete-password-label').hidden = state.user.hasPassword === false;
  $('#danger-zone').open = false;
  $('#dialog-account').showModal();
}
$('#account-signout').addEventListener('click', signOut);

$('#delete-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const password = form.elements.password.value;
  if (state.user.hasPassword !== false && !password) return formStatus(form, 'Type your password to confirm.');
  button.disabled = true;
  formStatus(form, 'Deleting…');
  try {
    await api('/auth/account', { method: 'DELETE', body: state.user.hasPassword === false ? {} : { password } });
    $('#dialog-account').close();
    signedOut();
    resetSchedulePage();
    state.started = false;
    welcomeMessage('Your account and everything saved in it has been deleted.');
    show('welcome');
  } catch (err) {
    formStatus(form, err.message);
  } finally {
    button.disabled = false;
  }
});

$('#forgot-open').addEventListener('click', () => {
  const form = $('#forgot-form');
  form.reset();
  formStatus(form, '');
  form.elements.email.value = $('#form-signin').elements.email.value;
  $('#dialog-forgot').showModal();
});
$('#forgot-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  formStatus(form, 'Sending…');
  try {
    await api('/auth/forgot', { method: 'POST', body: { email: form.elements.email.value } });
    formStatus(form, "If that email has a Slotted account, a reset link is on its way. Check your spam folder too. The link works for one hour.");
  } catch (err) {
    formStatus(form, err instanceof ApiUnavailable ? "Accounts aren't available right now. Please try again later." : err.message);
  }
});

function openResetDialog(token) {
  const form = $('#reset-form');
  form.dataset.token = token;
  $('#dialog-reset').showModal();
}
$('#reset-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  formStatus(form, 'Saving…');
  try {
    const { user } = await api('/auth/reset', { method: 'POST', body: { token: form.dataset.token, password: form.elements.password.value } });
    $('#dialog-reset').close();
    signedIn(user);
    show('welcome');
  } catch (err) {
    formStatus(form, err.message);
  }
});

/* ================= start ================= */

// Things that arrive in the address bar: a password-reset link, or the return
// from Google sign-in. Read them, then remove them from the address
// so they don't stay in the browser history.
const params = new URLSearchParams(location.search);
const resetToken = params.get('reset');
const returnedFromSignIn = params.get('signed_in') === '1';
const signInError = params.get('signin_error');
if (location.search) history.replaceState(null, '', location.pathname + location.hash);

const SIGN_IN_ERRORS = {
  cancelled: 'Sign-in was cancelled.',
  expired: 'That sign-in took too long or was interrupted. Please try again.',
  email_taken: 'An account with that email already exists. Sign in with your email and password instead.',
  no_email: "That account didn't share an email address, so Slotted can't create an account with it.",
  unverified_email: "Google hasn't confirmed the email on that account yet, so Slotted can't use it. Confirm it with Google, or sign up with your email and a password.",
  unavailable: "That sign-in option isn't available right now.",
  failed: 'Something went wrong signing in. Please try again.',
};
// The API said the sign-in has ended (expired, or signed out somewhere else).
window.addEventListener('slotted:signed-out', () => {
  if (!state.user) return;
  signedOut();
  show('welcome');
  showSignInForms(true);
  welcomeMessage('Your sign-in has ended. Please sign in again.');
});

if (signInError) {
  showSignInForms(true);
  welcomeMessage(SIGN_IN_ERRORS[signInError] ?? SIGN_IN_ERRORS.failed);
  state.started = false;
}

// Already signed in from an earlier visit? (Fails quietly if accounts are offline.)
api('/auth/me').then(({ user }) => {
  if (user) {
    signedIn(user);
    state.started = returnedFromSignIn || state.started;
    if (returnedFromSignIn) show('welcome');
  } else {
    state.user = null;
    applyTheme(currentTheme());  // guests keep whatever they chose in this browser
    renderAccountChip();
  }
  renderWelcome();
}).catch(() => {});

// Show "Continue with Google" only if it's set up on the server.
api('/auth/providers').then(providers => {
  $('#oauth-google').href = `${API_URL}/auth/google/start`;
  $('#oauth-google').hidden = !providers?.google;
  $('#oauth-buttons').hidden = !providers?.google;
}).catch(() => {});

if (resetToken) openResetDialog(resetToken);
if (signInError) show('welcome', { push: false });

show(location.hash.slice(1) || 'cover', { push: false });
