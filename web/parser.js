// Reads a saved DraftMySchedule page. Runs only in the browser: the file is
// never uploaded anywhere.
//
// Safety: DOMParser builds a document that is never displayed and never runs
// scripts, so even a booby-trapped file can't do anything. We only pull plain
// text out of table cells.

const DAY_TOKENS = new Set(['M', 'Tu', 'W', 'Th', 'F', 'Sa', 'Su']);
const ROMAN = /^(I|II|III|IV|V|VI|VII|VIII|IX|X)$/;

export class ScheduleReadError extends Error {}

const clean = text => text.replace(/\s+/g, ' ').trim();
const cellText = cell => clean(cell.textContent);
const clip = (text, max) => text.slice(0, max);

// "02:30 PM" -> "14:30"
function to24h(text) {
  const m = /^(\d{1,2}):(\d{2})\s*([AP]M)$/i.exec(text.trim());
  if (!m) return null;
  let hour = Number(m[1]) % 12;
  if (m[3].toUpperCase() === 'PM') hour += 12;
  return `${String(hour).padStart(2, '0')}:${m[2]}`;
}

// "PROGRAMMING MY DIGITAL LIFE" -> "Programming My Digital Life"
function titleCase(text) {
  return text.toLowerCase().split(' ')
    .map(w => (ROMAN.test(w.toUpperCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

// The class list is the table whose header has a "Days/Times/Location" column.
function findClassTable(doc) {
  return [...doc.querySelectorAll('table')].find(table => {
    const header = table.rows[0];
    return header && [...header.cells].some(c => !c.querySelector('table') && cellText(c).includes('Days/Times/Location'));
  });
}

/**
 * @param {string} html  the saved page's text
 * @returns {{ courses: object[], academicYear: string|null, notes: string[] }}
 */
export function readSchedule(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = findClassTable(doc);
  if (!table) {
    throw new ScheduleReadError("This file doesn't contain a DraftMySchedule class list.");
  }

  // The heading "Class List for <name> - Fall/Winter 2026" says which session
  // this is. (Read the heading, not the first "Fall/Winter" on the page: the
  // term menu near the top lists other years too.)
  const pageText = clean(doc.body?.textContent ?? '');
  const heading = /Class List for [\s\S]*?-\s*(Fall\/Winter|Summer|Intersession)\s+(\d{4})/i.exec(pageText);
  if (heading && !/^Fall\/Winter$/i.test(heading[1])) {
    const err = new ScheduleReadError(`This is your ${heading[1]} ${heading[2]} schedule. Slotted only works with Fall/Winter schedules. In DraftMySchedule, switch the term to Fall/Winter, then save the My Current Schedule page again.`);
    err.complete = true;  // the message already says what to do
    throw err;
  }
  const startYear = heading?.[2] ?? /Fall\/Winter\s+(\d{4})/i.exec(pageText)?.[1];
  // "2026" -> school year "2026-27"
  const academicYear = startYear
    ? `${startYear}-${String((Number(startYear) + 1) % 100).padStart(2, '0')}`
    : null;

  const headers = [...table.rows[0].cells].map(cellText);
  const col = name => headers.indexOf(name);
  const get = (row, name) => {
    const i = col(name);
    return i >= 0 && row.cells[i] ? row.cells[i] : null;
  };
  const text = (row, name) => (get(row, name) ? cellText(get(row, name)) : '');

  const courses = [];
  const notes = [];
  for (const row of [...table.rows].slice(1)) {
    const subject = text(row, 'Subject').toUpperCase().replace(/[^A-Z]/g, '');
    const number = text(row, 'Course Number').toUpperCase();
    if (!subject) continue;
    if (!/^[A-Z]{2,10}$/.test(subject) || !/^\d{4}[A-Z]?$/.test(number)) {
      notes.push(`Skipped a row that didn't look like a course (${clip(`${subject} ${number}`, 30)}).`);
      continue;
    }

    const timesCell = get(row, 'Days/Times/Location');
    const inner = timesCell?.querySelector('table');
    const meetings = inner
      ? [...inner.rows].map(r => {
        const [days = '', time = '', room = ''] = [...r.cells].map(cellText);
        const [startText = '', endText = ''] = time.split('-');
        const start = to24h(startText);
        const end = to24h(endText);
        const validTime = start && end && end > start;
        return {
          days: days.split(' ').filter(d => DAY_TOKENS.has(d)),
          start: validTime ? start : null,
          end: validTime ? end : null,
          room: clip(room, 40),
        };
      })
      : [];
    if (!meetings.length) meetings.push({ days: [], start: null, end: null, room: '' });

    const status = text(row, 'Status');
    if (status && status.toUpperCase() !== 'ENROLLED') {
      notes.push(`${subject} ${number} ${text(row, 'Component')} is marked "${clip(status, 20)}", not enrolled. It's still included.`);
    }

    courses.push({
      subject,
      number,
      component: clip(text(row, 'Component').toUpperCase().replace(/[^A-Z]/g, ''), 4) || 'LEC',
      section: clip(text(row, 'Section').toUpperCase().replace(/[^0-9A-Z]/g, ''), 4) || '1',
      title: clip(titleCase(text(row, 'Description')), 100),
      classNbr: clip(text(row, 'Class Nbr').replace(/\D/g, ''), 6),
      instructor: clip(text(row, 'Instructor'), 60),
      delivery: clip(text(row, 'Delivery Type'), 40),
      meetings: meetings.slice(0, 10),
    });
  }

  if (!courses.length) {
    throw new ScheduleReadError('The class list in this file is empty.');
  }
  if (courses.length > 40) {
    notes.push('Only the first 40 rows were used.');
  }
  return { courses: courses.slice(0, 40), academicYear, notes };
}
