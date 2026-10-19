// Turns a list of classes into an iCalendar (.ics) file.
//
// This file is "shared": the webpage uses it to make files for guests, and the
// API uses it to serve subscription links. So it must work in BOTH the browser
// and Node.js — no `document`, no `fs`, no packages. Just plain JavaScript.
//
// A course looks like this (the webpage's reader produces it):
//   { subject: 'COMPSCI', number: '2211A', component: 'LEC', section: '001',
//     title: 'Software Tools', classNbr: '10755', instructor: 'Smith',
//     delivery: 'In Person',
//     meetings: [{ days: ['Tu', 'Th'], start: '10:30', end: '12:30', room: 'NSC-1' }] }
//
// A term looks like this (a row from the `terms` table):
//   { season: 'fall', starts_on: '2026-09-09', ends_on: '2026-12-09',
//     no_class_dates: ['2026-09-30', ...] }

const DAYS = { Su: 0, M: 1, Tu: 2, W: 3, Th: 4, F: 5, Sa: 6 };
const ICAL_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// The letter at the end of a Western course number says when it runs.
// Source: Western's Academic Calendar, "Course Numbering".
//   no letter, E          full course: fall + winter
//   A, F, W               first term (fall)        (W = accelerated full course)
//   B, G, X               second term (winter)     (X = accelerated full course)
//   Q, R                  6-week quarter: first / second half of fall
//   S, T                  6-week quarter: first / second half of winter
//   Y, Z, U, L            outside the regular Fall/Winter session (e.g. summer)
//   anything else         unusual (Law, Nursing, Education); we can't tell, so we say so
const SUFFIX_RUNS = {
  '': ['fall', 'winter'], E: ['fall', 'winter'],
  A: ['fall'], F: ['fall'], W: ['fall'], Q: ['fall'], R: ['fall'],
  B: ['winter'], G: ['winter'], X: ['winter'], S: ['winter'], T: ['winter'],
};
const QUARTERS = new Set(['Q', 'R', 'S', 'T']);
const OUTSIDE_SESSION = new Set(['Y', 'Z', 'U', 'L']);
const suffixOf = courseNumber => (/[A-Z]$/i.test(courseNumber) ? courseNumber.slice(-1).toUpperCase() : '');

const TIMEZONE = `BEGIN:VTIMEZONE
TZID:America/Toronto
BEGIN:DAYLIGHT
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
TZNAME:EDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
TZNAME:EST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE`.split('\n');

/* ---------- small helpers ---------- */

