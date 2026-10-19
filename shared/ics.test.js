// Automated tests for ics.js. Run from the project folder with:  node --test shared/ics.test.js
// Uses made-up classes so no real schedule is ever committed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendar, seasonsFor, periodsFor, whyNotPlaced, meetingDays } from './ics.js';

const terms = [
  { season: 'fall', starts_on: '2026-09-09', ends_on: '2026-12-09',
    no_class_dates: ['2026-09-30', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'],
    quarters: { Q: ['2026-09-09', '2026-10-28'], R: ['2026-10-29', '2026-12-09'] } },
  { season: 'winter', starts_on: '2027-01-04', ends_on: '2027-04-09',
    no_class_dates: ['2027-02-15', '2027-02-16', '2027-02-17', '2027-02-18', '2027-02-19', '2027-03-26'],
    quarters: { S: ['2027-01-04', '2027-02-12'], T: ['2027-02-22', '2027-04-09'] } },
];
const fallClass = {
  subject: 'TEST', number: '1000A', component: 'LEC', section: '001', title: 'Testing, Part I',
  instructor: 'Staff', delivery: 'In Person',
  meetings: [{ days: ['M', 'W'], start: '14:30', end: '15:30', room: 'MC-110' }],
};
const winterClass = { ...fallClass, number: '2000B', meetings: [{ days: ['F'], start: '08:30', end: '10:30', room: 'NSC-1' }] };
const onlineClass = { ...fallClass, number: '3000G', delivery: 'Online', meetings: [{ days: [], start: null, end: null }] };
const fixedNow = new Date('2026-10-15T12:00:00Z');

test('course letters map to the right terms', () => {
  assert.deepEqual(seasonsFor('1000A'), ['fall']);
  assert.deepEqual(seasonsFor('2000B'), ['winter']);
  assert.deepEqual(seasonsFor('1026E'), ['fall', 'winter']);
});

test('first class is the first matching weekday of the term', () => {
  // Sep 9 2026 is a Wednesday, so a Mon/Wed class starts that day.
  const { ics } = buildCalendar({ courses: [fallClass], terms, now: fixedNow });
  assert.match(ics, /DTSTART;TZID=America\/Toronto:20260909T143000/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261210T035959Z/);
});

test('days off are skipped only on days the class meets', () => {
  const { ics } = buildCalendar({ courses: [fallClass], terms, now: fixedNow });
  const exdates = ics.match(/EXDATE[^\r]*/g);
  // Mon Oct 12 + Wed Sep 30 + Wed Oct 14 — but not Tue/Thu/Fri.
  assert.equal(exdates.length, 3);
});

test('"include" picks one term', () => {
  const both = buildCalendar({ courses: [fallClass, winterClass], terms, now: fixedNow });
  const fallOnly = buildCalendar({ courses: [fallClass, winterClass], terms, include: 'fall', now: fixedNow });
  assert.equal(both.added.length, 2);
  assert.deepEqual(fallOnly.added.map(a => a.season), ['fall']);
});

test('online classes with no time are reported, not added', () => {
  const { added, skipped } = buildCalendar({ courses: [onlineClass], terms, now: fixedNow });
  assert.equal(added.length, 0);
  assert.equal(skipped[0].reason, 'Online');
});

test('special characters are escaped and long lines folded', () => {
  const { ics } = buildCalendar({ courses: [fallClass], terms, alarmMinutes: 10, now: fixedNow });
  assert.match(ics, /Testing\\, Part I/);
  assert.match(ics, /TRIGGER:-PT10M/);
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75);
});

test('the same class always gets the same UID', () => {
  const a = buildCalendar({ courses: [fallClass], terms, now: fixedNow }).ics.match(/UID:\S+/)[0];
  const b = buildCalendar({ courses: [fallClass], terms, now: new Date() }).ics.match(/UID:\S+/)[0];
  assert.equal(a, b);
});

test('subscriptions get a refresh hint; downloads do not', () => {
  const feed = buildCalendar({ courses: [fallClass], terms, refreshHours: 6, now: fixedNow }).ics;
  const file = buildCalendar({ courses: [fallClass], terms, now: fixedNow }).ics;
  assert.match(feed, /REFRESH-INTERVAL;VALUE=DURATION:PT6H/);
  assert.match(feed, /X-PUBLISHED-TTL:PT6H/);
  assert.doesNotMatch(file, /REFRESH-INTERVAL/);
});

test('every Western course letter is handled', () => {
  assert.deepEqual(seasonsFor('1020'), ['fall', 'winter']);   // no letter = full year
  assert.deepEqual(seasonsFor('1030W'), ['fall']);            // accelerated, first term
  assert.deepEqual(seasonsFor('1030X'), ['winter']);          // accelerated, second term
  assert.deepEqual(seasonsFor('2100F'), ['fall']);
  assert.deepEqual(seasonsFor('2100G'), ['winter']);
  assert.deepEqual(seasonsFor('3000Y'), []);                  // outside Fall/Winter
  assert.match(whyNotPlaced('3000Y'), /outside the Fall\/Winter/);
  assert.match(whyNotPlaced('5000V'), /unusual course letter \(V\)/);
  assert.equal(whyNotPlaced('1000A'), null);
});

