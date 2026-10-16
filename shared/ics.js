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
const SUFFIX_SEASONS = {
  A: ['fall'], F: ['fall'], Q: ['fall'], R: ['fall'],
  B: ['winter'], G: ['winter'], S: ['winter'], T: ['winter'],
  E: ['fall', 'winter'], Y: ['fall', 'winter'], Z: ['fall', 'winter'],
};

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
    .replaceAll('\\', '\\\\').replaceAll(';', '\;')
    .replaceAll(',', '\\,').replaceAll('\n', '\\n');
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
  return SUFFIX_SEASONS[courseNumber.slice(-1).toUpperCase()] ?? [];
}

/* ---------- the main function ---------- */

/**
 * @param {object}   options
 * @param {object[]} options.courses       classes from the schedule reader
 * @param {object[]} options.terms         term rows (fall and/or winter)
 * @param {'fall'|'winter'|'both'} [options.include]
 * @param {number}   [options.alarmMinutes] 0 = no reminder
 * @param {string}   [options.calendarName]
 * @param {Date}     [options.now]          only used for the DTSTAMP field
 * @param {number}   [options.refreshHours] for subscriptions: how often apps should re-check
 * @returns {{ ics: string, added: object[], skipped: object[] }}
 */
export function buildCalendar({
  courses, terms, include = 'both', alarmMinutes = 0,
  calendarName = 'Western Classes', now = new Date(), refreshHours = null,
}) {
  const termBySeason = Object.fromEntries(terms.map(t => [t.season, t]));
  const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Taras Koval//Western Calendar//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`, 'X-WR-TIMEZONE:America/Toronto',
    // Hints for subscribed calendars. Two spellings: the official one, and the
    // older one that Apple Calendar and Outlook actually read.
    ...(refreshHours ? [`REFRESH-INTERVAL;VALUE=DURATION:PT${refreshHours}H`, `X-PUBLISHED-TTL:PT${refreshHours}H`] : []),
    ...TIMEZONE,
  ];
  const added = [];
  const skipped = [];

  for (const course of courses) {
    const code = `${course.subject} ${course.number}`;
    const seasons = seasonsFor(course.number)
      .filter(season => include === 'both' || include === season)
      .filter(season => termBySeason[season]);

    for (const meeting of course.meetings ?? []) {
      const weekdays = (meeting.days ?? []).map(d => DAYS[d]).filter(d => d !== undefined);
      if (!weekdays.length || !meeting.start || !meeting.end) {
        skipped.push({ code, component: course.component, reason: course.delivery || 'No set time' });
        continue;
      }

      for (const season of seasons) {
        const term = termBySeason[season];
        // First class = first matching weekday on or after the term's first day.
        let first = toDate(term.starts_on);
        while (!weekdays.includes(first.getUTCDay())) first = addDays(first, 1);
        // UNTIL is in UTC: 03:59:59Z the next day = after any class, in EST or EDT.
        const until = ymd(addDays(toDate(term.ends_on), 1)) + 'T035959Z';

        const uidSource = [code, course.component, course.section, meeting.days.join(''),
          meeting.start, season, term.starts_on].join('|');
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
        for (const day of term.no_class_dates ?? []) {
          if (weekdays.includes(toDate(day).getUTCDay())) {
            lines.push(`EXDATE;TZID=America/Toronto:${ymd(toDate(day))}T${hhmmss(meeting.start)}`);
          }
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