// Dates are handled as plain 'YYYY-MM-DD' calendar days. Using UTC for the math
// means the computer's own time zone can never shift a class to the wrong day.
function toDate(isoDay) {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function addDays(date, n) {
  return new Date(date.getTime() + n * 86_400_000);
}
function ymd(date) {
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}
function hhmmss(time) {               // '14:30' -> '143000'
  return time.replace(':', '') + '00';
}

// iCalendar treats , ; \ and newlines as special, so they must be escaped.
function escapeText(text) {
  return String(text)
    .replaceAll('\\', '\\\\').replaceAll(';', '\\;')
    .replaceAll(',', '\\,').replace(/\r\n?|\n/g, '\\n');
}

// Lines may be at most 75 bytes; longer ones continue on the next line after a space.
const encoder = new TextEncoder();
const decoder = new TextDecoder();
function fold(line) {
  let bytes = encoder.encode(line);
  if (bytes.length <= 75) return line;
  const parts = [];
  let limit = 75;
  while (bytes.length > limit) {
    let cut = limit;
    while ((bytes[cut] & 0xc0) === 0x80) cut--;  // don't split a multi-byte character (é, –)
    parts.push(decoder.decode(bytes.slice(0, cut)));
    bytes = bytes.slice(cut);
    limit = 74;                                   // continuation lines start with a space
  }
  parts.push(decoder.decode(bytes));
  return parts.join('\r\n ');
}

// A short, stable ID from text. The same class always gets the same UID, so
// calendar apps update an event instead of duplicating it. (FNV-1a hash.)
function stableId(text) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export function seasonsFor(courseNumber) {
  return SUFFIX_RUNS[suffixOf(courseNumber)] ?? [];
}

// Why a course can't be placed in Fall/Winter, or null if it can.
export function whyNotPlaced(courseNumber) {
  const letter = suffixOf(courseNumber);
  if (SUFFIX_RUNS[letter]) return null;
  if (OUTSIDE_SESSION.has(letter)) return 'runs outside the Fall/Winter terms (for example in summer)';
  return `has an unusual course letter (${letter}), so Slotted can't tell which term it's in`;
}

// The stretches of time a course runs in, as term-shaped objects
// { season, starts_on, ends_on, no_class_dates }. Usually one or two whole
// terms; a quarter course (Q/R/S/T) gets just its six weeks, using the
// term's "quarters" dates when they are known.
export function periodsFor(courseNumber, terms, include = 'both') {
  const letter = suffixOf(courseNumber);
  const out = [];
  for (const season of seasonsFor(courseNumber)) {
    if (include !== 'both' && include !== season) continue;
    const term = terms.find(t => t.season === season);
    if (!term) continue;
    const quarter = QUARTERS.has(letter) ? term.quarters?.[letter] : null;
    if (quarter) {
      const [starts, ends] = quarter;
      out.push({ ...term, starts_on: starts, ends_on: ends, quarter: letter,
        no_class_dates: (term.no_class_dates ?? []).filter(d => d >= starts && d <= ends) });
    } else {
      out.push(term);
    }
  }
  return out;
}

/* ---------- labs, tutorials and how often they meet ---------- */

// Labs and tutorials can be left out, or added on their own, and can run every
// other week or only between certain dates. Everything else is a "lecture".
const LAB_PARTS = new Set(['LAB', 'TUT']);
export const isLabPart = component => LAB_PARTS.has(String(component).toUpperCase());

// parts: 'all' | 'lectures' | 'labs'
export function partIncluded(component, parts = 'all') {
  if (parts === 'lectures') return !isLabPart(component);
  if (parts === 'labs') return isLabPart(component);
  return true;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const isoOf = date => date.toISOString().slice(0, 10);
// Monday of the week a date is in (calendar apps count "every other week"
// in Monday-to-Sunday weeks, so we do too).
const mondayOf = date => addDays(date, -((date.getUTCDay() + 6) % 7));

// When one meeting of a course actually happens within one term, after the
// course's own settings: course.repeat = { every: 1 | 2, first: 'YYYY-MM-DD'
// or null, last: 'YYYY-MM-DD' or null }. Returns null if it never happens.
//   first  the first day it meets (also the week "every other week" counts from)
//   until  the last possible day
export function meetingWindow(course, meeting, term) {
  const weekdays = (meeting.days ?? []).map(d => DAYS[d]).filter(d => d !== undefined);
  if (!weekdays.length) return null;
  const repeat = course.repeat ?? {};
  let start = term.starts_on;
  let end = term.ends_on;
  if (ISO_DAY.test(repeat.first ?? '') && repeat.first > start) start = repeat.first;
  if (ISO_DAY.test(repeat.last ?? '') && repeat.last < end) end = repeat.last;
  let first = toDate(start);
  while (!weekdays.includes(first.getUTCDay())) first = addDays(first, 1);
  if (isoOf(first) > end) return null;
  return { weekdays, first, until: toDate(end), every: repeat.every === 2 ? 2 : 1 };
}

// Every day a meeting COULD land on in one term (each week on its weekdays),
// as [{ iso, off }]. Used to show all the possible lab days to pick from.
export function possibleDays(meeting, term) {
  const weekdays = (meeting.days ?? []).map(d => DAYS[d]).filter(d => d !== undefined);
  const off = new Set(term.no_class_dates ?? []);
  const out = [];
  for (let d = toDate(term.starts_on); isoOf(d) <= term.ends_on; d = addDays(d, 1)) {
    if (weekdays.includes(d.getUTCDay())) out.push({ iso: isoOf(d), off: off.has(isoOf(d)) });
  }
  return out;
}

// The days a lab or tutorial actually happens in one term, sorted.
//
//   repeat.dates          picked by hand: exactly those days (minus days off)
//   otherwise             a pattern: every week or every other week, from the
//                         first day to the last day. A lab that lands on a
//                         holiday or reading week is PUSHED BACK a week, and
//                         the ones after it move back too (every other week
//                         keeps alternating from the moved one), but never
//                         past the last day.
export function labDays(course, meeting, term) {
  return labPlan(course, meeting, term).days;
}

// labDays, plus `pushed`: the days off that pushed later labs back a week,
// and `lost`: how many were pushed past the end of the term.
export function labPlan(course, meeting, term) {
  const possible = possibleDays(meeting, term);
  const repeat = course.repeat ?? {};
  if (Array.isArray(repeat.dates)) {
    const picked = new Set(repeat.dates);
    return { days: possible.filter(d => picked.has(d.iso) && !d.off).map(d => d.iso), pushed: [], lost: 0 };
  }
  const window = meetingWindow(course, meeting, term);
  if (!window) return { days: [], pushed: [], lost: 0 };
  const start = isoOf(window.first);
  const end = isoOf(window.until);
  const every = window.every;
  const firstWeek = mondayOf(window.first).getTime();
  const weekOf = iso => Math.round((mondayOf(toDate(iso)).getTime() - firstWeek) / (7 * 86_400_000));
  const out = [];
  const pushed = [];
  let lost = 0;      // pushed past the end of the term, so left out
  // Each weekday is its own run (a lab that meets Tuesday and Thursday is two runs).
  for (const weekday of window.weekdays) {
    const run = possible.filter(d => toDate(d.iso).getUTCDay() === weekday);
    // How many labs the pattern has, as if there were no days off.
    const planned = run.filter(d => d.iso >= start && d.iso <= end && weekOf(d.iso) % every === 0);
    if (!planned.length) continue;
    let i = run.findIndex(d => d.iso === planned[0].iso);
    let placed = 0;
    // Never past the last day the person chose (or the end of the term).
    while (placed < planned.length && i < run.length && run[i].iso <= end) {
      if (run[i].off) { pushed.push(run[i].iso); i++; continue; }  // a day off: try the same day next week
      out.push(run[i].iso);
      placed++;
      i += every;
    }
    lost += planned.length - placed;
  }
  return { days: out.sort(), pushed: pushed.sort(), lost };
}

// Every day the meeting lands on in one term, as [{ iso, off }]
// (off = a holiday or reading-week day, so the class doesn't happen).
// Matches exactly what the calendar file produces. Labs and tutorials only
// list the days they really happen (see labDays).
export function meetingDays(course, meeting, term) {
  if (isLabPart(course.component)) return labDays(course, meeting, term).map(iso => ({ iso, off: false }));
  const window = meetingWindow(course, meeting, term);
  if (!window) return [];
  const { weekdays, first, until, every } = window;
  const firstWeek = mondayOf(first).getTime();
  const off = new Set(term.no_class_dates ?? []);
  const out = [];
  for (let d = first; d <= until; d = addDays(d, 1)) {
    if (!weekdays.includes(d.getUTCDay())) continue;
    const weeks = Math.round((mondayOf(d).getTime() - firstWeek) / (7 * 86_400_000));
    if (weeks % every !== 0) continue;
    out.push({ iso: isoOf(d), off: off.has(isoOf(d)) });
  }
  return out;
}

/* ---------- the main function ---------- */

/**
 * @param {object}   options
 * @param {object[]} options.courses       classes from the schedule reader
 * @param {object[]} options.terms         term rows (fall and/or winter)
 * @param {'fall'|'winter'|'both'} [options.include]
 * @param {'all'|'lectures'|'labs'} [options.parts]  leave out labs/tutorials, or add only them
 * @param {number}   [options.alarmMinutes] 0 = no reminder
 * @param {string}   [options.calendarName]
 * @param {Date}     [options.now]          only used for the DTSTAMP field
 * @param {number}   [options.refreshHours] for subscriptions: how often apps should re-check
 * @param {string}   [options.calendarColor] '#RRGGBB'; a hint Apple Calendar may use for the calendar's colour
 * @returns {{ ics: string, added: object[], skipped: object[] }}
 */
export function buildCalendar({
  courses, terms, include = 'both', parts = 'all', alarmMinutes = 0,
  calendarName = 'Western Classes', now = new Date(), refreshHours = null, calendarColor = null,
}) {
  const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Taras Koval//Western Calendar//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`, 'X-WR-TIMEZONE:America/Toronto',
    // Hints for subscribed calendars. Two spellings: the official one, and the
    // older one that Apple Calendar and Outlook actually read.
    ...(refreshHours ? [`REFRESH-INTERVAL;VALUE=DURATION:PT${refreshHours}H`, `X-PUBLISHED-TTL:PT${refreshHours}H`] : []),
    // Apple's own (unofficial) line for a calendar's colour. Other apps ignore it.
    ...(/^#[0-9A-Fa-f]{6}$/.test(calendarColor ?? '') ? [`X-APPLE-CALENDAR-COLOR:${calendarColor.toUpperCase()}`] : []),
    ...TIMEZONE,
  ];
  const added = [];
  const skipped = [];
  const seen = new Set();   // the same class listed twice is only added once

  for (const course of courses) {
    if (!partIncluded(course.component, parts)) continue;  // left out on purpose, not "skipped"
    const code = `${course.subject} ${course.number}`;
    const periods = periodsFor(course.number, terms, include);
    const notPlaced = whyNotPlaced(course.number);

    for (const meeting of course.meetings ?? []) {
      const weekdays = (meeting.days ?? []).map(d => DAYS[d]).filter(d => d !== undefined);
      if (!weekdays.length || !meeting.start || !meeting.end) {
        skipped.push({ code, component: course.component, reason: course.delivery || 'No set time' });
        continue;
      }
      if (notPlaced) {
        skipped.push({ code, component: course.component, reason: notPlaced });
        continue;
      }

      for (const term of periods) {
        const season = term.season;
        // First class = first matching weekday on or after the term's first day
        // (or the course's own first date, if it starts later).
        // Lectures: weekly from the first class to the end, minus days off.
        // Labs and tutorials: their exact days (every other week, pushed back
        // past days off, or picked by hand), written as a weekly rule from the
        // first one to the last one, minus every week they don't happen.
        let first, lastDay, skip;
        if (isLabPart(course.component)) {
          const days = labDays(course, meeting, term);
          if (!days.length) continue;
          const happens = new Set(days);
          first = toDate(days[0]);
          lastDay = toDate(days.at(-1));
          skip = possibleDays(meeting, term).map(d => d.iso).filter(iso => iso > days[0] && iso < days.at(-1) && !happens.has(iso));
        } else {
          const window = meetingWindow(course, meeting, term);
          if (!window) continue;
          first = window.first;
          lastDay = window.until;
          skip = (term.no_class_dates ?? []).filter(day => weekdays.includes(toDate(day).getUTCDay()));
        }
        // UNTIL is in UTC: 03:59:59Z the next day = after any class, in EST or EDT.
        const until = ymd(addDays(lastDay, 1)) + 'T035959Z';

        // Everything that makes this event different from the others goes into
        // its UID, so two events in one calendar can never share one.
        const uidSource = [code, course.component, course.section, meeting.days.join(''),
          meeting.start, meeting.end, meeting.room ?? '', season, term.starts_on].join('|');
        if (seen.has(uidSource)) continue;
        seen.add(uidSource);
        const details = [course.title, `${course.component} section ${course.section}`];
        if (course.instructor && course.instructor.toLowerCase() !== 'staff') details.push(`Instructor: ${course.instructor}`);
        if (course.classNbr) details.push(`Class Nbr: ${course.classNbr}`);
        if (course.delivery) details.push(course.delivery);

        lines.push(
          'BEGIN:VEVENT',
          `UID:${stableId(uidSource)}@western-calendar`,
          `DTSTAMP:${stamp}`,
          `SUMMARY:${escapeText(`${code} ${course.component}`)}`,
          `DTSTART;TZID=America/Toronto:${ymd(first)}T${hhmmss(meeting.start)}`,
          `DTEND;TZID=America/Toronto:${ymd(first)}T${hhmmss(meeting.end)}`,
          `RRULE:FREQ=WEEKLY;BYDAY=${weekdays.map(d => ICAL_DAYS[d]).join(',')};UNTIL=${until}`,
          `DESCRIPTION:${escapeText(details.join('\n'))}`,
        );
        if (meeting.room) lines.push(`LOCATION:${escapeText(meeting.room)}`);
        for (const day of skip) {
          lines.push(`EXDATE;TZID=America/Toronto:${ymd(toDate(day))}T${hhmmss(meeting.start)}`);
        }
        if (alarmMinutes > 0) {
          lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(code)}`,
            `TRIGGER:-PT${alarmMinutes}M`, 'END:VALARM');
        }
        lines.push('END:VEVENT');
        added.push({ code, component: course.component, days: meeting.days, start: meeting.start,
          end: meeting.end, room: meeting.room ?? '', season });
      }
    }
  }

  lines.push('END:VCALENDAR');
  return { ics: lines.map(fold).join('\r\n') + '\r\n', added, skipped };
}