test('quarter courses only get their six weeks', () => {
  const [q] = periodsFor('1500Q', terms);
  assert.equal(q.starts_on, '2026-09-09');
  assert.equal(q.ends_on, '2026-10-28');
  assert.deepEqual(q.no_class_dates, ['2026-09-30', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
  const [t] = periodsFor('1500T', terms);
  assert.equal(t.starts_on, '2027-02-22');
  assert.deepEqual(t.no_class_dates, ['2027-03-26']);
  const { ics } = buildCalendar({ courses: [{ ...fallClass, number: '1500R' }], terms, now: fixedNow });
  assert.match(ics, /DTSTART;TZID=America\/Toronto:20261102T143000/);   // Oct 29 is a Thursday, so the first Mon/Wed is Nov 2
});

test('full-year courses with no letter fill both terms', () => {
  const { added } = buildCalendar({ courses: [{ ...fallClass, number: '1020' }], terms, now: fixedNow });
  assert.deepEqual(added.map(a => a.season), ['fall', 'winter']);
});

test('courses outside Fall/Winter are reported, not dropped silently', () => {
  const { added, skipped } = buildCalendar({ courses: [{ ...fallClass, number: '3000Y' }], terms, now: fixedNow });
  assert.equal(added.length, 0);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /outside the Fall\/Winter/);
});

test('semicolons in text are escaped', () => {
  const { ics } = buildCalendar({ courses: [{ ...fallClass, title: 'Labs; Lectures' }], terms, now: fixedNow });
  assert.match(ics, /Labs\\; Lectures/);
});

test('line breaks inside text cannot add extra calendar lines', () => {
  const { ics } = buildCalendar({ courses: [{ ...fallClass, title: 'Evil\r\nSUMMARY:Hacked\rX' }], terms, now: fixedNow });
  assert.ok(!ics.includes('\r\nSUMMARY:Hacked'));
  assert.ok(!/\r(?!\n)/.test(ics));   // no lone carriage returns
});

test('every event in a calendar has its own UID, and exact duplicates are added once', () => {
  const lab = { ...fallClass, component: 'LAB', meetings: [
    { days: ['Tu'], start: '09:30', end: '10:30', room: 'A' },
    { days: ['Tu'], start: '09:30', end: '11:30', room: 'B' },   // same start, different end/room
  ] };
  const { ics, added } = buildCalendar({ courses: [lab, lab], terms, now: fixedNow });   // the row listed twice
  const uids = ics.match(/^UID:.*$/gm);
  assert.equal(new Set(uids).size, uids.length);
  assert.equal(added.length, 2);
});

test('calendar colour: added only when it is a real #RRGGBB colour', () => {
  const withColour = buildCalendar({ courses: [fallClass], terms, calendarColor: '#c9562e' }).ics;
  assert.match(withColour, /\r?\nX-APPLE-CALENDAR-COLOR:#C9562E\r?\n/);
  assert.doesNotMatch(buildCalendar({ courses: [fallClass], terms }).ics, /X-APPLE-CALENDAR-COLOR/);
  assert.doesNotMatch(buildCalendar({ courses: [fallClass], terms, calendarColor: 'red;X-EVIL:1' }).ics, /X-APPLE-CALENDAR-COLOR|X-EVIL/);
});

const labClass = { ...fallClass, component: 'LAB', section: '003', meetings: [{ days: ['W'], start: '10:30', end: '11:30', room: 'UCC-37' }] };

test('parts: lectures only leaves labs out; labs only leaves lectures out', () => {
  const both = buildCalendar({ courses: [fallClass, labClass], terms, include: 'fall' }).added.map(a => a.component);
  assert.deepEqual([...new Set(both)].sort(), ['LAB', 'LEC']);
  assert.ok(buildCalendar({ courses: [fallClass, labClass], terms, include: 'fall', parts: 'lectures' }).added.every(a => a.component === 'LEC'));
  assert.ok(buildCalendar({ courses: [fallClass, labClass], terms, include: 'fall', parts: 'labs' }).added.every(a => a.component === 'LAB'));
});

test('every other week, with first and last dates', () => {
  const lab = { ...labClass, repeat: { every: 2, first: '2026-09-16', last: '2026-11-25' } };
  const ics = buildCalendar({ courses: [lab], terms, include: 'fall' }).ics;
  assert.match(ics, /DTSTART;TZID=America\/Toronto:20260916T103000/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;INTERVAL=2;WKST=MO;BYDAY=WE;UNTIL=20261126T035959Z/);
  const days = meetingDays(lab, lab.meetings[0], terms[0]).map(d => d.iso);
  assert.deepEqual(days, ['2026-09-16', '2026-09-30', '2026-10-14', '2026-10-28', '2026-11-11', '2026-11-25']);
});

test('a first date after the term ends adds nothing for that term', () => {
  const lab = { ...labClass, repeat: { every: 1, first: '2026-12-20', last: null } };
  assert.equal(buildCalendar({ courses: [lab], terms, include: 'fall' }).added.length, 0);
});
